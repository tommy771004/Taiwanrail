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
  const url = `${METRO_BASE}/Station/${system}?$format=JSON`;
  const raw = await fetchTDXApi<any>(url);
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
  const url = `${METRO_BASE}/S2STravelTime/${system}?$format=JSON`;
  const raw = await fetchTDXApi<any>(url);
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
