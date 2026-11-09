/**
 * Encode TDX 市區公車 Route + StopOfRoute replies into the compact per-city file the 公車 tab
 * reads (format and decoder: src/lib/busData.ts). Pure, so the round trip is pinned by
 * scripts/bus-data.test.ts.
 *
 * What is kept: route names and terminals (zh/en), every StopOfRoute record (sub-route ×
 * direction) as a list of stop indexes, each stop's StopUID (the ETA key), and each 站位
 * (StationID) once with its name and position. Everything else TDX sends — operators, fares,
 * address, UpdateTime per row — is dropped; the stop page never shows it.
 */
import { BUS_FILE_VERSION, type BusCityCode, type BusCityFile, type BusPatternRow, type BusRouteRow, type BusStationRow, type BusStopRow } from '../src/lib/busData.js';

type Raw = Record<string, any>;

const zh = (n: any): string => (typeof n?.Zh_tw === 'string' ? n.Zh_tw.trim() : '');
const en = (n: any): string => (typeof n?.En === 'string' ? n.En.trim() : '');
const str = (v: any): string => (typeof v === 'string' ? v.trim() : '');

/** The five cities' stops all sit on Taiwan's main island; anything else is a bad position. */
function validPosition(lat: unknown, lon: unknown): lat is number {
  return typeof lat === 'number' && typeof lon === 'number'
    && lat > 21.8 && lat < 25.4 && lon > 119.9 && lon < 122.1;
}

const round5 = (x: number) => Math.round(x * 1e5) / 1e5;

export interface BusEncodeStats {
  routes: number;
  stations: number;
  stops: number;
  patterns: number;
  /** StopOfRoute records dropped: under two usable stops, or no RouteUID. */
  droppedPatterns: number;
  /** Stops dropped for a missing UID or a position off the island. */
  droppedStops: number;
}

export function encodeBusCity(
  city: BusCityCode,
  routesRaw: readonly Raw[],
  stopOfRouteRaw: readonly Raw[],
  meta: { updated: string; version: number | null },
): { file: BusCityFile; stats: BusEncodeStats } {
  const routeInfo = new Map<string, BusRouteRow>();
  for (const r of routesRaw) {
    const uid = str(r?.RouteUID);
    if (!uid) continue;
    routeInfo.set(uid, [
      uid,
      zh(r.RouteName),
      en(r.RouteName),
      str(r.DepartureStopNameZh),
      str(r.DepartureStopNameEn),
      str(r.DestinationStopNameZh),
      str(r.DestinationStopNameEn),
    ]);
  }

  type Stop = { uid: string; stationKey: string };
  const stationRows = new Map<string, BusStationRow>();
  const stationCand = new Map<string, { uid: string; row: BusStationRow }>();
  const stopRows = new Map<string, Stop>();
  const patterns: { routeUid: string; direction: number; subNameZh: string; stopUids: string[] }[] = [];
  let droppedPatterns = 0;
  let droppedStops = 0;

  for (const p of stopOfRouteRaw) {
    const routeUid = str(p?.RouteUID);
    const stops: Raw[] = Array.isArray(p?.Stops) ? [...p.Stops] : [];
    if (!routeUid) { droppedPatterns++; continue; }
    stops.sort((a, b) => (Number(a?.StopSequence) || 0) - (Number(b?.StopSequence) || 0));
    const uids: string[] = [];
    for (const s of stops) {
      const uid = str(s?.StopUID);
      const lat = s?.StopPosition?.PositionLat;
      const lon = s?.StopPosition?.PositionLon;
      if (!uid || !validPosition(lat, lon)) { droppedStops++; continue; }
      const nameZh = zh(s.StopName);
      const stationId = str(s.StationID);
      // StationID groups the poles of different routes standing at one spot. Without it,
      // the name and position (to about 10 m) stand in.
      const stationKey = stationId ? `id:${stationId}` : `pos:${nameZh}@${(lat as number).toFixed(4)},${(lon as number).toFixed(4)}`;
      // The station's name and position come from its lowest StopUID (so the file does not
      // depend on reply order); an English name missing there is taken from another pole.
      const cand = stationCand.get(stationKey);
      const nameEn = en(s.StopName);
      if (!cand || uid < cand.uid) {
        stationRows.set(stationKey, [nameZh, nameEn || cand?.row[1] || '', round5(lat as number), round5(lon as number)]);
        stationCand.set(stationKey, { uid, row: stationRows.get(stationKey)! });
      } else if (!cand.row[1] && nameEn) {
        cand.row[1] = nameEn;
      }
      if (!stopRows.has(uid)) stopRows.set(uid, { uid, stationKey });
      uids.push(uid);
    }
    if (uids.length < 2) { droppedPatterns++; continue; }
    if (!routeInfo.has(routeUid)) {
      // A StopOfRoute without a Route record still has a name and both ends.
      const first = stationRows.get(stopRows.get(uids[0])!.stationKey)!;
      const last = stationRows.get(stopRows.get(uids[uids.length - 1])!.stationKey)!;
      routeInfo.set(routeUid, [routeUid, zh(p.RouteName), en(p.RouteName), first[0], first[1], last[0], last[1]]);
    }
    const subNameZh = zh(p.SubRouteName);
    const direction = Number.isInteger(p?.Direction) ? p.Direction : 255;
    patterns.push({
      routeUid,
      direction,
      subNameZh: subNameZh && subNameZh !== routeInfo.get(routeUid)![1] ? subNameZh : '',
      stopUids: uids,
    });
  }

  // Stable order, so an unchanged city produces a byte-identical file.
  const routeUids = [...new Set(patterns.map((p) => p.routeUid))].sort();
  const routeIndex = new Map(routeUids.map((u, i) => [u, i]));
  const stationKeys = [...stationRows.keys()].sort();
  const stationIndex = new Map(stationKeys.map((k, i) => [k, i]));
  const stopUids = [...stopRows.keys()].sort();
  const stopIndex = new Map(stopUids.map((u, i) => [u, i]));

  const patternRows: BusPatternRow[] = patterns
    .map((p): BusPatternRow => [routeIndex.get(p.routeUid)!, p.direction, p.subNameZh, p.stopUids.map((u) => stopIndex.get(u)!)])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]) || a[3].length - b[3].length || a[3].join().localeCompare(b[3].join()));

  // Identical records (TDX repeats some per operator) are kept once.
  const seen = new Set<string>();
  const uniquePatterns = patternRows.filter((p) => {
    const k = JSON.stringify(p);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const file: BusCityFile = {
    v: BUS_FILE_VERSION,
    city,
    updated: meta.updated,
    version: meta.version,
    routes: routeUids.map((u) => routeInfo.get(u)!),
    stations: stationKeys.map((k) => stationRows.get(k)!),
    stops: stopUids.map((u): BusStopRow => [u, stationIndex.get(stopRows.get(u)!.stationKey)!]),
    patterns: uniquePatterns,
  };
  return {
    file,
    stats: {
      routes: file.routes.length,
      stations: file.stations.length,
      stops: file.stops.length,
      patterns: file.patterns.length,
      droppedPatterns,
      droppedStops,
    },
  };
}

/** A city file thinner than this is not trusted (a partial or empty TDX reply). */
export const BUS_MIN = { routes: 30, stations: 300, patterns: 60 } as const;

export function isBusFileUsable(stats: BusEncodeStats): boolean {
  return stats.routes >= BUS_MIN.routes && stats.stations >= BUS_MIN.stations && stats.patterns >= BUS_MIN.patterns;
}
