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

### Measurement

**Page View**:
A recorded “app opened / route shell loaded” analytics event. Not proof of real use.
_Avoid_: visit, hit, session (session is separate)

**Query** (also **Route Search**):
A deliberate search the User submits for an origin–destination (rail, HSR, metro, or journey planner). This is the primary signal of real product use.
_Avoid_: page view, request, API call

**Engaged use**:
Product use evidenced by one or more Queries (and similar intentional actions), not by Page Views alone.
_Avoid_: traffic, DAU based only on page views

### Controls

**Log filter**:
Server-side rules that **drop analytics writes** (e.g. noisy Page Views) without blocking the HTTP response or page access. Configurable; must not use country/region as a deny rule.
_Avoid_: block, ban, firewall (those mean denying access)

**Query throttle**:
A rate limit on Query submission so burst abuse does not spam search UX or query logs. Does not redirect the User off-site.
_Avoid_: ban, captcha (unless explicitly introduced later)

**Sliding window**:
Throttle accounting over a fixed recent duration (here: last 10 seconds); when under the limit again, Queries are allowed with no extra lockout.
_Avoid_: cooldown ban, penalty ladder

## Agreed product rules (analytics & throttle)

These are product decisions, kept here only as constraints on the language above:

- **Primary measurement of real use**: Query, not Page View.
- **Page View noise**: Log filter only; do not block Crawlers or geo for SEO/AI.
- **Query abuse**: throttle with sliding window **10s / 8 Queries** per identity; soft UX (disable + neutral message), not external redirect.
- **Identity**: browser session for UX; IP as coarse backend net for query-log writes.
- **Scope**: one shared bucket across train / HSR / metro / planner; count only submitted searches.
- **Static timetable assets** (`/data/*`) are not throttled by this rule.
