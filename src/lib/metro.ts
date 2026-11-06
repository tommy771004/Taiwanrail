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
import { taiwanDateString, taiwanWeekdayIndex } from './taiwanDate';
import { metroServesWeekday } from './metroBoard';

const METRO_BASE = 'https://tdx.transportdata.tw/api/basic/v2/Rail/Metro';

/**
 * Read a per-system static snapshot committed weekly by
 * `scripts/fetch-tdx-metro.ts` from `/data/metro_<sys>/<name>.json`.
 *
 * Station / S2STravelTime / LineTransfer rarely change but are fetched
 * unfiltered (and Station is fetched for all 7 systems on every page load for
 * geolocation), so they are the main contributors to TDX 429s. Serving them
 * from the static snapshot keeps the transfer router off the rate-limited path:
 * a 429 leaves `fetchTDXApi` with nothing to return, which would silently turn
 * every cross-line search into "查無路線".
 *
 * Returns null when the file is absent (e.g. snapshot not yet generated) so the
 * caller transparently falls back to the live API. LiveBoard (real-time)
 * intentionally stays live.
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

/**
 * The operators each endpoint accepts, as TDX's own 400 lists them (checked 2026-11-06). Asking
 * for any other is a call spent for nothing, on every search or board poll, and a 400 is never
 * cached by the gateway or CDN. LivePosition is 高雄輕軌 only, so no other line map has live trains.
 */
const TDX_ENDPOINT_SYSTEMS = {
  LineTransfer: new Set(['TRTC', 'KRTC', 'TYMC', 'NTMC']),
  StationTransfer: new Set(['TRTC', 'NTMC', 'TYMC']),
  StationPlatform: new Set(['KLRT']),
  Alert: new Set(['TRTC', 'KRTC', 'TYMC', 'KLRT', 'TMRT']),
  LiveBoard: new Set(['TRTC', 'KRTC', 'TYMC', 'KLRT']),
  LivePosition: new Set(['KLRT']),
};

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
  /** Some operators (KLRT) pack "中文;English" into one string — split at render. */
  StationAddress?: string;
  LocationCity?: string;
  LocationTown?: string;
  BikeAllowOnHoliday?: boolean;
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
      StationAddress: typeof s?.StationAddress === 'string' ? s.StationAddress : undefined,
      LocationCity: typeof s?.LocationCity === 'string' ? s.LocationCity : undefined,
      LocationTown: typeof s?.LocationTown === 'string' ? s.LocationTown : undefined,
      BikeAllowOnHoliday: typeof s?.BikeAllowOnHoliday === 'boolean' ? s.BikeAllowOnHoliday : undefined,
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
 *   has more stations. So a 429, which leaves `fetchTDXApi` with an empty list,
 *   can never collapse the picker below the floor
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
  // picker. Only when live failed or came back short do we fall back to the
  // floor (unioning in any coordinates live did carry). The degraded (floor)
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

/**
 * Origins in the system's fare snapshot, or null when it has none. An origin
 * missing from this list has no fares on TDX at all (新北捷運 LB* answers `[]`).
 */
const _fareOriginsCache = new Map<string, Promise<Set<string> | null>>();
function loadMetroFareOrigins(system: string): Promise<Set<string> | null> {
  let origins = _fareOriginsCache.get(system);
  if (!origins) {
    origins = loadMetroStatic<string[]>(system, 'fares/index').then((ids) =>
      Array.isArray(ids) && ids.length > 0 ? new Set(ids) : null);
    _fareOriginsCache.set(system, origins);
  }
  return origins;
}

