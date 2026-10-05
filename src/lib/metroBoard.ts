/**
 * src/lib/metroBoard.ts
 * 捷運「到站看板」的純邏輯：把 LiveBoard（即時）、車站時刻表（表定）、月台與車廂擁擠度
 * 整理成「一條線、兩個方向」的看板資料。沒有 DOM、沒有 fetch，方便單元測試。
 *
 * 方向一律用「營運路線（service pattern）上的站序」判斷，不用 TDX 的 Direction 代碼。
 * 一條線可能有好幾個 pattern：中和新蘆線是「南勢角↔迴龍」與「南勢角↔蘆洲」，淡水信義線
 * 另有「北投↔新北投」支線。pattern 由 S2STravelTime 串出來（buildLinePatterns），並統一
 * 以站碼小→大為正向，所以 `down` = 往站碼小的一端、`up` = 往站碼大的一端（淡水信義線：
 * down 往象山端、up 往淡水）；列車往哪一端，看它的終點站在「同時經過本站的 pattern」裡
 * 位於本站之前或之後。只用 StationID 排序會把支線接成一直線（迴龍接三重國小）。
 *
 * 即時與表定絕不混用標示：`live: true` 只給 LiveBoard 的列，時刻表推出來的一律
 * `live: false`，畫面據此顯示「即時」或「表定」。
 */
import type { BiName, MetroLiveBoard, MetroLivePosition, MetroPlatform, MetroTrainLiveBoard } from './metro';
import { typicalCrowdAt, type TypicalCrowd } from './metroCrowd';

export type BoardDir = 'down' | 'up';

const WEEKDAY_KEYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Whether a StationTimeTable row runs on `weekday` (0 = Sunday, Taipei calendar).
 * Each station file carries separate 平日 / 週六 / 週日 rows for the same direction,
 * so ignoring ServiceDay lists every train up to three times. A row without a
 * readable ServiceDay is kept rather than silently dropped.
 * Lives here (not metro.ts) so this module stays free of the fetch layer and testable in Node.
 */
export function metroServesWeekday(entry: any, weekday: number): boolean {
  const sd = entry?.ServiceDay;
  if (!sd || typeof sd !== 'object') return true;
  const v = sd[WEEKDAY_KEYS[weekday]];
  return v === undefined ? true : Boolean(v);
}

export interface BoardTrain {
  /** Minutes until the train reaches this station (0 = arriving). */
  minutes: number;
  destId: string;
  destName: BiName;
  /** true = TDX LiveBoard reading; false = derived from the static timetable. */
  live: boolean;
  /** Scheduled departure "HH:MM" (timetable trains only — LiveBoard gives minutes, not a clock time). */
  time?: string;
}

export interface BoardDirection {
  dir: BoardDir;
  /**
   * Line ends in this direction — the heading riders read on the platform sign. More than
   * one where the line branches beyond this station (大橋頭 up: 迴龍 and 蘆洲).
   */
  terminusIds: string[];
  terminusNames: BiName[];
  /** No service pattern continues past this station in this direction. */
  isLineEnd: boolean;
  /** The timetable has no train from here in this direction on any day (e.g. a branch stub). */
  noService: boolean;
  next: BoardTrain | null;
  following: BoardTrain | null;
  platform: string;
  /** Per-car crowdedness (1–4) of `next`, only when `next` is live and TDX published it. */
  crowdedness?: number[];
  /**
   * How full trains leaving here this way usually are in the hour `next` departs, from
   * historical ridership (metro_crowd.json) — 「歷史」, never a live reading. Null without data.
   */
  typicalCrowd: TypicalCrowd | null;
  /** The next several trains for the 後續班次 panel: live ones first, then the timetable after them. */
  upcoming: BoardTrain[];
  /** Today's first and last scheduled departure in this direction ("HH:MM"), in service order. */
  firstTrain: string | null;
  lastTrain: string | null;
}

export interface BoardLineInput {
  stationId: string;
  /**
   * The line's service patterns (buildLinePatterns), each in running order from the low-id
   * end to the high-id end. A plain line is one pattern; a branched line has one per branch.
   */
  patterns: string[][];
  names: Record<string, BiName>;
  liveBoard: MetroLiveBoard[];
  /** Raw `/data/metro_<sys>/<stationId>.json` (TDX StationTimeTable rows). */
  timetable: any[];
  platforms: MetroPlatform[];
  trainLive: MetroTrainLiveBoard[];
  /** Minutes since midnight, Taipei time. */
  nowMin: number;
  /** 0 = Sunday … 6 = Saturday, Taipei calendar. */
  weekday: number;
  /** This system's segments from metro_crowd.json ("FROM>TO" → levels); absent outside 台北捷運 / 環狀線. */
  typicalCrowd?: Record<string, string>;
}

