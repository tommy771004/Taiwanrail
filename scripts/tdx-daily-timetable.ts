/**
 * 把 TDX 每日時刻表回應編碼成 `src/lib/dailyTimetable.ts` 定義的壓縮格式，
 * 並負責清掉過期日期的檔案。格式細節與體積考量見該檔開頭說明。
 */
import { readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import {
  DAILY_FLAG_ORDER,
  DAILY_WINDOW_DAYS,
  isDailyDateString,
  type CompactDailyTimetable,
  type CompactDailyTrain,
  type DailyRail,
} from '../src/lib/dailyTimetable.js';

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}

/** TDX 每日時刻表有 v3 (`{ TrainTimetables }`)、v2（陣列）兩種外殼。 */
function unwrapTrainList(raw: unknown): Record<string, any>[] {
  if (Array.isArray(raw)) return raw.filter((item): item is Record<string, any> => !!asRecord(item));
  const envelope = asRecord(raw);
  if (!envelope) return [];
  for (const key of ['TrainTimetables', 'DailyTrainTimetables', 'TrainTimetableList']) {
    if (Array.isArray(envelope[key])) {
      return envelope[key].filter((item: unknown): item is Record<string, any> => !!asRecord(item));
    }
  }
  return [];
}

function normalizeNote(note: unknown): string {
  if (typeof note === 'string') return note.trim();
  const record = asRecord(note);
  if (record && typeof record.Zh_tw === 'string') return record.Zh_tw.trim();
  return '';
}

