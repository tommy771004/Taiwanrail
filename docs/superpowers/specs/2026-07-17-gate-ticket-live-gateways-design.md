# Spec: Gate ticket for live gateways (ADR-0005)

Status: ready-for-agent  
Source: `docs/adr/0005-gate-ticket-for-live-gateways.md`, `CONTEXT.md` (Resource abuse & live gateways)

## Gap audit (ADRs vs code)

| ADR | Status |
|-----|--------|
| 0001 Query throttle | Done |
| 0002 Disable Page View Function | Done |
| 0003 Gate Alert on engaged search | Done |
| 0004 Origin/Host on public Functions | Done |
| 0005 Gate ticket + dual auth on live gateways | **Not implemented** (API abuse throttle 60s/30 exists as partial scaffolding) |

## Problem

Origin/Host alone still allows bare clients on safe GETs without Origin (or simple same-origin automation) to burn TDX credentials and Vercel Function quota through `/api/tdx/*`, `/api/geocode`, and `/api/youbike`.

## Solution

Live gateways require a **Gate ticket**: a short-lived HMAC-signed anonymous credential (~10 minutes) returned in the mint response body, bound to an HttpOnly cookie that carries only the **jti**. Live requests must present a valid ticket **and** pass Origin/Host (ADR-0004). Missing-Origin safe GETs without a valid ticket are **denied**.

### Endpoints

1. **`POST /api/gate`** — mint or silent-refresh a ticket  
   - Requires allowed Origin/Host (mutating method → Origin required).  
   - Sliding mint limit: **60s / 10** per client identity (IP).  
   - Body: `{ ticket: string, expiresAt: number }` (expiresAt = epoch ms).  
   - `Set-Cookie: tr_gate_jti=<jti>; HttpOnly; Path=/; Max-Age=600; SameSite=Lax` (+ `Secure` when not localhost).  
   - Silent refresh: client may POST while holding a still-valid ticket in the last ~2 minutes; mint limit still applies.  
   - Gate escalation: after roughly **≥3** API abuse throttle hits in **~10 minutes** for the same identity, refuse issue/refresh for **~15 minutes**.

2. **Live gateways** (require ticket + cookie jti + Origin/Host + abuse throttle):  
   - `/api/tdx/*` (shared `runTdxProxyHttp`)  
   - `/api/geocode`  
   - `/api/youbike`  

3. **Out of Gate scope** (unchanged): `/api/log`, `/api/feedback`, static `/data/*`, HTML/SEO.

### Ticket format

Compact signed token (not full JWT library):

```
base64url(JSON.stringify({ jti, iat, exp })) + "." + base64url(HMAC-SHA256(secret, payloadPart))
```

- `jti`: random 16+ bytes hex  
- `iat` / `exp`: epoch ms; `exp - iat ≈ 10 * 60_000`  
- Secret: `GATE_SECRET` env; if unset on localhost/dev, process-local ephemeral secret (never empty in production — production mint/verify fail closed without secret).

### Live request presentation

- Header: `Authorization: Bearer <ticket>` (preferred) or `X-Gate-Ticket: <ticket>`  
- Cookie: `tr_gate_jti` must equal claims.jti  
- OPTIONS preflight remains Origin/Host only (no ticket) so browsers can mint later

### Client (SPA)

- `src/lib/gateTicketClient.ts`: in-memory ticket cache; `ensureGateTicket()` mints if missing/near-expiry; attaches Authorization on live fetches with `credentials: 'include'`.  
- Wire into `fetchTDXApi`, booking deeplink fetch, `getNearestYouBike`, geocode fetch.  
- Failures degrade as today (mock/empty) without blocking static-data-first search.

### Throttles (unchanged numbers)

| Control | Window | Max | Surface |
|---------|--------|-----|---------|
| Query throttle | 10s | 8 | Search UX + query log IP |
| Gate mint | 60s | 10 | POST /api/gate |
| API abuse | 60s | 30 | Live gateway use |
| Gate escalation | 10m / 3 abuse hits → 15m refuse mint | process-local |

### Local runtime

- Express (`server.ts`): `POST /api/gate` + pass ticket/cookie into `runTdxProxyHttp`.  
- Vite dev middleware for geocode/youbike: enforce the same pure policy helpers (or skip only when secret is ephemeral localhost — still mint via Express).  
- Prefer: SPA always mints via `/api/gate` on Express; live calls carry ticket.

### Testing seam

- Pure crypto sign/verify with fixed secret + deterministic clock.  
- Pure auth decision: ticket + cookie + Origin combinations.  
- Mint throttle + escalation stores with reset helpers.  
- `runTdxProxyHttp` denies without ticket; allows with valid dual-auth.  
- No network, no real TDX credentials.

### Out of scope

- Captcha, Redis/KV, global bans, crawler blocks, throttling `/data/*`  
- Changing Query throttle UX  
- probe-routing CLI script  
- CSP/meta changes beyond Allow-Headers for Authorization if needed in CORS responses

## Success criteria

1. Bare curl GET `/api/tdx/...` without ticket → 401/403, no gateway execute.  
2. SPA with mint → live calls work; static timetable search still works offline of live APIs.  
3. Foreign Origin still denied even with a forged ticket string.  
4. Escalation refuses mint after repeated abuse throttle hits.  
5. Focused tests green; `npm run lint` green.