/** A scheduled train counts as "the following one" only if it is at least this much after the live next train. */
const FOLLOWING_GAP_MIN = 2;
/** How many trains the 後續班次 panel lists. */
const UPCOMING_COUNT = 8;
/** Departures before this hour belong to the previous service day (a 00:20 train runs after the 23:50 one). */
const SERVICE_DAY_START_MIN = 3 * 60;

function serviceOrder(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  if (!m) return null;
  const min = Number(m[1]) * 60 + Number(m[2]);
  return min < SERVICE_DAY_START_MIN ? min + 1440 : min;
}

/**
 * Direction of a train at `fromId` heading for `destId`: decided inside a pattern that runs
 * through both, or null when none does (not this line, or across branches — no train runs
 * 迴龍 → 蘆洲).
 */
export function boardDirOf(patterns: string[][], fromId: string, destId: string): BoardDir | null {
  for (const p of patterns) {
    const i = p.indexOf(fromId);
    const j = p.indexOf(destId);
    if (i < 0 || j < 0 || i === j) continue;
    return j > i ? 'up' : 'down';
  }
  return null;
}

/** Minimal shape of an S2STravelTime entry (metro.ts `MetroLineTimes`). */
interface PatternSource { segments: { fromId: string; toId: string }[] }

/**
 * Service patterns per line code from S2STravelTime: each entry that forms one contiguous
 * chain becomes a station sequence, oriented low id → high id, and a pattern lying wholly
 * inside another (a short turn like 南港展覽館↔亞東醫院) is dropped, so what remains is one
 * pattern per branch. Entries that are not a chain (TYMC publishes all-pairs segments) are
 * skipped; a line left with no pattern falls back to its StationID order in the caller.
 */
export function buildLinePatterns(
  lines: PatternSource[],
  codeOf: (stationId: string) => string,
  compareIds: (a: string, b: string) => number,
): Map<string, string[][]> {
  const byCode = new Map<string, string[][]>();
  for (const line of lines ?? []) {
    const segs = line.segments ?? [];
    if (segs.length === 0) continue;
    if (segs.some((sg, k) => k > 0 && segs[k - 1].toId !== sg.fromId)) continue;
    const ids = [segs[0].fromId, ...segs.map((sg) => sg.toId)];
    if (new Set(ids).size !== ids.length) continue;
    if (compareIds(ids[0], ids[ids.length - 1]) > 0) ids.reverse();
    const code = codeOf(ids[0]);
    if (!code) continue;
    const list = byCode.get(code) ?? [];
    list.push(ids);
    byCode.set(code, list);
  }
  for (const [code, list] of byCode) {
    const sets = list.map((p) => new Set(p));
    const kept = list.filter((p, a) => !list.some((q, b) => {
      if (a === b || q.length < p.length) return false;
      if (q.length === p.length && b > a) return false; // identical sets: keep the first
      return p.every((id) => sets[b].has(id));
    }));
    byCode.set(code, kept);
  }
  return byCode;
}

export interface LineBranch {
  /** Station on the main pattern where the branch leaves it. */
  junctionId: string;
  /** Branch stations in running order (low id → high id), junction included at its end. */
  ids: string[];
}

/**
 * Main line + branches for drawing: the longest pattern is the main line, and each other
 * pattern contributes the run of stations the main line doesn't have (蘆洲支線 from 大橋頭,
 * 新北投支線 from 北投, 小碧潭支線 from 七張).
 */
export function lineLayout(patterns: string[][]): { main: string[]; branches: LineBranch[] } {
  if (patterns.length === 0) return { main: [], branches: [] };
  const main = [...patterns].sort((a, b) => b.length - a.length)[0];
  const onMain = new Set(main);
  const branches: LineBranch[] = [];
  for (const p of patterns) {
    if (p === main) continue;
    const off = p.map((id) => !onMain.has(id));
    const first = off.indexOf(true);
    const last = off.lastIndexOf(true);
    if (first < 0) continue;
    if (off.slice(first, last + 1).some((x) => !x)) continue; // not one contiguous run
    if (last === p.length - 1 && first > 0) {
      branches.push({ junctionId: p[first - 1], ids: p.slice(first - 1) });
    } else if (first === 0 && last < p.length - 1) {
      branches.push({ junctionId: p[last + 1], ids: p.slice(0, last + 2) });
    }
  }
  return { main, branches };
}

