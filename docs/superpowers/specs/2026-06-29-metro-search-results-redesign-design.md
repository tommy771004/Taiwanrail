# Metro (捷運) Search Results Redesign — Design

**Date:** 2026-06-29
**Status:** Approved (architecture: Portal)
**Component:** `src/components/MetroSearch.tsx`, `src/App.tsx`, `scripts/fetch-tdx-metro.ts`

## Goal

Make the Metro (捷運) search **results** look and behave like the TRA/HSR (台/高鐵) results:

1. **Position** — results move out of the narrow search-box container and render full-width
   **below** the search form, in the same place as the rail `#results-section`.
2. **Card list + detail UI/UX** — designed like the HSR train cards (per-departure card with
   車種 / 出發時間 / 抵達時間 / 行車時間, expandable detail).
3. Reference layout: the attached Taoyuan Metro screenshot — a summary header
   (出發站 / 抵達站 / 票價 "$20 元 · 單程票") above a list of departures
   (車種 = 普通, 出發時間, 抵達時間, 行車時間 = 15 分鐘).

Source API: TDX Metro `/v2/Rail/Metro/...` (already wrapped in `src/lib/metro.ts`).

## Current state

- `MetroSearch.tsx` is a single self-contained component rendered inside the search-form
  `<section>` at `App.tsx:2251`. It renders the search controls **and** results in one
  `max-w-3xl` container.
- Rail (TRA/HSR) results render separately in a sibling `<section id="results-section">`
  (`max-w-5xl mx-auto`) **after** the form section (`App.tsx:2491`), gated by `isRailTab`.
- Metro tab is currently `isDevEnv`-only (`App.tsx:2198`).
- Metro results today = one summary card (fare + horizontal stop line) + a small
  "近期班次" list (next 5) with per-row live-board expansion. Not styled like HSR.

### Data available (per-station static timetable)

`public/data/metro_<SYSTEM>/<STATIONID>.json` — array of:

```json
{
  "LineID": "BL", "Direction": 0,
  "DestinationStaionID": "BL23",            // NOTE: typo in source — missing 't'
  "DestinationStationName": { "Zh_tw": "南港展覽館", "En": "..." },
  "Timetables": [ { "Sequence": 1, "DepartureTime": "06:00", "TrainType": 0 } ]
}
```

- `TrainType`: `0` = 普通 / Local; `1` = 直達 / Express (express only appears on airport
  lines such as TYMC; TRTC is all `0`).
- `computeSameLineJourney(s2s, origin, dest)` → `{ travelTimeSec, stopNames[] }` for same-line
  trips. **Arrival time = departure + travelTimeSec.**
- Fare from `getMetroODFare` (OD-level, one fare for all departures).
- `getMetroLiveBoard` for real-time estimates.
- **Coverage gap:** only `metro_TRTC/` is split per-station on disk. Other systems exist only
  as un-split `.gz`, and TYMC/TMRT have no split data yet. `fetch-tdx-metro.ts` already targets
  all 7 systems and splits per station — it just needs to be run.

## Architecture — Approach A (Portal)

`MetroSearch` remains **one component owning all metro state/logic**. Its output splits into
two DOM zones:

- **Search zone** (origin/dest/swap, search button, picker modal) renders inline at its
  current location (`App.tsx:2251`), unchanged in placement.
- **Results zone** renders via `createPortal` into a mount node that `App` places **after**
  the form `</section>` (line 2477), parallel to the rail `#results-section`.

Rationale: `MetroSearch` already uses `createPortal` (picker modal → `document.body`), so this
reuses an established pattern. App.tsx change is minimal (add one mount node). All metro logic
stays in one file; no shared-state wiring.

### Portal wiring

- `App.tsx`: render an empty mount container after the form section, only for the metro tab:

  ```tsx
  {mainTab === 'metro' && <div id="metro-results-mount" />}
  ```

  Placed where `#results-section` sits (sibling after line 2477), so results land in the same
  page position as rail. The styled `<section>` wrapper itself lives **inside** the portal
  content (so an empty mount node adds no layout when there are no results).

