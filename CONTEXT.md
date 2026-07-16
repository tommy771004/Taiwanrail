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
Throttle accounting over a fixed recent duration (here: last 10 seconds); when under the limit again, Queries are allowed with no extra lockout.
_Avoid_: cooldown ban, penalty ladder

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

## Agreed product rules (TDX proxy authorization)

- **Purpose of the live TDX gateway:** serve legitimate browser Users of this product — not act as an open proxy for arbitrary Attacker traffic.
- **Primary controls:** when Origin is present it must match known Hosts (same deployment Host, canonical production, localhost — not “any Vercel app” against production). Forgeable browser-hint headers are not trusted.
- **Missing Origin:** allowed for safe methods (GET/HEAD/OPTIONS) so same-origin SPA reads keep working; denied for writes (POST). Resource abuse without Origin is limited by path allowlist + rate limit.
- **Path policy:** Origin/Host validation when Origin is sent. The shared gateway refuses unsafe / non-product paths as blast-radius defense-in-depth; rate limits and Firewall remain deepening / emergency controls.
- **Deepening controls:** HTTP method limits; server-side API abuse throttle on the TDX proxy (**60s / 30** per client identity); Firewall for P0 emergency containment.
- **Other public Functions** (Query log, feedback, geocode, youbike): same fail-closed browser Origin/Host policy as the TDX proxy.
- **CSP:** one source of truth on HTTP response headers (`vercel.json` in production; local Express applies the same header set). Do not ship a CSP `<meta>` in the HTML shell.
- **Public error bodies:** live gateway HTTP failures return a generic message to clients (no raw exception text).
- **Static-first unchanged:** ordinary timetable/fare Route Searches still prefer committed static data; the gateway remains live fallback and live-only features.
