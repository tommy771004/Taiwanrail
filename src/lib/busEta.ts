/**
 * 公車預估到站（TDX EstimatedTimeOfArrival, N1）: request URLs and the reading of a reply.
 *
 * Quota: every URL here is canonical — the same stop set or route always produces the same
 * string — because the gateway and Vercel's CDN share answers by exact URL (CLAUDE.md
 * "TDX quota scales with distinct URLs"). A stop page asks once for all of its poles; a route
 * page asks once for the route. The whole-city ETA is never requested: the gateway refuses a
 * City ETA call without a StopUID filter (src/lib/tdxGateway.ts).
 *
 * Display rules (concept canvas 「到站時間的顯示規則」): whole minutes only, no seconds
 * countdown; 進站中 under one minute; 尚未發車 shows the next scheduled time only when TDX
 * gives one, labelled 表定; anything unreadable is 無資料 — never a guessed minute.
 */
import type { BusCityCode } from './busData';

const TDX = 'https://tdx.transportdata.tw/api/basic/v2/Bus/EstimatedTimeOfArrival/City';

/** Terms per request: keeps a URL well under any proxy limit (40 × ~30 chars). */
export const BUS_ETA_MAX_STOPS = 40;

/** A StopUID / RouteUID as TDX writes them (authority code + id). Anything else is not sent. */
export const BUS_UID_RE = /^[A-Z]{3}[0-9A-Za-z_-]{1,24}$/;

/** One URL per chunk of the stop set, sorted so the same stops always give the same URL. */
export function busStopEtaUrls(city: BusCityCode, stopUids: readonly string[]): string[] {
  const uids = [...new Set(stopUids.filter((u) => BUS_UID_RE.test(u)))].sort();
  const urls: string[] = [];
  for (let i = 0; i < uids.length; i += BUS_ETA_MAX_STOPS) {
    const filter = uids.slice(i, i + BUS_ETA_MAX_STOPS).map((u) => `StopUID eq '${u}'`).join(' or ');
    urls.push(`${TDX}/${city}?$filter=${encodeURIComponent(filter)}&$format=JSON`);
  }
  return urls;
}

/** The whole route (both directions): one URL per route, shared by every stop page and rider. */
export function busRouteEtaUrl(city: BusCityCode, routeNameZh: string, routeUid: string): string | null {
  if (!BUS_UID_RE.test(routeUid) || !routeNameZh.trim()) return null;
  const filter = `RouteUID eq '${routeUid}'`;
  return `${TDX}/${city}/${encodeURIComponent(routeNameZh)}?$filter=${encodeURIComponent(filter)}&$format=JSON`;
}

export type BusEta =
  | { kind: 'arriving' }
  | { kind: 'minutes'; minutes: number }
  | { kind: 'scheduled'; time: string }
  | { kind: 'notDeparted' }
  | { kind: 'noStop' }
  | { kind: 'lastPassed' }
  | { kind: 'noService' }
  | { kind: 'none' };

export const NO_ETA: BusEta = { kind: 'none' };

