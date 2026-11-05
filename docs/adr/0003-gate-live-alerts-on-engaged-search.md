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

## Superseded 2026-11-05: rail alerts removed

Live rail alerts are gone: no banner, no 「今日停駛」 ticket state, no `TRA/Alert` call. The decision
above no longer applies.

The product owner decided the feature is no longer needed, while reviewing the November rise in TDX
calls. On 2026-11-04 `TRA/Alert` was 242 of the day's calls.

The gateway now refuses `Rail/{TRA,THSR}/Alert` outright (`403`, no token, no upstream call), because
tabs still running an older bundle keep requesting it and an allowed path would bill each one.

Consequence: a same-day cancellation is no longer flagged. Riders see the train as scheduled.
