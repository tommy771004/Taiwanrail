# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A bilingual (Traditional Chinese / English) single-page web app for searching Taiwan public
transit — timetables, fares, stops, live delays and door-to-door journey planning — covering
**TRA (台鐵, Taiwan Railways)**, **THSR (高鐵, High Speed Rail)**, and **7 metro/light-rail
systems** (Taipei, New Taipei, Taoyuan, Taichung, Kaohsiung MRT + Kaohsiung/Danhai LRT). React 19 +
Vite 6 + Tailwind 4, deployed on Vercel at `taiwanrail.vercel.app`. All transit data originates
from the government **TDX** open API (`tdx.transportdata.tw`); geocoding uses OSM Nominatim and
bike-share uses data.taipei's YouBike feed.

The UI is essentially one monolithic component: `src/App.tsx` (~275KB), which lazy-loads
`JourneyPlanner.tsx` and `MetroSearch.tsx`. Files under `src/components/` and `src/lib/` are
supporting pieces it imports.

## Commands

```bash
npm run dev          # tsx server.ts — Express + Vite middleware + Socket.IO on :3000 (NOT plain `vite`)
npm run build        # generate-route-pages.mjs (SEO pages + sitemap) THEN vite build → dist/
npm run build:ssg    # build + prerender.ts (Puppeteer prerenders SPA entry points)
npm run lint         # tsc --noEmit  ← this is the only "test"/check; there is no unit-test suite
npm run verify:data  # validate core TRA/THSR JSON syntax and minimum collection sizes
npm run test:data-integrity # regression tests for validated atomic dataset replacement
npm run fetch-data       # tsx scripts/fetch-tdx-data.ts — pulls fresh TDX static rail data into public/data/
npm run fetch-metro-data # tsx scripts/fetch-tdx-metro.ts — same, for the 7 metro/LRT systems (public/data/metro_*)
npm run build-metro-floor # regenerate the hardcoded metro-station fallback list (see Metro section)
npm run probe-metro   # tsx scripts/probe-tdx-metro.ts — inspect a live Metro TDX response shape
npm run probe-routing # tsx scripts/probe-routing.ts — inspect a live MaaS Routing response shape
npm run seo:verify     # node scripts/verify-seo.mjs
npm run bundle:verify  # node scripts/verify-bundle.mjs — asserts dist/ chunk count + size budget after build
npm run seo:external-targets # prints prod URLs for manual PageSpeed/Search Console checks
npm run preview      # vite preview (serves dist/)
```

There is no linter beyond `tsc`; targeted data-integrity tests use Node's built-in test runner via `tsx`.

## The core architectural pattern: static-data-first, live-API fallback

This is the single most important thing to understand. The app does **not** hit the live API for
normal searches. Instead:

1. Large TDX datasets are **committed into `public/data/`** (stations, full general timetables,
   fares). `src/lib/api.ts` getters (`getTRATimetableOD`, `getTHSRTimetableOD`, `getTRAODFare`,
   `getTRATrainTimetable`, …) fetch these static JSON files and **filter in-browser** by
   origin/dest/day-of-week.
2. Only if the static file is missing/unreadable does a getter fall back to `fetchTDXApi()` — the
   live proxy path.
3. `fetchTDXApi()` rewrites a full TDX URL → `/api/tdx/*` (relative proxy), with an in-memory
   request cache + in-flight dedup. On error it returns the last cache, else `getMockData()`
   (hand-written sample data so the UI never renders empty).

So: timetable/fare logic lives client-side in `api.ts`; the network layer is a last resort.

### Data refresh pipeline
`scripts/fetch-tdx-data.ts` regenerates `public/data/`. Non-obvious details baked in:
- TDX **force-gzips large responses without a `Content-Encoding` header** — the script detects gzip
  by magic bytes (`0x1f 0x8b`) and decompresses manually.
