export type FootfallMode = 'metro-trtc' | 'tra';
export type FootfallLevel = 'low' | 'medium' | 'high';

export interface StationFootfallDataset {
  version: 1;
  metro: Record<string, Array<Array<number | null>>>;
  tra: Record<string, Array<number | null>>;
}

export interface StationFootfall {
  level: FootfallLevel;
}

export interface StationFootfallInput {
  mode: FootfallMode;
  stationId?: string;
  stationName?: string;
  date: string;
  time: string;
}

let datasetPromise: Promise<StationFootfallDataset | null> | null = null;

/** Normalize the operator's display name without trying to guess a station from a partial name. */
export function normalizeMetroStationName(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/臺/g, '台')
    .replace(/\s+/g, '')
    .trim();
}

function isDataset(value: unknown): value is StationFootfallDataset {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StationFootfallDataset>;
  return candidate.version === 1 && !!candidate.metro && !!candidate.tra;
}

async function loadDataset(): Promise<StationFootfallDataset | null> {
  if (!datasetPromise) {
    datasetPromise = fetch('/data/station-footfall.json')
      .then(async response => {
        if (!response.ok) return null;
        const data: unknown = await response.json();
        return isDataset(data) ? data : null;
      })
      .catch(() => null);
  }
  return datasetPromise;
}

function weekdayForTaiwanDate(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(utc.getTime()) ? null : utc.getUTCDay();
}

function hourFromTime(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 24 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return hour === 24 ? 0 : hour;
}

function levelFromScore(score: number | null | undefined): FootfallLevel | null {
  if (score === 0) return 'low';
  if (score === 1) return 'medium';
  if (score === 2) return 'high';
  return null;
}

/**
 * Return a historical station-footfall level only when a real station, service
 * date and matching time bucket can be resolved. Missing data intentionally
 * returns null so the UI does not manufacture a "no data" state.
 */
export function resolveStationFootfall(dataset: StationFootfallDataset, input: StationFootfallInput): StationFootfall | null {
  const day = weekdayForTaiwanDate(input.date);
  if (day === null) return null;

  if (input.mode === 'tra') {
    if (!input.stationId) return null;
    const level = levelFromScore(dataset.tra[input.stationId]?.[day]);
    return level ? { level } : null;
  }

  const hour = hourFromTime(input.time);
  if (hour === null || !input.stationName) return null;
  const station = dataset.metro[normalizeMetroStationName(input.stationName)];
  const level = levelFromScore(station?.[day]?.[hour]);
  return level ? { level } : null;
}

export async function getStationFootfall(input: StationFootfallInput): Promise<StationFootfall | null> {
  const dataset = await loadDataset();
  return dataset ? resolveStationFootfall(dataset, input) : null;
}

export function serviceDateForStationTime(serviceDate: string, serviceStartTime: string, stationTime: string): string {
  const startHour = hourFromTime(serviceStartTime);
  const stationHour = hourFromTime(stationTime);
  if (startHour === null || stationHour === null || stationHour >= startHour) return serviceDate;

  const date = new Date(`${serviceDate}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return serviceDate;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function taiwanToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
