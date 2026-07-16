# Taiwanrail product & analytics

Bilingual Taiwan rail/metro search product. This glossary covers how we talk about
**traffic, measurement, and abuse controls** — not implementation details.

## Language

### Traffic & actors

**User**:
A person using the product to look up journeys (timetable, fare, stops, planner).
_Avoid_: visitor (ambiguous), client, account

**Crawler**:
An automated agent that fetches pages or files for indexing or AI answers (e.g. search engines, GPTBot). Expected to read public HTML and respect robots where applicable.
_Avoid_: bot (too broad — mixes crawlers, abuse, and synthetic traffic)

**Synthetic traffic**:
Automated traffic that renders or hits the app without genuine journey-seeking intent (e.g. identical browser fingerprints opening `/` at scale). Not the same as a Crawler.
_Avoid_: bot, spam (unless clearly abusive)

**Attacker**:
An external party with no product account who tries to abuse, pollute, extract secrets, or compromise the public site or its live gateways. Distinct from a Crawler (indexing) and from Synthetic traffic (noise without necessarily targeting cost or integrity).
_Avoid_: bot, hacker (vague), user (reserved for legitimate journey-seekers)

**Resource abuse**:
Using live Functions or the TDX gateway as free capacity or an open proxy, without legitimate journey-seeking intent — burning quota, credentials budget, or plan limits.
_Avoid_: DDoS (volumetric flood is a narrower tactic), scraping (may be benign)

**Log pollution**:
Writing fake or bulk **Query** (or feedback) events so analytics or storage no longer reflect real Engaged use.
_Avoid_: spam (unless clearly about messages), injection (too implementation-specific)

**Information disclosure**:
Unintended exposure of secrets, internal errors, credentials, or infrastructure details through responses, headers, or client assets.
_Avoid_: data breach (implies bulk user PII; this product has no accounts)

**Client-side compromise**:
Attacks that run in the User's browser (e.g. script injection, CSP bypass, hostile third-party script) rather than only against server endpoints.
_Avoid_: XSS alone (one technique among several)

### Measurement

**Page View**:
A historical “app opened / route shell loaded” analytics event. It is no longer collected because
automated opens consumed Vercel Function invocations without proving real use.
_Avoid_: visit, hit, session (session is separate)

**Query** (also **Route Search**):
A deliberate search the User submits for an origin–destination (rail, HSR, metro, or journey planner). This is the primary signal of real product use.
_Avoid_: page view, request, API call

**Engaged use**:
Product use evidenced by one or more Queries (and similar intentional actions), not by Page Views alone.
_Avoid_: traffic, DAU based only on page views

### Controls

**Page View endpoint deny**:
A Vercel Firewall rule that rejects the retired `/api/log-pageview` path before it can invoke a
Function. It does not block the website, static assets, Crawlers, or Query submission.
_Avoid_: site ban, geo block

**Query throttle**:
A rate limit on Query submission so burst abuse does not spam search UX or query logs. Does not redirect the User off-site.
_Avoid_: ban, captcha (unless explicitly introduced later)

**Sliding window**:
Throttle accounting over a fixed recent duration (here: last 10 seconds for Query; other windows are stated with their control); when under the limit again, events are allowed with no extra lockout for that control alone.
_Avoid_: cooldown ban, penalty ladder (reserved language for Query UX — see Gate escalation for live APIs)

**Gate ticket**:
A short-lived, server-signed anonymous credential proving a client recently obtained access from an allowed product Origin. Presented on live gateway calls together with a browser-held binding cookie. Not a User account and not a secret API key for third parties.
_Avoid_: session (ambiguous with analytics), API key, captcha token, bot score

**API abuse throttle**:
A coarser sliding-window limit on live gateway invocations per client identity (here: **60s / 30**), separate from Query throttle. Protects Function and upstream quota, not search-button UX.
_Avoid_: Query throttle (different surface and window)

**Gate escalation**:
A soft, best-effort step-up after repeated API abuse throttle hits from the same identity: refuse new Gate tickets / refresh for a short period (and may shorten remaining ticket life). Not a site-wide ban and not applied to Query submission UX.
_Avoid_: penalty ladder (Query language), ban, captcha, Firewall (Firewall is P0 emergency, not this product step)

**Live gateway**:
A product Function that spends upstream quota or credentials on behalf of the browser (TDX proxy, geocode, YouBike; probe-style helpers in the same class). Distinct from Query log, feedback, and static `/data/*`.
_Avoid_: API (too broad), proxy alone (TDX is one live gateway among several)

## Agreed product rules (analytics & throttle)

These are product decisions, kept here only as constraints on the language above:

