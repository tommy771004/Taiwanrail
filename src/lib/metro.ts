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

export interface MetroFare {
  label: string; // ticket-type label if known
  price: number;
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
const _stationCache = new Map<string, MetroStation[]>();
export async function getMetroStations(system: string): Promise<MetroStation[]> {
  if (_stationCache.has(system)) return _stationCache.get(system)!;
  let raw: any = await loadMetroStatic(system, 'stations');
  if (raw == null) raw = await fetchTDXApi<any>(`${METRO_BASE}/Station/${system}?$format=JSON`);
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
  _stationCache.set(system, out);
  return out;
}

// --- ODFare (exact for any OD, incl. transfers) ---
export async function getMetroODFare(system: string, originId: string, destId: string): Promise<MetroFare[]> {
  const filter = `OriginStationID eq '${originId}' and DestinationStationID eq '${destId}'`;
  const url = `${METRO_BASE}/ODFare/${system}?$filter=${filter}&$format=JSON`;
  const raw = await fetchTDXApi<any>(url);
  const arr: any[] = Array.isArray(raw) ? raw : (raw?.ODFares ?? []);
  const row = arr.find((r) => String(r?.OriginStationID) === originId && String(r?.DestinationStationID) === destId) ?? arr[0];
  const fares: any[] = row?.Fares ?? [];
  return fares
    .map((f) => ({
      label: text(f?.TicketType) || text(f?.Description) || (f?.FareClass != null ? `FareClass ${f.FareClass}` : ''),
      price: num(f?.Price ?? f?.Fare),
    }))
    .filter((f) => f.price > 0);
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

export interface SameLineJourney {
  lineId: string;
  travelTimeSec: number;
  stopNames: string[]; // origin … destination inclusive, in travel order
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
    let travelTimeSec = 0;
    for (let i = lo; i < hi; i++) travelTimeSec += line.segments[i].runTime + line.segments[i].stopTime;
    const slice = ids.slice(lo, hi + 1).map((id) => names[id]).filter(Boolean);
    const forward = oi <= di;
    return {
      lineId: line.lineId,
      travelTimeSec,
      stopNames: forward ? slice : slice.reverse(),
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

export const METRO_TRANSFER_FALLBACK_SEC = 240;

export interface MetroTransferEdge {
  fromId: string; fromName: BiName;
  toId: string; toName: BiName;
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
      transferTimeSec: mins > 0 ? mins * 60 : METRO_TRANSFER_FALLBACK_SEC,
    };
  }).filter((e) => e.fromId && e.toId);
  _transferCache.set(system, out);
  return out;
}

export interface MetroRouteLeg {
  lineId: string;
  fromName: string; toName: string;
  stopNames: string[]; // inclusive, in travel order
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
      while (i < pathEdges.length && pathEdges[i] === lineId) {
        rideTimeSec += edgeWeight(pathNodes[i], pathNodes[i + 1], lineId);
        stopIds.push(pathNodes[i + 1]);
        i++;
      }
      totalTimeSec += rideTimeSec;
      const stopNames = stopIds.map((id) => nodeName.get(id) || '').filter(Boolean);
      legs.push({
        lineId,
        fromName: stopNames[0] || '',
        toName: stopNames[stopNames.length - 1] || '',
        stopNames,
        rideTimeSec,
      });
    }
  }

  if (legs.length === 0) return null;
  return { legs, transfers: transfersOut, totalTimeSec, transferCount: Math.max(0, legs.length - 1) };
}