function taipeiClock(iso: unknown): string | null {
  if (typeof iso !== 'string' || !iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** One N1 row → what the rider is told. */
export function etaFromRow(row: Record<string, unknown>): BusEta {
  const status = row.StopStatus;
  const est = row.EstimateTime;
  const hasEst = typeof est === 'number' && Number.isFinite(est) && est >= 0;
  if (status === 0 || (status === undefined && hasEst)) {
    if (!hasEst) return NO_ETA;
    return (est as number) < 60 ? { kind: 'arriving' } : { kind: 'minutes', minutes: Math.floor((est as number) / 60) };
  }
  if (status === 1) {
    const next = taipeiClock(row.NextBusTime);
    return next ? { kind: 'scheduled', time: next } : { kind: 'notDeparted' };
  }
  if (status === 2) return { kind: 'noStop' };
  if (status === 3) return { kind: 'lastPassed' };
  if (status === 4) return { kind: 'noService' };
  return NO_ETA;
}

/** Lower is sooner / more useful; used to pick among sub-routes and to sort 常用. */
export function etaRank(e: BusEta): number {
  switch (e.kind) {
    case 'arriving': return 0;
    case 'minutes': return 1 + e.minutes;
    case 'scheduled': return 2000;
    case 'notDeparted': return 3000;
    case 'noStop': return 4000;
    case 'lastPassed': return 5000;
    case 'noService': return 6000;
    default: return 9000;
  }
}

export function bestEta(list: readonly BusEta[]): BusEta {
  let best: BusEta = NO_ETA;
  for (const e of list) {
    if (etaRank(e) < etaRank(best)) best = e;
    else if (e.kind === 'scheduled' && best.kind === 'scheduled' && e.time < best.time) best = e;
  }
  return best;
}

export interface BusEtaIndex {
  /** `${RouteUID}|${StopUID}` → every row's reading (sub-routes give several). */
  byKey: Map<string, BusEta[]>;
  /** StopUID of every row where a bus is arriving — the route page draws a bus there. */
  arrivingStops: Set<string>;
  /** Newest UpdateTime among the rows; null when the reply had none. */
  asOf: string | null;
  rows: number;
}

export function emptyEtaIndex(): BusEtaIndex {
  return { byKey: new Map(), arrivingStops: new Set(), asOf: null, rows: 0 };
}

/** Read a TDX reply (a bare array; anything else is no data). */
export function indexEtaRows(payload: unknown, into: BusEtaIndex = emptyEtaIndex()): BusEtaIndex {
  if (!Array.isArray(payload)) return into;
  for (const raw of payload) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const stop = row.StopUID;
    const route = row.RouteUID;
    if (typeof stop !== 'string' || typeof route !== 'string') continue;
    const eta = etaFromRow(row);
    const key = `${route}|${stop}`;
    const list = into.byKey.get(key);
    if (list) list.push(eta);
    else into.byKey.set(key, [eta]);
    if (eta.kind === 'arriving') into.arrivingStops.add(stop);
    const t = typeof row.UpdateTime === 'string' ? row.UpdateTime : typeof row.SrcUpdateTime === 'string' ? row.SrcUpdateTime : null;
    if (t && !Number.isNaN(Date.parse(t)) && (!into.asOf || Date.parse(t) > Date.parse(into.asOf))) into.asOf = t;
    into.rows++;
  }
  return into;
}

/** The reading for a route at one or more StopUIDs (a row on the stop page). */
export function etaFor(index: BusEtaIndex, routeUid: string, stopUids: readonly string[]): BusEta {
  const all: BusEta[] = [];
  for (const s of stopUids) all.push(...(index.byKey.get(`${routeUid}|${s}`) ?? []));
  return bestEta(all);
}

/** Readings older than this are not shown as minutes (concept: 超過 5 分鐘就清掉分鐘數). */
export const BUS_ETA_MAX_AGE_MS = 5 * 60_000;

export function isEtaExpired(asOf: string | null, now: number): boolean {
  if (!asOf) return false;
  const t = Date.parse(asOf);
  return Number.isFinite(t) && now - t > BUS_ETA_MAX_AGE_MS;
}

/** The text a rider reads, in their language. */
export function etaText(e: BusEta, zh: boolean): string {
  switch (e.kind) {
    case 'arriving': return zh ? '進站中' : 'Arriving';
    case 'minutes': return zh ? `${e.minutes} 分` : `${e.minutes} min`;
    case 'scheduled': return zh ? `表定 ${e.time}` : `Sched. ${e.time}`;
    case 'notDeparted': return zh ? '尚未發車' : 'Not departed';
    case 'noStop': return zh ? '交管不停靠' : 'Not stopping';
    case 'lastPassed': return zh ? '末班車已過' : 'Last bus left';
    case 'noService': return zh ? '今日未營運' : 'No service today';
    default: return zh ? '無資料' : 'No data';
  }
}
