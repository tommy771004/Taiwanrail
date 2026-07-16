# TDX proxy requires known browser Origin and Host (not an open proxy)

> Live-gateway **Gate ticket** dual-auth and tighter missing-Origin rules for TDX /
> geocode / YouBike are in [ADR-0005](./0005-gate-ticket-for-live-gateways.md).
> Origin/Host matching below remains in force; missing-Origin-only access is no longer
> sufficient where a Gate ticket is required.

## Decision

When a request includes an **Origin** header, it must be a **valid browser Origin**
whose host is the same deployment Host, the canonical product host
(`taiwanrail.vercel.app`), or localhost for development. Malformed Origin values and
foreign Origins (including other `*.vercel.app` apps against production) are **denied**.

**Missing Origin** was historically allowed only for **safe methods** (GET, HEAD, OPTIONS)
so same-origin SPA reads kept working; mutating methods (e.g. POST log/feedback) still
**require** Origin. For **live gateways** under ADR-0005, a valid **Gate ticket** is also
required — missing Origin alone is not an open path. `Sec-Fetch-*` headers are **not**
used for authorization (they are forgeable).

HTTP methods other than those the product uses for the proxy (GET, plus OPTIONS for
CORS preflight if required) are rejected.

**Path policy:** Origin/Host is the primary authorization model. The shared gateway may
still refuse unsafe or non-product paths (traversal, empty path, and the existing
product path set) as blast-radius control; that is defense-in-depth, not a substitute
for Origin/Host. Rate limits and Vercel Firewall remain emergency / deepening controls.

Static-data-first Route Search is unchanged: ordinary timetable and fare use stays on
committed `/data/*` where possible.

## Why

Without a required Origin, any client can invoke `/api/tdx/*` and spend TDX credentials
and Vercel Function quota (**Resource abuse**). Fail-open on missing Origin and allowing
any `*.vercel.app` Origin against production made the proxy easy to drive from third-party
pages. Opening the path surface further would increase blast radius; tightening Origin/Host
stops the unauthenticated open-proxy case first.

## Consequences

- Non-browser clients (bare curl without Origin) can no longer use the production proxy;
  that is intentional.
- Preview deployments still work when the page Origin matches that preview Host.
- Legitimate Users of the SPA are unaffected (browsers send Origin on cross-origin and
  same-site API calls as today).
- Operators should pair P0 incidents with Firewall rules only as temporary containment.
