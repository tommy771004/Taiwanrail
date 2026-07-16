# Disable the Page View Function and measure engaged use with Queries

## Decision

The client must not send `POST /api/log-pageview`, and production must not deploy a
Page View serverless function. Completed route searches continue to send `POST /api/log`.

The retired `/api/log-pageview` path should additionally be denied with a path-specific
Vercel Firewall rule. The rule must not challenge or deny `/`, static assets, SEO pages,
Crawlers, countries, or the Query endpoint.

## Why

Synthetic traffic repeatedly rendered the SPA and submitted Page View events without
performing route searches. Filtering inside the Function protected the database but still
spent a Function invocation before the filter could run. Page Views were therefore both a
noisy behavior metric and an avoidable compute cost on the Vercel Hobby plan.

## Consequences

- Opening the website remains a static CDN operation and does not depend on analytics.
- `query_logs` is the source of truth for engaged use.
- Historical rows in `page_view_logs` remain untouched but receive no new application writes.
- The Firewall rule protects the retired path from stale clients or direct POSTs before they
  reach application code.
- Operators lose a first-party count of passive opens; this is intentional because passive
  opens were not reliably attributable to Users.
