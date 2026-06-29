# Metro Search Results Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Metro (捷運) search results full-width below the search form (parallel to the rail `#results-section`), as HSR-style per-departure cards with a fare summary header, matching the Taoyuan Metro reference layout.

**Architecture:** `MetroSearch` stays one component owning all metro state. Pure data shaping (train-type label, direction-aware departure list, arrival times) moves into `src/lib/metro.ts` as testable helpers. The results UI renders via `createPortal` into a mount node `App` places after the form `</section>`, so results land in the same page position as rail results.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind, lucide-react, `react-dom` `createPortal`. No test framework in repo → verification is `npm run lint` (`tsc --noEmit`) + a one-off `tsx` assertion script for pure logic + manual dev-server check.

---

## File Structure

- **`src/lib/metro.ts`** (modify) — add pure helpers: `metroTrainTypeLabel`, `MetroDeparture`, `buildMetroDepartures`; extend `SameLineJourney` (and `computeSameLineJourney`) with line ordering needed for direction filtering. This is where all non-React logic lives.
- **`src/App.tsx`** (modify, ~line 2488) — add the metro results portal mount node after the form section.
- **`src/components/MetroSearch.tsx`** (modify) — resolve mount node, portal results into it, consume `buildMetroDepartures`, rebuild results UI (summary header + HSR-style cards + expand + fallbacks), remove the old in-component results block.
- **`scripts/fetch-tdx-metro.ts`** (run; optional harden) — backfill per-station timetables for all systems.

---

## Task 1: metro.ts pure helpers (train-type label, journey ordering, departure list)

**Files:**
- Modify: `src/lib/metro.ts`
- Verify (temp): `scripts/_tmp-verify-metro.ts` (created, run, deleted)

- [ ] **Step 1: Extend `SameLineJourney` interface**

In `src/lib/metro.ts`, replace the existing `SameLineJourney` interface (currently lines ~141-145) with:

```ts
export interface SameLineJourney {
  lineId: string;
  travelTimeSec: number;
  stopNames: string[]; // origin … destination inclusive, in travel order
  lineStopIds: string[]; // full ordered station ids for the matched line
  originIndex: number; // index of origin in lineStopIds
  destIndex: number; // index of destination in lineStopIds
  directionTerminusId: string; // far end of the line in travel direction
  directionTerminusName: string; // its display name (current language)
}
```

- [ ] **Step 2: Return the new fields from `computeSameLineJourney`**

In `computeSameLineJourney`, replace the final `return { ... }` (currently lines ~176-180) with:

```ts
    const forward = oi <= di;
    return {
      lineId: line.lineId,
      travelTimeSec,
      stopNames: forward ? slice : slice.reverse(),
      lineStopIds: ids,
      originIndex: oi,
      destIndex: di,
      directionTerminusId: forward ? ids[ids.length - 1] : ids[0],
      directionTerminusName: names[forward ? ids[ids.length - 1] : ids[0]] || '',
    };
```

(`ids` and `names` already exist in the function scope.)

- [ ] **Step 3: Add `metroTrainTypeLabel`, `addMinutesToHHMM`, `MetroDeparture`, `buildMetroDepartures`**

Append to `src/lib/metro.ts`:

