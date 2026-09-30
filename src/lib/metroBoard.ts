/**
 * src/lib/metroBoard.ts
 * 捷運「到站看板」的純邏輯：把 LiveBoard（即時）、車站時刻表（表定）、月台與車廂擁擠度
 * 整理成「一條線、兩個方向」的看板資料。沒有 DOM、沒有 fetch，方便單元測試。
 *
 * 方向一律用「線上的站序」判斷，不用 TDX 的 Direction 代碼：站序來自 StationID
 * （groupMetroStationsByLine），而列車的終點站在站序裡的位置就決定它往哪一端開。
 * `down` = 往線路第一站，`up` = 往最後一站（淡水信義線：down 往象山端、up 往淡水）。
 *
 * 即時與表定絕不混用標示：`live: true` 只給 LiveBoard 的列，時刻表推出來的一律
 * `live: false`，畫面據此顯示「即時」或「表定」。
 */
import type { BiName, MetroLiveBoard, MetroLivePosition, MetroPlatform, MetroTrainLiveBoard } from './metro';

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
  /** Line end in this direction — the heading riders read on the platform sign. */
  terminusId: string;
  terminusName: BiName;
  /** This station is the line end in this direction. */
  isLineEnd: boolean;
  /** The timetable has no train from here in this direction on any day (e.g. a branch stub). */
  noService: boolean;
  next: BoardTrain | null;
  following: BoardTrain | null;
  platform: string;
  /** Per-car crowdedness (1–4) of `next`, only when `next` is live and TDX published it. */
  crowdedness?: number[];
  /** The next several trains for the 後續班次 panel: live ones first, then the timetable after them. */
  upcoming: BoardTrain[];
  /** Today's first and last scheduled departure in this direction ("HH:MM"), in service order. */
  firstTrain: string | null;
  lastTrain: string | null;
}

export interface BoardLineInput {
  stationId: string;
  /** Station ids of this line in running order (first terminus → last terminus). */
  lineStopIds: string[];
  /** Station names parallel to `lineStopIds`. */
  lineStopNames: BiName[];
  liveBoard: MetroLiveBoard[];
  /** Raw `/data/metro_<sys>/<stationId>.json` (TDX StationTimeTable rows). */
  timetable: any[];
  platforms: MetroPlatform[];
  trainLive: MetroTrainLiveBoard[];
  /** Minutes since midnight, Taipei time. */
  nowMin: number;
  /** 0 = Sunday … 6 = Saturday, Taipei calendar. */
  weekday: number;
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

/** Direction of a train at stop index `from` heading for `destId`, or null if it is not on this line. */
export function boardDirOf(lineStopIds: string[], from: number, destId: string): BoardDir | null {
  const j = lineStopIds.indexOf(destId);
  if (j < 0 || from < 0 || j === from) return null;
  return j > from ? 'up' : 'down';
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
  const { stationId, lineStopIds, lineStopNames, nowMin, weekday } = input;
  const i = lineStopIds.indexOf(stationId);
  const last = lineStopIds.length - 1;

  const live: Record<BoardDir, BoardTrain[]> = { down: [], up: [] };
  for (const row of input.liveBoard) {
    if (row.StationID !== stationId) continue;
    const dir = boardDirOf(lineStopIds, i, row.DestinationStationID);
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
    const dir = boardDirOf(lineStopIds, i, destId);
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

    const endIdx = dir === 'up' ? last : 0;
    const isLineEnd = i === endIdx;

    const lastLive = liveTrains[liveTrains.length - 1];
    const upcoming = (lastLive
      ? [...liveTrains, ...schedTrains.filter((t) => t.minutes >= lastLive.minutes + FOLLOWING_GAP_MIN)]
      : schedTrains
    ).slice(0, UPCOMING_COUNT);

    const ordered = todayTimes[dir]
      .map((t) => ({ t, k: serviceOrder(t) }))
      .filter((x): x is { t: string; k: number } => x.k !== null)
      .sort((a, b) => a.k - b.k);

    const platform = input.platforms.find((p) =>
      p.stationId === stationId && boardDirOf(lineStopIds, i, p.destStationId) === dir)?.platform ?? '';

    let crowdedness: number[] | undefined;
    if (next?.live) {
      // The next train is the one still upstream of us (or at the platform) heading to the same terminus.
      let best: { k: number; cars?: number[] } | null = null;
      for (const t of input.trainLive) {
        if (t.DestinationStationID !== next.destId) continue;
        const k = lineStopIds.indexOf(t.StationID);
        if (k < 0) continue;
        const upstream = dir === 'up' ? k <= i : k >= i;
        if (!upstream) continue;
        if (!best || (dir === 'up' ? k > best.k : k < best.k)) best = { k, cars: t.CarCrowdedness };
      }
      if (best?.cars?.length) crowdedness = best.cars;
    }

    return {
      dir,
      terminusId: lineStopIds[endIdx] ?? '',
      terminusName: lineStopNames[endIdx] ?? {},
      isLineEnd,
      noService: !isLineEnd && hasTimetable && !servedAnyDay[dir] && liveTrains.length === 0,
      next: isLineEnd ? null : next,
      following: isLineEnd ? null : following,
      upcoming: isLineEnd ? [] : upcoming,
      firstTrain: isLineEnd ? null : ordered[0]?.t ?? null,
      lastTrain: isLineEnd ? null : ordered[ordered.length - 1]?.t ?? null,
      platform,
      crowdedness,
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
 * Live train positions along a whole line (the 全線動態 view). TDX LivePosition is
 * station-granular: MoveStatus 0 = at / arriving at `stationId`, 1 = departed from it,
 * so a departed train is drawn half-way to the next stop in its direction. Station ids
 * are line-scoped, so positions on other lines simply don't match `lineStopIds`.
 */
export function lineTrains(positions: MetroLivePosition[], lineStopIds: string[]): LineTrain[] {
  const out: LineTrain[] = [];
  for (const p of positions) {
    const k = lineStopIds.indexOf(p.stationId);
    if (k < 0) continue;
    const dir = boardDirOf(lineStopIds, k, p.destStationId);
    if (!dir) continue;
    const index = k + (p.moveStatus === 1 ? (dir === 'up' ? 0.5 : -0.5) : 0);
    if (index < 0 || index > lineStopIds.length - 1) continue;
    out.push({ index, dir });
  }
  return out;
}

/** The same markers, relative to the board station and limited to the strip's ±`window` stops. */
export function boardStripTrains(
  positions: MetroLivePosition[],
  lineStopIds: string[],
  stationId: string,
  window = 2,
): BoardStripTrain[] {
  const i = lineStopIds.indexOf(stationId);
  if (i < 0) return [];
  return lineTrains(positions, lineStopIds)
    .map((t) => ({ offset: t.index - i, dir: t.dir }))
    .filter((t) => Math.abs(t.offset) <= window + 0.5);
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
