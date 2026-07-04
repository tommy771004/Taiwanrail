# Metro System SEO Landing Pages — Design

**Date:** 2026-07-04
**Status:** Approved
**Components:** `scripts/generate-route-pages.mjs`, `src/App.tsx`, `src/components/MetroSearch.tsx`, `public/routes/metro/`, `public/sitemap.xml`

## Goals

GSC audit (see chat, 2026-07-04) found the metro/捷運 feature (shipped 2026-06-27/28) has
**zero SEO surface**: not in `sitemap.xml`, no static landing pages, no JSON-LD. TRA/HSR route
pages already average position ~33 after a month, so a naive template clone risks the same
outcome. This spec covers sub-project 1 of 2: one static landing page per metro operator,
built from data already committed in `public/data/metro_*`.

Sub-project 2 (a journey-planner landing page) is a separate spec, done after this ships.

## Page unit: one page per system (not per station-pair)

TRA/HSR route pages are curated station-pair routes because "journey" = a specific train.
Metro has no OD train numbers, and 7 systems × station pairs explodes into thousands of thin
pages — the STRUCTURE.md growth policy explicitly warns against this. One page per system (7
total) keeps page count low while each page carries real, system-wide facts.

## Data sources (all static, already committed — no live TDX calls at build time)

Per system directory `public/data/metro_<CODE>/`:

| File | Shape | Used for |
|---|---|---|
| `stations.json` | `MetroStation[]` | station count |
| `s2s.json` | `{ LineNo, LineID, TravelTimes: [{ FromStationID, ToStationID, RunTime, StopTime, ... }] }[]` | per-line station count (`TravelTimes.length + 1`) and one-way time (`Σ(RunTime+StopTime)` seconds → minutes) |
| `transfers.json` | `LineTransfer[]` (`FromLineNo/FromStationID` → `ToLineNo/ToStationID`, in-system only) | interchange station count + representative names |
| `fares/<StationID>.json` | per-origin `ODFare[]` (mirrors the TRA fare-split pattern), `Fares[].FareClass===1` = full fare | network-wide full-fare min/max (scan all origin files, take min/max `Price` where `FareClass===1`) |
| `<StationID>.json` (root level, e.g. `BL01.json`) | per-station `Timetables[]` (`DepartureTime`) | representative first/last departure (read a line's terminal station file) |

**Gotcha — per-system resilience:** unlike the TRA/HSR generator (one shared timetable dataset,
abort-the-whole-build if missing), each metro system's data is independent and can be
incomplete (e.g. KLRT's `fares/` was empty in an earlier snapshot). The metro page loop must
**skip and warn** for a system missing a required file, not abort the other 6 pages or the
sitemap write.

## Content sections (per page)

1. **Hero** — system zh/en name + one stat-rich sentence: line count, station count, longest
   single-line one-way time.
2. **路線一覽 table** — one row per line: name (zh/en), station count, one-way time.
3. **票價** — full-fare NT$ range (min–max across the system), noting it's distance-based via
   `fares/*.json` (TDX ODFare), IC card (悠遊卡/一卡通) discount mentioned generically, sourced
   with a citation link — same "don't publish what you can't compute reliably" discipline as
   the existing TRA-fare-omission rule, just applied the other way (this data *is* reliable, so
   it's fine to publish, unlike TRA's known-bad distance/price dataset).
4. **營運時間** — representative first/last departure range, caveat "varies by line, confirm live".
5. **轉乘** — interchange station count + a few representative names, linking to the live app.
6. **FAQ** (`FAQPage` JSON-LD, 4–5 Qs) — mirrors the TRA/HSR FAQ pattern: how many lines, hours,
   fare range, where to transfer. Always-present generic FAQs (free/live-data) copied verbatim
   from the existing generator.
7. **Other systems** — internal links to the other 6 metro pages (same `related` pattern as
   existing route pages).
8. **CTA** — deep link to `${SITE}/?transport=metro&system=<CODE>` (see App.tsx change below).

## Schema

`WebPage` + `BreadcrumbList` + `FAQPage`, same as existing route pages. **No `TravelAction`** —
that schema models a single origin→destination trip, which doesn't fit a whole-system page.

## URL / output structure

- Path: `public/routes/metro/<system-slug>/index.html` (+ `/en/routes/metro/<system-slug>/`).
- Slugs (English-name based, matching existing `taipei-to-kaohsiung` convention), mapped from
  the `METRO_SYSTEMS` codes in `src/lib/metro.ts`:

  | Code (metro.ts) | Slug |
  |---|---|
  | `TRTC` | `taipei-metro` |
  | `NTMC` | `new-taipei-metro` |
  | `TYMC` | `taoyuan-metro` |
  | `TMRT` | `taichung-metro` |
  | `KRTC` | `kaohsiung-metro` |
  | `KLRT` | `kaohsiung-lrt` |
  | `NTDLRT` | `danhai-lrt` |
- Added to `public/sitemap.xml` alongside existing TRA/HSR entries (same hreflang triplet).

## Build integration

Extend `scripts/generate-route-pages.mjs` in place (add a `METRO_SYSTEMS` table + `pageForMetro()`
+ a metro generation loop before the sitemap is assembled) rather than a new script — the
sitemap-writing logic already lives centrally in that file; a second writer would risk
clobbering it. Runs on every `npm run build` (same as today), reading only committed data.

## App.tsx / MetroSearch.tsx: honor `?system=<CODE>` (small, in-scope addition)

Today `?transport=metro` correctly switches to the metro tab (`mainTab` state, `App.tsx:112`),
but there's no way to preselect an operator — the CTA would land on the metro tab with no
system chosen. Add: read `system` from the query string alongside `transport` (same place
`queryTransport` is parsed, `App.tsx:112`) and pass it down so `MetroSearch` preselects that
operator on mount if valid (matches a `METRO_SYSTEMS` code from `src/lib/metro.ts`), falling
back to its current default otherwise.

## Verification

- `npm run generate-routes` — manual run, inspect output files for all 7 systems.
- `npm run seo:verify` — existing sitemap/meta checks must still pass.
- `npm run lint` (`tsc --noEmit`) — App.tsx/MetroSearch.tsx changes type-check.
- Manual: open a couple of generated pages in a browser, confirm stats render and CTA lands on
  the right metro system.

## Out of scope (this spec)

- Journey-planner landing page (sub-project 2, separate spec).
- Per-line or per-station-pair metro pages.
- Any change to the runtime `metro.ts` live-data path.
