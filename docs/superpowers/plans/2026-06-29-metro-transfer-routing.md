# Metro Transfer Routing + Show-More Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute and display an in-system metro transfer route (lines, interchange stations, total time, transfer count) for cross-line trips, and cap the same-line departure list at 10 with a +10 show-more button.

**Architecture:** Add a TDX LineTransfer fetcher and a Dijkstra router (`computeMetroRoute`) to `src/lib/metro.ts`, building a graph from existing `S2STravelTime` ride edges + LineTransfer edges, multi-source/target by station name. `MetroSearch` calls it when the trip is not same-line and renders an itinerary leg card; same-line departures gain a `visibleCount` slice + show-more button.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind, lucide-react. No test framework → verify with `npx tsc --noEmit` + a one-off `tsx` assertion + `npx vite build` + manual.

---

## File Structure

- **`src/lib/metro.ts`** (modify) — add `METRO_TRANSFER_FALLBACK_SEC`, `MetroTransferEdge`, `getMetroLineTransfer`, `MetroRouteLeg`/`MetroRouteTransfer`/`MetroRoute`, `computeMetroRoute`.
- **`src/components/MetroSearch.tsx`** (modify) — `route`/`visibleCount` state, imports, `handleSearch` transfer branch + resets, generalized header, departure slice + show-more, transfer itinerary branch, reworded final fallback.

---

## Task 1: metro.ts — LineTransfer fetcher + Dijkstra router

**Files:**
- Modify: `src/lib/metro.ts`
- Verify (temp): `scripts/_tmp-verify-route.ts` (created, run, deleted)

- [ ] **Step 1: Append the transfer fetcher and router**

Append to `src/lib/metro.ts` (after `buildMetroDepartures`):