```ts
/** TDX Metro StationTimeTable TrainType → display label. 0 = Local, 1 = Express. */
export function metroTrainTypeLabel(trainType: number, zh: boolean): string {
  switch (trainType) {
    case 1: return zh ? '直達' : 'Express';
    default: return zh ? '普通' : 'Local';
  }
}

/** Add `addSec` seconds to an "HH:MM" string, wrapping past midnight. */
export function addMinutesToHHMM(hhmm: string, addSec: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (h * 60 + m + Math.round(addSec / 60)) % 1440;
  const norm = (total + 1440) % 1440;
  const hh = Math.floor(norm / 60).toString().padStart(2, '0');
  const mm = (norm % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

export interface MetroDeparture {
  departureTime: string; // "17:36"
  arrivalTime: string;   // departureTime + journey travel time
  trainType: number;     // 0 Local, 1 Express
  destName: string;      // direction terminus name
  destId: string;        // direction terminus id
  seq: number;
}

/**
 * Shape a station's static timetable (array from /data/metro_<sys>/<origin>.json)
 * into the upcoming departures heading toward the trip destination.
 * Direction filter uses the journey's line ordering; falls back to terminus-name
 * match when the timetable terminus id is not on the matched line ordering.
 * Source field `DestinationStaionID` is mis-spelled in TDX data — read both.
 */
export function buildMetroDepartures(
  rawStationTimetable: any[],
  journey: SameLineJourney,
  zh: boolean,
  nowHHMM: string,
): MetroDeparture[] {
  const forward = journey.destIndex >= journey.originIndex;
  const out: MetroDeparture[] = [];
  for (const t of (rawStationTimetable ?? [])) {
    const destId = String(t?.DestinationStationID ?? t?.DestinationStaionID ?? '');
    const destName =
      (zh ? t?.DestinationStationName?.Zh_tw : t?.DestinationStationName?.En) ||
      t?.DestinationStationName?.Zh_tw || '';
    const termIdx = journey.lineStopIds.indexOf(destId);
    const headingRight = termIdx !== -1
      ? (forward ? termIdx >= journey.destIndex : termIdx <= journey.destIndex)
      : (destName !== '' && destName === journey.directionTerminusName);
    if (!headingRight) continue;
    for (const d of (t?.Timetables ?? [])) {
      out.push({
        departureTime: d.DepartureTime,
        arrivalTime: addMinutesToHHMM(d.DepartureTime, journey.travelTimeSec),
        trainType: typeof d.TrainType === 'number' ? d.TrainType : 0,
        destName,
        destId,
        seq: d.Sequence,
      });
    }
  }
  return out
    .filter(d => d.departureTime >= nowHHMM)
    .sort((a, b) => a.departureTime.localeCompare(b.departureTime));
}
```

- [ ] **Step 4: Write a one-off verification script**

Create `scripts/_tmp-verify-metro.ts`:

```ts
import { computeSameLineJourney, buildMetroDepartures, metroTrainTypeLabel, addMinutesToHHMM, MetroLineTimes } from '../src/lib/metro';
import assert from 'node:assert';

// Line A-B-C-D, each segment 60s run + 0 dwell.
const lines: MetroLineTimes[] = [{
  lineId: 'L1',
  segments: [
    { fromId: 'A', fromName: { Zh_tw: 'A' }, toId: 'B', toName: { Zh_tw: 'B' }, runTime: 60, stopTime: 0 },
    { fromId: 'B', fromName: { Zh_tw: 'B' }, toId: 'C', toName: { Zh_tw: 'C' }, runTime: 60, stopTime: 0 },
    { fromId: 'C', fromName: { Zh_tw: 'C' }, toId: 'D', toName: { Zh_tw: 'D' }, runTime: 60, stopTime: 0 },
  ],
}];

const j = computeSameLineJourney(lines, 'A', 'C', true);
assert(j, 'journey A->C should exist');
assert.deepStrictEqual(j!.lineStopIds, ['A', 'B', 'C', 'D']);
assert.strictEqual(j!.originIndex, 0);
assert.strictEqual(j!.destIndex, 2);
assert.strictEqual(j!.directionTerminusId, 'D');
assert.strictEqual(j!.travelTimeSec, 120); // 2 segments

assert.strictEqual(addMinutesToHHMM('17:36', 120), '17:38');
assert.strictEqual(addMinutesToHHMM('23:59', 120), '00:01');
assert.strictEqual(metroTrainTypeLabel(0, true), '普通');
assert.strictEqual(metroTrainTypeLabel(1, false), 'Express');

// Timetable at origin A: forward train (terminus D) kept, reverse train (terminus A) dropped.
const tt = [
  { DestinationStaionID: 'D', DestinationStationName: { Zh_tw: 'D' }, Timetables: [
    { Sequence: 1, DepartureTime: '17:30', TrainType: 0 },
    { Sequence: 2, DepartureTime: '17:00', TrainType: 0 }, // before "now", dropped
  ]},
  { DestinationStaionID: 'A', DestinationStationName: { Zh_tw: 'A' }, Timetables: [
    { Sequence: 1, DepartureTime: '17:40', TrainType: 0 }, // wrong direction, dropped
  ]},
];
const deps = buildMetroDepartures(tt, j!, true, '17:20');
assert.strictEqual(deps.length, 1, 'only the upcoming forward departure');
assert.strictEqual(deps[0].departureTime, '17:30');
assert.strictEqual(deps[0].arrivalTime, '17:32');
assert.strictEqual(deps[0].destName, 'D');

console.log('ALL METRO HELPER ASSERTIONS PASSED');
```

