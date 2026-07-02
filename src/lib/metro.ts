/**
 * Metro (捷運) API layer over TDX `/v2/Rail/Metro/...`, reached through the same
 * /api/tdx proxy as the rail endpoints (fetchTDXApi strips the `basic/` prefix).
 *
 * Metro is per-system (TRTC, KRTC, …) and frequency/line based — there are no OD
 * train numbers like TRA/THSR. So a "journey" here is: fare (ODFare, exact) plus,
 * when origin & destination sit on one line, a travel-time + stop list computed
 * from S2STravelTime. Cross-line trips show fare only and point users to 規劃.
 *
 * Response field names aren't published in the OAS, so parsing is defensive
 * (mirrors the routing layer). Reconcile against a live probe if a field is off.
 */
import { fetchTDXApi } from './api';

const METRO_BASE = 'https://tdx.transportdata.tw/api/basic/v2/Rail/Metro';

/**
 * Read a per-system static snapshot committed weekly by
 * `scripts/fetch-tdx-metro.ts` from `/data/metro_<sys>/<name>.json`.
 *
 * Station / S2STravelTime / LineTransfer rarely change but are fetched
 * unfiltered (and Station is fetched for all 7 systems on every page load for
 * geolocation), so they are the main contributors to TDX 429s. Serving them
 * from the static snapshot keeps the transfer router off the rate-limited path:
 * before this, a 429 made `fetchTDXApi` fall back to mock data — which has no
 * LineTransfer mock — silently turning every cross-line search into "查無路線".
 *
 * Returns null when the file is absent (e.g. snapshot not yet generated) so the
 * caller transparently falls back to the live API. LiveBoard (real-time) and
 * ODFare (per-OD, filtered/small) intentionally stay live.
 */