export async function getMetroODFare(system: string, originId: string, destId: string): Promise<MetroFare[]> {
  // Static-first: the origin's pre-split fare file, filtered for the destination.
  // The snapshot holds every row TDX has, so a miss there means no fare exists.
  // Only an unreadable snapshot goes live: asking per OD would spend one TDX call
  // on each pair just to hear `[]` again.
  let row: any = null;
  const origins = await loadMetroFareOrigins(system);
  const staticRows = origins && !origins.has(originId)
    ? []
    : await loadMetroOriginFares(system, originId);
  if (staticRows) {
    row = staticRows.find((r) => String(r?.DestinationStationID) === destId) ?? null;
  }
  if (!staticRows) {
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
export interface MetroLineTimes {
  lineId: string;
  segments: MetroSegment[];
  trainType?: number; // 桃園機捷 publishes local (1) and express (2) as separate entries
}

const _s2sCache = new Map<string, MetroLineTimes[]>();
export async function getMetroS2STravelTime(system: string): Promise<MetroLineTimes[]> {
  if (_s2sCache.has(system)) return _s2sCache.get(system)!;
  let raw: any = await loadMetroStatic(system, 's2s');
  if (raw == null && system !== 'NTDLRT') raw = await fetchTDXApi<any>(`${METRO_BASE}/S2STravelTime/${system}?$format=JSON`);
  const arr: any[] = Array.isArray(raw) ? raw : (raw?.S2STravelTimes ?? []);
  const lines: MetroLineTimes[] = arr.map((line) => ({
    // LineID first: 台中捷運's LineNo is 「1」, which names nothing to a rider or the label tables.
    lineId: String(line?.LineID ?? line?.LineNo ?? line?.RouteID ?? line?.LineName?.Zh_tw ?? ''),
    segments: (line?.TravelTimes ?? line?.Segments ?? []).map((t: any) => ({
      fromId: String(t?.FromStationID ?? t?.FromStationId ?? ''),
      fromName: t?.FromStationName ?? {},
      toId: String(t?.ToStationID ?? t?.ToStationId ?? ''),
      toName: t?.ToStationName ?? {},
      runTime: num(t?.RunTime ?? t?.RunTimes),
      stopTime: num(t?.StopTime ?? t?.StopTimes),
    })),
    ...(line?.TrainType === undefined ? {} : { trainType: Number(line.TrainType) }),
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
  tripHeadSign?: string; // 高雄輕軌 「順行方向」／「逆行方向」: all its trains are signed to C1
}

/**
 * Live next-train minutes at one station, or at several in one request — an
 * interchange has one StationID per line (台北車站 = BL12 + R10), and the arrivals
 * board needs all of them without one round trip each.
 */
export async function getMetroLiveBoard(system: string, stationId: string | string[]): Promise<MetroLiveBoard[]> {
  const ids = (Array.isArray(stationId) ? stationId : [stationId]).filter(Boolean);
  if (ids.length === 0 || !TDX_ENDPOINT_SYSTEMS.LiveBoard.has(system)) return [];
  const filter = ids.map((id) => `StationID eq '${id}'`).join(' or ');
  const url = `${METRO_BASE}/LiveBoard/${system}?$filter=${filter}&$format=JSON`;
  const raw = await fetchTDXApi<any>(url);
  const arr: any[] = Array.isArray(raw) ? raw : (raw?.LiveBoards ?? []);
  return arr.map(lb => ({
    StationID: String(lb?.StationID || ''),
    StationName: lb?.StationName || {},
    DestinationStationID: String(lb?.DestinationStationID || ''),
    DestinationStationName: lb?.DestinationStationName || {},
    EstimateTime: num(lb?.EstimateTime),
    tripHeadSign: typeof lb?.TripHeadSign === 'string' ? lb.TripHeadSign : '',
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
  if (!TDX_ENDPOINT_SYSTEMS.LivePosition.has(system)) return [];
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
  if (!TDX_ENDPOINT_SYSTEMS.Alert.has(system)) return [];
  const url = `${METRO_BASE}/Alert/${system}?$format=JSON`;
  let raw: any;
  try { raw = await fetchTDXApi<any>(url); } catch { return []; }
  return parseMetroAlerts(raw);
}

/**
 * Every operator publishes one all-clear row (Status 1, 「正常營運」) while nothing is wrong, and
 * shown under 營運通阻 it reads as a disruption. Only that exact row is dropped: a notice with
 * its own wording stays, because hiding a real one is the worse mistake.
 */
export function parseMetroAlerts(raw: any): MetroAlert[] {
  const arr: any[] = Array.isArray(raw) ? raw : (raw?.Alerts ?? raw?.MetroAlerts ?? raw?.AlertInfos ?? []);
  const isAllClear = (a: any) => a?.Status === 1 && text(a?.Title).trim() === '正常營運';
  return arr.filter((a) => !isAllClear(a)).map((a) => ({
    title: text(a?.Title ?? a?.AlertTitle ?? a?.Subject ?? ''),
    description: text(a?.Description ?? a?.AlertDescription ?? a?.Content ?? a?.Title ?? ''),
    status: text(a?.Status ?? a?.StatusDescription ?? a?.Effects ?? ''),
    level: num(a?.Level ?? a?.AlertLevel),
  })).filter((a) => a.title || a.description);
}

/** One train type's stops and times between two stations. */
export interface MetroTrainRide {
  stopIds: string[];
  stopNames: string[];
  stopOffsetsSec: number[];
  travelTimeSec: number;
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
  coveredStopIds: ReadonlySet<string>; // every station S2STravelTime covers, on any line of this system
  ridesByTrainType?: Record<number, MetroTrainRide>; // when train types differ; a missing type does not make this trip
  ringDirection?: number; // ring line only: TDX Direction of this trip (0 = 順行, ids climbing)
  ringEnd?: { stopId: string; offsetSec: number }; // ring line only: the line's end, if the trip runs across it
}

/** Stops of an all-pairs entry in line order: the order its first station lists them. */
function allPairsStops(entry: MetroLineTimes, nameOf: (n: BiName) => string) {
  const first = entry.segments[0].fromId;
  const ids = [first];
  const names: Record<string, string> = { [first]: nameOf(entry.segments[0].fromName) };
  for (const s of entry.segments) {
    if (s.fromId !== first || names[s.toId] !== undefined) continue;
    ids.push(s.toId);
    names[s.toId] = nameOf(s.toName);
  }
  return { ids, names };
}

/** One all-pairs entry's ride between two of its stops, read from the origin's own rows. */
function allPairsRide(
  entry: MetroLineTimes,
  originId: string,
  destId: string,
  nameOf: (n: BiName) => string,
): MetroTrainRide | null {
  const { ids, names } = allPairsStops(entry, nameOf);
  const oi = ids.indexOf(originId);
  const di = ids.indexOf(destId);
  if (oi === -1 || di === -1) return null;
  const secTo = new Map<string, number>();
  for (const s of entry.segments) {
    if (s.fromId === originId) secTo.set(s.toId, Math.min(secTo.get(s.toId) ?? Infinity, s.runTime));
  }
  const stopIds = oi <= di ? ids.slice(oi, di + 1) : ids.slice(di, oi + 1).reverse();
  const offsets = stopIds.map((id) => (id === originId ? 0 : secTo.get(id)));
  if (!offsets.every((o): o is number => o !== undefined)) return null;
  return {
    stopIds,
    stopNames: stopIds.map((id) => names[id] || ''),
    stopOffsetsSec: offsets,
    travelTimeSec: offsets[offsets.length - 1],
  };
}

/**
 * The journey over an all-pairs S2STravelTime entry (桃園機捷, 高雄輕軌): one row per station
 * pair, each RunTime cumulative and already including dwell, so rows must be read, never
 * summed. Train types get an entry each on 桃園機捷, so each keeps its own stops and times.
 * A self-loop row (C1→C1, once round) marks a ring, which has a row for each way round per
 * pair: there a trip takes the shorter way, summing adjacent steps, and every train is signed
 * to one terminus, so only Direction tells the two ways apart.
 */
function allPairsJourney(
  lines: MetroLineTimes[],
  line: MetroLineTimes,
  originId: string,
  destId: string,
  nameOf: (n: BiName) => string,
  coveredStopIds: ReadonlySet<string>,
): SameLineJourney | null {
  const { ids, names } = allPairsStops(line, nameOf);
  const oi = ids.indexOf(originId);
  const di = ids.indexOf(destId);
  if (oi === -1 || di === -1) return null;

  const sameLine = lines.filter((l) => l.lineId === line.lineId);
  const journey = (ride: MetroTrainRide, lineStopIds: string[], terminusId: string): SameLineJourney => ({
    lineId: line.lineId,
    ...ride,
    lineStopIds,
    originIndex: lineStopIds.indexOf(originId),
    destIndex: lineStopIds.indexOf(destId),
    directionTerminusId: terminusId,
    directionTerminusName: names[terminusId] || '',
    coveredStopIds,
  });

  if (!sameLine.some((l) => l.segments.some((s) => s.fromId === s.toId))) {
    const ride = allPairsRide(line, originId, destId, nameOf);
    if (!ride) return null;
    const rides: Record<number, MetroTrainRide> = {};
    for (const l of sameLine) {
      const r = l.trainType === undefined ? null : allPairsRide(l, originId, destId, nameOf);
      if (r) rides[l.trainType!] = r;
    }
    return {
      ...journey(ride, ids, oi <= di ? ids[ids.length - 1] : ids[0]),
      ...(Object.keys(rides).length > 0 ? { ridesByTrainType: rides } : {}),
    };
  }

  const fastest = new Map<string, number>();
  for (const l of sameLine) {
    for (const s of l.segments) {
      const key = `${s.fromId}>${s.toId}`;
      fastest.set(key, Math.min(fastest.get(key) ?? Infinity, s.runTime));
    }
  }
  const walk = (step: number) => {
    const stopIds = [originId];
    const offsets = [0];
    for (let i = oi; i !== di;) {
      const next = (i + step + ids.length) % ids.length;
      const sec = fastest.get(`${ids[i]}>${ids[next]}`);
      if (sec === undefined) return null;
      stopIds.push(ids[next]);
      offsets.push(offsets[offsets.length - 1] + sec);
      i = next;
    }
    return { stopIds, offsets, direction: step === 1 ? 0 : 1 };
  };
  const ways = [walk(1), walk(-1)].filter((w) => w !== null);
  if (ways.length === 0) return null;
  const way = ways.reduce((a, b) => (b.offsets[b.offsets.length - 1] < a.offsets[a.offsets.length - 1] ? b : a));
  const first = ids[0];
  const endAt = way.stopIds.indexOf(first);
  const crossesEnd = endAt > 0 && endAt < way.stopIds.length - 1;
  const ride: MetroTrainRide = {
    stopIds: way.stopIds,
    stopNames: way.stopIds.map((id) => names[id] || ''),
    stopOffsetsSec: way.offsets,
    travelTimeSec: way.offsets[way.offsets.length - 1],
  };
  return {
    // A ring has no far end: the line, for this trip, is the way round it takes.
    ...journey(ride, way.stopIds, destId),
    ringDirection: way.direction,
    ...(crossesEnd ? { ringEnd: { stopId: first, offsetSec: way.offsets[endAt] } } : {}),
  };
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
  const coveredStopIds = new Set(lines.flatMap((l) => l.segments.flatMap((s) => [s.fromId, s.toId])));
  for (const line of lines) {
    if (!line.segments.length) continue;
    if (line.segments.some((s, i) => i > 0 && line.segments[i - 1].toId !== s.fromId)) {
      const j = allPairsJourney(lines, line, originId, destId, nameOf, coveredStopIds);
      if (j) return j;
      continue;
    }
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
      coveredStopIds,
    };
  }
  return null;
}

/** TDX Metro StationTimeTable TrainType → display label. Only 桃園機捷 sets it: 1 普通, 2 直達. */
export function metroTrainTypeLabel(trainType: number, zh: boolean): string {
  switch (trainType) {
    case 2: return zh ? '直達' : 'Express';
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
  arrivalTime: string;   // departureTime + rideSec
  rideSec: number;       // this train's time to the destination
  trainType: number;     // see metroTrainTypeLabel
  destName: string;      // direction terminus name
  destId: string;        // direction terminus id
  seq: number;
  trainNo?: string;      // optional train identifier
  crowdedness?: number[]; // [1..4] levels per car
}

/** "HH:MM" on the service day: past-midnight times count after the evening's. */
const serviceMin = (hhmm: string) => {
  const min = hhmmToMin(hhmm);
  return min < 180 ? min + 1440 : min;
};

const stationPrefix = (id: string) => /^[A-Za-z]+/.exec(id)?.[0] ?? '';
const stationNumber = (id: string) => Number(/\d+/.exec(id)?.[0] ?? NaN);

/**
 * Whether a train's terminus sits past the end of the line the journey travels toward: a
 * newly opened station S2STravelTime has not caught up with (R01 廣慈/奉天宮 beyond R02 象山),
 * so every train bound there would otherwise have no direction. Only a station S2STravelTime
 * covers nowhere qualifies: O54 蘆洲 numbers higher than O21 迴龍, but it is a real branch.
 */
function isPastLineEnd(destId: string, journey: SameLineJourney): boolean {
  if (journey.coveredStopIds.has(destId)) return false;
  const { lineStopIds, directionTerminusId: end } = journey;
  const otherEnd = end === lineStopIds[0] ? lineStopIds[lineStopIds.length - 1] : lineStopIds[0];
  if (stationPrefix(destId) !== stationPrefix(end)) return false;
  const outward = Math.sign(stationNumber(end) - stationNumber(otherEnd));
  return outward !== 0 && Math.sign(stationNumber(destId) - stationNumber(end)) === outward;
}

/**
 * Shape a station's static timetable (array from /data/metro_<sys>/<origin>.json)
 * into the upcoming departures heading toward the trip destination.
 * Direction filter uses the journey's line ordering; falls back to terminus-name
 * match, then isPastLineEnd, when the timetable terminus id is not on that ordering.
 * A ring line signs every train to one terminus, so there Direction decides, and the card
 * names the rider's stop: 「往籬仔內」 would read the same both ways round.
 * Only today's service day (Taipei calendar) is used.
 * Source field `DestinationStaionID` is mis-spelled in TDX data — read both.
 */
export function buildMetroDepartures(
  rawStationTimetable: any[],
  journey: SameLineJourney,
  zh: boolean,
  nowHHMM: string,
  weekday: number = taiwanWeekdayIndex(taiwanDateString()) ?? 0,
): MetroDeparture[] {
  const forward = journey.destIndex >= journey.originIndex;
  const out: MetroDeparture[] = [];
  for (const t of (rawStationTimetable ?? [])) {
    if (!metroServesWeekday(t, weekday)) continue;
    const destId = String(t?.DestinationStationID ?? t?.DestinationStaionID ?? '');
    const destName =
      (zh ? t?.DestinationStationName?.Zh_tw : t?.DestinationStationName?.En) ||
      t?.DestinationStationName?.Zh_tw || '';
    const termIdx = journey.lineStopIds.indexOf(destId);
    const headingRight = journey.ringDirection !== undefined
      ? t?.Direction === journey.ringDirection
      : termIdx !== -1
        ? (forward ? termIdx >= journey.destIndex : termIdx <= journey.destIndex)
        : (destName !== '' && destName === journey.directionTerminusName) || isPastLineEnd(destId, journey);
    if (!headingRight) continue;
    for (const d of (t?.Timetables ?? [])) {
      const trainType = typeof d.TrainType === 'number' ? d.TrainType : 0;
      const ride = journey.ridesByTrainType ? journey.ridesByTrainType[trainType] : journey;
      if (!ride) continue; // this train type does not stop at both ends
      out.push({
        departureTime: d.DepartureTime,
        arrivalTime: addMinutesToHHMM(d.DepartureTime, ride.travelTimeSec),
        rideSec: ride.travelTimeSec,
        trainType,
        destName: journey.ringDirection === undefined ? destName : journey.directionTerminusName,
        destId,
        seq: d.Sequence,
      });
    }
  }
  return out
    .filter(d => d.departureTime >= nowHHMM)
    .sort((a, b) => a.departureTime.localeCompare(b.departureTime));
}

/**
 * A ring trip across the line's end needs its train to carry on, but trains stop running
 * through once the end has seen its last departure that way (C1 last leaves 順行 at 22:35
 * while C37 still has trains until 24:00, all ending at C1). `ringEndTimetable` is the end
 * station's file; without one the list stays as it is.
 */
export function keepRingContinuations(
  departures: MetroDeparture[],
  journey: SameLineJourney,
  ringEndTimetable: any[],
  weekday: number = taiwanWeekdayIndex(taiwanDateString()) ?? 0,
): MetroDeparture[] {
  if (!journey.ringEnd) return departures;
  const lastFromEnd = (ringEndTimetable ?? [])
    .filter((t) => t?.Direction === journey.ringDirection && metroServesWeekday(t, weekday))
    .flatMap((t) => (t?.Timetables ?? []).map((d: any) => serviceMin(d.DepartureTime)));
  if (lastFromEnd.length === 0) return departures;
  const last = Math.max(...lastFromEnd);
  const toEndMin = journey.ringEnd.offsetSec / 60;
  return departures.filter((d) => serviceMin(d.departureTime) + toEndMin <= last);
}

/** One scheduled run of a multi-leg (transfer) metro trip. */
export interface MetroRouteDepartureLeg {
  departureTime: string | null; // boarding this leg; null = unknown, see buildMetroRouteDepartures
  arrivalTime: string | null;   // alighting this leg; null with departureTime
  destName: string;      // direction terminus of the train boarded
  trainType: number;
  waitSec: number;       // platform wait after the transfer walk (0 on leg 0)
}
export interface MetroRouteDeparture {
  departureTime: string; // origin boarding time
  arrivalTime: string | null; // final arrival; null when a leg has no clock time
  totalTimeSec: number;  // door to door; without arrivalTime it leaves out the unknown waits
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
 *
 * TDX publishes no StationTimeTable for some lines (文湖線, 台中捷運), so a leg can have an
 * empty `legTimetables[k]`. Its ride and walk are still real, but the train is not: that leg
 * has null clock times, and so does every later one, because which train connects is
 * unknown. A first leg without a timetable has no departure to list, so it returns [].
 */
export function buildMetroRouteDepartures(
  legTimetables: any[][],
  legJourneys: SameLineJourney[],
  transferWalkSec: number[],
  zh: boolean,
  nowHHMM: string,
  limit = 30,
  weekday?: number,
): MetroRouteDeparture[] {
  if (!legJourneys.length || legTimetables.length !== legJourneys.length) return [];
  const untimed = legTimetables.map((t) => !t?.length);
  if (untimed[0]) return [];
  const perLegAll = legJourneys.map((lj, k) =>
    buildMetroDepartures(legTimetables[k], lj, zh, k === 0 ? nowHHMM : '00:00', weekday));
  if (perLegAll.some((deps, k) => !untimed[k] && deps.length === 0)) return [];

  const out: MetroRouteDeparture[] = [];
  for (const d0 of perLegAll[0].slice(0, limit)) {
    let lastArrival = addMinutesToHHMM(d0.departureTime, legJourneys[0].travelTimeSec);
    let elapsedSec = legJourneys[0].travelTimeSec;
    let clockLost = false;
    const legs: MetroRouteDepartureLeg[] = [{
      departureTime: d0.departureTime,
      arrivalTime: lastArrival,
      destName: d0.destName,
      trainType: d0.trainType,
      waitSec: 0,
    }];
    let ok = true;
    for (let k = 1; k < legJourneys.length; k++) {
      const walkSec = transferWalkSec[k - 1] ?? 0;
      clockLost = clockLost || untimed[k];
      if (clockLost) {
        elapsedSec += walkSec + legJourneys[k].travelTimeSec;
        legs.push({
          departureTime: null,
          arrivalTime: null,
          destName: legJourneys[k].directionTerminusName,
          trainType: 0,
          waitSec: 0,
        });
        continue;
      }
      const ready = addMinutesToHHMM(lastArrival, walkSec);
      if (hhmmToMin(ready) < hhmmToMin(lastArrival)) { ok = false; break; } // wrapped midnight
      const next = perLegAll[k].find((d) => d.departureTime >= ready);
      if (!next) { ok = false; break; }
      const waitSec = (hhmmToMin(next.departureTime) - hhmmToMin(ready)) * 60;
      lastArrival = addMinutesToHHMM(next.departureTime, legJourneys[k].travelTimeSec);
      elapsedSec += walkSec + waitSec + legJourneys[k].travelTimeSec;
      legs.push({
        departureTime: next.departureTime,
        arrivalTime: lastArrival,
        destName: next.destName,
        trainType: next.trainType,
        waitSec,
      });
    }
    if (!ok) continue;
    out.push({
      departureTime: d0.departureTime,
      arrivalTime: clockLost ? null : lastArrival,
      totalTimeSec: clockLost
        ? elapsedSec
        : ((hhmmToMin(lastArrival) - hhmmToMin(d0.departureTime) + 1440) % 1440) * 60,
      legs,
      seq: out.length,
    });
  }
  return out;
}

export interface MetroHeadway { minMins: number; maxMins: number }

/**
 * Published headways, for lines with no StationTimeTable (文湖線, 台中捷運). Snapshot only:
 * a missing file means no headway line, not a live call on every search.
 */
const _frequencyCache = new Map<string, any[]>();
export async function getMetroFrequency(system: string): Promise<any[]> {
  if (_frequencyCache.has(system)) return _frequencyCache.get(system)!;
  const raw = await loadMetroStatic<any>(system, 'frequency');
  const rows: any[] = Array.isArray(raw) ? raw : [];
  _frequencyCache.set(system, rows);
  return rows;
}

/** The headway published for a line right now, or null outside every window (`lineId` as in S2STravelTime). */
export function metroHeadwayAt(rows: any[], lineId: string, weekday: number, nowMin: number): MetroHeadway | null {
  for (const row of rows) {
    if (row?.LineNo !== lineId && row?.LineID !== lineId) continue;
    if (!metroServesWeekday(row, weekday)) continue;
    for (const h of row?.Headways ?? []) {
      const start = hhmmToMin(h.StartTime);
      const end = hhmmToMin(h.EndTime);
      if (nowMin >= start && nowMin < (end <= start ? end + 1440 : end)) {
        return { minMins: h.MinHeadwayMins, maxMins: h.MaxHeadwayMins };
      }
    }
  }
  return null;
}

/**
 * 新北捷運's lines meet only through 台北捷運 (三鶯線 and 環狀線 share no station), so a trip
 * between them routes over the partner's lines as well. One-way: a 台北捷運 search stays inside
 * 台北捷運, because the station picker keeps both ends in one system.
 */
const METRO_PARTNER_SYSTEM: Record<string, string> = { NTMC: 'TRTC' };
export const metroPartnerSystem = (system: string): string | undefined => METRO_PARTNER_SYSTEM[system];

/** The system a line belongs to, when a route borrows a partner's lines. */
export function metroLineOwner(system: string, lineCode: string): string {
  const partner = metroPartnerSystem(system);
  return partner && !METRO_LINE_COLORS[system]?.[lineCode] && METRO_LINE_COLORS[partner]?.[lineCode] ? partner : system;
}

export const METRO_TRANSFER_FALLBACK_SEC = 240;

export interface MetroTransferEdge {
  fromId: string; fromName: BiName;
  toId: string; toName: BiName;
  fromLineId: string; toLineId: string; // line you transfer from → to (for badges)
  fromLineName: BiName; toLineName: BiName; // human line names as published by TDX
  transferTimeSec: number;
}

const _transferCache = new Map<string, MetroTransferEdge[]>();
export async function getMetroLineTransfer(system: string): Promise<MetroTransferEdge[]> {
  if (_transferCache.has(system)) return _transferCache.get(system)!;
  let raw: any = await loadMetroStatic(system, 'transfers');
  if (raw == null && TDX_ENDPOINT_SYSTEMS.LineTransfer.has(system)) raw = await fetchTDXApi<any>(`${METRO_BASE}/LineTransfer/${system}?$format=JSON`);
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
      fromLineName: t?.FromLineName ?? {},
      toLineName: t?.ToLineName ?? {},
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
/** Raw per-station rows of TDX Metro `StationTransfer`, shared (and cached once)
 * by `getMetroStationTransfer` (rail hand-offs) and `getMetroStationDetail`
 * (amenities) so the file is fetched and unwrapped in exactly one place. */
const _stationTransferRawCache = new Map<string, any[]>();
async function loadStationTransferRaw(system: string): Promise<any[]> {
  if (_stationTransferRawCache.has(system)) return _stationTransferRawCache.get(system)!;
  let raw: any = await loadMetroStatic(system, 'stationtransfer');
  if (raw == null && TDX_ENDPOINT_SYSTEMS.StationTransfer.has(system)) {
    try { raw = await fetchTDXApi<any>(`${METRO_BASE}/StationTransfer/${system}?$format=JSON`); }
    catch { raw = []; }
  }
  const arr: any[] = Array.isArray(raw) ? raw : (raw?.StationTransfers ?? raw?.TransferInfos ?? []);
  _stationTransferRawCache.set(system, arr);
  return arr;
}

const _stationTransferCache = new Map<string, MetroStationTransferInfo[]>();
export async function getMetroStationTransfer(system: string): Promise<MetroStationTransferInfo[]> {
  if (_stationTransferCache.has(system)) return _stationTransferCache.get(system)!;
  const arr = await loadStationTransferRaw(system);
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

/** Rail operator codes seen in transfer data → short display label. */
const METRO_OPERATOR_LABELS: Record<string, [string, string]> = {
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

/** Pick the display string for a bilingual name, preferring the UI language. */
export function biName(n: BiName | undefined, zh: boolean): string {
  if (!n) return '';
  return (zh ? (n.Zh_tw || n.En) : (n.En || n.Zh_tw)) || '';
}

/**
 * Official line names per system for line codes that never appear in that
 * system's LineTransfer data (single-line systems have no in-system transfers,
 * and KRTC's feed omits English). Line codes collide across systems (TRTC
 * G=松山新店線 vs TMRT G=綠線), hence the per-system keying.
 */
const LINE_TRTC_CIRCULAR: [string, string] = ['環狀線', 'Circular Line'];
const LINE_KRTC_RED: [string, string] = ['紅線', 'Red Line'];
const LINE_KRTC_ORANGE: [string, string] = ['橘線', 'Orange Line'];
const LINE_KLRT_CIRCULAR: [string, string] = ['環狀輕軌', 'Circular Light Rail'];
const METRO_LINE_NAME_FALLBACK: Record<string, Record<string, [string, string]>> = {
  TRTC: {
    BR: ['文湖線', 'Wenhu Line'],
    R: ['淡水信義線', 'Tamsui-Xinyi Line'],
    G: ['松山新店線', 'Songshan-Xindian Line'],
    O: ['中和新蘆線', 'Zhonghe-Xinlu Line'],
    BL: ['板南線', 'Bannan Line'],
    Y: LINE_TRTC_CIRCULAR,
  },
  NTMC: {
    Y: LINE_TRTC_CIRCULAR,
  },
  TYMC: {
    A: ['機場線', 'Airport MRT Line'],
  },
  TMRT: {
    G: ['綠線', 'Green Line'],
  },
  KRTC: {
    R: LINE_KRTC_RED,
    O: LINE_KRTC_ORANGE,
    C: LINE_KLRT_CIRCULAR,
  },
  KLRT: {
    C: LINE_KLRT_CIRCULAR,
    R: LINE_KRTC_RED,
    O: LINE_KRTC_ORANGE,
  },
  NTDLRT: {
    V: METRO_OPERATOR_LABELS.NTDLRT,
  },
};

/**
 * Human-readable name for a line/operator code shown on transfer badges, leg
 * chips and the transfer popup — never the raw code when a name is known.
 * Resolution order per language: operator code label (cross-system hand-offs
 * like TRA/THSR) → name published in this system's LineTransfer data
 * (`dynamic`, built from `MetroTransferEdge.from/toLineName`) → per-system
 * static fallback → the raw code.
 */
export function metroLineLabel(system: string, code: string, zh: boolean, dynamic?: Map<string, BiName>): string {
  if (!code) return '';
  const op = METRO_OPERATOR_LABELS[code];
  if (op) return zh ? op[0] : op[1];
  const dyn = dynamic?.get(code);
  const fb = METRO_LINE_NAME_FALLBACK[system]?.[code];
  const name = zh
    ? (dyn?.Zh_tw ?? fb?.[0])
    : (dyn?.En ?? fb?.[1] ?? dyn?.Zh_tw ?? fb?.[0]);
  return name || code;
}

/**
 * Line code a station belongs to, taken from the letter prefix of its
 * StationID (BL12 → BL, R22A → R, C7 → C). Metro StationIDs are line-scoped by
 * construction — an interchange like 台北車站 exists twice, as BL12 and R10 —
 * so the prefix is a reliable grouping key and needs no extra TDX call.
 *
 * `EXTENSION_PREFIXES` folds branch/extension prefixes back into their parent
 * line (KRTC RK1 岡山車站 is the 紅線 岡山路竹延伸線; OT1 大寮 is the 橘線), which
 * TDX numbers separately but riders read as one line.
 */
const EXTENSION_PREFIXES: Record<string, Record<string, string>> = {
  KRTC: { RK: 'R', OT: 'O' },
};
export function metroLineCodeOf(system: string, stationId: string): string {
  const raw = (stationId.match(/^[A-Za-z]+/)?.[0] ?? '').toUpperCase();
  return EXTENSION_PREFIXES[system]?.[raw] ?? raw;
}

/**
 * Display order of lines within a system, mirroring the operator's own route
 * map / line numbering (北捷 文湖→淡水信義→松山新店→中和新蘆→板南→環狀). Codes not
 * listed sort after these, alphabetically.
 */
const METRO_LINE_ORDER: Record<string, string[]> = {
  TRTC: ['BR', 'R', 'G', 'O', 'BL', 'Y'],
  NTMC: ['Y', 'K'],
  KRTC: ['R', 'O', 'C'],
};

/**
 * Line identity colours, used only as a scanning aid in the station picker
 * (colour dot / left edge) — never as the sole carrier of meaning, so every
 * swatch is paired with the line's name. Unknown codes fall back to slate.
 */
const METRO_LINE_COLORS: Record<string, Record<string, string>> = {
  TRTC: { BR: '#c48c31', R: '#e3002c', G: '#008659', O: '#f8b61c', BL: '#0070bd', Y: '#ffdb00' },
  NTMC: { Y: '#ffdb00', K: '#b07f4a' },
  TYMC: { A: '#8246af' },
  TMRT: { G: '#97d700' },
  KRTC: { R: '#e60012', O: '#f39800', C: '#8fc31f' },
  KLRT: { C: '#8fc31f' },
  NTDLRT: { V: '#00a0a0' },
};
export function metroLineColor(system: string, code: string): string {
  return METRO_LINE_COLORS[system]?.[code] ?? '#64748b';
}

/**
 * Ink colour that stays readable on a line colour used as a fill — 環狀線's
 * yellow needs dark text where 板南線's blue needs white. Relative luminance
 * per WCAG, thresholded where the contrast ratio against both candidates is
 * comfortably above 4.5:1.
 */
export function metroLineInkColor(system: string, code: string): string {
  const hex = metroLineColor(system, code).replace('#', '');
  const ch = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
  return luminance > 0.4 ? '#0f172a' : '#ffffff';
}

/**
 * Sort key for a station within its line: numeric part first, then any letter
 * suffix (R22 → R22A → R23), then the raw prefix so folded extensions
 * (KRTC RK1) land after the parent line's own stations rather than at its head.
 */
function stationSeqKey(system: string, stationId: string): [number, number, string] {
  const raw = (stationId.match(/^[A-Za-z]+/)?.[0] ?? '').toUpperCase();
  const isExtension = EXTENSION_PREFIXES[system]?.[raw] ? 1 : 0;
  const n = Number(stationId.match(/\d+/)?.[0] ?? '0');
  const suffix = stationId.replace(/^[A-Za-z]*\d+/, '');
  return [isExtension, Number.isFinite(n) ? n : 0, suffix];
}

/** Running order of two stations on the same line by StationID (R22 < R22A < R23; KRTC RK1 after R24). */
export function compareMetroStationIds(system: string, a: string, b: string): number {
  const ka = stationSeqKey(system, a);
  const kb = stationSeqKey(system, b);
  return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
}

export interface MetroLineGroup {
  /** Line code (BL, R, …) — feed to `metroLineLabel` / `metroLineColor`. */
  code: string;
  /** Stations in running order, first terminus → last terminus. */
  stations: MetroStation[];
}

/**
 * Group a system's stations into lines, each ordered along the line rather
 * than by name or ID string. This is what makes the picker scannable: riders
 * look for a station by where it sits on the line, the same way they read the
 * map hanging in the concourse.
 */
export function groupMetroStationsByLine(system: string, stations: MetroStation[]): MetroLineGroup[] {
  const byLine = new Map<string, MetroStation[]>();
  for (const s of stations) {
    const code = metroLineCodeOf(system, s.StationID);
    if (!code) continue;
    const bucket = byLine.get(code);
    if (bucket) bucket.push(s);
    else byLine.set(code, [s]);
  }
  const order = METRO_LINE_ORDER[system] ?? [];
  const rank = (code: string) => {
    const i = order.indexOf(code);
    return i === -1 ? order.length : i;
  };
  return [...byLine.entries()]
    .map(([code, list]) => ({
      code,
      stations: list.sort((a, b) => {
        const ka = stationSeqKey(system, a.StationID);
        const kb = stationSeqKey(system, b.StationID);
        return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
      }),
    }))
    .sort((a, b) => rank(a.code) - rank(b.code) || a.code.localeCompare(b.code));
}

/**
 * Per-station non-rail transfer amenities from TDX Metro `StationTransfer`
 * (published for TRTC and TYMC only): interior map links, YouBike / parking /
 * bus / airport hand-offs. Rail hand-offs from the same file are already
 * flattened by `getMetroStationTransfer`. Everything is passed through
 * verbatim from TDX — nothing synthesized — so absent systems simply yield an
 * empty map. `Description` on bike/parking rows is sometimes a URL; it is
 * split into `url` vs `note` so the UI can render a link or plain text.
 */
export interface MetroStationDetail {
  stationId: string;
  interiorMaps: { name: BiName; url: string }[];
  bikes: { name: BiName; floor: string; url: string; note: string }[];
  parkings: { name: BiName; floor: string; url: string; note: string }[];
  buses: { routeName: BiName; destination: string; operator: BiName }[];
  airports: { name: BiName; floor: string; note: string }[];
}
const _stationDetailCache = new Map<string, Map<string, MetroStationDetail>>();
export async function getMetroStationDetail(system: string): Promise<Map<string, MetroStationDetail>> {
  if (_stationDetailCache.has(system)) return _stationDetailCache.get(system)!;
  const arr = await loadStationTransferRaw(system);
  const out = new Map<string, MetroStationDetail>();
  const splitDesc = (v: any): { url: string; note: string } => {
    const s = typeof v === 'string' ? v.trim() : '';
    return /^https?:\/\//i.test(s) ? { url: s, note: '' } : { url: '', note: s };
  };
  for (const t of arr) {
    const stationId = String(t?.StationID ?? t?.StationId ?? '');
    if (!stationId) continue;
    const d: MetroStationDetail = {
      stationId,
      interiorMaps: (Array.isArray(t?.InteriorMapURLs) ? t.InteriorMapURLs : [])
        .filter((m: any) => typeof m?.MapURL === 'string' && /^https?:\/\//i.test(m.MapURL))
        .map((m: any) => ({ name: m?.MapName ?? {}, url: String(m.MapURL) })),
      bikes: [], parkings: [], buses: [], airports: [],
    };
    const busSeen = new Set<string>();
    for (const g of (Array.isArray(t?.Transfers) ? t.Transfers : [])) {
      for (const b of (Array.isArray(g?.BikeTransfers) ? g.BikeTransfers : [])) {
        d.bikes.push({ name: b?.OperatorName ?? {}, floor: text(b?.FloorLevel ?? ''), ...splitDesc(b?.Description) });
      }
      for (const p of (Array.isArray(g?.ParkingTransfers) ? g.ParkingTransfers : [])) {
        d.parkings.push({ name: p?.CarParkName ?? {}, floor: text(p?.FloorLevel ?? ''), ...splitDesc(p?.Description) });
      }
      for (const b of (Array.isArray(g?.BusTransfers) ? g.BusTransfers : [])) {
        const key = `${text(b?.RouteName ?? '')}|${text(b?.Destination ?? '')}`;
        if (key === '|' || busSeen.has(key)) continue;
        busSeen.add(key);
        d.buses.push({ routeName: b?.RouteName ?? {}, destination: text(b?.Destination ?? ''), operator: b?.OperatorName ?? {} });
      }
      for (const a of (Array.isArray(g?.AirportTransfers) ? g.AirportTransfers : [])) {
        d.airports.push({ name: a?.AirportName ?? a?.OperatorName ?? {}, floor: text(a?.FloorLevel ?? ''), note: typeof a?.Description === 'string' ? a.Description : '' });
      }
    }
    out.set(stationId, d);
  }
  _stationDetailCache.set(system, out);
  return out;
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
/**
 * Systems TDX publishes no StationPlatform for, covered by a hand-maintained table instead
 * (`scripts/build-trtc-platforms.mjs` → `platforms-manual.json`). Its DestinationStationID is
 * the next station, not the terminus — consumers must match on direction, not terminus id.
 */
const MANUAL_PLATFORM_SYSTEMS = new Set(['TRTC']);
export async function getMetroStationPlatform(system: string): Promise<MetroPlatform[]> {
  if (_platformCache.has(system)) return _platformCache.get(system)!;
  let raw: any = await loadMetroStatic(system, 'platforms');
  if (raw == null && MANUAL_PLATFORM_SYSTEMS.has(system)) raw = await loadMetroStatic(system, 'platforms-manual');
  if (raw == null && TDX_ENDPOINT_SYSTEMS.StationPlatform.has(system)) {
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
export interface MetroRouteTransfer {
  stationName: string;
  transferTimeSec: number;
  /**
   * A change of trains on the same line at a branch junction (大橋頭, 北投, 七張): no
   * LineTransfer walk, but still a transfer — no train runs 迴龍 → 蘆洲 or 新北投 → 淡水.
   */
  sameLine?: boolean;
}
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

  // Which service patterns (S2STravelTime entries) run each segment. A branch line is
  // several entries under one lineId — 中和新蘆線 is 迴龍→南勢角 and 蘆洲→南勢角 — so a leg
  // may only continue while one entry covers every segment so far; otherwise the rider
  // changes trains at the junction even though the line colour never changes.
  const segKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const patternsOf = new Map<string, Set<number>>();
  lines.forEach((line, idx) => {
    for (const s of line.segments) {
      const k = segKey(s.fromId, s.toId);
      const set = patternsOf.get(k) ?? new Set<number>();
      set.add(idx);
      patternsOf.set(k, set);
    }
  });

  const legs: MetroRouteLeg[] = [];
  const transfersOut: MetroRouteTransfer[] = [];
  let totalTimeSec = 0;
  let pendingTransferSec = 0;
  let pendingTransferStation = '';
  let pendingBranchStation = '';
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
      if (legs.length > 0) {
        if (pendingBranchStation) {
          transfersOut.push({ stationName: pendingBranchStation, transferTimeSec: 0, sameLine: true });
        } else if (pendingTransferSec > 0) {
          transfersOut.push({ stationName: pendingTransferStation, transferTimeSec: pendingTransferSec });
        }
      }
      pendingTransferSec = 0;
      pendingBranchStation = '';
      let rideTimeSec = 0;
      const stopIds: string[] = [pathNodes[i]];
      const stopOffsetsSec: number[] = [0];
      let covering: Set<number> | null = null;
      while (i < pathEdges.length && pathEdges[i] === lineId) {
        const here = patternsOf.get(segKey(pathNodes[i], pathNodes[i + 1])) ?? new Set<number>();
        const next: Set<number> = covering === null ? new Set(here) : new Set([...covering].filter((x) => here.has(x)));
        if (covering !== null && next.size === 0) {
          // No single train runs through here: end the leg at this junction.
          pendingBranchStation = nodeName.get(pathNodes[i]) || '';
          break;
        }
        covering = next;
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
