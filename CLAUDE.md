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
npm run test:daily-timetable # round-trip tests for the compact per-date timetable format
npm run test:affiliates # affiliate data contract: validation, {crop} templating, slot ordering, SQL/query drift
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

### Two-week daily timetables layered over the weekly general timetable
`GeneralTrainTimetable` only describes a **one-week** service pattern (`ServiceDay`), so it misses
extra trains, cancellations and retimes. On top of it the fetch script pulls the **next 14 days**
(`DAILY_WINDOW_DAYS` in `src/lib/dailyTimetable.ts`) of TDX daily timetables into
`public/data/tra-daily/<YYYY-MM-DD>.json` and `public/data/thsr-daily/<YYYY-MM-DD>.json`.
- Those files use a **compact format**, not the raw TDX response: station names (recoverable from
  the station dataset) are dropped and each stop becomes `"stationID,arrival,departure[,1]"`. Raw
  TRA daily data is ~3.3MB/day → ~46MB per refresh of new git blobs every other day; compact is
  ~0.55MB/day (~7.8MB for both rails), and the client downloads one date instead of the 3.5MB
  weekly file. Encoder: `scripts/tdx-daily-timetable.ts`; decoder: `src/lib/dailyTimetable.ts`;
  the format is pinned by round-trip tests in `scripts/daily-timetable.test.ts`.
- `getTRATimetableOD` / `getTHSRTimetableOD` / `get*TrainTimetable` try the daily file for the
  requested date first, then fall back to the weekly general timetable (dates beyond the window,
  or a missing/thin daily file), then the live proxy — so the fallback chain grew by one layer.
- A daily file is only trusted if it parses **and** carries at least `DAILY_MIN_TRAINS` trains
  (TRA 300 / THSR 50); otherwise both the fetch script and the client ignore it. Dates TDX has not
  published yet are skipped, never written thin, and old dates are pruned on each run.
- The 14-day window deliberately matches the date picker in `App.tsx` (today + 13 days), so every
  date a user can pick has a daily snapshot and no past date is ever kept or requested. Only the
  current two weeks live in the tree; because the snapshots are highly repetitive, git packs them
  down to well under a megabyte per refresh.

### Data refresh pipeline
`scripts/fetch-tdx-data.ts` regenerates `public/data/`. Non-obvious details baked in:
- TDX **force-gzips large responses without a `Content-Encoding` header** — the script detects gzip
  by magic bytes (`0x1f 0x8b`) and decompresses manually.
- TRA `ODFare` full set is ~535MB (> GitHub's 100MB limit), so it is **streamed and split by
  `OriginStationID`** into `public/data/tra-fares/{id}.json` (~2MB each, lazy-loaded per origin).
- `.github/workflows/fetch-tdx-data.yml` runs this every other day, commits changed data, and the
  commit triggers a Vercel redeploy. **Data freshness is a deploy artifact, not runtime.** Its
  change detection uses `git status --porcelain` (not `git diff`) because each run adds and prunes
  whole daily-timetable files, and `git diff` cannot see untracked ones.

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
- **Line grouping comes from the StationID prefix**, not from a TDX line endpoint
  (`groupMetroStationsByLine` / `metroLineCodeOf` in `metro.ts`, used by the station picker).
  Metro StationIDs are line-scoped — 台北車站 exists twice, as `BL12` and `R10` — so the letter
  prefix is an exact grouping key and the number orders stations along the line, which
  `S2STravelTime` cannot do reliably (TYMC publishes all-pairs segments, KLRT omits `LineNo`).
  Branch/extension prefixes are folded into their parent line by `EXTENSION_PREFIXES`
  (KRTC `RK1` 岡山車站 → 紅線, `OT1` 大寮 → 橘線); add new ones there, not in the UI.
  `METRO_LINE_COLORS` is a display aid only — every swatch is paired with the line name from
  `metroLineLabel`, so an unknown code degrades to a slate dot rather than losing meaning.

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
  computes real stats (fastest time, weekday/weekend frequency, stops, fares), and emits
  self-contained static HTML landing pages to `public/routes/<transport>/<from>-to-<to>/index.html`
  plus JSON-LD, then overwrites `public/sitemap.xml`.
  - Pages carry the full weekday and weekend timetable for the OD (train number, type, times),
    printed from the committed weekly `GeneralTrainTimetable`. Frequency **must** be stated per
    `ServiceDay` group — a single "per day" figure folds weekend-only extras into the weekday count.
  - Pages must stay **script-free except for the Google tag**: the later-departures section uses a
    native `<details>`, and `verify-seo` fails the build if any external script other than
    `googletagmanager.com/gtag/js` appears. This zero-JS first paint is the only advantage these
    pages hold over the native timetable apps, which cannot appear in search.
  - The generated pages are standalone documents — they never load the SPA, so they do **not**
    inherit `index.html`'s `<head>`. Anything that must be on every page (the Google tag, and any
    future site-wide tag) has to be added to `generate-route-pages.mjs` as well, or it covers only
    `/` and `/en/` — 2 of the 290 sitemap URLs, and not the ones organic search lands on. GA4 read
    that gap as "property receiving no data". `verify-seo` now pins the tag, and a single
    measurement ID, across `index.html` and all 288 generated pages.
  - Pages state a **data-as-of date taken from the dataset's own `UpdateTime`**, not from
    `SITEMAP_LASTMOD` (that is the *page* modification date, i.e. build time — using it to describe
    the data overstates freshness, because the refresh workflow runs every other day).
  - **TRA fares are published** (verified 2026-07-30). The earlier rule here said not to, on the
    grounds that the dataset had unreliable distances/prices — that was a misdiagnosis. TDX ships
    one `ODFare` record per direction round the island and the consumer kept the long-way one, which
    is where figures like "Taipei→Taichung 711 km" came from; `pickShortestRouteFares` resolves it at
    the data layer. Post-disambiguation values match the operator's published tariff exactly
    (Taipei→Kaohsiung NT$994, Taipei→Taitung NT$936, Taipei→Hualien NT$583 after the 2025-06-23
    fare revision). Fares are joined to the timetable via `TrainInfo.TrainTypeCode` → `ODFare.TrainType`,
    so a page only lists fares for train types that actually run the route.