- [ ] **Step 5: Run the verification script**

Run: `npx tsx scripts/_tmp-verify-metro.ts`
Expected: prints `ALL METRO HELPER ASSERTIONS PASSED`, exit 0.

- [ ] **Step 6: Delete the verification script and typecheck**

```bash
rm scripts/_tmp-verify-metro.ts
npm run lint
```
Expected: `tsc --noEmit` passes (no errors).

- [ ] **Step 7: Commit**

```bash
git add src/lib/metro.ts
git commit -m "feat(metro): add departure-list + train-type helpers, extend journey ordering"
```

---

## Task 2: App.tsx — metro results portal mount node

**Files:**
- Modify: `src/App.tsx` (after the form `</section>`, near line 2488)

- [ ] **Step 1: Add the mount node**

In `src/App.tsx`, immediately after the `RecentSearches` block that ends at line ~2488 and before the rail `{isRailTab && (` results section at line ~2491, insert:

```tsx
      {/* Metro results portal mount — MetroSearch renders its results here so they
          sit in the same position as the rail #results-section. */}
      {mainTab === 'metro' && <div id="metro-results-mount" />}
```

- [ ] **Step 2: Typecheck**

Run: `npm run lint`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(metro): add results portal mount node below search form"
```

---

## Task 3: MetroSearch — portal wiring + use buildMetroDepartures

**Files:**
- Modify: `src/components/MetroSearch.tsx`

- [ ] **Step 1: Import the new helpers and types**

In `src/components/MetroSearch.tsx`, update the metro lib import (line 3) to include the new exports:

```ts
import { getMetroStations, getMetroODFare, getMetroS2STravelTime, computeSameLineJourney, METRO_SYSTEMS, MetroStation, MetroFare, SameLineJourney, getMetroLiveBoard, MetroLiveBoard, MetroDeparture, buildMetroDepartures, metroTrainTypeLabel } from '../lib/metro';
```

- [ ] **Step 2: Type the departures state and add the mount-node state**

Change the `timetables` state (line 39) to the typed departures list, and add a results-mount state. Replace:

```ts
  const [timetables, setTimetables] = useState<any[]>([]);
```
with:
```ts
  const [departures, setDepartures] = useState<MetroDeparture[]>([]);
  const [resultsMount, setResultsMount] = useState<HTMLElement | null>(null);
```

Add this effect right after the existing `useEffect`/state setup block (e.g. after line 51's refs):

```ts
  useEffect(() => {
    setResultsMount(document.getElementById('metro-results-mount'));
  }, []);
```

- [ ] **Step 3: Replace the timetable-shaping logic in `handleSearch`**

In `handleSearch`, replace the entire static-timetable block (currently lines ~149-188, the `if (j) { try { const res = await fetch(...) ... } }` that builds `departures`/`setTimetables`) with:

```ts
      // Load static timetable for the origin station and shape into departures.
      if (j) {
        try {
          const res = await fetch(`/data/metro_${system}/${originId}.json`);
          if (res.ok) {
            const data = await res.json();
            const now = new Date();
            const nowHHMM = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
            setDepartures(buildMetroDepartures(data, j, zh, nowHHMM));
          } else {
            setDepartures([]);
          }
        } catch {
          setDepartures([]);
        }
      } else {
        setDepartures([]);
      }
