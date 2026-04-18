import type { DailyTimetableOD } from './api';

const STORAGE_KEY = 'rail_offline_snapshots_v1';
const MAX_SNAPSHOTS = 12;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface SnapshotMeta {
  transportType: 'hsr' | 'train';
  originId: string;
  destId: string;
  date: string;
  returnDate?: string;
  tripType: 'one-way' | 'round-trip';
}

export interface Snapshot extends SnapshotMeta {
  savedAt: number;
  timetables: DailyTimetableOD[];
  returnTimetables: DailyTimetableOD[];
}

export function snapshotKey(meta: SnapshotMeta): string {
  return [
    meta.transportType,
    meta.originId,
    meta.destId,
    meta.date,
    meta.tripType,
    meta.returnDate || '',
  ].join('|');
}

function readAll(): Record<string, Snapshot> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, Snapshot>;
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, Snapshot>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    // Quota — drop oldest half and retry once
    try {
      const entries = Object.entries(map).sort((a, b) => a[1].savedAt - b[1].savedAt);
      const trimmed = Object.fromEntries(entries.slice(Math.ceil(entries.length / 2)));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      console.warn('[offlineSnapshot] localStorage quota exceeded; snapshot dropped', err);
    }
  }
}

function pruneStale(map: Record<string, Snapshot>): Record<string, Snapshot> {
  const now = Date.now();
  const entries = Object.entries(map).filter(([, s]) => now - s.savedAt < MAX_AGE_MS);
  if (entries.length <= MAX_SNAPSHOTS) return Object.fromEntries(entries);
  entries.sort((a, b) => b[1].savedAt - a[1].savedAt);
  return Object.fromEntries(entries.slice(0, MAX_SNAPSHOTS));
}

export function saveSnapshot(
  meta: SnapshotMeta,
  timetables: DailyTimetableOD[],
  returnTimetables: DailyTimetableOD[]
): void {
  if (!timetables.length && !returnTimetables.length) return;
  const map = readAll();
  const key = snapshotKey(meta);
  map[key] = {
    ...meta,
    savedAt: Date.now(),
    timetables,
    returnTimetables,
  };
  writeAll(pruneStale(map));
}

export function loadSnapshot(meta: SnapshotMeta): Snapshot | null {
  const map = readAll();
  const key = snapshotKey(meta);
  const snap = map[key];
  if (!snap) return null;
  if (Date.now() - snap.savedAt > MAX_AGE_MS) return null;
  return snap;
}

export function listSnapshots(): Snapshot[] {
  return Object.values(readAll()).sort((a, b) => b.savedAt - a.savedAt);
}

export function parseHHMM(time: string | undefined | null): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (Number.isNaN(h) || Number.isNaN(min)) return null;
  return h * 60 + min;
}

function nowMinutesTaipei(): number {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Taipei',
  });
  const parts = fmt.format(new Date()).split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

export interface OfflineCountdown {
  trainNo: string;
  depTime: string;
  arrTime: string;
  minutesUntilDeparture: number;
  status: 'boarding' | 'soon' | 'later' | 'departed';
}

export function nextDepartureFromSnapshot(
  trains: DailyTimetableOD[],
  todayDateStr: string,
  snapshotDate: string
): OfflineCountdown | null {
  if (!trains.length) return null;
  if (todayDateStr !== snapshotDate) return null;
  const now = nowMinutesTaipei();

  let best: OfflineCountdown | null = null;
  for (const t of trains) {
    const dep = parseHHMM(t.OriginStopTime?.DepartureTime);
    if (dep == null) continue;
    const diff = dep - now;
    if (diff < -2) continue;
    const candidate: OfflineCountdown = {
      trainNo: t.DailyTrainInfo?.TrainNo || '',
      depTime: (t.OriginStopTime?.DepartureTime || '').substring(0, 5),
      arrTime: (t.DestinationStopTime?.ArrivalTime || '').substring(0, 5),
      minutesUntilDeparture: diff,
      status: diff < 0 ? 'departed' : diff <= 3 ? 'boarding' : diff <= 15 ? 'soon' : 'later',
    };
    if (!best || candidate.minutesUntilDeparture < best.minutesUntilDeparture) {
      best = candidate;
    }
  }
  return best;
}
