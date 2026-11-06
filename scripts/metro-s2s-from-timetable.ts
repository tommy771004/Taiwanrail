import fs from 'fs/promises';
import path from 'path';

/**
 * TDX has no S2STravelTime for 淡海輕軌 (`NTDLRT` is "not accepted", 400), which left that system
 * with no journey, route or arrival time at all. Its station timetables are published, so the
 * run times are read off them: follow one route's trains from the first stop and take the
 * median departure offset at each later stop. Offsets stay cumulative from the first stop, so
 * whole-minute timetables do not stack a rounding error per stop. Written in the S2STravelTime
 * shape to public/data/metro_<sys>/s2s.json, using the snapshotted `stationofroute.json`.
 */
interface RouteStop { StationID: string; StationName: unknown }
interface Route { LineID: string; RouteID: string; Direction: number; Stations: RouteStop[] }

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

export function deriveS2SFromTimetables(routes: Route[], timetableOf: (stationId: string) => any[]) {
  const out = [];
  for (const route of routes.filter((r) => r.Direction === 0)) {
    // Weekday rows: one service day is enough, and it is the fullest one.
    const timesAt = (stationId: string, direction = route.Direction): number[] => timetableOf(stationId)
      .filter((t) => t.RouteID === route.RouteID && t.Direction === direction && t.ServiceDay?.Monday)
      .flatMap((t) => (t.Timetables ?? []).map((d: any) => toMin(d.DepartureTime)))
      .sort((a: number, b: number) => a - b);
    const firstStop = timesAt(route.Stations[0].StationID);
    const offsets = [0];
    for (const [i, stop] of route.Stations.slice(1).entries()) {
      const here = timesAt(stop.StationID);
      const previous = offsets[offsets.length - 1];
      if (here.length === 0 && i === route.Stations.length - 2) {
        // A terminus lists no departures toward itself, so time the last stretch coming back.
        const back = timesAt(route.Stations[i].StationID, 1 - route.Direction);
        const gaps = timesAt(stop.StationID, 1 - route.Direction).flatMap((t) => {
          const reached = back.find((x) => x >= t);
          return reached === undefined ? [] : [reached - t];
        });
        if (gaps.length > 0) offsets.push(previous + median(gaps));
        break;
      }
      const gaps = firstStop.flatMap((t) => {
        const reached = here.find((x) => x >= t + previous);
        return reached === undefined ? [] : [reached - t];
      });
      if (gaps.length === 0) break;
      offsets.push(median(gaps));
    }
    if (offsets.length !== route.Stations.length) {
      throw new Error(`${route.RouteID}: no timetable from stop ${offsets.length + 1}`);
    }
    out.push({
      LineNo: route.LineID,
      LineID: route.LineID,
      RouteID: route.RouteID,
      TrainType: 0,
      TravelTimes: route.Stations.slice(1).map((stop, i) => ({
        Sequence: i + 1,
        FromStationID: route.Stations[i].StationID,
        FromStationName: route.Stations[i].StationName,
        ToStationID: stop.StationID,
        ToStationName: stop.StationName,
        RunTime: (offsets[i + 1] - offsets[i]) * 60,
        StopTime: 0,
      })),
    });
  }
  return out;
}

export async function writeDerivedS2S(system: string, dataDir: string) {
  const dir = path.join(dataDir, `metro_${system}`);
  const raw = JSON.parse(await fs.readFile(path.join(dir, 'stationofroute.json'), 'utf8'));
  const routes: Route[] = Array.isArray(raw) ? raw : raw.StationOfRoutes ?? [];
  const files = new Map<string, any[]>();
  for (const id of new Set(routes.flatMap((r) => r.Stations.map((s) => s.StationID)))) {
    files.set(id, JSON.parse(await fs.readFile(path.join(dir, `${id}.json`), 'utf8')));
  }
  const lines = deriveS2SFromTimetables(routes, (id) => files.get(id) ?? []);
  await fs.writeFile(path.join(dir, 's2s.json'), JSON.stringify(lines));
  console.log(`✅ Saved ${system}/s2s.json (${lines.length} routes, derived from timetables)`);
}

if (process.argv[1]?.endsWith('metro-s2s-from-timetable.ts')) {
  await writeDerivedS2S(process.argv[2] ?? 'NTDLRT', path.join(process.cwd(), 'public', 'data'));
}
