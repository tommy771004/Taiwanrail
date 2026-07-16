# Gate live TRA Alert polling on an engaged rail search

## Decision

Do not fetch or poll the live TRA Alert endpoint when the SPA merely opens. Start Alert fetching
only after an accepted TRA/THSR route search sets the rail search state to engaged. While that
search remains active, retain the existing five-minute refresh interval.

## Why

TRA Alert is a live-only TDX resource and therefore traverses the Vercel TDX Function. Automated
clients that render the homepage can multiply that Function cost even though they never search.
Static timetables do not have this problem because they are served from committed `/data/*` files.

## Consequences

- Passive opens and Crawlers do not invoke the Alert proxy.
- Users receive live Alert and cancellation information after their first deliberate rail search.
- A direct replay attack against the Alert proxy still requires a path-specific Vercel Firewall
  Deny; that emergency rule intentionally disables live Alert information while active.