- `scripts/prerender.ts` (the `:ssg` build) uses Puppeteer against `vite preview` to prerender the
  SPA entry points (`/`, `/en/`, `?transport=…`) for crawlers.
- In `App.tsx`, `react-helmet-async` manages canonical/hreflang tags, and `INDEXABLE_ROUTE_PATHS`
  maps `transport:fromId:toId` → the canonical static route page so deep-linked searches point at
  an indexable URL. `index.html` carries the base meta/JSON-LD; the strict CSP now lives on the
  **response header** in `vercel.json` (mirrored by `server.ts`, which reads it from there), not in
  a `<meta>` tag — `scripts/security-headers.test.ts` fails if a CSP meta reappears, because a dual
  CSP intersects in the browser and historically reintroduced `unsafe-eval`. New external origins
  (scripts, fonts, `connect-src`) must be added to that header.

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

## Affiliate / sponsored placements (second, separate database)

Sponsored travel links are **not** hardcoded — they come from a `affiliates` table that is
**shared across several unrelated projects**, per `docs/affiliate-integration-spec.md` (the
authoritative contract; that doc is written against a Next.js sibling project, so its file paths
are illustrative — the real files here are the ones below). Key consequences:

- **Two databases.** `SUP_DATABASE_URL` holds the shared `affiliates` table (written by *external*
  admin systems, not by this repo); `DATABASE_URL` holds this app's own data, now including the
  `Rail_Audit_log` impression/click events. When `SUP_DATABASE_URL` is unset, `/api/affiliates`
  returns `503 {offers: []}` and **must not** fall back to `DATABASE_URL`. Schemas:
  `db/affiliates.sql` (run against `SUP_DATABASE_URL`) and `db/rail_audit_log.sql` (against
  `DATABASE_URL`). `Rail_Audit_log` is written unquoted, so Postgres stores it as
  `rail_audit_log` — never reference it as quoted `"Rail_Audit_log"`, which would not resolve.
- **Rows are partitioned by `project_name`**, PK `(project_name, id)`. Other projects reuse the same
  `id`s, so every query must filter by `AFFILIATE_PROJECT_NAME` (default `taiwanrail`). Never query
  by `id` alone.
- **`categories` / `crops` / `{crop}` keep their contract names** even though nothing here grows
  vegetables. Local meaning: `categories` = transport context (`all`/`train`/`hsr`/`metro`/
  `planner`, same vocabulary as `api/log.ts`'s `VALID_TRANSPORT`), `crops` = station/route keyword
  fragments, `{crop}` = the substitution keyword (search results pass the destination station name).
  The marquee has no keyword context, so `{crop}` renders empty there — write offer copy that still
  reads correctly without it.
- **No hardcoded fallback list, deliberately.** Empty/failed API → the placement renders nothing.
  Restoring a fallback would keep showing offers that a partner disabled via `enabled = FALSE`
  (the spec's only supported takedown mechanism), so the DB must be seeded *before* deploy or the
  strip silently disappears. `db/affiliates.sql` seeds the 9 partners that used to be hardcoded.
- Files: `src/lib/affiliates.ts` (pure contract — validation, `{crop}`, §4.2/§4.3 sort ordering;
  imported by **both** the Function and the browser, so no Node/DOM globals),
  `api/affiliates.ts` + a mirrored dev middleware in `vite.config.ts` (keep in sync — same
  arrangement as `api/proxy.ts` vs `server.ts`), `api/affiliate-event.ts`,
  `src/lib/affiliateOffers.ts` (one shared fetch per page load), `src/lib/affiliateTracking.ts`,
  `src/components/AffiliateMarquee.tsx` (§4.3) and `AffiliateSlot.tsx` (§4.2).
- `npm run test:affiliates` pins the selection/validation rules **and** guards column drift between
  `db/affiliates.sql`, the Function and the dev middleware.
- Compliance is load-bearing, not cosmetic: outbound links need
  `rel="sponsored nofollow noopener noreferrer"`, every card needs its 贊助／合作推薦 label, and
  offer text is never injected as HTML (rows containing `<`/`>` are dropped).

## Environment variables (`.env.example`)

- `TDX_CLIENT_ID` / `TDX_CLIENT_SECRET` — required for the server-side proxy and `fetch-data`.
  These replaced the old client-side `VITE_TDX_*` vars (now deprecated; do not reintroduce
  client-exposed TDX keys).
- `DATABASE_URL` — Neon Postgres for query logging, feedback and affiliate `Rail_Audit_log` events
  (optional; app works without it).
- `SUP_DATABASE_URL` / `AFFILIATE_PROJECT_NAME` — the shared affiliate DB and this project's
  partition name; see the affiliate section above. Server-only, never `VITE_*`.
- `APP_URL` / `VITE_APP_URL` — canonical site URL used for sitemaps, hreflang and self-links;
  `server.ts` and the SEO scripts substitute it for the hardcoded `taiwanrail.vercel.app`.
- `GEMINI_API_KEY` and the `@google/genai` dependency are leftover Google AI Studio scaffolding
  (only referenced in `vite.config.ts`'s `define`) — not used by any feature. Don't build on it
  without checking it's still intended; same category as the unused `vite-plugin-pwa` dep above.
