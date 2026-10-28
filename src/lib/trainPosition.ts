/**
 * 列車現在在線上的哪裡：停站時刻 + 誤點 + 現在時間 → 狀態、所在區段、比例。
 *
 * 這是推算，不是 GPS。兩站之間的位置用時間內插，畫面上的分鐘數一律寫「約」。
 * 台鐵的誤點（LiveTrainDelay）是「最後通過站」的誤點，這裡整班順延同樣分鐘數，
 * 與 App 對誤點班次的時刻推估一致；高鐵沒有即時來源，誤點固定為 0。
 *
 * 時間採 App 的慣例：凌晨 0~3 點視為前一天的 24~27 點（getTwMinutes / timeToMinutes），
 * 所以傳進來的 now 也要是同一個尺度，`taipeiNowMinutes()` 會算好。
 */

export interface PositionStopInput {
  StationID: string;
  StationName?: { Zh_tw?: string; En?: string };
  ArrivalTime?: string;
  DepartureTime?: string;
}

export interface TimedStop {
  id: string;
  zh: string;
  en: string;
  /** 已含誤點的到站／離站分鐘數，單調遞增 */
  arr: number;
  dep: number;
}

/** waiting = 還在始發站沒開；dwell = 停在某站；run = 兩站之間；done = 已到終點站 */
export type TrainMotion = 'waiting' | 'dwell' | 'run' | 'done';
/** 相對使用者的起訖站：還沒到起站／停在起站／起訖之間／已過訖站 */
export type TrainPhase = 'approach' | 'atOrigin' | 'enroute' | 'arrived';

export interface TrainPosition {
  stops: TimedStop[];
  originIndex: number;
  destIndex: number;
  motion: TrainMotion;
  /** dwell / waiting / done：所在站；run：區段起點站 */
  index: number;
  /** run 時區段內的時間比例（0~1），其他狀態為 0 */
  fraction: number;
  phase: TrainPhase;
  /** 起站到訖站的進度（0~1），與 `scheduleFraction` 用同一把尺 */
  progress: number;
  /** 下一個要到的站（run 才有） */
  nextIndex: number | null;
  /** phase = approach：還要經過幾站才到起站（含起站） */
  stopsToOrigin: number;
  /** phase = approach：約幾分鐘後到起站 */
  minutesToOrigin: number | null;
}

const DAY = 1440;
// App 把 0~3 點當成 24~27 點；跨過這條線的車次要整班一起搬
const EARLY_MORNING = 4 * 60;

function parseHHMM(value: string | undefined): number | null {
  const m = value?.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 47 || min > 59) return null;
  return h * 60 + min;
}

/**
 * 把停站時刻轉成單調遞增的分鐘數，並套上誤點。任何一站缺時間就回 null（不猜）。
 */
export function timeStops(stops: PositionStopInput[], delayMinutes = 0): TimedStop[] | null {
  const out: TimedStop[] = [];
  let offset = 0;
  let last = -Infinity;
  for (const stop of stops) {
    const rawArr = parseHHMM(stop.ArrivalTime) ?? parseHHMM(stop.DepartureTime);
    const rawDep = parseHHMM(stop.DepartureTime) ?? rawArr;
    if (rawArr === null || rawDep === null) return null;
    let arr = rawArr + offset;
    if (arr < last) { offset += DAY; arr += DAY; }
    let dep = rawDep + offset;
    if (dep < arr) { offset += DAY; dep += DAY; }
    last = dep;
    out.push({ id: stop.StationID, zh: stop.StationName?.Zh_tw || '', en: stop.StationName?.En || stop.StationName?.Zh_tw || '', arr, dep });
  }
  if (out.length < 2) return null;
  const shift = (out[0].dep < EARLY_MORNING ? DAY : 0) + (Number.isFinite(delayMinutes) ? delayMinutes : 0);
  if (shift) for (const s of out) { s.arr += shift; s.dep += shift; }
  return out;
}

export function locateTrain(stops: TimedStop[], now: number): { motion: TrainMotion; index: number; fraction: number } {
  if (now < stops[0].dep) return { motion: 'waiting', index: 0, fraction: 0 };
  for (let i = 0; i < stops.length; i++) {
    if (now >= stops[i].arr && now <= stops[i].dep) return { motion: 'dwell', index: i, fraction: 0 };
    const next = stops[i + 1];
    if (next && now > stops[i].dep && now < next.arr) {
      return { motion: 'run', index: i, fraction: (now - stops[i].dep) / (next.arr - stops[i].dep) };
    }
  }
  return { motion: 'done', index: stops.length - 1, fraction: 0 };
}

/**
 * 某站在起訖區間上的位置（0~1），依到站時間的比例。站與站的間距因此跟行車時間成正比，
 * 車頭在畫面上大致等速移動。
 */