async function loadMetroStatic<T = any>(system: string, name: string): Promise<T | null> {
  try {
    const res = await fetch(`/data/metro_${system}/${name}.json`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface MetroSystem { code: string; zh: string; en: string }

// Operators that expose Station + ODFare + S2STravelTime on TDX.
export const METRO_SYSTEMS: MetroSystem[] = [
  { code: 'TRTC', zh: '台北捷運', en: 'Taipei Metro' },
  { code: 'NTMC', zh: '新北捷運', en: 'New Taipei Metro' },
  { code: 'TYMC', zh: '桃園捷運', en: 'Taoyuan Metro' },
  { code: 'TMRT', zh: '台中捷運', en: 'Taichung Metro' },
  { code: 'KRTC', zh: '高雄捷運', en: 'Kaohsiung Metro' },
  { code: 'KLRT', zh: '高雄輕軌', en: 'Kaohsiung LRT' },
  { code: 'NTDLRT', zh: '淡海輕軌', en: 'Danhai LRT' },
];

export interface BiName { Zh_tw?: string; En?: string }

export interface MetroStation {
  StationID: string;
  StationName: BiName;
  StationPosition?: { PositionLat?: number; PositionLon?: number };
}

/** Passenger/ticket category a metro fare belongs to. */
export type MetroFareCategory = 'full' | 'ic' | 'student' | 'child' | 'senior' | 'love' | 'group' | 'unknown';

export interface MetroFare {
  label: string;   // display label (zh)
  labelEn: string; // display label (en)
  price: number;
  category: MetroFareCategory;
}

function text(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') return v.Zh_tw ?? v.En ?? v.name ?? '';
  return '';
}

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// --- Stations ---
function parseMetroStations(raw: any): MetroStation[] {
  const arr: any[] = Array.isArray(raw) ? raw : (raw?.Stations ?? []);
  const seen = new Set<string>();
  const out: MetroStation[] = [];
  for (const s of arr) {
    const id = s?.StationID ?? s?.StationUID;
    if (!id || seen.has(String(id))) continue;
    seen.add(String(id));
    out.push({
      StationID: String(id),
      StationName: s?.StationName ?? {},
      StationPosition: s?.StationPosition,
    });
  }
  return out;
}

const _stationHasPos = (s: MetroStation) =>
  !!s.StationPosition && typeof s.StationPosition.PositionLat === 'number' && typeof s.StationPosition.PositionLon === 'number';

/** Union by StationID; `primary` entries win (they carry coordinates), `secondary` fills gaps. */
function mergeMetroStations(primary: MetroStation[], secondary: MetroStation[]): MetroStation[] {
  const byId = new Map<string, MetroStation>();
  for (const s of primary) byId.set(s.StationID, s);
  for (const s of secondary) if (!byId.has(s.StationID)) byId.set(s.StationID, s);
  return [...byId.values()].sort((a, b) => a.StationID.localeCompare(b.StationID));
}

/**
 * Station list with a resilience floor.
 *
 * - A *complete* static snapshot (the weekly job's `/Station` dump, which carries
 *   `StationPosition`) wins outright → no live call, 429-safe.
 * - Otherwise we still query live (authoritative, includes frequency-only lines
 *   like 文湖線 and coordinates) but keep whichever of {live, committed floor}
 *   has more stations. So a 429 — which makes `fetchTDXApi` fall back to the tiny
 *   ~8-station mock — can never collapse the picker below the floor
 *   (e.g. the 97 committed TRTC stations). The floor result isn't cached, so a
 *   later call can still upgrade to the full live list.
 */
const _stationCache = new Map<string, MetroStation[]>();
export async function getMetroStations(system: string): Promise<MetroStation[]> {
  if (_stationCache.has(system)) return _stationCache.get(system)!;

  const floor = parseMetroStations(await loadMetroStatic(system, 'stations'));
  if (floor.length > 0 && floor.some(_stationHasPos)) {
    // Complete snapshot (has coordinates) → trust it, skip live entirely.
    _stationCache.set(system, floor);
    return floor;
  }

  let live: MetroStation[] = [];
  try { live = parseMetroStations(await fetchTDXApi<any>(`${METRO_BASE}/Station/${system}?$format=JSON`)); }
  catch { live = []; }

  // When live has more stations than the floor it is the authoritative full list
  // and is used ALONE — so the floor can never inject a phantom id into a healthy
  // picker. Only when live is the tiny mock / a failure do we fall back to the
  // floor (unioning in any coordinates the mock carried). The degraded (floor)
  // result is not cached, so a later call can upgrade to the real live list.
  const liveIsReal = live.length > floor.length;
  const result = liveIsReal ? live : mergeMetroStations(live, floor);
  if (liveIsReal || floor.length === 0) _stationCache.set(system, result);
  return result;
}

// --- ODFare (exact for any OD, incl. transfers) ---
interface FareCategoryMeta { zh: string; en: string; order: number }
export const METRO_FARE_CATEGORIES: Record<MetroFareCategory, FareCategoryMeta> = {
  full:    { zh: '全票',     en: 'Adult',    order: 0 },
  ic:      { zh: '電子票證', en: 'IC Card',  order: 1 },
  student: { zh: '學生票',   en: 'Student',  order: 2 },
  child:   { zh: '兒童票',   en: 'Child',    order: 3 },
  senior:  { zh: '敬老票',   en: 'Senior',   order: 4 },
  love:    { zh: '愛心票',   en: 'Disabled', order: 5 },
  group:   { zh: '團體票',   en: 'Group',    order: 6 },
  unknown: { zh: '票價',     en: 'Fare',     order: 7 },
};

/**
 * Classify a TDX metro fare row into a passenger/ticket category. Prefers any
 * text label (`TicketType` string, `*Name`, `Description`) so it is correct
 * regardless of operator-specific numeric codes; only falls back to the
 * (best-effort) numeric `FareClass` map when no text is present. Field names
 * aren't in the OAS, so this is defensive — verify against a live probe.
 */
function classifyMetroFare(raw: any): MetroFareCategory {
  const blob = [
    text(raw?.TicketType), text(raw?.TicketTypeName), text(raw?.Description),
    text(raw?.FareName), text(raw?.FareClassName),
  ].join(' ').toLowerCase();
  const has = (...ks: string[]) => ks.some((k) => blob.includes(k.toLowerCase()));
  if (has('學生', 'student')) return 'student';
  if (has('敬老', '長者', '銀髮', 'senior', 'elder')) return 'senior';
  if (has('愛心', '博愛', 'love', 'disab')) return 'love';
  if (has('兒童', '孩童', '小孩', '半票', 'child')) return 'child';
  if (has('團體', 'group')) return 'group';
  if (has('電子', '悠遊', '一卡通', 'icash', 'ic卡', 'smart', 'card')) return 'ic';
  if (has('全票', '成人', '單程', '普通', 'adult', 'full', 'single', 'one-way')) return 'full';
  switch (num(raw?.FareClass)) {
    case 1: return 'full';
    case 2: return 'child';
    case 3: return 'senior';
    case 4: return 'love';
    case 5: return 'student';
    case 6: return 'group';
  }
  return 'unknown';
}

// Per-origin OD fare rows from the static snapshot, cached so repeated searches
// from the same origin don't refetch the file.
const _odFareOriginCache = new Map<string, any[] | null>();
async function loadMetroOriginFares(system: string, originId: string): Promise<any[] | null> {
  const key = `${system}:${originId}`;
  if (_odFareOriginCache.has(key)) return _odFareOriginCache.get(key)!;
  const rows = await loadMetroStatic<any[]>(system, `fares/${originId}`);
  const val = Array.isArray(rows) ? rows : null;
  _odFareOriginCache.set(key, val);
  return val;
}

export async function getMetroODFare(system: string, originId: string, destId: string): Promise<MetroFare[]> {
  // Static-first: the origin's pre-split fare file, filtered for the destination.
  let row: any = null;
  const staticRows = await loadMetroOriginFares(system, originId);
  if (staticRows) {
    row = staticRows.find((r) => String(r?.DestinationStationID) === destId) ?? null;
  }
  if (!row) {
    const filter = `OriginStationID eq '${originId}' and DestinationStationID eq '${destId}'`;
    const url = `${METRO_BASE}/ODFare/${system}?$filter=${filter}&$format=JSON`;
    const raw = await fetchTDXApi<any>(url);
    const arr: any[] = Array.isArray(raw) ? raw : (raw?.ODFares ?? []);
    row = arr.find((r) => String(r?.OriginStationID) === originId && String(r?.DestinationStationID) === destId) ?? arr[0];
  }
  const fares: any[] = row?.Fares ?? [];
  const out: MetroFare[] = [];
  const seen = new Set<string>();
  for (const f of fares) {
    const price = num(f?.Price ?? f?.Fare);
    if (price <= 0) continue;
    const category = classifyMetroFare(f);
    const meta = METRO_FARE_CATEGORIES[category];
    // Prefer an explicit textual label; ignore bare numeric codes as labels.
    const tt = text(f?.TicketType);
    const explicit = (tt && !/^\d+$/.test(tt)) ? tt : (text(f?.TicketTypeName) || text(f?.Description));
    const label = explicit || meta.zh;
    const key = `${category}|${price}|${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, labelEn: explicit || meta.en, price, category });
  }
  // Full/adult first, then by descending price within a category.
  out.sort((a, b) =>
    (METRO_FARE_CATEGORIES[a.category].order - METRO_FARE_CATEGORIES[b.category].order) || (b.price - a.price));
  return out;
}

// --- S2STravelTime (per-line segment run/dwell times) ---
export interface MetroSegment { fromId: string; fromName: BiName; toId: string; toName: BiName; runTime: number; stopTime: number }
export interface MetroLineTimes { lineId: string; segments: MetroSegment[] }

const _s2sCache = new Map<string, MetroLineTimes[]>();
export async function getMetroS2STravelTime(system: string): Promise<MetroLineTimes[]> {
  if (_s2sCache.has(system)) return _s2sCache.get(system)!;
  let raw: any = await loadMetroStatic(system, 's2s');
  if (raw == null) raw = await fetchTDXApi<any>(`${METRO_BASE}/S2STravelTime/${system}?$format=JSON`);
  const arr: any[] = Array.isArray(raw) ? raw : (raw?.S2STravelTimes ?? []);
  const lines: MetroLineTimes[] = arr.map((line) => ({
    lineId: String(line?.LineNo ?? line?.LineID ?? line?.RouteID ?? line?.LineName?.Zh_tw ?? ''),
    segments: (line?.TravelTimes ?? line?.Segments ?? []).map((t: any) => ({
      fromId: String(t?.FromStationID ?? t?.FromStationId ?? ''),
      fromName: t?.FromStationName ?? {},
      toId: String(t?.ToStationID ?? t?.ToStationId ?? ''),
      toName: t?.ToStationName ?? {},
      runTime: num(t?.RunTime ?? t?.RunTimes),
      stopTime: num(t?.StopTime ?? t?.StopTimes),
    })),
  }));
  _s2sCache.set(system, lines);
  return lines;
}

export interface MetroLiveBoard {
  StationID: string;
  StationName: BiName;
  DestinationStationID: string;
  DestinationStationName: BiName;
  EstimateTime: number; // minutes
}

export async function getMetroLiveBoard(system: string, stationId: string): Promise<MetroLiveBoard[]> {
  const url = `${METRO_BASE}/LiveBoard/${system}?$filter=StationID eq '${stationId}'&$format=JSON`;
  const raw = await fetchTDXApi<any>(url);
  const arr: any[] = Array.isArray(raw) ? raw : (raw?.LiveBoards ?? []);
  return arr.map(lb => ({
    StationID: String(lb?.StationID || ''),
    StationName: lb?.StationName || {},
    DestinationStationID: String(lb?.DestinationStationID || ''),
    DestinationStationName: lb?.DestinationStationName || {},
    EstimateTime: num(lb?.EstimateTime),
  }));
}

/**
 * A train's live position on the network (TDX Metro `LivePosition`).
 * Real-time only (no static snapshot) and only some operators publish it, so
 * the call degrades to `[]` on 404/429. Field names aren't in the OAS, so the
 * parse is defensive (mirrors the rest of this module).
 */
export interface MetroTrainLiveBoard {
  TrainNo: string;
  LineID: string;
  StationID: string;
  DestinationStationID: string;
  Direction: number;
  // Cars crowdedness levels, typically 1 to 4. e.g. [1, 2, 1, 1, 3, 2]
  // Might be nested depending on TDX schema, we will try to parse it defensively.
  CarCrowdedness?: number[];
  TrainCrowdedness?: number;
}

export async function getMetroTrainLiveBoard(system: string): Promise<MetroTrainLiveBoard[]> {
  if (system !== 'TRTC') return []; // currently only requested for TRTC
  try {
    const url = `${METRO_BASE}/TrainLiveBoard/${system}?$format=JSON`;
    const raw = await fetchTDXApi<any>(url);
    const arr: any[] = Array.isArray(raw) ? raw : (raw?.TrainLiveBoards ?? []);
    return arr.map(lb => {
      // Defensively parse crowdedness
      let carLevels: number[] = [];
      if (Array.isArray(lb?.Cars)) {
        carLevels = lb.Cars.map((c: any) => parseInt(c?.CarCrowdedness) || 1);
      } else if (Array.isArray(lb?.CarCrowdedness)) {
        carLevels = lb.CarCrowdedness.map((c: any) => parseInt(c) || 1);
      }
      return {
        TrainNo: String(lb?.TrainNo || ''),
        LineID: String(lb?.LineID || ''),
        StationID: String(lb?.StationID || ''),
        DestinationStationID: String(lb?.DestinationStationID || ''),
        Direction: parseInt(lb?.Direction) || 0,
        CarCrowdedness: carLevels.length > 0 ? carLevels : undefined,
        TrainCrowdedness: parseInt(lb?.TrainCrowdedness) || undefined,
      };
    });
  } catch (e) {
    console.warn(`[getMetroTrainLiveBoard] Failed to fetch for ${system}`, e);
    return [];
  }
}

export interface MetroLivePosition {
  trainNo: string;
  lineId: string;
  stationId: string;     // station the train is at / approaching
  stationName: BiName;
  destStationId: string; // service terminus (direction hint)
  destName: BiName;
  direction: number;     // raw direction code
  /** Raw TDX MoveStatus: typically 0 = at station / arriving, 1 = departed / running. */
  moveStatus: number;
}

export async function getMetroLivePosition(system: string): Promise<MetroLivePosition[]> {
  const url = `${METRO_BASE}/LivePosition/${system}?$format=JSON`;
  let raw: any;
  try {
    raw = await fetchTDXApi<any>(url);
  } catch {
    return [];
  }
  const arr: any[] = Array.isArray(raw)
    ? raw
    : (raw?.LivePositions ?? raw?.TrainLivePositions ?? raw?.LivePosition ?? []);
  return arr.map((p) => ({
    trainNo: String(p?.TrainNo ?? p?.TrainNumber ?? p?.CarID ?? ''),
    lineId: String(p?.LineID ?? p?.LineNo ?? p?.RouteID ?? ''),
    stationId: String(p?.StationID ?? p?.CurrentStationID ?? p?.NextStationID ?? ''),
    stationName: p?.StationName ?? p?.CurrentStationName ?? p?.NextStationName ?? {},
    destStationId: String(p?.EndStationID ?? p?.DestinationStationID ?? p?.TerminalStationID ?? ''),
    destName: p?.EndStationName ?? p?.DestinationStationName ?? p?.TripHeadSign ?? {},
    direction: num(p?.Direction ?? p?.DirectionType),
    moveStatus: num(p?.MoveStatus),
  })).filter((p) => p.stationId);
}

/**
 * Service alerts / disruptions (TDX Metro `Alert`, 營運通阻). Real-time-ish
 * (10-min proxy cache); degrades to `[]` on 404/429 — no mock, so a healthy
 * picker never shows a fabricated disruption. Defensive parse (no OAS fields).
 */
export interface MetroAlert {
  title: string;
  description: string;
  status: string;
  level: number;
}
export async function getMetroAlert(system: string): Promise<MetroAlert[]> {
  const url = `${METRO_BASE}/Alert/${system}?$format=JSON`;
  let raw: any;
  try { raw = await fetchTDXApi<any>(url); } catch { return []; }
  const arr: any[] = Array.isArray(raw) ? raw : (raw?.Alerts ?? raw?.MetroAlerts ?? raw?.AlertInfos ?? []);
  return arr.map((a) => ({
    title: text(a?.Title ?? a?.AlertTitle ?? a?.Subject ?? ''),
    description: text(a?.Description ?? a?.AlertDescription ?? a?.Content ?? a?.Title ?? ''),
    status: text(a?.Status ?? a?.StatusDescription ?? a?.Effects ?? ''),
    level: num(a?.Level ?? a?.AlertLevel),
  })).filter((a) => a.title || a.description);
}

export interface SameLineJourney {
  lineId: string;
  travelTimeSec: number;
  stopNames: string[]; // origin … destination inclusive, in travel order
  stopIds: string[]; // station ids, parallel to stopNames (travel order)
  stopOffsetsSec: number[]; // cumulative seconds from origin to each stop (parallel)
  lineStopIds: string[]; // full ordered station ids for the matched line
  originIndex: number; // index of origin in lineStopIds
  destIndex: number; // index of destination in lineStopIds
  directionTerminusId: string; // far end of the line in travel direction
  directionTerminusName: string; // its display name (current language)
}

/**
 * If origin & destination lie on a single line, return its id, summed
 * run+dwell travel time, and the ordered stop names between them. Else null
 * (a transfer is needed — caller falls back to fare-only).
 */
export function computeSameLineJourney(
  lines: MetroLineTimes[],
  originId: string,
  destId: string,
  zh: boolean,
): SameLineJourney | null {
  const nameOf = (n: BiName) => (zh ? n.Zh_tw : n.En) || n.Zh_tw || n.En || '';
  for (const line of lines) {
    if (!line.segments.length) continue;
    const ids: string[] = [];
    const names: Record<string, string> = {};
    line.segments.forEach((s, i) => {
      if (i === 0) { ids.push(s.fromId); names[s.fromId] = nameOf(s.fromName); }
      ids.push(s.toId);
      names[s.toId] = nameOf(s.toName);
    });
    const oi = ids.indexOf(originId);
    const di = ids.indexOf(destId);
    if (oi === -1 || di === -1) continue;
    const lo = Math.min(oi, di);
    const hi = Math.max(oi, di);
    // Ascending-index slice + the cumulative run+dwell offset of each stop from `lo`.
    const sliceIds = ids.slice(lo, hi + 1);
    const ascOffsets: number[] = [0];
    for (let i = lo; i < hi; i++) {
      ascOffsets.push(ascOffsets[ascOffsets.length - 1] + line.segments[i].runTime + line.segments[i].stopTime);
    }
    const travelTimeSec = ascOffsets[ascOffsets.length - 1];
    const forward = oi <= di;
    // Re-order into travel direction (origin first) and recompute offsets from origin.
    const order = sliceIds.map((_, k) => (forward ? k : sliceIds.length - 1 - k));
    const stopIds = order.map((k) => sliceIds[k]);
    const stopNames = stopIds.map((id) => names[id] || '');
    const stopOffsetsSec = order.map((k) => (forward ? ascOffsets[k] : travelTimeSec - ascOffsets[k]));
    return {
      lineId: line.lineId,
      travelTimeSec,
      stopNames,
      stopIds,
      stopOffsetsSec,
      lineStopIds: ids,
      originIndex: oi,
      destIndex: di,
      directionTerminusId: forward ? ids[ids.length - 1] : ids[0],
      directionTerminusName: names[forward ? ids[ids.length - 1] : ids[0]] || '',
    };
  }
  return null;
}

/** TDX Metro StationTimeTable TrainType → display label. 0 = Local, 1 = Express. */
export function metroTrainTypeLabel(trainType: number, zh: boolean): string {
  switch (trainType) {
    case 1: return zh ? '直達' : 'Express';
    default: return zh ? '普通' : 'Local';
  }
}

/** Add `addSec` seconds to an "HH:MM" string, wrapping past midnight. */
export function addMinutesToHHMM(hhmm: string, addSec: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (h * 60 + m + Math.round(addSec / 60)) % 1440;
  const norm = (total + 1440) % 1440;
  const hh = Math.floor(norm / 60).toString().padStart(2, '0');
  const mm = (norm % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

export interface MetroDeparture {
  departureTime: string; // "17:36"
  arrivalTime: string;   // departureTime + journey travel time
  trainType: number;     // 0 Local, 1 Express
  destName: string;      // direction terminus name
  destId: string;        // direction terminus id
  seq: number;
  trainNo?: string;      // optional train identifier
  crowdedness?: number[]; // [1..4] levels per car
}

/**
 * Shape a station's static timetable (array from /data/metro_<sys>/<origin>.json)
 * into the upcoming departures heading toward the trip destination.
 * Direction filter uses the journey's line ordering; falls back to terminus-name
 * match when the timetable terminus id is not on the matched line ordering.
 * Source field `DestinationStaionID` is mis-spelled in TDX data — read both.
 */
export function buildMetroDepartures(
  rawStationTimetable: any[],
  journey: SameLineJourney,
  zh: boolean,
  nowHHMM: string,
): MetroDeparture[] {
  const forward = journey.destIndex >= journey.originIndex;
  const out: MetroDeparture[] = [];
  for (const t of (rawStationTimetable ?? [])) {
    const destId = String(t?.DestinationStationID ?? t?.DestinationStaionID ?? '');
    const destName =
      (zh ? t?.DestinationStationName?.Zh_tw : t?.DestinationStationName?.En) ||
      t?.DestinationStationName?.Zh_tw || '';
    const termIdx = journey.lineStopIds.indexOf(destId);
    const headingRight = termIdx !== -1
      ? (forward ? termIdx >= journey.destIndex : termIdx <= journey.destIndex)
      : (destName !== '' && destName === journey.directionTerminusName);
    if (!headingRight) continue;
    for (const d of (t?.Timetables ?? [])) {
      out.push({
        departureTime: d.DepartureTime,
        arrivalTime: addMinutesToHHMM(d.DepartureTime, journey.travelTimeSec),
        trainType: typeof d.TrainType === 'number' ? d.TrainType : 0,
        destName,
        destId,
        seq: d.Sequence,
      });
    }
  }
  return out
    .filter(d => d.departureTime >= nowHHMM)
    .sort((a, b) => a.departureTime.localeCompare(b.departureTime));
}

/** One scheduled run of a multi-leg (transfer) metro trip. */
export interface MetroRouteDepartureLeg {
  departureTime: string; // boarding this leg
  arrivalTime: string;   // alighting this leg
  destName: string;      // direction terminus of the train boarded
  trainType: number;
  waitSec: number;       // platform wait after the transfer walk (0 on leg 0)
}
export interface MetroRouteDeparture {
  departureTime: string; // origin boarding time
  arrivalTime: string;   // final arrival
  totalTimeSec: number;
  legs: MetroRouteDepartureLeg[];
  seq: number;
}

const hhmmToMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Chain per-leg station timetables into scheduled departures for a transfer
 * route: board the first line now-or-later, ride, walk the transfer, then take
 * the next scheduled train on the following line (repeat for 3+ legs).
 * `legTimetables[k]` is the raw /data/metro_<sys>/<boarding-id>.json array for
 * leg k's boarding station; `legJourneys[k]` the same-line journey for leg k;
 * `transferWalkSec[k]` the walk between leg k and k+1. Trips that would wrap
 * past midnight between legs are dropped (same day-boundary limit as the
 * single-line list).
 */
export function buildMetroRouteDepartures(
  legTimetables: any[][],
  legJourneys: SameLineJourney[],
  transferWalkSec: number[],
  zh: boolean,
  nowHHMM: string,
  limit = 30,
): MetroRouteDeparture[] {
  if (!legJourneys.length || legTimetables.length !== legJourneys.length) return [];
  const perLegAll = legJourneys.map((lj, k) =>
    buildMetroDepartures(legTimetables[k], lj, zh, k === 0 ? nowHHMM : '00:00'));
  if (perLegAll.some((deps) => deps.length === 0)) return [];

  const out: MetroRouteDeparture[] = [];
  for (const d0 of perLegAll[0].slice(0, limit)) {
    const legs: MetroRouteDepartureLeg[] = [{
      departureTime: d0.departureTime,
      arrivalTime: addMinutesToHHMM(d0.departureTime, legJourneys[0].travelTimeSec),
      destName: d0.destName,
      trainType: d0.trainType,
      waitSec: 0,
    }];
    let ok = true;
    for (let k = 1; k < legJourneys.length; k++) {
      const ready = addMinutesToHHMM(legs[k - 1].arrivalTime, transferWalkSec[k - 1] ?? 0);
      if (hhmmToMin(ready) < hhmmToMin(legs[k - 1].arrivalTime)) { ok = false; break; } // wrapped midnight
      const next = perLegAll[k].find((d) => d.departureTime >= ready);
      if (!next) { ok = false; break; }
      legs.push({
        departureTime: next.departureTime,
        arrivalTime: addMinutesToHHMM(next.departureTime, legJourneys[k].travelTimeSec),
        destName: next.destName,
        trainType: next.trainType,
        waitSec: (hhmmToMin(next.departureTime) - hhmmToMin(ready)) * 60,
      });
    }
    if (!ok) continue;
    const arrivalTime = legs[legs.length - 1].arrivalTime;
    out.push({
      departureTime: d0.departureTime,
      arrivalTime,
      totalTimeSec: ((hhmmToMin(arrivalTime) - hhmmToMin(d0.departureTime) + 1440) % 1440) * 60,
      legs,
      seq: out.length,
    });
  }
  return out;
}

export const METRO_TRANSFER_FALLBACK_SEC = 240;

export interface MetroTransferEdge {
  fromId: string; fromName: BiName;
  toId: string; toName: BiName;
  fromLineId: string; toLineId: string; // line you transfer from → to (for badges)
  transferTimeSec: number;
}

const _transferCache = new Map<string, MetroTransferEdge[]>();
export async function getMetroLineTransfer(system: string): Promise<MetroTransferEdge[]> {
  if (_transferCache.has(system)) return _transferCache.get(system)!;
  let raw: any = await loadMetroStatic(system, 'transfers');
  if (raw == null) raw = await fetchTDXApi<any>(`${METRO_BASE}/LineTransfer/${system}?$format=JSON`);
  const arr: any[] = Array.isArray(raw) ? raw : (raw?.LineTransfers ?? []);
  const out: MetroTransferEdge[] = arr.map((t) => {
    const mins = num(t?.TransferTime ?? t?.TransferTimes ?? t?.MorningFirstTransferTime);
    return {
      fromId: String(t?.FromStationID ?? t?.FromStationId ?? ''),
      fromName: t?.FromStationName ?? {},
      toId: String(t?.ToStationID ?? t?.ToStationId ?? ''),
      toName: t?.ToStationName ?? {},
      fromLineId: String(t?.FromLineID ?? t?.FromLineNo ?? ''),
      toLineId: String(t?.ToLineID ?? t?.ToLineNo ?? ''),
      transferTimeSec: mins > 0 ? mins * 60 : METRO_TRANSFER_FALLBACK_SEC,
    };
  }).filter((e) => e.fromId && e.toId);
  _transferCache.set(system, out);
  return out;
}

/**
 * In-station transfer detail (TDX Metro `StationTransfer`). Static data —
 * served static-first like the other reference endpoints, falling back to live
 * and degrading to `[]` if unavailable. Its unique value over `LineTransfer`
 * is the human walking `description`; the line/time are already in LineTransfer.
 * Field names aren't in the OAS → defensive parse.
 */
export interface MetroStationTransferInfo {
  fromStationId: string;
  toStationId: string;
  fromLineId: string;
  toLineId: string;
  transferTimeSec: number;
  description: string;
}
const _stationTransferCache = new Map<string, MetroStationTransferInfo[]>();
export async function getMetroStationTransfer(system: string): Promise<MetroStationTransferInfo[]> {
  if (_stationTransferCache.has(system)) return _stationTransferCache.get(system)!;
  let raw: any = await loadMetroStatic(system, 'stationtransfer');
  if (raw == null) {
    try { raw = await fetchTDXApi<any>(`${METRO_BASE}/StationTransfer/${system}?$format=JSON`); }
    catch { raw = []; }
  }
  const arr: any[] = Array.isArray(raw) ? raw : (raw?.StationTransfers ?? raw?.TransferInfos ?? []);
  const out: MetroStationTransferInfo[] = [];
  for (const t of arr) {
    const fromStationId = String(t?.FromStationID ?? t?.FromStationId ?? t?.StationID ?? '');
    if (!fromStationId) continue;
    const groups: any[] = Array.isArray(t?.Transfers) ? t.Transfers : [];
    const rails = groups.flatMap((g) => (Array.isArray(g?.RailTransfers) ? g.RailTransfers : []));
    if (rails.length) {
      // Nested TDX shape (e.g. TRTC): per-operator rail hand-offs with real
      // walking directions. The "line" we surface is the operator code
      // (THSR/TRA/TYMC…) — in-system line↔line pairs live in LineTransfer.
      const fromLineId = fromStationId.replace(/\d.*$/, '');
      for (const rt of rails) {
        out.push({
          fromStationId,
          toStationId: String(rt?.StationID ?? ''),
          fromLineId,
          toLineId: String(rt?.OperatorCode ?? ''),
          transferTimeSec: 0,
          description: text(rt?.Description ?? ''),
        });
      }
    } else if (t?.FromStationID ?? t?.FromStationId) {
      // Flat legacy shape (defensive — field names aren't in the OAS).
      const mins = num(t?.TransferTime ?? t?.TransferTimes ?? t?.TransferDuration);
      out.push({
        fromStationId,
        toStationId: String(t?.ToStationID ?? t?.ToStationId ?? ''),
        fromLineId: String(t?.FromLineID ?? t?.FromLineNo ?? ''),
        toLineId: String(t?.ToLineID ?? t?.ToLineNo ?? ''),
        transferTimeSec: mins > 0 ? mins * 60 : 0,
        description: text(t?.TransferDescription ?? t?.Description ?? ''),
      });
    }
  }
  _stationTransferCache.set(system, out);
  return out;
}

/** Short display label for a rail operator code seen in transfer data. */
export function metroOperatorLabel(code: string, zh: boolean): string {
  const map: Record<string, [string, string]> = {
    THSR: ['高鐵', 'THSR'],
    TRA: ['台鐵', 'TRA'],
    TYMC: ['機捷', 'Airport MRT'],
    TRTC: ['北捷', 'Taipei Metro'],
    NTMC: ['新北捷運', 'New Taipei Metro'],
    NTDLRT: ['淡海輕軌', 'Danhai LRT'],
    KRTC: ['高雄捷運', 'Kaohsiung Metro'],
    KLRT: ['高雄輕軌', 'Kaohsiung LRT'],
    TMRT: ['台中捷運', 'Taichung Metro'],
  };
  const hit = map[code];
  return hit ? (zh ? hit[0] : hit[1]) : code;
}

/**
 * Boarding platforms per station (TDX Metro `StationPlatform`). Static — only
 * the physical layout, so served static-first. Tolerates both a nested
 * `{ StationID, Platforms: [...] }` shape and flat per-platform rows.
 * Field names aren't in the OAS → defensive parse; consumers render only when a
 * platform label resolves, so a field mismatch degrades to "no platform shown".
 */
export interface MetroPlatform {
  stationId: string;
  platform: string;
  lineId: string;
  destStationId: string;
  destName: BiName;
  direction: number;
}
const _platformCache = new Map<string, MetroPlatform[]>();
export async function getMetroStationPlatform(system: string): Promise<MetroPlatform[]> {
  if (_platformCache.has(system)) return _platformCache.get(system)!;
  let raw: any = await loadMetroStatic(system, 'platforms');
  if (raw == null) {
    try { raw = await fetchTDXApi<any>(`${METRO_BASE}/StationPlatform/${system}?$format=JSON`); }
    catch { raw = []; }
  }
  const arr: any[] = Array.isArray(raw) ? raw : (raw?.StationPlatforms ?? raw?.Platforms ?? []);
  const out: MetroPlatform[] = [];
  for (const s of arr) {
    const sid = String(s?.StationID ?? s?.StationId ?? '');
    const rows = Array.isArray(s?.Platforms) ? s.Platforms
      : Array.isArray(s?.PlatformList) ? s.PlatformList
      : [s];
    for (const p of rows) {
      const label = text(p?.PlatformID ?? p?.Platform ?? p?.PlatformNo ?? p?.PlatformName ?? '');
      const stationId = sid || String(p?.StationID ?? p?.StationId ?? '');
      if (!stationId || !label) continue;
      out.push({
        stationId,
        platform: label,
        lineId: String(p?.LineID ?? p?.LineNo ?? s?.LineID ?? ''),
        destStationId: String(p?.DestinationStationID ?? p?.EndStationID ?? p?.ToStationID ?? ''),
        destName: p?.DestinationStationName ?? p?.EndStationName ?? {},
        direction: num(p?.Direction ?? p?.DirectionType),
      });
    }
  }
  _platformCache.set(system, out);
  return out;
}

export interface MetroRouteLeg {
  lineId: string;
  fromName: string; toName: string;
  stopNames: string[]; // inclusive, in travel order
  stopIds: string[]; // station ids, parallel to stopNames
  stopOffsetsSec: number[]; // cumulative seconds within this leg (0 at boarding), parallel to stopNames
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
      const stopOffsetsSec: number[] = [0];
      while (i < pathEdges.length && pathEdges[i] === lineId) {
        rideTimeSec += edgeWeight(pathNodes[i], pathNodes[i + 1], lineId);
        stopIds.push(pathNodes[i + 1]);
        stopOffsetsSec.push(rideTimeSec);
        i++;
      }
      totalTimeSec += rideTimeSec;
      // Fall back to the id so the arrays stay parallel with stopIds/stopOffsetsSec.
      const stopNames = stopIds.map((id) => nodeName.get(id) || id);
      legs.push({
        lineId,
        fromName: stopNames[0] || '',
        toName: stopNames[stopNames.length - 1] || '',
        stopNames,
        stopIds,
        stopOffsetsSec,
        rideTimeSec,
      });
    }
  }

  if (legs.length === 0) return null;
  return { legs, transfers: transfersOut, totalTimeSec, transferCount: Math.max(0, legs.length - 1) };
}