function normalizeTime(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function encodeFlags(info: Record<string, any>): string {
  // TDX 在 v2/v3 之間換過拼法（WheelChairFlag ↔ WheelchairFlag 等），兩種都收。
  const aliases: Record<string, string[]> = {
    WheelChairFlag: ['WheelChairFlag', 'WheelchairFlag'],
    BreastFeedFlag: ['BreastFeedFlag', 'BreastFeedingFlag'],
  };
  return DAILY_FLAG_ORDER.map((name) => {
    const keys = aliases[name] ?? [name];
    return keys.some((key) => Number(info[key]) === 1) ? '1' : '0';
  }).join('');
}

function encodeTrain(item: Record<string, any>): CompactDailyTrain | null {
  const nested = asRecord(item.GeneralTimetable);
  const info =
    asRecord(item.TrainInfo) ??
    asRecord(item.DailyTrainInfo) ??
    asRecord(nested?.TrainInfo) ??
    asRecord(nested?.GeneralTrainInfo);
  const stopSource = Array.isArray(item.StopTimes)
    ? item.StopTimes
    : Array.isArray(nested?.StopTimes)
      ? nested!.StopTimes
      : [];

  const trainNo = typeof info?.TrainNo === 'string' ? info.TrainNo : '';
  if (!trainNo || stopSource.length === 0) return null;

  const stops: string[] = [];
  for (const rawStop of stopSource) {
    const stop = asRecord(rawStop);
    const stationId = typeof stop?.StationID === 'string' ? stop.StationID : '';
    if (!stationId) continue;
    const arrival = normalizeTime(stop!.ArrivalTime) || normalizeTime(stop!.DepartureTime);
    const departure = normalizeTime(stop!.DepartureTime) || arrival;
    const suspended = Number(stop!.SuspendedFlag) === 1 ? ',1' : '';
    stops.push(`${stationId},${arrival},${departure}${suspended}`);
  }
  if (stops.length === 0) return null;

  const typeName = asRecord(info!.TrainTypeName);
  const flags = encodeFlags(info!);
  const note = normalizeNote(info!.Note);

  const train: CompactDailyTrain = { n: trainNo, st: stops };
  if (typeof info!.TrainTypeID === 'string' && info!.TrainTypeID) train.ty = info!.TrainTypeID;
  if (typeof info!.TrainTypeCode === 'string' && info!.TrainTypeCode) train.tc = info!.TrainTypeCode;
  if (typeof typeName?.Zh_tw === 'string' && typeName.Zh_tw) train.tz = typeName.Zh_tw;
  if (typeof typeName?.En === 'string' && typeName.En) train.te = typeName.En;
  if (typeof info!.StartingStationID === 'string' && info!.StartingStationID) train.ss = info!.StartingStationID;
  if (typeof info!.EndingStationID === 'string' && info!.EndingStationID) train.es = info!.EndingStationID;
  if (Number.isFinite(Number(info!.Direction))) train.d = Number(info!.Direction);
  if (Number.isFinite(Number(info!.TripLine))) train.tl = Number(info!.TripLine);
  if (typeof info!.OverNightStationID === 'string' && info!.OverNightStationID) train.ov = info!.OverNightStationID;
  if (note) train.nz = note;
  if (flags.includes('1')) train.f = flags;

  return train;
}

/** 編碼一天的每日時刻表；`raw` 可以是 TDX v3 外殼或 v2 陣列。 */
export function encodeDailyTimetable(
  rail: DailyRail,
  date: string,
  raw: unknown,
): CompactDailyTimetable {
  if (!isDailyDateString(date)) throw new Error(`Invalid daily timetable date: ${date}`);

  const envelope = asRecord(raw);
  const updateTime = typeof envelope?.UpdateTime === 'string' ? envelope.UpdateTime : undefined;

  const seen = new Set<string>();
  const trains: CompactDailyTrain[] = [];
  for (const item of unwrapTrainList(raw)) {
    const train = encodeTrain(item);
    // 同車次在跨日/多版本回應中可能出現兩次，只留第一筆。
    if (!train || seen.has(train.n)) continue;
    seen.add(train.n);
    trains.push(train);
  }

  return { Rail: rail, TrainDate: date, UpdateTime: updateTime, Trains: trains };
}

/** YYYY-MM-DD 加減天數。台灣沒有日光節約，直接在 UTC 午夜上算即可。 */
export function shiftDailyDate(date: string, days: number): string {
  if (!isDailyDateString(date)) throw new Error(`Invalid daily timetable date: ${date}`);
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** 目錄裡現有的每日快照日期（只認 YYYY-MM-DD.json），由舊到新排序。 */
export async function listDailyDates(directory: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => entry.slice(0, -'.json'.length))
    .filter(isDailyDateString)
    .sort();
}

/**
 * 增量更新：這次要抓哪些日期。
 *
 * 從「現有最新一天的隔天」起抓，抓到日期選單的最後一天（今天 + windowDays - 1）為止。
 * 每天跑一次且前一天有抓到時，這就只有一天（最新 10/31 → 只抓 11/1）；漏跑幾天、TDX
 * 晚發布或目錄是空的，才會一次補多天。最新一天已經在今天之前（或沒有檔案）時從今天起抓，
 * 不補過去的日期——前端只會查今天以後。
 */
export function planDailyFetch(
  existing: string[],
  today: string,
  windowDays: number = DAILY_WINDOW_DAYS,
): string[] {
  const lastPickable = shiftDailyDate(today, windowDays - 1);
  const latest = existing.filter(isDailyDateString).sort().at(-1);
  let next = latest && latest >= today ? shiftDailyDate(latest, 1) : today;

  const dates: string[] = [];
  while (next <= lastPickable) {
    dates.push(next);
    next = shiftDailyDate(next, 1);
  }
  return dates;
}

/**
 * 增量更新後要保留的日期：以最新一天為準往前共 windowDays 天，其餘刪除
 * （最新 11/1 → 保留 10/19～11/1，刪掉 10/18 以前）。今天以前的日期前端不會再查，
 * 所以落後於視窗時（例如 TDX 晚發布）也一併刪掉，不會留著過期檔案。
 */
export function dailyDatesToKeep(
  existing: string[],
  today: string,
  windowDays: number = DAILY_WINDOW_DAYS,
): string[] {
  const dates = existing.filter(isDailyDateString).sort();
  const latest = dates.at(-1);
  if (!latest) return [];
  const windowStart = shiftDailyDate(latest, -(windowDays - 1));
  const oldestKept = windowStart > today ? windowStart : today;
  return dates.filter((date) => date >= oldestKept);
}

/** 刪掉不在 `keep` 名單內的每日檔案（過期日期），回傳被刪掉的檔名。 */
export async function pruneDailyDirectory(directory: string, keep: string[]): Promise<string[]> {
  const keepSet = new Set(keep);
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }

  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const date = entry.slice(0, -'.json'.length);
    if (keepSet.has(date)) continue;
    await unlink(path.join(directory, entry)).catch(() => {});
    removed.push(entry);
  }
  return removed;
}
