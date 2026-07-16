# Gate ticket + dual Origin for live gateways (Resource abuse)

## Decision

Treat **Resource abuse** (not crawler blocking or static-data hiding) as the product’s
anti-abuse goal for live Functions. Live gateways — **TDX proxy, geocode, YouBike** (and
probe-style helpers in the same class) — require a **Gate ticket**: a short-lived
server-signed anonymous credential (~**10 minutes**, silent refresh in the last ~**2
minutes**) returned in the response body, bound to an **HttpOnly cookie** that carries only
a **jti**. Live requests must present a valid ticket **and** pass the existing
**Origin/Host** policy (ADR-0004). Missing-Origin safe GETs without a valid ticket are
**denied**.

Ticket minting (`POST` gate endpoint) requires allowed Origin/Host and its own sliding
limit (target **60s / 10** per client identity). Live use keeps the **API abuse throttle**
(**60s / 30**). After roughly **≥3** throttle hits in **~10 minutes**, apply **Gate
escalation**: refuse issue/refresh for ~**15 minutes** (and may shorten remaining ticket
life). Throttle and escalation state remain **process-local best-effort** under serverless
multi-instance; they are not a global ban. **No captcha**; P0 containment stays on
**Vercel Firewall**.

**Query log** and **feedback** stay outside Gate ticket scope (Origin/Host + existing
Query/IP rules only). Static `/data/*` and Crawlers are intentionally unrestricted by this
decision.

## Why

Open live proxies burn TDX credentials and Function quota. Origin/Host alone still allowed
bare clients on safe methods without Origin. A public constant header is trivial to forge;
a signed short-lived ticket raised the bar without product accounts. Binding jti in an
HttpOnly cookie (with Bearer in the app) blocks simple “copy header only” replay while
keeping the SPA model. Dual checks keep cross-site and host-mismatch abuse out of scope
even if a token string leaks. Query throttle stays a separate, softer UX control so search
is not given a penalty ladder.

## Considered options

- **Crawler / full-site bot challenge** — rejected; harms Users, SEO, and AI citation (GEO).
- **Throttle static `/data/*`** — rejected; static-data-first Route Search depends on it.
- **Fixed public client header only** — rejected as sole control; too easy to forge.
- **Full cookie session or IP-bound tokens** — rejected as primary model (complexity / mobile IP churn).
- **Shared Redis/KV for throttle+escalation** — deferred; v1 accepts best-effort per instance.
- **Captcha after escalation** — deferred; not in the current product rule set.

## Consequences

- SPA must mint/refresh Gate tickets before live calls; bare curl against production live
  paths fails without ticket + cookie + allowed Origin rules.
- `GATE_SECRET` (or equivalent) becomes an operational secret; rotation invalidates tickets.
- Multi-instance escalation may engage unevenly until traffic sticks to one instance or P0
  Firewall is used.
- ADR-0004 Origin/Host rules remain; missing-Origin openness for live GETs is **tightened**
  by this ADR whenever a Gate ticket is required.
- Residual risk: same-origin automation and multi-IP abuse still possible within throttle
  budgets; static timetable JSON remains public by design.