- **Primary measurement of real use**: Query, not Page View.
- **Page View collection**: disabled; do not deploy or call a Page View Function.
- **Retired endpoint**: deny only `/api/log-pageview` at Vercel Firewall; do not block Crawlers or
  countries/regions from the site.
- **Query abuse**: throttle with sliding window **10s / 8 Queries** per identity; soft UX (disable + neutral message), not external redirect.
- **Identity**: browser session for UX; IP as coarse backend net for query-log writes.
- **Scope**: one shared bucket across train / HSR / metro / planner; count only submitted searches.
- **Static timetable assets** (`/data/*`) are not throttled by this rule.

## Agreed product rules (security threat priority)

For authorized penetration / adversarial review of the public product:

- **Primary threats (priority order):** Resource abuse → Log pollution → Information disclosure → Client-side compromise.
- **Not primary for app-level review:** pure platform account / DNS / Vercel-console takeover (separate engagement).
- **No product accounts:** Attacker model is unauthenticated by default.
- **Engagement intensity:** phased A (recon) → B (bounded abuse proof) → C (aggressive, time/rate gated); success is proof of abuse or bypass, not site outage; stop on real User harm, widespread TDX 429, or quota alerts.
- **Scope:** in-scope is the public product origin only; TDX, DB, YouBike, geocode, and ads are through-app only (no direct attack on third parties); platform consoles out of scope.
- **Engagement outcome:** findings list plus fixes; P0–P2 must be fixed to close; P3 fixed or explicitly accepted risk; P4 out of product scope.
- **Authorization:** owner-authorized testing of the public product origin; prefer off-peak for B/C; on P0 stop testing and remediate first; retain minimal repro evidence only (no full secrets in public trackers).

## Agreed product rules (Resource abuse & live gateways)

- **Goal of “anti-abuse” here:** reduce **Resource abuse** on live gateways — not block Crawlers, not hide public HTML/SEO pages, not throttle static `/data/*` timetable assets.
- **Success bar:** stop casual open-proxy use and measurable single-identity burn; accept residual risk from determined multi-IP abuse and same-origin automation (bounded by throttles; P0 uses Firewall).
- **Gate ticket required** on live gateways (TDX proxy, geocode, YouBike; same class for probe helpers): short-lived signed ticket (**~10 minutes**) plus HttpOnly binding cookie (jti); silent refresh in the last ~2 minutes when allowed.
- **Issuance:** only from an allowed browser Origin/Host; ticket minting itself is rate-limited (target **60s / 10** per client identity).
- **Dual authorization on live calls:** valid Gate ticket **and** Origin/Host policy. Safe methods without a valid ticket are **not** treated as open; bare clients cannot rely on missing Origin alone.
- **API abuse throttle:** **60s / 30** per client identity on live gateway use (separate from Query throttle **10s / 8**).
- **Gate escalation:** within ~**10 minutes**, about **≥3** API abuse throttle hits → refuse ticket issue/refresh for ~**15 minutes** (best-effort per compute instance; not a global ban). Single over-limit responses use soft rate-limit semantics (e.g. retry timing), not off-site redirect or captcha.
- **Out of Gate ticket scope:** Query log and feedback stay on Origin/Host (+ existing Query/IP rules) without requiring a Gate ticket.
- **Throttle/escalation durability:** process-local best-effort under serverless multi-instance; not a distributed ban list. Cross-instance consistency is not required for v1.
- **P0 containment:** Vercel Firewall path/rate rules; not the default product control.
- **No captcha** in this product rule set unless a later decision introduces it.
- **CSP:** one source of truth on HTTP response headers (`vercel.json` in production; local Express applies the same header set). Do not ship a CSP `<meta>` in the HTML shell.
- **Public error bodies:** live gateway HTTP failures return a generic message to clients (no raw exception text).
- **Static-first unchanged:** ordinary timetable/fare Route Searches still prefer committed static data; live gateways remain live fallback and live-only features.

## Agreed product rules (TDX proxy authorization)

Superseded in part by **Resource abuse & live gateways** (Gate ticket + dual auth). Remaining TDX-specific constraints:

- **Purpose of the live TDX gateway:** serve legitimate browser Users of this product — not act as an open proxy for arbitrary Attacker traffic.
- **Origin/Host:** when Origin is present it must match known Hosts (same deployment Host, canonical production, localhost — not “any Vercel app” against production). Forgeable browser-hint headers are not trusted as the sole control.
- **Path policy:** the shared gateway refuses unsafe / non-product paths as blast-radius defense-in-depth.
- **HTTP methods:** only methods the product uses for the proxy (and OPTIONS for CORS preflight if required).
- **Other public Functions:** Query log and feedback keep fail-closed browser Origin/Host without Gate ticket; geocode and YouBike follow live-gateway Gate ticket rules.