- TRA `ODFare` full set is ~535MB (> GitHub's 100MB limit), so it is **streamed and split by
  `OriginStationID`** into `public/data/tra-fares/{id}.json` (~2MB each, lazy-loaded per origin).
- `.github/workflows/fetch-tdx-data.yml` runs this every other day, commits changed data, and the
  commit triggers a Vercel redeploy. **Data freshness is a deploy artifact, not runtime.**

## Dual runtime: Vercel vs. local Express

The app runs in two different server environments, and code branches on which one it's in:

- **Production (Vercel):** static SPA + serverless functions in `api/` (`proxy.ts`, `log.ts`,
  `log-pageview.ts`, `feedback.ts`, `youbike.ts`, `geocode.ts`, `probe-routing.ts`). `vercel.json`
  rewrites `/api/tdx/*` → `/api/proxy` and everything non-`/api/` → `/index.html`.
- **Local dev (`server.ts`):** Express serves Vite in middleware mode AND runs a **Socket.IO**
  server that polls TDX LiveBoard every 30s and pushes `delay-update` events to subscribed station
  rooms. Vercel serverless **cannot** hold persistent sockets, so `App.tsx` detects serverless
  hosts via a hostname regex (`*.vercel.app|*.netlify.app|…`) and sets `socket = null`. **The
  realtime-delay push feature only works on the self-hosted Express server.**
- The TDX proxy logic is **duplicated** in `api/proxy.ts` (Vercel) and `server.ts` (local) — keep
  them in sync when changing proxy behavior.
- Vercel functions (`/api/youbike`, `/api/log`, …) don't run under `vite dev`. `vite.config.ts`
  ships a dev-only middleware plugin (`youbikeDevApi`) so `/api/youbike` works locally; query
  logging is simply skipped on `localhost`.

### The proxy injects credentials and works around TDX quirks
Both proxies: cache an OAuth token, attach `Authorization: Bearer`, cache responses with
path-specific TTLs, and serve stale cache on 429/5xx. Critical gotchas encoded there:
- **Forward the original `$`-containing OData query string unencoded.** `URLSearchParams.toString()`
  encodes `$`→`%24`, which TDX's WAF rejects as invalid OData (404/429). The cache *key* is
  normalized/sorted, but the *outbound* URL uses `urlObj.search` verbatim.
- `TRA/Alert` and `*/LiveBoard` paths are rewritten to known-good versions; Alert failures degrade
  to an empty `200 []` rather than surfacing upstream errors.

## TDX data shape gotchas

- **TRA and THSR have separate, colliding StationID numbering.** Both reuse `"1000"`, `"1020"`,
  etc. for different cities. Anything keyed by station must disambiguate by transport type:
  `transfers.ts` keys by **Zh_tw name**; `platformStrategy.ts` uses a `"1000-TRA"` suffix.
- **TDX v2 vs v3 differ structurally** (`DailyTrainInfo` vs `TrainInfo`, envelope keys). `api.ts`
  normalizes via `mapV3ToOD` / `mapV3ToTrainTimetable` / `unwrapArray`, and typically tries v3 then
  falls back to v2.
- **THSR has no LiveBoard or Alert endpoint** (both 404). `getTHSRLiveBoard` / `getTHSRAlerts`
  return `[]` by design — don't "fix" them to call the API.

## Metro (捷運) support

`src/lib/metro.ts` layers over TDX `/v2/Rail/Metro/...` for 7 operators (`METRO_SYSTEMS` in that
file: TRTC/NTMC/TYMC/TMRT/KRTC/KLRT/NTDLRT). It follows the same static-first pattern as rail, but
per-system: `scripts/fetch-tdx-metro.ts` writes weekly snapshots to `public/data/metro_<sys>/`.
Key differences from TRA/THSR:
- There are no OD train numbers. A same-line "journey" is fare (live `ODFare`) plus a
  travel-time/stop list computed from the static `S2STravelTime` snapshot; a cross-line trip shows
  fare only and points the user at 站到站 journey planning (`JourneyPlanner`).
- Station/S2STravelTime/LineTransfer are the main source of TDX 429s (Station is fetched for all 7
  systems on every page load, for geolocation), so they're served from the static snapshot rather
  than live — a 429 falling back to `getMockData()` would otherwise silently break every
  cross-line search (no LineTransfer in the mock). LiveBoard and per-OD `ODFare` intentionally stay
  live.
- `scripts/build-metro-station-floor.mjs` generates a **hardcoded** minimal station list
  (`npm run build-metro-floor`) used only as an offline safety net when TDX 429s collapse the live
  station list to the ~8-station mock — it's a floor, never shown once the live/static list loads.
- Quick "does a transfer exist here" data lives in `transfers.ts` (keyed by Zh_tw station name,
  shared with TRA); the rich walking-directions/floor-guide modal (`TransferMapModal.tsx`,
  `getDetailedTransfers`) is a separate, hand-authored dataset for specific interchange stations —
  don't conflate the two when adding a new transfer point.

## Door-to-door journey planning (MaaS Routing)

`JourneyPlanner.tsx` (lazy-loaded, full-screen modal or inline tab) plans arbitrary-point trips via
`getRouting()` in `api.ts`, which calls the TDX **MaaS Routing API** through the same
`/api/tdx` proxy. The OAS leaves the per-leg `sections` object undocumented, so its shape was
captured by hitting the live endpoint once (`npm run probe-routing`, writes
`scripts/routing-sample.json`) — reconcile `legMeta()`/leg parsing in `api.ts` against that sample
if routing output looks wrong, don't guess field names.
- `api/geocode.ts` proxies OSM Nominatim (no key) so users can start/end a journey at an arbitrary
  place name, not just a station — response cached 1h server-side, requires a `User-Agent` header
  or Nominatim 403s.
- `api/youbike.ts` proxies data.taipei's YouBike2.0 feed to answer "nearest bike station" queries;
  it only covers Taipei City and returns `{ station: null }` beyond 1.5km.
- Both are Vercel functions with a matching dev-only middleware in `vite.config.ts`
  (`geocodeDevApi`/`youbikeDevApi`) so they work under `vite dev` too.

## SEO architecture

SEO is a first-class concern with dedicated build steps:
- `scripts/generate-route-pages.mjs` (runs in **every** `build`) reads the committed datasets,
  computes real stats (fastest time, daily frequency, stops, THSR fares), and emits self-contained
  static HTML landing pages to `public/routes/<transport>/<from>-to-<to>/index.html` plus JSON-LD,
  then overwrites `public/sitemap.xml`.
  - **TRA fares are intentionally NOT published** on these pages (the dataset has unreliable
    distances/prices); only THSR fares are shown. Don't add TRA fares to SEO pages.
- `scripts/prerender.ts` (the `:ssg` build) uses Puppeteer against `vite preview` to prerender the
  SPA entry points (`/`, `/en/`, `?transport=…`) for crawlers.
- In `App.tsx`, `react-helmet-async` manages canonical/hreflang tags, and `INDEXABLE_ROUTE_PATHS`
  maps `transport:fromId:toId` → the canonical static route page so deep-linked searches point at
  an indexable URL. `index.html` carries the base meta/JSON-LD and a strict CSP — new external
  origins (scripts, fonts, `connect-src`) must be added to the CSP meta tag.

## Client-side "intelligence" libs (all localStorage-backed, SSR-guarded)

- `delayReliability.ts` — records observed delay samples per train and blends them with heuristics
  (east-line stations `7x/8x`, cross-line 自強, peak hours) into a reliability score/badge.
- `offlineSnapshot.ts` — snapshots search results to localStorage so the app shows a
  next-departure countdown offline (the app's "offline mode"; there is no service worker — the
  `vite-plugin-pwa` dep is unused and `public/manifest.webmanifest` is a static file).
- `recentSearches.ts`, `geo.ts` (nearest-station + geolocation), `platformStrategy.ts` (static
  platform-exit data); see the Metro section above for `transfers.ts` vs `TransferMapModal.tsx`.
- `queryLogger.ts` → fire-and-forget POST to `/api/log` & `/api/log-pageview`, which insert into a
  **Neon Postgres** DB (`DATABASE_URL`). All logging is best-effort: failures and missing DB are
  swallowed and never block the UI; logging is disabled on `localhost`.

## Environment variables (`.env.example`)

- `TDX_CLIENT_ID` / `TDX_CLIENT_SECRET` — required for the server-side proxy and `fetch-data`.
  These replaced the old client-side `VITE_TDX_*` vars (now deprecated; do not reintroduce
  client-exposed TDX keys).
- `DATABASE_URL` — Neon Postgres for query logging (optional; app works without it).
- `APP_URL` / `VITE_APP_URL` — canonical site URL used for sitemaps, hreflang and self-links;
  `server.ts` and the SEO scripts substitute it for the hardcoded `taiwanrail.vercel.app`.
- `GEMINI_API_KEY` and the `@google/genai` dependency are leftover Google AI Studio scaffolding
  (only referenced in `vite.config.ts`'s `define`) — not used by any feature. Don't build on it
  without checking it's still intended; same category as the unused `vite-plugin-pwa` dep above.
