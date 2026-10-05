/**
 * 「此時段通常多擠」— typical crowding of a 台北捷運 / 環狀線 segment by hour, estimated
 * offline from historical ridership (`scripts/build-metro-crowd.ts`, monthly) and looked up
 * here at query time. No live data and no per-car detail: it says how full trains on this
 * stretch usually are at this hour, and the board labels it 「歷史」 so it is never read as
 * a live reading.
 *
 * Shared by the build script and the browser, so no Node or DOM globals beyond `fetch`.
 */

export type CrowdLevel = 1 | 2 | 3 | 4;
export type CrowdDayType = 'wd' | 'we';

/** `public/data/metro_crowd.json`. */
export interface MetroCrowdTable {
  Source: string;
  /** Ridership month the levels come from, "YYYY-MM". */
  Month: string;
  GeneratedAt: string;
  /** Days of each type the averages are over (weekend includes weekday holidays). */
  Days: Record<CrowdDayType, number>;
  /** Per "SYSTEM:LINE": "perTrain" (hourly load ÷ scheduled trains) or "perHour" (no timetable). */
  Basis: Record<string, 'perTrain' | 'perHour'>;
  /** Per system: directed segment "FROM>TO" → encoded levels (see encodeCrowdLevels). */
  Systems: Record<string, Record<string, string>>;
}

export const CROWD_HOURS = 24;

/** Segment key: a train leaving `fromId` toward the adjacent `toId`. */
export const crowdSegmentKey = (fromId: string, toId: string) => `${fromId}>${toId}`;

/**
 * 48 characters: weekday hours 00–23 then weekend/holiday hours 00–23, each '1'–'4', or
 * '0' where there is no estimate (no service, or no ridership to speak of).
 */
export function encodeCrowdLevels(levels: Record<CrowdDayType, (CrowdLevel | 0)[]>): string {
  return (['wd', 'we'] as CrowdDayType[])
    .map((t) => Array.from({ length: CROWD_HOURS }, (_, h) => String(levels[t][h] ?? 0)).join(''))
    .join('');
}

export function decodeCrowdLevel(encoded: string | undefined, dayType: CrowdDayType, hour: number): CrowdLevel | null {
  if (!encoded || encoded.length !== CROWD_HOURS * 2) return null;
  const c = Number(encoded[(dayType === 'wd' ? 0 : CROWD_HOURS) + hour]);
  return c >= 1 && c <= 4 ? (c as CrowdLevel) : null;
}

/**
 * Day type for a Taipei calendar weekday (0 = Sunday). National holidays are not known here,
 * so a weekday holiday reads as a weekday — the levels themselves fold holiday ridership into
 * the weekend profile.
 */
export const crowdDayTypeOf = (weekday: number): CrowdDayType => (weekday === 0 || weekday === 6 ? 'we' : 'wd');

export interface TypicalCrowd {
  level: CrowdLevel;
  hour: number;
  dayType: CrowdDayType;
}

/**
 * Typical level for a train leaving `fromId` toward any of `toIds` (several at a fork — the
 * busiest wins) at `minuteOfDay` (Taipei, 0–1439+; wraps). The ridership file is keyed by
 * calendar date, so no 03:00 service-day shift applies.
 */
export function typicalCrowdAt(
  segments: Record<string, string> | undefined,
  fromId: string,
  toIds: string[],
  weekday: number,
  minuteOfDay: number,
): TypicalCrowd | null {
  if (!segments || toIds.length === 0) return null;
  const minute = ((Math.floor(minuteOfDay) % 1440) + 1440) % 1440;
  const hour = Math.floor(minute / 60);
  // Past midnight the calendar day has moved on.
  const day = minuteOfDay >= 1440 ? (weekday + 1) % 7 : weekday;
  const dayType = crowdDayTypeOf(day);
  let level: CrowdLevel | null = null;
  for (const to of toIds) {
    const l = decodeCrowdLevel(segments[crowdSegmentKey(fromId, to)], dayType, hour);
    if (l !== null && (level === null || l > level)) level = l;
  }
  return level === null ? null : { level, hour, dayType };
}

let _table: Promise<MetroCrowdTable | null> | null = null;
/** One fetch per page load; null when the file is missing (the board then shows nothing). */
export function getMetroCrowdTable(): Promise<MetroCrowdTable | null> {
  _table ??= fetch('/data/metro_crowd.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d && typeof d === 'object' && d.Systems ? (d as MetroCrowdTable) : null))
    .catch(() => null);
  return _table;
}