```ts
export const METRO_TRANSFER_FALLBACK_SEC = 240;

export interface MetroTransferEdge {
  fromId: string; fromName: BiName;
  toId: string; toName: BiName;
  transferTimeSec: number;
}

const _transferCache = new Map<string, MetroTransferEdge[]>();
export async function getMetroLineTransfer(system: string): Promise<MetroTransferEdge[]> {
  if (_transferCache.has(system)) return _transferCache.get(system)!;
  const url = `${METRO_BASE}/LineTransfer/${system}?$format=JSON`;
  const raw = await fetchTDXApi<any>(url);
  const arr: any[] = Array.isArray(raw) ? raw : (raw?.LineTransfers ?? []);
  const out: MetroTransferEdge[] = arr.map((t) => {
    const mins = num(t?.TransferTime ?? t?.TransferTimes ?? t?.MorningFirstTransferTime);
    return {
      fromId: String(t?.FromStationID ?? t?.FromStationId ?? ''),
      fromName: t?.FromStationName ?? {},
      toId: String(t?.ToStationID ?? t?.ToStationId ?? ''),
      toName: t?.ToStationName ?? {},
      transferTimeSec: mins > 0 ? mins * 60 : METRO_TRANSFER_FALLBACK_SEC,
    };
  }).filter((e) => e.fromId && e.toId);
  _transferCache.set(system, out);
  return out;
}

export interface MetroRouteLeg {
  lineId: string;
  fromName: string; toName: string;
  stopNames: string[]; // inclusive, in travel order
  rideTimeSec: number;
}
export interface MetroRouteTransfer { stationName: string; transferTimeSec: number; }
export interface MetroRoute {
  legs: MetroRouteLeg[];
  transfers: MetroRouteTransfer[]; // between legs
  totalTimeSec: number;
  transferCount: number;
}

/**
 * Shortest in-system metro route allowing transfers. Graph = bidirectional ride
 * edges (S2STravelTime, weight run+dwell, tagged with lineId) + bidirectional
 * transfer edges (LineTransfer, weight transfer seconds, lineId null). Multi-source
 * / multi-target by station NAME (interchanges have different per-line ids; seeding
 * every same-name node at distance 0 avoids counting a phantom transfer at the
 * origin/destination). Returns null when no path exists.
 */
export function computeMetroRoute(
  lines: MetroLineTimes[],
  transfers: MetroTransferEdge[],
  originName: string,
  destName: string,
  zh: boolean,
): MetroRoute | null {
  const nameOf = (n: BiName) => (zh ? n.Zh_tw : n.En) || n.Zh_tw || n.En || '';
  interface Edge { to: string; weight: number; lineId: string | null }
  const adj = new Map<string, Edge[]>();
  const nodeName = new Map<string, string>();
  const addNode = (id: string, name: string) => {
    if (!adj.has(id)) adj.set(id, []);
    if (name && !nodeName.has(id)) nodeName.set(id, name);
  };
  const addEdge = (a: string, b: string, w: number, lineId: string | null) => {
    addNode(a, ''); adj.get(a)!.push({ to: b, weight: w, lineId });
  };

  for (const line of lines) {
    for (const s of line.segments) {
      const w = s.runTime + s.stopTime;
      addNode(s.fromId, nameOf(s.fromName));
      addNode(s.toId, nameOf(s.toName));
      addEdge(s.fromId, s.toId, w, line.lineId);
      addEdge(s.toId, s.fromId, w, line.lineId);
    }
  }
  for (const t of transfers) {
    addNode(t.fromId, nameOf(t.fromName));
    addNode(t.toId, nameOf(t.toName));
    addEdge(t.fromId, t.toId, t.transferTimeSec, null);
    addEdge(t.toId, t.fromId, t.transferTimeSec, null);
  }

  const sources = [...nodeName.entries()].filter(([, n]) => n === originName).map(([id]) => id);
  const targetSet = new Set([...nodeName.entries()].filter(([, n]) => n === destName).map(([id]) => id));
  if (sources.length === 0 || targetSet.size === 0) return null;

  const dist = new Map<string, number>();
  const prev = new Map<string, { node: string; lineId: string | null }>();
  const visited = new Set<string>();
  for (const id of adj.keys()) dist.set(id, Infinity);
  for (const s of sources) dist.set(s, 0);

  while (true) {
    let u: string | null = null; let best = Infinity;
    for (const [id, d] of dist) { if (!visited.has(id) && d < best) { best = d; u = id; } }
    if (u === null) break;
    visited.add(u);
    if (targetSet.has(u)) break;
    for (const e of (adj.get(u) ?? [])) {
      const nd = best + e.weight;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, { node: u, lineId: e.lineId });
      }
    }
  }

  let target: string | null = null; let td = Infinity;
  for (const t of targetSet) { const d = dist.get(t) ?? Infinity; if (d < td) { td = d; target = t; } }
  if (target === null || td === Infinity) return null;

  const pathNodes: string[] = [];
  const pathEdges: (string | null)[] = [];
  let cur: string | null = target;
  while (cur != null) {
    pathNodes.push(cur);
    const p = prev.get(cur);
    if (!p) break;
    pathEdges.push(p.lineId);
    cur = p.node;
  }
  pathNodes.reverse();
  pathEdges.reverse(); // pathEdges[i] connects pathNodes[i] -> pathNodes[i+1]

  const edgeWeight = (a: string, b: string, lineId: string | null) =>
    (adj.get(a) ?? []).find((x) => x.to === b && x.lineId === lineId)?.weight ?? 0;

  const legs: MetroRouteLeg[] = [];
  const transfersOut: MetroRouteTransfer[] = [];
  let totalTimeSec = 0;
  let pendingTransferSec = 0;
  let pendingTransferStation = '';
  let i = 0;
  while (i < pathEdges.length) {
    const lineId = pathEdges[i];
    if (lineId === null) {
      const w = edgeWeight(pathNodes[i], pathNodes[i + 1], null);
      if (pendingTransferSec === 0) pendingTransferStation = nodeName.get(pathNodes[i]) || '';
      pendingTransferSec += w;
      totalTimeSec += w;
      i++;
    } else {
      if (pendingTransferSec > 0 && legs.length > 0) {
        transfersOut.push({ stationName: pendingTransferStation, transferTimeSec: pendingTransferSec });
      }
      pendingTransferSec = 0;
      let rideTimeSec = 0;
      const stopIds: string[] = [pathNodes[i]];
      while (i < pathEdges.length && pathEdges[i] === lineId) {
        rideTimeSec += edgeWeight(pathNodes[i], pathNodes[i + 1], lineId);
        stopIds.push(pathNodes[i + 1]);
        i++;
      }
      totalTimeSec += rideTimeSec;
      const stopNames = stopIds.map((id) => nodeName.get(id) || '').filter(Boolean);
      legs.push({
        lineId,
        fromName: stopNames[0] || '',
        toName: stopNames[stopNames.length - 1] || '',
        stopNames,
        rideTimeSec,
      });
    }
  }

  if (legs.length === 0) return null;
  return { legs, transfers: transfersOut, totalTimeSec, transferCount: Math.max(0, legs.length - 1) };
}
```