/**
 * `main` extended with stations the patterns don't cover but that sit past its ends in
 * StationID order — a newly opened terminus S2STravelTime has not caught up with yet
 * (淡水信義線 R01 廣慈/奉天宮 beyond R02 象山).
 */
export function extendWithUncovered(main: string[], sortedIds: string[], covered: Set<string>): string[] {
  if (main.length === 0) return sortedIds;
  const start = sortedIds.indexOf(main[0]);
  const end = sortedIds.indexOf(main[main.length - 1]);
  if (start < 0 || end < 0) return main;
  const before: string[] = [];
  for (let k = start - 1; k >= 0 && !covered.has(sortedIds[k]); k--) before.unshift(sortedIds[k]);
  const after: string[] = [];
  for (let k = end + 1; k < sortedIds.length && !covered.has(sortedIds[k]); k++) after.push(sortedIds[k]);
  return [...before, ...main, ...after];
}

/** "HH:MM" → minutes from `nowMin`, folded into (-720, 720] so 00:05 after 23:50 reads as +15. */
export function minutesUntil(hhmm: string, nowMin: number): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  if (!m) return null;
  let diff = Number(m[1]) * 60 + Number(m[2]) - nowMin;
  if (diff <= -720) diff += 1440;
  else if (diff > 720) diff -= 1440;
  return diff;
}

