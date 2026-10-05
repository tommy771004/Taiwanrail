/**
 * Pure model behind public/data/metro_crowd.json (I/O lives in build-metro-crowd.ts).
 *
 * The open data (臺北捷運各站分時進出量統計) only says how many people entered at A and left at B
 * in each hour. Crowding is about how many are *on the train* between two stations, so every
 * A→B flow is routed over the network and added to each directed segment it rides:
 *
 *   1. route — fastest path on a graph of line segments (S2STravelTime run + stop time) and
 *      transfer edges (LineTransfer time + a waiting penalty). Riders are assumed to take it.
 *   2. spill — a flow is counted in its entry hour, but a segment ridden t seconds after
 *      entering is in the next hour for a share t/3600 of riders (entries spread over the hour).
 *   3. normalise — per scheduled train in that hour where the line has station timetables
 *      (a 3-minute peak and a 7-minute midday carry very different loads per train), per hour
 *      otherwise (文湖線 has no StationTimeTable).
 *   4. level — relative to the line's own busy reference (its 98th-percentile weekday value),
 *      because train capacity differs by line and is not in the data.
 */
import { CROWD_HOURS, type CrowdDayType, type CrowdLevel } from '../src/lib/metroCrowd.js';

export interface CrowdStation { id: string; name: string; line: string }
export interface CrowdEdge { to: string; sec: number; transfer: boolean }
export type CrowdGraph = Map<string, CrowdEdge[]>;

/** Waiting on the second platform, on top of the walk LineTransfer gives. */
export const TRANSFER_PENALTY_SEC = 180;
/** Walk for an interchange LineTransfer does not list (matched by station name instead). */
export const DEFAULT_TRANSFER_SEC = 240;
/**
 * Weight of a pattern segment S2STravelTime has no time for (R01 廣慈/奉天宮 — see CLAUDE.md).
 * Routing only: it is the sole way to reach that station, so the value cannot change which
 * path any flow takes, and it is never shown.
 */
export const NOMINAL_SEGMENT_SEC = 120;

/** Level thresholds as a share of the line's reference value. */
export const LEVEL_THRESHOLDS = [0.3, 0.55, 0.8] as const;
/** Below this many riders per hour on a segment there is no meaningful estimate → '0'. */
export const MIN_HOURLY_LOAD = 30;

export const normName = (s: string) => s.replace(/臺/g, '台').replace(/\s+/g, '').replace(/站$/, '');

/**
 * Station ids an OD-file name refers to. A leading line code restricts it to that line —
 * the file writes the 板橋 interchange as 「BL板橋」 and 「Y板橋」.
 */
export function resolveOdName(raw: string, stations: CrowdStation[]): string[] {
  const m = /^([A-Z]{1,2})(\D.*)$/.exec(raw.trim());
  const line = m ? m[1] : null;
  const name = normName(m ? m[2] : raw);
  return stations.filter((s) => normName(s.name) === name && (!line || s.line === line)).map((s) => s.id);
}

export function buildCrowdGraph(
  patterns: string[][],
  segmentSec: Map<string, number>,
  stations: CrowdStation[],
  transfers: { a: string; b: string; sec: number }[],
): CrowdGraph {
  const g: CrowdGraph = new Map(stations.map((s) => [s.id, []]));
  const add = (a: string, b: string, sec: number, transfer: boolean) => {
    if (!g.has(a) || !g.has(b) || a === b) return;
    if (g.get(a)!.some((e) => e.to === b)) return;
    g.get(a)!.push({ to: b, sec, transfer });
    g.get(b)!.push({ to: a, sec, transfer });
  };
  for (const p of patterns) {
    for (let k = 1; k < p.length; k++) {
      add(p[k - 1], p[k], segmentSec.get(`${p[k - 1]}|${p[k]}`) ?? segmentSec.get(`${p[k]}|${p[k - 1]}`) ?? NOMINAL_SEGMENT_SEC, false);
    }
  }
  for (const t of transfers) add(t.a, t.b, t.sec + TRANSFER_PENALTY_SEC, true);
  // Same-name stations on different lines LineTransfer does not list.
  for (const a of stations) {
    for (const b of stations) {
      if (a.id < b.id && a.line !== b.line && normName(a.name) === normName(b.name)) add(a.id, b.id, DEFAULT_TRANSFER_SEC + TRANSFER_PENALTY_SEC, true);
    }
  }
  return g;
}

export interface CrowdPath {
  /** Directed line segments ridden, with seconds from entry to the start of each. */
  segments: { from: string; to: string; atSec: number }[];
}

