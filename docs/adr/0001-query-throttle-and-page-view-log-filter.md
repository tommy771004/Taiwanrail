# Soft Query throttle + Page View log filter (no access blocking for noise)

We treat **Query** as the real-use metric and **Page View** as noisy. Synthetic traffic that only opens `/` is dropped from Page View analytics via configurable `log-filters` (no geo deny). Burst Query abuse is handled with a **sliding-window Query throttle** (10s / 8, session UX + IP on query log), neutral in-app copy, and **no redirect off-site** and **no full-site crawler block**, so SEO/AI crawlers and normal Users stay unaffected.

## Considered options

- Redirect abusers to google.com — rejected (hostile UX, misses Page View-only synthetic traffic).
- Full-site bot challenge / geo block — rejected as default (hurts Users and AI/SEO).
- Throttle static `/data/*` — rejected for v1 (would risk legitimate search).

## Consequences

- Page View counts will under-count automated opens by design; dashboards should prefer Queries.
- Determined abusers can reset session or change IP; this is acceptable for v1 soft control.
- Filter fingerprints and throttle thresholds may need retuning without changing the product rules above.