export function buildBoardLine(input: BoardLineInput): BoardDirection[] {
  const { stationId, nowMin, weekday } = input;
  const patterns = input.patterns.filter((p) => p.includes(stationId));
  const dirOf = (destId: string) => boardDirOf(patterns, stationId, destId);
  /** Ends of every pattern through this station that continues in `dir`. */
  const endsToward = (dir: BoardDir): string[] => {
    const ends = new Set<string>();
    for (const p of patterns) {
      const i = p.indexOf(stationId);
      if (dir === 'up' && i < p.length - 1) ends.add(p[p.length - 1]);
      if (dir === 'down' && i > 0) ends.add(p[0]);
    }
    return [...ends];
  };

  const live: Record<BoardDir, BoardTrain[]> = { down: [], up: [] };
  for (const row of input.liveBoard) {
    if (row.StationID !== stationId) continue;
    const dir = dirOf(row.DestinationStationID);
    if (!dir) continue;
    live[dir].push({
      minutes: Math.max(0, Math.round(row.EstimateTime)),
      destId: row.DestinationStationID,
      destName: row.DestinationStationName,
      live: true,
    });
  }

  const scheduled: Record<BoardDir, BoardTrain[]> = { down: [], up: [] };
  const todayTimes: Record<BoardDir, string[]> = { down: [], up: [] };
  const servedAnyDay: Record<BoardDir, boolean> = { down: false, up: false };
  for (const entry of input.timetable ?? []) {
    if (entry?.StationID && String(entry.StationID) !== stationId) continue;
    // TDX misspells the field as DestinationStaionID in this dataset — read both.
    const destId = String(entry?.DestinationStationID ?? entry?.DestinationStaionID ?? '');
    const dir = dirOf(destId);
    if (!dir) continue;
    servedAnyDay[dir] = true;
    if (!metroServesWeekday(entry, weekday)) continue;
    for (const t of entry?.Timetables ?? []) {
      if (typeof t?.DepartureTime === 'string') todayTimes[dir].push(t.DepartureTime);
      const diff = minutesUntil(t?.DepartureTime, nowMin);
      if (diff === null || diff < 0) continue;
      scheduled[dir].push({ minutes: diff, destId, destName: entry?.DestinationStationName ?? {}, live: false, time: t.DepartureTime });
    }
  }

  const byMinutes = (a: BoardTrain, b: BoardTrain) => a.minutes - b.minutes;
  const hasTimetable = (input.timetable ?? []).length > 0;

  return (['down', 'up'] as BoardDir[]).map((dir) => {
    const liveTrains = live[dir].sort(byMinutes);
    const schedTrains = scheduled[dir].sort(byMinutes);
    let next: BoardTrain | null = liveTrains[0] ?? null;
    let following: BoardTrain | null = null;
    if (next) {
      following = liveTrains[1]
        ?? schedTrains.find((t) => t.minutes >= next!.minutes + FOLLOWING_GAP_MIN)
        ?? null;
    } else {
      next = schedTrains[0] ?? null;
      following = schedTrains[1] ?? null;
    }

    const termini = endsToward(dir);
    const isLineEnd = patterns.length > 0 && termini.length === 0;

    const lastLive = liveTrains[liveTrains.length - 1];
    const upcoming = (lastLive
      ? [...liveTrains, ...schedTrains.filter((t) => t.minutes >= lastLive.minutes + FOLLOWING_GAP_MIN)]
      : schedTrains
    ).slice(0, UPCOMING_COUNT);

    const ordered = todayTimes[dir]
      .map((t) => ({ t, k: serviceOrder(t) }))
      .filter((x): x is { t: string; k: number } => x.k !== null)
      .sort((a, b) => a.k - b.k);

    // Several platforms can serve one direction — 北投's 往淡水 and 往新北投, both platforms at
    // a terminus — so list each distinct one rather than the first match.
    const platform = [...new Set(input.platforms
      .filter((p) => p.stationId === stationId && dirOf(p.destStationId) === dir)
      .map((p) => p.platform))]
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
      .join('/');

    let crowdedness: number[] | undefined;
    if (next?.live) {
      // The next train is the one still upstream of us (or at the platform) heading to the same terminus.
      // Distance is measured inside a pattern that runs through us and the train's terminus.
      const pattern = patterns.find((p) => p.includes(next!.destId));
      const i = pattern ? pattern.indexOf(stationId) : -1;
      let best: { k: number; cars?: number[] } | null = null;
      for (const t of pattern ? input.trainLive : []) {
        if (t.DestinationStationID !== next.destId) continue;
        const k = pattern!.indexOf(t.StationID);
        if (k < 0) continue;
        const upstream = dir === 'up' ? k <= i : k >= i;
        if (!upstream) continue;
        if (!best || (dir === 'up' ? k > best.k : k < best.k)) best = { k, cars: t.CarCrowdedness };
      }
      if (best?.cars?.length) crowdedness = best.cars;
    }

    // The next stop this way on every pattern through here — two at a fork (北投: 淡水 and 新北投).
    const neighbours = [...new Set(patterns.map((p) => p[p.indexOf(stationId) + (dir === 'up' ? 1 : -1)]).filter(Boolean))];
    const typicalCrowd = isLineEnd
      ? null
      : typicalCrowdAt(input.typicalCrowd, stationId, neighbours, weekday, nowMin + Math.max(0, next?.minutes ?? 0));

    return {
      dir,
      terminusIds: termini,
      terminusNames: termini.map((id) => input.names[id] ?? {}),
      isLineEnd,
      noService: !isLineEnd && hasTimetable && !servedAnyDay[dir] && liveTrains.length === 0,
      next: isLineEnd ? null : next,
      following: isLineEnd ? null : following,
      upcoming: isLineEnd ? [] : upcoming,
      firstTrain: isLineEnd ? null : ordered[0]?.t ?? null,
      lastTrain: isLineEnd ? null : ordered[ordered.length - 1]?.t ?? null,
      platform,
      crowdedness,
      typicalCrowd,
    };
  });
}

export interface BoardStripTrain {
  /** Position in station-index units relative to the board station (0 = at it, -1.5 = between the 1st and 2nd stop toward `down`). */
  offset: number;
  dir: BoardDir;
}

export interface LineTrain {
  /** Position in station-index units along the line (2 = at the 3rd stop, 2.5 = between the 3rd and 4th). */
  index: number;
  dir: BoardDir;
}

/**
 * Live train positions along one drawn section of a line (the 全線動態 main line or a
 * branch). TDX LivePosition is station-granular: MoveStatus 0 = at / arriving at
 * `stationId`, 1 = departed from it, so a departed train is drawn half-way to the next
 * stop in its direction. Direction comes from the full `patterns`, because a train on a
 * branch is usually bound for a terminus outside the drawn section (蘆洲支線 → 南勢角).
 * Station ids are line-scoped, so positions on other lines simply don't match.
 */
