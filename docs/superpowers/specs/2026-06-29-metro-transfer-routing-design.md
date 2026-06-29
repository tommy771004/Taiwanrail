# Metro Transfer Routing + Show-More — Design

**Date:** 2026-06-29
**Status:** Approved
**Components:** `src/lib/metro.ts`, `src/components/MetroSearch.tsx`

## Goals

1. **Cross-line transfer routing.** When origin and destination are not on a single line,
   compute the actual transfer route (which lines, which interchange stations, total time,
   transfer count) instead of punting to the 規劃 tab with the amber
   "需轉乘 — 此路線需跨線轉乘…請使用「規劃」" message.
2. **Show-more.** Cap the same-line departure card list at 10 rows; reveal 10 more per click
   of a 查看更多 button.

## Current state

- `MetroSearch` results: same-line trips show a fare summary header + HSR-style departure
  cards (all upcoming departures). Cross-line trips show only an amber fallback telling the
  user to use 規劃.
- `computeSameLineJourney(lines, originId, destId, zh)` returns a `SameLineJourney` (single
  line) or `null` (transfer needed). It drives the departure-card flow via
  `buildMetroDepartures`.
- `getMetroS2STravelTime(system)` → `MetroLineTimes[]` (`{ lineId, segments: { fromId, fromName,
  toId, toName, runTime, stopTime }[] }`) — per-line ordered station pairs with run + dwell
  seconds. Already fetched on search.
- `getRouting` (the 規劃 engine) is coordinate-based door-to-door multimodal routing — not a
  metro-station graph, so it is not reused here.
- `transfers.ts` is a static TRA/HSR→metro interchange **badge** map, not a routing graph.
- Interchange stations in TDX metro have **different per-line StationIDs** but the **same
  StationName** (e.g. 忠孝復興 = `BR10` on Wenhu, `BL15` on Bannan).

## 1. Routing engine — `src/lib/metro.ts`

### `getMetroLineTransfer(system)`

New cached fetcher over TDX `Metro/LineTransfer/{system}`. Field names are not published in
the OAS (same as other metro endpoints), so parse defensively:

```ts
export interface MetroTransferEdge {
  fromId: string; fromName: BiName;
  toId: string; toName: BiName;
  transferTimeSec: number;
}
export async function getMetroLineTransfer(system: string): Promise<MetroTransferEdge[]>;
```

- `fromId` = `FromStationID` (fallbacks `FromStationId`); `toId` = `ToStationID` / `ToStationId`.
- `fromName`/`toName` = `FromStationName` / `ToStationName` BiName objects.
- `transferTimeSec` = `num(TransferTime ?? TransferTimes ?? MorningFirstTransferTime ?? 0) * 60`
  (TDX TransferTime is in minutes). Default to a `METRO_TRANSFER_FALLBACK_SEC = 240` when 0/absent.
- Cache in a module `Map<string, MetroTransferEdge[]>` like `_s2sCache`.

### `computeMetroRoute(lines, transfers, originName, destName, zh)`

Dijkstra over a directed graph keyed by per-line StationID:

- **Ride edges:** for every `MetroLineTimes` segment, add `fromId → toId` and `toId → fromId`,
  weight `runTime + stopTime`, tagged with `lineId`. Record each node's display name from
  segment names.
- **Transfer edges:** for every `MetroTransferEdge`, add `fromId ↔ toId`, weight
  `transferTimeSec`, tagged as a transfer (no lineId).
- **Multi-source / multi-target by name:** sources = all node ids whose name equals
  `originName`; targets = all node ids whose name equals `destName`. Seeding every same-name
  node at distance 0 prevents counting a spurious transfer when the chosen start/end is an
  interchange. Answer = the reachable target with the smallest distance.
- **Path → legs:** walk the predecessor chain; group consecutive **ride** edges with the same
  `lineId` into a `MetroRouteLeg`; each **transfer** edge becomes a transfer step between legs.