- [ ] **Step 2: Write a one-off verification script**

Create `scripts/_tmp-verify-route.ts`:

```ts
import { computeMetroRoute, MetroLineTimes, MetroTransferEdge } from '../src/lib/metro';
import assert from 'node:assert';

// line1: A-B-C ; line2: C2-D-E (C2 is line-2's id of interchange named "C")
const lines: MetroLineTimes[] = [
  { lineId: 'line1', segments: [
    { fromId: 'A', fromName: { Zh_tw: 'A' }, toId: 'B', toName: { Zh_tw: 'B' }, runTime: 60, stopTime: 0 },
    { fromId: 'B', fromName: { Zh_tw: 'B' }, toId: 'C', toName: { Zh_tw: 'C' }, runTime: 60, stopTime: 0 },
  ] },
  { lineId: 'line2', segments: [
    { fromId: 'C2', fromName: { Zh_tw: 'C' }, toId: 'D', toName: { Zh_tw: 'D' }, runTime: 60, stopTime: 0 },
    { fromId: 'D', fromName: { Zh_tw: 'D' }, toId: 'E', toName: { Zh_tw: 'E' }, runTime: 60, stopTime: 0 },
  ] },
];
const transfers: MetroTransferEdge[] = [
  { fromId: 'C', fromName: { Zh_tw: 'C' }, toId: 'C2', toName: { Zh_tw: 'C' }, transferTimeSec: 120 },
];

const r = computeMetroRoute(lines, transfers, 'A', 'E', true);
assert(r, 'A->E route should exist');
assert.strictEqual(r!.legs.length, 2);
assert.strictEqual(r!.transferCount, 1);
assert.strictEqual(r!.legs[0].lineId, 'line1');
assert.strictEqual(r!.legs[1].lineId, 'line2');
assert.deepStrictEqual(r!.legs[0].stopNames, ['A', 'B', 'C']);
assert.deepStrictEqual(r!.legs[1].stopNames, ['C', 'D', 'E']);
assert.strictEqual(r!.transfers.length, 1);
assert.strictEqual(r!.transfers[0].stationName, 'C');
assert.strictEqual(r!.totalTimeSec, 60 + 60 + 120 + 60 + 60); // 360

// Origin IS the interchange -> no phantom transfer, single leg on line2.
const r2 = computeMetroRoute(lines, transfers, 'C', 'E', true);
assert(r2, 'C->E route should exist');
assert.strictEqual(r2!.transferCount, 0);
assert.strictEqual(r2!.legs.length, 1);
assert.strictEqual(r2!.legs[0].lineId, 'line2');

console.log('ALL METRO ROUTE ASSERTIONS PASSED');
```

- [ ] **Step 3: Run the verification**

Run: `npx tsx scripts/_tmp-verify-route.ts`
Expected: prints `ALL METRO ROUTE ASSERTIONS PASSED`, exit 0.

- [ ] **Step 4: Delete the script and typecheck**

```bash
rm scripts/_tmp-verify-route.ts
npx tsc --noEmit
```
Expected: `TypeScript: No errors found`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/metro.ts
git commit -m "feat(metro): in-system transfer router (LineTransfer + Dijkstra)"
```

---

## Task 2: MetroSearch — state, imports, handleSearch transfer branch

**Files:**
- Modify: `src/components/MetroSearch.tsx`

- [ ] **Step 1: Extend the metro lib import**

Replace the `'../lib/metro'` import line with (adds `MetroRoute`, `getMetroLineTransfer`, `computeMetroRoute`):

```ts
import { getMetroStations, getMetroODFare, getMetroS2STravelTime, computeSameLineJourney, METRO_SYSTEMS, MetroStation, MetroFare, SameLineJourney, getMetroLiveBoard, MetroLiveBoard, MetroDeparture, buildMetroDepartures, metroTrainTypeLabel, MetroRoute, getMetroLineTransfer, computeMetroRoute } from '../lib/metro';
```

- [ ] **Step 2: Add `route` and `visibleCount` state**

Right after the `const [departures, setDepartures] = useState<MetroDeparture[]>([]);` line, add:

```ts
  const [route, setRoute] = useState<MetroRoute | null>(null);
  const [visibleCount, setVisibleCount] = useState(10);