```

- [ ] **Step 4: Typecheck (expect a known error to be fixed in Task 4)**

Run: `npm run lint`
Expected: errors only where the old results JSX still references `timetables`/`t.time`/`t.destName` (those are removed in Task 4). If other errors appear, fix them now. Do NOT commit yet — Task 4 completes the UI.

(If you prefer a green commit here, you may temporarily leave the old `timetables` references compiling by keeping `const timetables = departures;` — but Task 4 removes that block entirely, so skipping the commit is cleaner.)

---

## Task 4: MetroSearch — portal results UI (summary header + HSR-style cards + fallbacks)

**Files:**
- Modify: `src/components/MetroSearch.tsx`

- [ ] **Step 1: Remove the old in-component results block**

Delete the entire existing results block — the JSX starting at `{/* Results */}` (`{hasSearched && !loading && !error && (` at line ~325) through its closing `)}` at line ~490. The picker-modal block that follows (`{pickerType && createPortal(...)}`) stays.

- [ ] **Step 2: Add the portal results section before the picker-modal portal**

Immediately before the `{/* Station Picker Modal */}` block, insert this portal. It renders only when the mount node exists and a search has run:

```tsx
      {/* Results — portaled to the App-level mount so they sit where rail results do */}
      {resultsMount && hasSearched && !loading && !error && createPortal(
        <section className="max-w-5xl mx-auto px-4 md:px-8 pb-32 relative z-20 scroll-mt-24 animate-in fade-in slide-in-from-bottom-4 duration-500">

          {/* Summary header (出發站 / 抵達站 / 票價) */}
          <div className="mb-6 rounded-3xl p-6 bg-gradient-to-br from-cyan-500 to-cyan-600 text-white shadow-[0_8px_30px_rgba(8,145,178,0.3)] flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <h2 className="text-lg sm:text-2xl font-black tracking-tight flex items-center gap-2">
                <TramFront className="w-6 h-6 shrink-0" />
                <span>{getStationName(originStation) || '—'}</span>
                <span className="opacity-70">→</span>
                <span>{getStationName(destStation) || '—'}</span>
              </h2>
              <div className="flex items-baseline gap-2 bg-white/15 rounded-2xl px-4 py-2">
                {fares && fares.length > 0 ? (
                  <>
                    <span className="text-2xl sm:text-3xl font-black tabular-nums">NT${Math.min(...fares.map(f => f.price))}</span>
                    <span className="text-sm font-semibold opacity-90">{fares[0].label || L('單程票', 'Single')}</span>
                  </>
                ) : (
                  <span className="text-sm font-semibold opacity-90">{L('尚無票價資訊', 'No fare data')}</span>
                )}
              </div>
            </div>
            {journey && (
              <div className="flex items-center gap-2 text-sm font-semibold text-white/90">
                <Clock className="w-4 h-4" />
                <span>{Math.ceil(journey.travelTimeSec / 60)} {L('分鐘', 'min')}</span>
                <span className="opacity-70">·</span>
                <span>{L(`經 ${journey.stopNames.length - 1} 站`, `${journey.stopNames.length - 1} stops`)}</span>
              </div>
            )}
          </div>

          {journey ? (
            departures.length > 0 ? (
              <>
                <h3 className="mb-4 px-2 text-xs sm:text-sm font-black text-slate-950 dark:text-white tracking-widest uppercase">
                  {L(`近期班次 · ${departures.length} 班`, `Upcoming · ${departures.length}`)}
                </h3>
                <div className="flex flex-col gap-3">
                  {departures.map((d) => {
                    const key = `${d.departureTime}-${d.seq}`;
                    const isExpanded = expandedDeparture === key;
                    const isExpress = d.trainType === 1;
                    return (
                      <div
                        key={key}
                        className={`w-full rounded-2xl border bg-white dark:bg-slate-900 shadow-sm hover:shadow-md transition-all overflow-hidden ${
                          isExpanded ? 'border-cyan-200 dark:border-cyan-800 bg-gradient-to-br from-white to-cyan-50/40 dark:from-slate-900 dark:to-cyan-950/20' : 'border-slate-100 dark:border-slate-800'
                        }`}
                      >
                        <button
                          onClick={async () => {
                            if (!isExpanded) {
                              setExpandedDeparture(key);
                              setLoadingLiveBoard(true);
                              try {
                                const board = await getMetroLiveBoard(system, originId);
                                setLiveBoard(board.filter(b => b.DestinationStationID === d.destId));
                              } catch (e) {
                                console.error(e);
                              } finally {
                                setLoadingLiveBoard(false);
                              }
                            } else {
                              setExpandedDeparture(null);
                            }
                          }}
                          className="w-full text-left px-4 sm:px-6 py-4 cursor-pointer select-none"
                        >
                          <div className="grid grid-cols-12 gap-x-4 items-center">
                            {/* Train type + direction */}
                            <div className="col-span-4 sm:col-span-3 flex flex-col gap-1.5 min-w-0">
                              <span className={`self-start px-2 py-1 rounded-md text-xs sm:text-sm font-bold tracking-widest ${
                                isExpress ? 'bg-[#feebd6] text-[#d85e01]' : 'bg-[#e0f7fa] text-[#0e7490]'
                              }`}>
                                {metroTrainTypeLabel(d.trainType, zh)}
                              </span>
                              <span className="text-[11px] text-slate-500 truncate">
                                {L('往', 'To')} {d.destName}
                              </span>
                            </div>

                            {/* Departure — duration — arrival */}
                            <div className="col-span-8 sm:col-span-7 flex items-center gap-2 sm:gap-3">
                              <div className="text-center shrink-0">
                                <p className={`font-black text-2xl sm:text-4xl tracking-tighter tabular-nums leading-none ${isExpanded ? 'text-cyan-600' : 'text-slate-900 dark:text-white'}`}>
                                  {d.departureTime}
                                </p>
                              </div>
                              <div className="flex-grow text-center min-w-0">
                                <p className="text-xs text-slate-500 font-medium mb-1">
                                  {Math.ceil(journey.travelTimeSec / 60)} {L('分鐘', 'min')}
                                </p>
                                <div className="relative w-full h-px bg-slate-200 dark:bg-slate-700 my-1">
                                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-cyan-400 border-2 border-white dark:border-slate-900"></div>
                                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-cyan-600 border-2 border-white dark:border-slate-900"></div>
                                </div>
                                <p className="text-[0.65rem] font-semibold text-slate-400 tracking-wide uppercase">
                                  {L('直達', 'Direct')}
                                </p>
                              </div>
                              <div className="text-center shrink-0">
                                <p className="font-black text-2xl sm:text-4xl tracking-tighter tabular-nums leading-none text-slate-900 dark:text-white">
                                  {d.arrivalTime}
                                </p>
                              </div>
                            </div>

                            {/* Chevron */}
                            <div className="hidden sm:flex col-span-2 justify-end">
                              <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                            </div>
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="px-4 sm:px-6 pb-5 animate-in slide-in-from-top-2 fade-in duration-200">
                            <div className="pt-4 border-t border-slate-200 dark:border-slate-700 flex flex-col gap-4">
                              {/* Live board */}
                              <div>
                                <h4 className="font-bold text-slate-800 dark:text-slate-100 mb-2 text-sm flex items-center gap-2">
                                  <Clock className="w-4 h-4 text-cyan-500" />
                                  {L('即時看板', 'Live Board')}
                                </h4>
                                {loadingLiveBoard ? (
                                  <div className="flex items-center gap-2 text-sm text-slate-500 py-2">
                                    <div className="w-4 h-4 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
                                    {L('載入即時看板...', 'Loading live board...')}
                                  </div>
                                ) : liveBoard.length > 0 ? (
                                  <div className="flex flex-col gap-2">
                                    {liveBoard.map((lb, i) => (
                                      <div key={i} className="flex items-center gap-3 p-3 bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800">
                                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                        <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
                                          {zh ? lb.DestinationStationName.Zh_tw : lb.DestinationStationName.En}
                                        </span>
                                        <div className="ml-auto">
                                          {lb.EstimateTime <= 0 ? (
                                            <span className="text-sm font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 px-2 py-0.5 rounded-md">
                                              {L('進站中', 'Approaching')}
                                            </span>
                                          ) : (
                                            <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-md">
                                              {lb.EstimateTime} {L('分', 'min')}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-sm text-slate-500 py-2">
                                    {L('目前無即時動態資料', 'No live data available at the moment.')}
                                  </div>
                                )}
                              </div>

                              {/* Stop sequence */}
                              <div>
                                <h4 className="font-bold text-slate-800 dark:text-slate-100 mb-2 text-sm flex items-center gap-2">
                                  <MapPin className="w-4 h-4 text-cyan-500" />
                                  {L('停靠站', 'Stops')}
                                </h4>
                                <div className="relative p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl overflow-x-auto soft-scrollbar">
                                  <div className="flex items-center min-w-max pb-2">
                                    {journey.stopNames.map((name, i) => (
                                      <React.Fragment key={i}>
                                        <div className="flex flex-col items-center gap-2 relative z-10">
                                          <div className={`w-3 h-3 rounded-full ${
                                            i === 0 ? 'bg-cyan-500 ring-4 ring-cyan-500/20' :
                                            i === journey.stopNames.length - 1 ? 'bg-rose-500 ring-4 ring-rose-500/20' :
                                            'bg-white border-2 border-slate-300 dark:border-slate-600'
                                          }`} />
                                          <span className={`text-[11px] font-bold ${
                                            i === 0 || i === journey.stopNames.length - 1 ? 'text-slate-800 dark:text-slate-200' : 'text-slate-500'
                                          }`}>{name}</span>
                                        </div>
                                        {i < journey.stopNames.length - 1 && (
                                          <div className="w-12 h-1 bg-slate-200 dark:bg-slate-700 -mt-6 rounded-full" />
                                        )}
                                      </React.Fragment>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-2xl text-center gap-2">
                <AlertCircle className="w-8 h-8 text-slate-400" />
                <p className="text-sm text-slate-500 max-w-sm">
                  {L('此區間目前無班次時刻資料，僅顯示票價與乘車資訊。', 'No timetable data for this segment; fare and travel info only.')}
                </p>
              </div>
            )
          ) : (
            <div className="flex flex-col items-center justify-center p-6 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-2xl text-center gap-3">
              <AlertCircle className="w-8 h-8 text-amber-500" />
              <div>
                <h4 className="font-bold text-amber-700 dark:text-amber-500 mb-1">{L('需轉乘', 'Transfer Required')}</h4>
                <p className="text-sm text-amber-600/80 dark:text-amber-400/80 max-w-sm">
                  {L('此路線需跨線轉乘，詳細乘車時間與轉乘站請使用「規劃」功能進行查詢。', 'This route requires a transfer. Use the "Plan" tab for detailed routing and times.')}
                </p>
              </div>
            </div>
          )}
        </section>,
        resultsMount
      )}
```

- [ ] **Step 3: Remove now-unused imports/vars**

In the import on line 2, drop icons no longer used by MetroSearch after the rewrite if and only if `npm run lint` flags them (likely `DollarSign`, `Navigation`, `CheckCircle` may already be unused — only remove what tsc reports as unused via `noUnusedLocals` if enabled; otherwise leave them). Confirm `React`, `MapPin`, `Clock`, `ChevronDown`, `AlertCircle`, `TramFront`, `createPortal` are still imported (they are used above).

- [ ] **Step 4: Typecheck**

Run: `npm run lint`
Expected: passes with no errors.

- [ ] **Step 5: Manual dev-server verification**

```bash
npm run dev
```
Then in the browser (dev build exposes the 捷運 tab):
1. Switch to the 捷運 tab, pick a TRTC same-line route (e.g. 頂埔 → 南港展覽館), Search.
2. Confirm results render **full-width below the form**, in the same position as rail results (not in the narrow box).
3. Confirm the cyan summary header shows origin → dest, fare (NT$… · 單程票), and 乘車時間 · 經 N 站.
4. Confirm departure cards show 車種 badge + 往 terminus, 出發時間 — 行車時間 — 抵達時間.
5. Expand a card → live board + stop line appear.
6. Pick a cross-line route (different lines) → amber 需轉乘 fallback shows, with fare still in the header.

- [ ] **Step 6: Commit**

```bash
git add src/components/MetroSearch.tsx
git commit -m "feat(metro): HSR-style results card list + fare header via results portal"
```

---

## Task 5: Backfill per-station metro timetable data

**Files:**
- Run: `scripts/fetch-tdx-metro.ts` (via `npm run fetch-metro-data`)
- Optional modify: `scripts/fetch-tdx-metro.ts` (graceful skip)

> Requires `TDX_CLIENT_ID` / `TDX_CLIENT_SECRET` in `.env`. If credentials are unavailable, **skip this task** and note that only TRTC has live timetable cards until data is fetched; other systems fall back to fare/transfer summaries (already handled in Task 4).

- [ ] **Step 1: (Optional) Harden the fetch script**

In `scripts/fetch-tdx-metro.ts`, inside `fetchAndSplitByStation` after `const timetables = ...` (line ~77), add a guard so an empty/unsupported system is skipped cleanly:

```ts
      if (!Array.isArray(timetables) || timetables.length === 0) {
        console.warn(`⚠️ No StationTimeTable for ${systemCode}, skipping.`);
        await fs.unlink(tmpFile).catch(() => {});
        return;
      }
```

- [ ] **Step 2: Run the backfill**

Run: `npm run fetch-metro-data`
Expected: console logs `✅ Saved N stations for <SYSTEM>` for systems that publish timetables (TRTC, NTMC, KRTC, KLRT, NTDLRT; TYMC/TMRT may warn-skip if unsupported).

- [ ] **Step 3: Verify output directories exist**

```bash
ls public/data | grep metro_
```
Expected: per-station dirs `metro_<SYSTEM>/` for each system that returned data.

- [ ] **Step 4: Commit the data (repo convention commits static TDX data)**

```bash
git add public/data/metro_* scripts/fetch-tdx-metro.ts
git commit -m "chore(metro): backfill per-station static timetable data"
```

---

## Self-Review Notes

- **Spec coverage:** position (Task 2 mount + Task 4 portal `max-w-5xl` section), HSR-style cards (Task 4), summary header with fare (Task 4), expand detail = live board + stops (Task 4), train-type label (Task 1), arrival = dep + travel (Task 1 `buildMetroDepartures`/`addMinutesToHHMM`), dest-field typo fix (Task 1), transfer + no-data fallbacks (Task 4), data backfill (Task 5). All covered.
- **Type consistency:** `MetroDeparture`, `buildMetroDepartures`, `metroTrainTypeLabel`, `addMinutesToHHMM`, extended `SameLineJourney` fields (`lineStopIds`, `originIndex`, `destIndex`, `directionTerminusId`, `directionTerminusName`) defined in Task 1 and consumed unchanged in Tasks 3–4. State renamed `timetables` → `departures` consistently in Task 3.
- **No placeholders:** all steps include exact code/commands/expected output.