export function scheduleFraction(pos: Pick<TrainPosition, 'stops' | 'originIndex' | 'destIndex'>, index: number): number {
  const { stops, originIndex: o, destIndex: d } = pos;
  const span = stops[d].arr - stops[o].arr;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (stops[index].arr - stops[o].arr) / span));
}

export function trainPosition(
  rawStops: PositionStopInput[] | undefined,
  originId: string,
  destId: string,
  now: number,
  delayMinutes = 0,
): TrainPosition | null {
  if (!rawStops?.length) return null;
  const stops = timeStops(rawStops, delayMinutes);
  if (!stops) return null;
  const o = stops.findIndex(s => s.id === originId);
  const d = stops.findIndex(s => s.id === destId);
  if (o === -1 || d === -1 || o >= d) return null;

  const { motion, index, fraction } = locateTrain(stops, now);
  const at = index + fraction;

  let phase: TrainPhase;
  if (motion === 'waiting' && o === 0) phase = 'atOrigin';
  else if (motion === 'waiting' || at < o) phase = 'approach';
  else if (motion === 'dwell' && index === o) phase = 'atOrigin';
  else if (at < d) phase = 'enroute';
  else phase = 'arrived';

  const base = { stops, originIndex: o, destIndex: d };
  let progress: number;
  if (phase === 'approach' || phase === 'atOrigin') progress = 0;
  else if (phase === 'arrived') progress = 1;
  else if (motion === 'run') {
    const a = scheduleFraction(base, index), b = scheduleFraction(base, index + 1);
    progress = a + fraction * (b - a);
  } else progress = scheduleFraction(base, index);

  return {
    ...base,
    motion,
    index,
    fraction,
    phase,
    progress,
    nextIndex: motion === 'run' ? index + 1 : null,
    stopsToOrigin: phase === 'approach' ? o - index : 0,
    minutesToOrigin: phase === 'approach' ? stops[o].arr - now : null,
  };
}

/** 台北現在時間的分鐘數（含秒的小數），尺度同 App 的 getTwMinutes。 */
export function taipeiNowMinutes(date: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Taipei',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value || 0);
  const h = get('hour') % 24;
  return (h < 4 ? h + 24 : h) * 60 + get('minute') + get('second') / 60;
}

export function formatServiceTime(minutes: number): string {
  const m = Math.floor(minutes) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 「約 N 分」的 N：無條件進位，最少 1，避免顯示「約 0 分」 */
export function roundUpMinutes(minutes: number): number {
  return Math.max(1, Math.ceil(minutes - 1e-9));
}

/** 票券上那一行：列車現在在哪。 */
export function describeTrainPosition(pos: TrainPosition, now: number, zh: boolean): string {
  const { stops, originIndex: o, destIndex: d, motion, index, phase } = pos;
  const name = (i: number) => (zh ? stops[i].zh : stops[i].en);
  const eta = (target: number) => roundUpMinutes(target - now);

  if (phase === 'approach') {
    const left = pos.stopsToOrigin;
    if (motion === 'waiting') {
      return zh
        ? `${name(0)} 待發 ${formatServiceTime(stops[0].dep)} · 還有 ${left} 站到本站`
        : `Waiting at ${name(0)}, leaves ${formatServiceTime(stops[0].dep)} · ${left} stops away`;
    }
    if (motion === 'dwell') {
      return zh
        ? `停靠 ${name(index)} · 還有 ${left} 站 · 約 ${eta(stops[o].arr)} 分進站`
        : `At ${name(index)} · ${left} stop${left === 1 ? '' : 's'} away · ~${eta(stops[o].arr)} min`;
    }
    if (index + 1 === o) {
      return zh
        ? `${name(index)} → ${name(o)} · 約 ${eta(stops[o].arr)} 分進站`
        : `${name(index)} → ${name(o)} · arriving in ~${eta(stops[o].arr)} min`;
    }
    return zh
      ? `${name(index)} → ${name(index + 1)} · 還有 ${left} 站 · 約 ${eta(stops[o].arr)} 分`
      : `${name(index)} → ${name(index + 1)} · ${left} stops away · ~${eta(stops[o].arr)} min`;
  }
  if (phase === 'atOrigin') {
    return zh
      ? `停靠本站 · ${formatServiceTime(stops[o].dep)} 開`
      : `At this station · leaves ${formatServiceTime(stops[o].dep)}`;
  }
  if (phase === 'arrived') {
    return zh ? `已抵達${name(d)}` : `Arrived at ${name(d)}`;
  }
  if (motion === 'dwell') {
    return zh
      ? `停靠 ${name(index)} · ${formatServiceTime(stops[index].dep)} 開`
      : `At ${name(index)} · leaves ${formatServiceTime(stops[index].dep)}`;
  }
  return zh
    ? `行駛中 · ${name(index)} → ${name(index + 1)} · 約 ${eta(stops[index + 1].arr)} 分`
    : `${name(index)} → ${name(index + 1)} · ~${eta(stops[index + 1].arr)} min`;
}