```

- [ ] **Step 3: Update `handleSearch` — reset state + compute transfer route**

In `handleSearch`, replace the block from `setFares(f);` through the closing of the static-timetable `if (j) { ... } else { setDepartures([]); }` with:

```ts
      setFares(f);
      setVisibleCount(10);
      const j = computeSameLineJourney(s2s, originId, destId, zh);
      setJourney(j);

      if (j) {
        // Same line: load static timetable for the origin station and shape into departures.
        setRoute(null);
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
        // Cross-line: compute an in-system transfer route.
        setDepartures([]);
        try {
          const transferEdges = await getMetroLineTransfer(system);
          const originName = getStationName(stations.find(s => s.StationID === originId));
          const destName = getStationName(stations.find(s => s.StationID === destId));
          setRoute(computeMetroRoute(s2s, transferEdges, originName, destName, zh));
        } catch (e) {
          console.error(e);
          setRoute(null);
        }
      }
```

(`getStationName` and `stations` are already in scope.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes (the JSX still references `journey`/`departures`; `route` is set but rendered in Task 3 — no type error since `route` state exists).

- [ ] **Step 5: Commit**

```bash
git add src/components/MetroSearch.tsx
git commit -m "feat(metro): compute transfer route + reset paging on search"
```

---

## Task 3: MetroSearch — render header, show-more, itinerary, fallback

**Files:**
- Modify: `src/components/MetroSearch.tsx`

- [ ] **Step 1: Generalize the summary-header time line**

Replace the `{journey && ( ... )}` block inside the summary header:

```tsx
            {journey && (
              <div className="flex items-center gap-2 text-sm font-semibold text-white/90">
                <Clock className="w-4 h-4" />
                <span>{Math.ceil(journey.travelTimeSec / 60)} {L('分鐘', 'min')}</span>
                <span className="opacity-70">·</span>
                <span>{L(`經 ${journey.stopNames.length - 1} 站`, `${journey.stopNames.length - 1} stops`)}</span>
              </div>
            )}
```

with:

```tsx
            {(journey || route) && (
              <div className="flex items-center gap-2 text-sm font-semibold text-white/90">
                <Clock className="w-4 h-4" />
                {journey ? (
                  <>
                    <span>{Math.ceil(journey.travelTimeSec / 60)} {L('分鐘', 'min')}</span>
                    <span className="opacity-70">·</span>
                    <span>{L(`經 ${journey.stopNames.length - 1} 站`, `${journey.stopNames.length - 1} stops`)}</span>
                  </>
                ) : route ? (
                  <>
                    <span>{Math.ceil(route.totalTimeSec / 60)} {L('分鐘', 'min')}</span>
                    <span className="opacity-70">·</span>
                    <span>{L(`轉乘 ${route.transferCount} 次`, `${route.transferCount} transfer${route.transferCount === 1 ? '' : 's'}`)}</span>
                  </>
                ) : null}
              </div>
            )}
