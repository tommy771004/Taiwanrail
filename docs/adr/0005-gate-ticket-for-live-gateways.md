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

## Amendment 2026-10-14: ticket travels as `X-Gate-Ticket`; TDX responses are CDN-shared

The SPA now sends the ticket as `X-Gate-Ticket` instead of `Authorization: Bearer`
(every gated Function already accepted both). Vercel's CDN never caches a request that
carries `Authorization`, and the TDX proxy now marks cacheable responses with
`Vercel-CDN-Cache-Control: max-age=<remaining in-memory TTL>` so every visitor shares one
upstream call per URL per TTL instead of one per serverless instance.

Consequence: a response already in the CDN is served without running the Function, so a
bare client can read it without a ticket until it expires. That costs neither TDX quota nor
Function invocations, which is what this ADR protects; any URL not in the CDN still goes
through the full ticket + cookie + Origin check. STALE fallbacks, errors other than 404 and
booking deep links are never handed to the CDN.

## Amendment 2026-11-05: continuous-use limit and live client version

One Windows Chrome client in Singapore sent 2.1k requests a day on a fixed two-minute rhythm,
about 90 % of the live paths, and Bot Protection did not stop it. It most likely was a forgotten
tab: bundles from 10/22 to 11/04 poll with no idle or midnight stop, and an open tab never gets a
new bundle. Every stop rule lived in the browser, so a stale bundle or a script could ignore them.

**Decision.** `/api/gate` refuses to renew a chain of tickets after **6 hours** of continuous
renewal (`GATE_CHAIN_LIMIT_MS`), answering 403 with `code: reload_required`. A break longer than
**15 minutes** (`GATE_CHAIN_GAP_MS`) ends the chain. The state is a signed HttpOnly cookie
(`tr_gate_chain`), not a ticket claim, because every bundle drops its ticket after a refusal and
asks again without one, which would restart a ticket-held count. Refusals rewrite the cookie, so a
tab that keeps asking never looks like a break.

A page load starts a new chain with `X-Gate-New-Page: 1` on its first mint. Bundles older than this
amendment never send that header, so they stay refused until they reload, and a reload gets the
current bundle. The gate also reports `minClientVersion` (`LIVE_CLIENT_VERSION`); a bundle built
with a lower number, or refused as above, stops all live calls and shows a reload prompt. Bump that
constant only when open tabs must stop: data deploys happen daily and must not interrupt anyone.

**Limits.** This raises the cost of abuse; it is not a ban. A script can send the header or drop
cookies to restart its chain, and that is what Vercel Firewall remains for. The proxy never sees a
CDN hit, so a refused tab can still read shared cached responses, which costs no TDX call. A
display left running over 6 hours stops updating live data until someone reloads it; timetables
keep working.