```ts
export interface MetroRouteLeg {
  lineId: string;
  fromName: string; toName: string;
  stopNames: string[];   // inclusive, in travel order
  rideTimeSec: number;
}
export interface MetroRouteTransfer { stationName: string; transferTimeSec: number; }
export interface MetroRoute {
  legs: MetroRouteLeg[];
  transfers: MetroRouteTransfer[]; // length === legs.length - 1
  totalTimeSec: number;            // sum of ride + transfer times
  transferCount: number;           // legs.length - 1
}
export function computeMetroRoute(
  lines: MetroLineTimes[],
  transfers: MetroTransferEdge[],
  originName: string,
  destName: string,
  zh: boolean,
): MetroRoute | null;
```

- Names resolved per language with `zh` (BiName → Zh_tw / En).
- Returns `null` if no path (graph disconnected / missing data) → caller shows the final fallback.
- A small array-scan Dijkstra is fine (a few hundred nodes per system).
- `computeSameLineJourney` is **unchanged**; it still drives same-line departure cards.

## 2. Data flow — `MetroSearch.handleSearch`

- Add state: `const [route, setRoute] = useState<MetroRoute | null>(null);`
- After computing same-line `j`:
  - If `j` (same line): existing departure-card flow (unchanged); `setRoute(null)`.
  - Else: fetch `getMetroLineTransfer(system)`, call
    `computeMetroRoute(s2s, transferEdges, originName, destName, zh)`, `setRoute(...)`,
    and clear `departures`.
- `originName`/`destName` from `getStationName(originStation)` / `getStationName(destStation)`.
- LineTransfer fetch wrapped in try/catch → on failure `setRoute(null)`.

## 3. Transfer itinerary UI — `MetroSearch` results portal

- **Summary header** generalized: fare always; the time/stops line shows
  - same-line: `乘車時間 · 經 N 站` (from `journey`), else
  - transfer route: `總時間 · 轉乘 N 次` (from `route`).
- **Body branches:**
  - `journey` → departure cards (with show-more, §4).
  - else `route` → **itinerary leg card**: a vertical list —
    - per leg: cyan line badge + `起站 → 訖站` + `經 {stopNames.length - 1} 站` + ride time;
    - between legs: a transfer row "在 {stationName} 轉乘 · 約 {⌈transferTimeSec/60⌉} 分".
  - else → final fallback card (reworded): "查無路線 — 此區間無法在系統內轉乘，請改用「規劃」查詢"
    / "No in-system route — try the Plan tab.".

## 4. Show-more — same-line departure list

- Add `const [visibleCount, setVisibleCount] = useState(10);`
- Reset to 10 whenever a new search runs (in `handleSearch`, alongside `setDepartures`).
- Render `departures.slice(0, visibleCount)`.
- When `departures.length > visibleCount`, render a 查看更多 button:
  `查看更多 (+{Math.min(10, departures.length - visibleCount)})` →
  `setVisibleCount(v => v + 10)`. English: `Show more (+N)`.

## Error handling

- LineTransfer fetch failure or `computeMetroRoute` → `null`: show the final fallback card.
- Show-more `visibleCount` resets on every new search so a new query starts at 10.
- Transfer routes show ride + transfer times only — no per-train clock times (cross-leg
  timetable synchronization is out of scope for v1). Fare from `getMetroODFare` is already
  exact across transfers.

## Out of scope

- Per-departure clock times on transfer legs.
- Multi-system (e.g. TRTC↔TYMC) routing — `computeMetroRoute` is per selected system.
- Changing the same-line departure-card layout.

## Verification

- tsx assertion script for `computeMetroRoute`: synthetic two-line graph (line 1 A-B-C,
  line 2 C-D-E with C an interchange via a transfer edge) → route A→E has 2 legs, 1 transfer,
  total = ride(A→C) + transfer + ride(C→E); same-name multi-source avoids a phantom transfer
  when origin/dest is the interchange.
- `npx tsc --noEmit` clean; `npx vite build` succeeds.
- Manual: metro tab, pick a cross-line TRTC route (e.g. 淡水 → 南港展覽館) → itinerary card with
  the transfer station; pick a long same-line route → only 10 cards + 查看更多 reveals +10.