```

- [ ] **Step 2: Slice the departures map**

Change `{departures.map((d) => {` to:

```tsx
                  {departures.slice(0, visibleCount).map((d) => {
```

- [ ] **Step 3: Add the show-more button**

Find the cards container close — the `</div>` that ends `<div className="flex flex-col gap-3">` (immediately after the departures `.map(...)` closes with `})}` then `</div>`), followed by `</>`. Insert the button between that `</div>` and `</>`:

```tsx
                </div>
                {departures.length > visibleCount && (
                  <button
                    onClick={() => setVisibleCount(v => v + 10)}
                    className="mt-4 w-full py-3 rounded-2xl border border-cyan-200 dark:border-cyan-800 text-cyan-700 dark:text-cyan-400 font-bold text-sm hover:bg-cyan-50 dark:hover:bg-cyan-900/20 transition-colors"
                  >
                    {L(`查看更多 (+${Math.min(10, departures.length - visibleCount)})`, `Show more (+${Math.min(10, departures.length - visibleCount)})`)}
                  </button>
                )}
              </>
```

- [ ] **Step 4: Replace the cross-line fallback with the itinerary branch + reworded final fallback**

Replace this block (the outer `) : (` else with the amber card):

```tsx
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
```

with:

```tsx
          ) : route ? (
            <>
              <h3 className="mb-4 px-2 text-xs sm:text-sm font-black text-slate-950 dark:text-white tracking-widest uppercase">
                {L(`建議路線 · 轉乘 ${route.transferCount} 次`, `Suggested Route · ${route.transferCount} transfer${route.transferCount === 1 ? '' : 's'}`)}
              </h3>
              <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4 sm:p-6 flex flex-col">
                {route.legs.map((leg, i) => (
                  <React.Fragment key={i}>
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 self-start px-2 py-1 rounded-md text-xs font-bold tracking-widest bg-[#e0f7fa] text-[#0e7490] whitespace-nowrap">
                        {leg.lineId}
                      </span>
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="font-bold text-slate-800 dark:text-slate-100">{leg.fromName} → {leg.toName}</span>
                        <span className="text-xs text-slate-500">
                          {L(`經 ${Math.max(0, leg.stopNames.length - 1)} 站`, `${Math.max(0, leg.stopNames.length - 1)} stops`)}
                          {' · '}
                          {Math.ceil(leg.rideTimeSec / 60)} {L('分鐘', 'min')}
                        </span>
                      </div>
                    </div>
                    {i < route.legs.length - 1 && (
                      <div className="flex items-center gap-2 my-3 pl-1 text-xs font-semibold text-cyan-700 dark:text-cyan-400">
                        <ArrowRightLeft className="w-4 h-4 shrink-0" />
                        {L(`在 ${route.transfers[i]?.stationName ?? ''} 轉乘 · 約 ${Math.ceil((route.transfers[i]?.transferTimeSec ?? 0) / 60)} 分`,
                           `Transfer at ${route.transfers[i]?.stationName ?? ''} · ~${Math.ceil((route.transfers[i]?.transferTimeSec ?? 0) / 60)} min`)}
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center p-6 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-2xl text-center gap-3">
              <AlertCircle className="w-8 h-8 text-amber-500" />
              <div>
                <h4 className="font-bold text-amber-700 dark:text-amber-500 mb-1">{L('查無路線', 'No Route Found')}</h4>
                <p className="text-sm text-amber-600/80 dark:text-amber-400/80 max-w-sm">
                  {L('此區間無法在系統內轉乘，請改用「規劃」功能查詢跨運具路線。', 'No in-system transfer route for this segment. Try the "Plan" tab for multimodal routing.')}
                </p>
              </div>
            </div>
          )}
```

(`ArrowRightLeft` is already imported in MetroSearch; `React` is imported.)

- [ ] **Step 5: Typecheck + build**

```bash
npx tsc --noEmit
npx vite build
```
Expected: tsc clean; build succeeds.

- [ ] **Step 6: Manual dev-server verification**

```bash
npm run dev
```
1. Metro tab → cross-line TRTC route (e.g. 淡水 → 南港展覽館), Search → summary header shows 總時間 · 轉乘 N 次; itinerary card lists legs (line badge, from→to, 經 N 站 · ride time) with "在 {站} 轉乘 · 約 N 分" between legs.
2. Long same-line route → only 10 departure cards; 查看更多 (+N) reveals 10 more per click.
3. A genuinely unroutable pair (no LineTransfer data / disconnected) → amber 查無路線 fallback.

- [ ] **Step 7: Commit**

```bash
git add src/components/MetroSearch.tsx
git commit -m "feat(metro): transfer itinerary card + departure show-more"
```

---

## Self-Review Notes

- **Spec coverage:** transfer routing (Task 1 `computeMetroRoute` + `getMetroLineTransfer`; Task 2 wiring; Task 3 itinerary UI), show-more (Task 2 `visibleCount` reset; Task 3 slice + button), generalized header (Task 3 Step 1), reworded final fallback (Task 3 Step 4). All covered.
- **Type consistency:** `MetroRoute`/`MetroRouteLeg`/`MetroRouteTransfer`/`MetroTransferEdge`, `getMetroLineTransfer`, `computeMetroRoute` defined in Task 1, consumed unchanged in Tasks 2–3. `route`/`visibleCount` added in Task 2 before Task 3 references them.
- **No placeholders:** all steps contain exact code/commands/expected output.