export function lineTrains(
  positions: MetroLivePosition[],
  sectionIds: string[],
  patterns: string[][] = [sectionIds],
): LineTrain[] {
  const out: LineTrain[] = [];
  for (const p of positions) {
    const k = sectionIds.indexOf(p.stationId);
    if (k < 0) continue;
    const dir = boardDirOf(patterns, p.stationId, p.destStationId);
    if (!dir) continue;
    const index = k + (p.moveStatus === 1 ? (dir === 'up' ? 0.5 : -0.5) : 0);
    if (index < 0 || index > sectionIds.length - 1) continue;
    out.push({ index, dir });
  }
  return out;
}

export interface LineShape {
  /** Service patterns, with a newer terminus the data hasn't covered yet appended where it belongs. */
  patterns: string[][];
  /** The main line to draw, low id → high id. */
  main: string[];
  branches: LineBranch[];
}

/**
 * Everything the board and 全線動態 need about one line's shape. `patterns` come from
 * buildLinePatterns (possibly none); `sortedIds` is the line's StationID order, the fallback
 * when S2STravelTime gives no usable chain. A terminus S2STravelTime hasn't caught up with
 * (R01 廣慈/奉天宮) still gets trains in the timetable, so every pattern ending where the
 * main line ends is extended to it — otherwise trains bound there would have no direction.
 */
export function buildLineShape(patterns: string[][], sortedIds: string[]): LineShape {
  const known = new Set(sortedIds);
  const usable = patterns.filter((p) => p.every((id) => known.has(id)));
  if (usable.length === 0) return { patterns: [sortedIds], main: sortedIds, branches: [] };
  const layout = lineLayout(usable);
  const main = extendWithUncovered(layout.main, sortedIds, new Set(usable.flat()));
  const at = main.indexOf(layout.main[0]);
  const prefix = main.slice(0, at);
  const suffix = main.slice(at + layout.main.length);
  const first = layout.main[0];
  const last = layout.main[layout.main.length - 1];
  return {
    patterns: usable.map((p) => [
      ...(p[0] === first ? prefix : []),
      ...p,
      ...(p[p.length - 1] === last ? suffix : []),
    ]),
    main,
    branches: layout.branches,
  };
}

export interface BoardStripModel {
  /** Station ids at offsets -window … +window (null past a line end, or past a fork). */
  ids: (string | null)[];
  trains: BoardStripTrain[];
  /** The line runs on past the drawn stops on that side (including into branches). */
  continuesDown: boolean;
  continuesUp: boolean;
}

/**
 * The ±`window` stops around the board station. Neighbours are taken only while every
 * pattern through the station agrees on them — at 大橋頭 the up side forks to 迴龍 and
 * 蘆洲, so it stays blank there rather than pretending one branch is the line.
 */
export function boardStrip(
  patterns: string[][],
  stationId: string,
  positions: MetroLivePosition[],
  window = 2,
): BoardStripModel {
  const through = patterns.filter((p) => p.includes(stationId));
  const ids: (string | null)[] = Array(window * 2 + 1).fill(null);
  ids[window] = stationId;
  const side = (sign: 1 | -1) => {
    let reached = 0;
    for (let o = 1; o <= window; o++) {
      const here = new Set(through.map((p) => p[p.indexOf(stationId) + sign * o]).filter(Boolean));
      if (here.size !== 1) break;
      ids[window + sign * o] = [...here][0]!;
      reached = o;
    }
    return through.some((p) => p[p.indexOf(stationId) + sign * (reached + 1)] !== undefined);
  };
  const continuesDown = side(-1);
  const continuesUp = side(1);

  const trains: BoardStripTrain[] = [];
  for (const pos of positions) {
    const at = ids.indexOf(pos.stationId);
    if (at < 0) continue;
    const dir = boardDirOf(patterns, pos.stationId, pos.destStationId);
    if (!dir) continue;
    const slot = at + (pos.moveStatus === 1 ? (dir === 'up' ? 0.5 : -0.5) : 0);
    if (slot < 0 || slot > window * 2) continue;
    // A departed train between two drawn stops only; one heading into a fork has no slot.
    if (!Number.isInteger(slot) && (ids[Math.floor(slot)] === null || ids[Math.ceil(slot)] === null)) continue;
    trains.push({ offset: slot - window, dir });
  }
  return { ids, trains, continuesDown, continuesUp };
}

/** Minutes since midnight and weekday on the Taipei clock, whatever the device's time zone. */
export function taipeiClock(now: Date = new Date()): { nowMin: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { nowMin: Number(get('hour')) * 60 + Number(get('minute')), weekday: weekday < 0 ? 0 : weekday };
}