/** Fastest path from any of `fromIds` to the nearest of `toIds`; null when unreachable or the same station. */
export function fastestPath(g: CrowdGraph, fromIds: string[], toIds: string[]): CrowdPath | null {
  if (fromIds.some((id) => toIds.includes(id))) return null;
  const dist = new Map<string, number>();
  const prev = new Map<string, { node: string; transfer: boolean }>();
  const done = new Set<string>();
  for (const id of fromIds) if (g.has(id)) dist.set(id, 0);
  const targets = new Set(toIds);
  let reached: string | null = null;
  while (true) {
    let u: string | null = null;
    for (const [id, d] of dist) if (!done.has(id) && (u === null || d < dist.get(u)!)) u = id;
    if (u === null) break;
    if (targets.has(u)) { reached = u; break; }
    done.add(u);
    for (const e of g.get(u) ?? []) {
      const nd = dist.get(u)! + e.sec;
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, { node: u, transfer: e.transfer }); }
    }
  }
  if (!reached) return null;
  const hops: { from: string; to: string; transfer: boolean }[] = [];
  for (let v = reached; prev.has(v); v = prev.get(v)!.node) hops.unshift({ from: prev.get(v)!.node, to: v, transfer: prev.get(v)!.transfer });
  return {
    segments: hops
      .filter((h) => !h.transfer)
      .map((h) => ({ from: h.from, to: h.to, atSec: dist.get(h.from)! })),
  };
}

/** segment key → [hour] riders, per day type. */
export type SegmentLoads = Record<CrowdDayType, Map<string, Float64Array>>;

export function emptyLoads(): SegmentLoads {
  return { wd: new Map(), we: new Map() };
}

/** Add `riders` who entered in `hour` along `path`, spilling into the next hour by ride time. */
export function addFlow(loads: SegmentLoads, dayType: CrowdDayType, hour: number, riders: number, path: CrowdPath) {
  if (riders <= 0) return;
  for (const s of path.segments) {
    const key = `${s.from}>${s.to}`;
    let arr = loads[dayType].get(key);
    if (!arr) loads[dayType].set(key, (arr = new Float64Array(CROWD_HOURS)));
    const spill = Math.min(1, s.atSec / 3600);
    arr[hour] += riders * (1 - spill);
    arr[(hour + 1) % CROWD_HOURS] += riders * spill;
  }
}

/** Next station from `fromId` toward `destId`, inside a pattern running through both. */
export function nextHop(patterns: string[][], fromId: string, destId: string): string | null {
  for (const p of patterns) {
    const i = p.indexOf(fromId);
    const j = p.indexOf(destId);
    if (i < 0 || j < 0 || i === j) continue;
    return p[j > i ? i + 1 : i - 1];
  }
  return null;
}

export interface LineLevelsInput {
  /** Segment keys belonging to this line. */
  segments: string[];
  loads: SegmentLoads;
  /** Scheduled trains per segment per hour, per day type; absent for a perHour line. */
  trains?: Record<CrowdDayType, Map<string, Float64Array>>;
}

/** Per segment: levels for both day types (0 = no estimate). */
export function lineLevels({ segments, loads, trains }: LineLevelsInput): Map<string, Record<CrowdDayType, (CrowdLevel | 0)[]>> {
  const value = (t: CrowdDayType, key: string, h: number): number | null => {
    const load = loads[t].get(key)?.[h] ?? 0;
    if (load < MIN_HOURLY_LOAD) return null;
    if (!trains) return load;
    const n = trains[t].get(key)?.[h] ?? 0;
    return n > 0 ? load / n : null; // riders but no scheduled train that hour: spill past the last train
  };
  const weekday = segments.flatMap((k) => Array.from({ length: CROWD_HOURS }, (_, h) => value('wd', k, h)))
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const ref = weekday.length ? weekday[Math.min(weekday.length - 1, Math.floor(weekday.length * 0.98))] : 0;
  const out = new Map<string, Record<CrowdDayType, (CrowdLevel | 0)[]>>();
  for (const key of segments) {
    const levels = { wd: [] as (CrowdLevel | 0)[], we: [] as (CrowdLevel | 0)[] };
    for (const t of ['wd', 'we'] as CrowdDayType[]) {
      for (let h = 0; h < CROWD_HOURS; h++) {
        const v = value(t, key, h);
        levels[t].push(v === null || ref <= 0 ? 0 : (1 + LEVEL_THRESHOLDS.filter((x) => v / ref >= x).length) as CrowdLevel);
      }
    }
    out.set(key, levels);
  }
  return out;
}

/**
 * Day type per date: weekends are 'we'; a Mon–Fri date carrying under `share` of the median
 * weekday ridership is a holiday (or a typhoon day) and is folded into 'we' too.
 */
export function classifyDays(totals: Map<string, number>, share = 0.8): Map<string, CrowdDayType> {
  const dow = (d: string) => new Date(`${d}T12:00:00+08:00`).getUTCDay();
  const weekdayTotals = [...totals].filter(([d]) => dow(d) >= 1 && dow(d) <= 5).map(([, n]) => n).sort((a, b) => a - b);
  const median = weekdayTotals[Math.floor(weekdayTotals.length / 2)] ?? 0;
  return new Map([...totals].map(([d, n]) => {
    const w = dow(d);
    return [d, w === 0 || w === 6 || n < median * share ? 'we' : 'wd'];
  }));
}