- `MetroSearch.tsx`: resolve the node after mount and portal results into it:

  ```tsx
  const [resultsMount, setResultsMount] = useState<HTMLElement | null>(null);
  useEffect(() => { setResultsMount(document.getElementById('metro-results-mount')); }, []);
  // ...
  {resultsMount && createPortal(<MetroResultsSection ... />, resultsMount)}
  ```

  (One extra render after mount; acceptable, avoids `getElementById` during render.)

## Results layout (mirrors `#results-section`)

`<section className="max-w-5xl mx-auto px-0 md:px-8 pb-32 relative z-20 scroll-mt-24">`,
rendered when `hasSearched`. Metro **cyan** accent where rail uses blue/orange.

### 1. Summary header (the purple banner in the reference)

A prominent card at the top of the results:

- 出發站 → 抵達站 (station names, current language)
- 票價: primary fare emphasised, e.g. **NT$20** · 單程票 (label from `MetroFare.label`,
  fallback 單程票 / Single). If multiple fare tiers, show primary large + others as chips.
- 乘車時間 + 經 N 站 (from `journey`).
- Results count line consistent with rail's header (`app.results.found`).

### 2. Departure cards (HSR-style, one per upcoming departure)

Visual structure parallels the rail inline card / `TrainCard`:

- **Left:** 車種 badge — 普通 (cyan) / 直達 (orange) from `TrainType`; plus a
  `往 {終點方向}` direction label (metro has no train number, so this replaces train id).
- **Middle:** **出發時間** (large, tabular-nums) — duration bar showing 行車時間
  ("15 分鐘" / "15 min") — **抵達時間** (large). Arrival = departure + `journey.travelTimeSec`.
- **Right:** no per-card price and no booking button (fare is OD-level, shown once in the
  header; metro has no seat booking).
- **Expand (查看詳情 / 收起詳情):** reuse current expansion — 即時看板 (LiveBoard filtered to
  this destination) + 停靠站序 (`journey.stopNames` as the horizontal stop line). Chevron +
  cyan highlight on expand, matching the rail expanded-card treatment.

**List length:** show all remaining departures for the day (drop the current `.slice(0, 5)`),
matching a real timetable. Filtered to upcoming (`DepartureTime >= now`) and to the direction
toward the destination.

### 3. Fallbacks

- **Cross-line / transfer trip** (`computeSameLineJourney` → null): keep the existing amber
  "需轉乘 — 用「規劃」查詢" card (fare still shown in the summary header).
- **System without static timetable** (fetch returns nothing): show the summary header
  (fare + stop line if same-line) with a note that live departures are unavailable; no cards.

## Data work

- **Dest-field fix:** read `t.DestinationStationID ?? t.DestinationStaionID` (source typo);
  keep the name-based match as fallback.
- **車種 mapping:** `metroTrainTypeLabel(trainType, zh)` → `0`→普通/Local, `1`→直達/Express,
  default 普通/Local. Lives in `src/lib/metro.ts`.
- **Backfill data:** run `scripts/fetch-tdx-metro.ts` to produce split per-station timetables
  for all systems (TYMC, TMRT, NTMC, KRTC, KLRT, NTDLRT). Must degrade gracefully if TDX
  returns no StationTimeTable for a system (skip, no crash). Requires `TDX_CLIENT_ID/SECRET`.

## Out of scope

- No change to the metro search controls' placement or the picker modal.
- No new booking flow, no fare table editing, no cross-line routing (that stays in 規劃).
- Enabling the metro tab for non-dev users (`isDevEnv` gate) is a separate decision, not part
  of this redesign.

## Error handling

- Reuse existing error states (no fare, fetch failure, transfer-required).
- Portal mount missing → results simply don't render (no throw).
- Express arrival times are best-effort (S2STravelTime is all-stops); acceptable for v1.

## Verification

- `npm run dev`, open the metro tab (dev-only), search a TRTC same-line route (e.g. 頂埔→南港展覽館):
  - results render full-width below the form, in the same position as rail results;
  - summary header shows fare + 票種 + 乘車時間;
  - departure cards show 車種 / 出發 / 抵達 / 行車時間 and match the reference layout;
  - expand shows live board + stop line.
- Confirm cross-line route shows the transfer fallback.
- Confirm a backfilled system (e.g. TYMC airport line) shows 直達/普通 badges correctly.
- `npm run build` (or `tsc`) passes.
