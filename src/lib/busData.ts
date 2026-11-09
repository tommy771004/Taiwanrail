/**
 * 公車分頁的靜態資料：每個縣市一份精簡快照（public/data/bus/<City>.json），由
 * scripts/fetch-tdx-bus.ts 從 TDX Route + StopOfRoute 產生（編碼在 scripts/tdx-bus.ts），
 * 這裡解碼成站牌、路線與「地點」（同名、相近的站位合成一個，馬路兩側分開列）。
 *
 * Pure: no DOM, no network. The client fetches the files (src/lib/api.ts) and hands the
 * parsed JSON here. Only static data lives in these files — every minute shown to a rider
 * comes from TDX EstimatedTimeOfArrival (src/lib/busEta.ts), never from here.
 */

export type BusCityCode = 'Taipei' | 'NewTaipei' | 'Taoyuan' | 'Taichung' | 'Kaohsiung';
export type BusRegionCode = 'north' | 'taoyuan' | 'taichung' | 'kaohsiung';

export interface BusCityInfo {
  code: BusCityCode;
  zh: string;
  en: string;
  region: BusRegionCode;
}

export const BUS_CITIES: readonly BusCityInfo[] = [
  { code: 'Taipei', zh: '臺北市', en: 'Taipei', region: 'north' },
  { code: 'NewTaipei', zh: '新北市', en: 'New Taipei', region: 'north' },
  { code: 'Taoyuan', zh: '桃園市', en: 'Taoyuan', region: 'taoyuan' },
  { code: 'Taichung', zh: '臺中市', en: 'Taichung', region: 'taichung' },
  { code: 'Kaohsiung', zh: '高雄市', en: 'Kaohsiung', region: 'kaohsiung' },
];

export interface BusRegionInfo {
  code: BusRegionCode;
  zh: string;
  en: string;
  cities: BusCityCode[];
  /** [minLat, minLon, maxLat, maxLon] of the area the region's routes serve, with a margin. */
  bbox: [number, number, number, number];
}

/**
 * 臺北市與新北市的路線互相跨界（同一個站牌兩市的路線都停），所以兩市一起載入、一起搜尋。
 * The boxes only pick which files to load for a position; a place outside every box simply
 * has no nearby stops, and the rider can still pick a region.
 */
export const BUS_REGIONS: readonly BusRegionInfo[] = [
  { code: 'north', zh: '臺北＋新北', en: 'Taipei + New Taipei', cities: ['Taipei', 'NewTaipei'], bbox: [24.6, 121.25, 25.35, 122.05] },
  { code: 'taoyuan', zh: '桃園', en: 'Taoyuan', cities: ['Taoyuan'], bbox: [24.55, 120.95, 25.15, 121.5] },
  { code: 'taichung', zh: '臺中', en: 'Taichung', cities: ['Taichung'], bbox: [23.95, 120.4, 24.5, 121.5] },
  { code: 'kaohsiung', zh: '高雄', en: 'Kaohsiung', cities: ['Kaohsiung'], bbox: [22.4, 120.1, 23.5, 121.1] },
];

export function busCityInfo(code: string): BusCityInfo | undefined {
  return BUS_CITIES.find((c) => c.code === code);
}

export function busRegionInfo(code: string): BusRegionInfo | undefined {
  return BUS_REGIONS.find((r) => r.code === code);
}

/** Regions whose area contains the point, nearest box centre first. */
export function busRegionsAt(lat: number, lon: number): BusRegionCode[] {
  return BUS_REGIONS
    .filter(({ bbox: [a, b, c, d] }) => lat >= a && lat <= c && lon >= b && lon <= d)
    .map((r) => ({ code: r.code, d: Math.hypot(lat - (r.bbox[0] + r.bbox[2]) / 2, lon - (r.bbox[1] + r.bbox[3]) / 2) }))
    .sort((x, y) => x.d - y.d)
    .map((r) => r.code);
}

// ── file format ─────────────────────────────────────────────────────────────

export const BUS_FILE_VERSION = 1;

/** [RouteUID, 名稱, English, 起站, 起站 En, 迄站, 迄站 En] */
export type BusRouteRow = [string, string, string, string, string, string, string];
/** One 站位 (TDX StationID): [名稱, English, lat, lon] */
export type BusStationRow = [string, string, number, number];
/** [StopUID, index into stations] */
export type BusStopRow = [string, number];
/** One TDX StopOfRoute record (sub-route × direction): [route index, Direction, 附屬路線名 (empty when same as the route), stop indexes in StopSequence order] */
export type BusPatternRow = [number, number, string, number[]];

export interface BusCityFile {
  v: number;
  city: BusCityCode;
  /** TDX DataVersion UpdateTime of the snapshot (ISO8601). */
  updated: string;
  version: number | null;
  routes: BusRouteRow[];
  stations: BusStationRow[];
  stops: BusStopRow[];
  patterns: BusPatternRow[];
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Validate a downloaded city file. Malformed rows are dropped rather than trusted; a file
 * that is not this format at all returns null (the tab then says 無資料).
 */
export function parseBusCityFile(raw: unknown, city: BusCityCode): BusCityFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== BUS_FILE_VERSION || o.city !== city) return null;
  if (![o.routes, o.stations, o.stops, o.patterns].every(Array.isArray)) return null;
  const routes = (o.routes as unknown[]).filter(
    (r): r is BusRouteRow => Array.isArray(r) && r.length === 7 && r.every(isStr) && r[0].length > 0,
  );
  const stations = (o.stations as unknown[]).filter(
    (s): s is BusStationRow => Array.isArray(s) && s.length === 4 && isStr(s[0]) && isStr(s[1]) && isNum(s[2]) && isNum(s[3]),
  );
  // Indexes refer to the arrays as written; a dropped row would shift every later one,
  // so any bad row in an indexed array rejects the whole file.
  if (routes.length !== (o.routes as unknown[]).length || stations.length !== (o.stations as unknown[]).length) return null;
  const stops = (o.stops as unknown[]).filter(
    (s): s is BusStopRow => Array.isArray(s) && s.length === 2 && isStr(s[0]) && Number.isInteger(s[1]) && (s[1] as number) >= 0 && (s[1] as number) < stations.length,
  );
  if (stops.length !== (o.stops as unknown[]).length) return null;
  const patterns = (o.patterns as unknown[]).filter(
    (p): p is BusPatternRow =>
      Array.isArray(p) && p.length === 4 && Number.isInteger(p[0]) && (p[0] as number) >= 0 && (p[0] as number) < routes.length
      && Number.isInteger(p[1]) && isStr(p[2]) && Array.isArray(p[3])
      && (p[3] as unknown[]).every((i) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < stops.length),
  );
  return {
    v: BUS_FILE_VERSION,
    city,
    updated: isStr(o.updated) ? o.updated : '',
    version: isNum(o.version) ? o.version : null,
    routes,
    stations,
    stops,
    patterns,
  };
}

// ── runtime model ───────────────────────────────────────────────────────────

export interface BusStation {
  city: BusCityCode;
  index: number;
  nameZh: string;
  nameEn: string;
  lat: number;
  lon: number;
  /** Every pattern that stops here, with the stop's position in it. */
  visits: { pattern: BusPattern; pos: number }[];
  place: BusPlace | null;
}

export interface BusStopRef {
  city: BusCityCode;
  uid: string;
  station: BusStation;
}

export interface BusRoute {
  /** `${city}|${RouteUID}` — RouteUIDs are authority-prefixed, the city keeps the ETA URL. */
  key: string;
  city: BusCityCode;
  uid: string;
  nameZh: string;
  nameEn: string;
  depZh: string;
  depEn: string;
  destZh: string;
  destEn: string;
  patterns: BusPattern[];
}

export interface BusPattern {
  route: BusRoute;
  direction: number;
  subNameZh: string;
  stops: BusStopRef[];
}

export interface BusPlace {
  id: string;
  nameZh: string;
  nameEn: string;
  lat: number;
  lon: number;
  stations: BusStation[];
  /** Distinct routes that can be boarded here. */
  routeKeys: string[];
}

export interface BusNetwork {
  cities: BusCityCode[];
  /** Newest snapshot time among the cities' files. */
  updated: string;
  routes: BusRoute[];
  routeByKey: Map<string, BusRoute>;
  places: BusPlace[];
  placeById: Map<string, BusPlace>;
}

/** 循環線：Direction 2 (迴圈) / 10 (循環線), or a pattern that ends where it starts. */
export function isLoopPattern(p: BusPattern): boolean {
  if (p.direction === 2 || p.direction === 10) return true;
  const a = p.stops[0]?.station;
  const b = p.stops[p.stops.length - 1]?.station;
  return !!a && !!b && a !== b && a.nameZh === b.nameZh && haversineM(a.lat, a.lon, b.lat, b.lon) < 300;
}

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial compass bearing, degrees clockwise from north. */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Same-named stops this close together are one place (an intersection's several poles). */
export const PLACE_RADIUS_M = 250;

/**
 * Decode one or more city files into a network. Cities in one region are combined so a
 * pole served by 臺北 and 新北 routes is one place.
 */
export function buildBusNetwork(files: readonly BusCityFile[]): BusNetwork {
  const routes: BusRoute[] = [];
  const routeByKey = new Map<string, BusRoute>();
  const stations: BusStation[] = [];

  for (const f of files) {
    const cityRoutes = f.routes.map(([uid, nameZh, nameEn, depZh, depEn, destZh, destEn]) => {
      const r: BusRoute = { key: `${f.city}|${uid}`, city: f.city, uid, nameZh, nameEn, depZh, depEn, destZh, destEn, patterns: [] };
      return r;
    });
    const cityStations = f.stations.map(([nameZh, nameEn, lat, lon], index) => {
      const s: BusStation = { city: f.city, index, nameZh, nameEn, lat, lon, visits: [], place: null };
      return s;
    });
    const cityStops = f.stops.map(([uid, st]): BusStopRef => ({ city: f.city, uid, station: cityStations[st] }));
    for (const [ri, direction, subNameZh, idxs] of f.patterns) {
      const route = cityRoutes[ri];
      const p: BusPattern = { route, direction, subNameZh, stops: idxs.map((i) => cityStops[i]) };
      if (p.stops.length < 2) continue;
      route.patterns.push(p);
      p.stops.forEach((s, pos) => s.station.visits.push({ pattern: p, pos }));
    }
    for (const r of cityRoutes) {
      if (!r.patterns.length || routeByKey.has(r.key)) continue;
      routes.push(r);
      routeByKey.set(r.key, r);
    }
    for (const s of cityStations) if (s.visits.length) stations.push(s);
  }

  // Places: same name within PLACE_RADIUS_M of the place's first pole.
  const byName = new Map<string, BusPlace[]>();
  const places: BusPlace[] = [];
  for (const s of stations) {
    const name = foldText(s.nameZh);
    const list = byName.get(name) ?? [];
    let place = list.find((p) => haversineM(p.lat, p.lon, s.lat, s.lon) <= PLACE_RADIUS_M);
    if (!place) {
      place = { id: `${s.city}:${s.index}`, nameZh: s.nameZh, nameEn: s.nameEn, lat: s.lat, lon: s.lon, stations: [], routeKeys: [] };
      list.push(place);
      byName.set(name, list);
      places.push(place);
    }
    place.stations.push(s);
    if (!place.nameEn && s.nameEn) place.nameEn = s.nameEn;
    s.place = place;
  }
  for (const p of places) {
    p.lat = p.stations.reduce((a, s) => a + s.lat, 0) / p.stations.length;
    p.lon = p.stations.reduce((a, s) => a + s.lon, 0) / p.stations.length;
    const keys = new Set<string>();
    for (const s of p.stations) for (const v of s.visits) if (boardable(v.pattern, v.pos)) keys.add(v.pattern.route.key);
    p.routeKeys = [...keys];
  }
  const kept = places.filter((p) => p.routeKeys.length > 0);
  // A terminal nobody boards at is no place to open; its poles stay on the route page.
  for (const p of places) if (!p.routeKeys.length) for (const s of p.stations) s.place = null;
  const updated = files.map((f) => f.updated).filter(Boolean).sort().pop() ?? '';
  return {
    cities: files.map((f) => f.city),
    updated,
    routes: routes.sort(compareRoutes),
    routeByKey,
    places: kept,
    placeById: new Map(kept.map((p) => [p.id, p])),
  };
}

/** A pattern's last stop only lets riders off, unless the route is a loop (it starts there too). */
function boardable(p: BusPattern, pos: number): boolean {
  return pos < p.stops.length - 1 || isLoopPattern(p);
}

// ── stop page rows ──────────────────────────────────────────────────────────

export interface BusPlaceRow {
  route: BusRoute;
  direction: number;
  loop: boolean;
  /** Where the bus is heading from here: the pattern's last stop. */
  towardZh: string;
  towardEn: string;
  /** Every StopUID of this route at this pole (sub-routes can share or split them). */
  stopUids: string[];
  /** The longest pattern through here, for the route page. */
  pattern: BusPattern;
  pos: number;
}

export interface BusPlaceSide {
  /** Compass bearing the buses mostly leave in, null when unknown. */
  heading: number | null;
  stations: BusStation[];
  rows: BusPlaceRow[];
}

/** Poles closer than this are one side (臺北 and 新北 poles at the same spot)… */
const SIDE_MERGE_M = 30;
/** …when their buses leave within this many degrees of each other. */
const SIDE_MERGE_DEG = 60;

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Mean bearing from a pole to the next stop of every route boarding there; null when the
 * routes disagree (they leave in clearly different directions), which says nothing about
 * the side of the road.
 */
function stationHeading(s: BusStation): number | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const v of s.visits) {
    if (!boardable(v.pattern, v.pos)) continue;
    const next = v.pattern.stops[v.pos + 1]?.station;
    if (!next || haversineM(s.lat, s.lon, next.lat, next.lon) <= 5) continue;
    const b = (bearingDeg(s.lat, s.lon, next.lat, next.lon) * Math.PI) / 180;
    sx += Math.sin(b);
    sy += Math.cos(b);
    n++;
  }
  if (!n || Math.hypot(sx, sy) / n < 0.5) return null;
  return ((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360;
}

/**
 * The stop page: the place's poles, merged when they stand together, each listing the
 * routes boarding there, one row per route and direction.
 */
export function placeSides(place: BusPlace): BusPlaceSide[] {
  // Two sides of a narrow street can stand closer than SIDE_MERGE_M, so poles are one side
  // only when they are close AND their buses leave the same way (within SIDE_MERGE_DEG).
  const groups: { stations: BusStation[]; lat: number; lon: number; heading: number | null }[] = [];
  for (const s of place.stations) {
    const h = stationHeading(s);
    const g = groups.find((x) =>
      haversineM(x.lat, x.lon, s.lat, s.lon) <= SIDE_MERGE_M
      && (x.heading === null || h === null || angleDiff(x.heading, h) <= SIDE_MERGE_DEG));
    if (g) g.stations.push(s);
    else groups.push({ stations: [s], lat: s.lat, lon: s.lon, heading: h });
  }
  const sides = groups.map((g): BusPlaceSide => {
    const rows = new Map<string, BusPlaceRow>();
    let sx = 0;
    let sy = 0;
    for (const s of g.stations) {
      for (const v of s.visits) {
        if (!boardable(v.pattern, v.pos)) continue;
        const p = v.pattern;
        const key = `${p.route.key}#${p.direction}`;
        const uid = p.stops[v.pos].uid;
        const last = p.stops[p.stops.length - 1].station;
        const next = p.stops[v.pos + 1]?.station;
        if (next && haversineM(s.lat, s.lon, next.lat, next.lon) > 5) {
          const b = (bearingDeg(s.lat, s.lon, next.lat, next.lon) * Math.PI) / 180;
          sx += Math.sin(b);
          sy += Math.cos(b);
        }
        const existing = rows.get(key);
        if (existing) {
          if (!existing.stopUids.includes(uid)) existing.stopUids.push(uid);
          if (p.stops.length > existing.pattern.stops.length) {
            Object.assign(existing, { pattern: p, pos: v.pos, towardZh: last.nameZh, towardEn: last.nameEn, loop: isLoopPattern(p) });
          }
          continue;
        }
        rows.set(key, {
          route: p.route,
          direction: p.direction,
          loop: isLoopPattern(p),
          towardZh: last.nameZh,
          towardEn: last.nameEn,
          stopUids: [uid],
          pattern: p,
          pos: v.pos,
        });
      }
    }
    const heading = sx === 0 && sy === 0 ? null : ((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360;
    return { heading, stations: g.stations, rows: [...rows.values()].sort((a, b) => compareRoutes(a.route, b.route) || a.direction - b.direction) };
  });
  return sides.filter((s) => s.rows.length > 0).sort((a, b) => (a.heading ?? 999) - (b.heading ?? 999));
}

const WINDS_ZH = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
const WINDS_EN = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

/** 「往北」/ "northbound"-style label for a side's heading. */
export function headingLabel(heading: number | null, zh: boolean): string {
  if (heading === null) return '';
  const i = Math.round(heading / 45) % 8;
  return zh ? `往${WINDS_ZH[i]}` : `Heading ${WINDS_EN[i]}`;
}

// ── route page ──────────────────────────────────────────────────────────────

/**
 * The patterns a route page offers, one per direction: the longest of each (a sub-route that
 * only runs part of the way is not the route). Loop routes have a single entry.
 */
export function routeDirections(route: BusRoute): BusPattern[] {
  const best = new Map<number, BusPattern>();
  for (const p of route.patterns) {
    const d = p.direction === 1 ? 1 : p.direction === 0 ? 0 : p.direction;
    const cur = best.get(d);
    if (!cur || p.stops.length > cur.stops.length) best.set(d, p);
  }
  return [...best.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p);
}

// ── search ──────────────────────────────────────────────────────────────────

/** Fold for matching: full/half width (NFKC), 臺→台, case, spaces and brackets. */
export function foldText(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/臺/g, '台')
    .toLowerCase()
    .replace(/[\s()（）［］\[\]·・.]/g, '');
}

const COLLATOR = typeof Intl !== 'undefined' ? new Intl.Collator('zh-Hant-TW', { numeric: true }) : null;

/** Routes in natural order: 1, 2, 10, 307, 紅3 … */
export function compareRoutes(a: BusRoute, b: BusRoute): number {
  const ad = /^\d/.test(a.nameZh);
  const bd = /^\d/.test(b.nameZh);
  if (ad !== bd) return ad ? -1 : 1;
  const c = COLLATOR ? COLLATOR.compare(a.nameZh, b.nameZh) : a.nameZh.localeCompare(b.nameZh);
  return c || a.city.localeCompare(b.city);
}

export interface BusRouteHit { route: BusRoute; rank: number }
export interface BusPlaceHit { place: BusPlace; rank: number; distance: number | null }

/**
 * 路線: the name starting with the query first (「30」→ 30, 302, 307…), then containing it, then
 * a terminal containing it. 站牌: name starts with, then contains. Places near the rider first.
 */
export function searchBus(
  net: BusNetwork,
  query: string,
  opts: { lat?: number; lon?: number; routeLimit?: number; placeLimit?: number } = {},
): { routes: BusRouteHit[]; places: BusPlaceHit[] } {
  const q = foldText(query);
  if (!q) return { routes: [], places: [] };
  const routes: BusRouteHit[] = [];
  for (const r of net.routes) {
    const name = foldText(r.nameZh);
    const en = foldText(r.nameEn);
    let rank = -1;
    if (name === q || en === q) rank = 0;
    else if (name.startsWith(q) || en.startsWith(q)) rank = 1;
    else if (name.includes(q) || en.includes(q)) rank = 2;
    else if (q.length >= 2 && [r.depZh, r.destZh, r.depEn, r.destEn].some((t) => foldText(t).includes(q))) rank = 3;
    if (rank >= 0) routes.push({ route: r, rank });
  }
  routes.sort((a, b) => a.rank - b.rank || compareRoutes(a.route, b.route));

  const places: BusPlaceHit[] = [];
  const hasMe = typeof opts.lat === 'number' && typeof opts.lon === 'number';
  for (const p of net.places) {
    const zh = foldText(p.nameZh);
    const en = foldText(p.nameEn);
    let rank = -1;
    if (zh === q || en === q) rank = 0;
    else if (zh.startsWith(q) || en.startsWith(q)) rank = 1;
    else if (zh.includes(q) || (q.length >= 3 && en.includes(q))) rank = 2;
    if (rank < 0) continue;
    places.push({ place: p, rank, distance: hasMe ? haversineM(opts.lat!, opts.lon!, p.lat, p.lon) : null });
  }
  places.sort((a, b) =>
    a.rank - b.rank
    || (a.distance ?? Infinity) - (b.distance ?? Infinity)
    || a.place.nameZh.localeCompare(b.place.nameZh, 'zh-Hant'));
  return {
    routes: routes.slice(0, opts.routeLimit ?? 60),
    places: places.slice(0, opts.placeLimit ?? 40),
  };
}

/**
 * 前綴快速鍵 taken from the data, not hard-coded: the letters that start route numbers in this
 * region (紅 藍 綠 棕 橘 小 F …), most routes first. Typing them on a phone means switching
 * keyboards, which is why the bus apps riders already use offer them as keys.
 */
export function routePrefixes(net: BusNetwork, max = 10, minCount = 3): string[] {
  const counts = new Map<string, number>();
  for (const r of net.routes) {
    const m = /^([^\d\s]{1,2})\d/.exec(r.nameZh.normalize('NFKC'));
    if (!m) continue;
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant'))
    .slice(0, max)
    .map(([k]) => k);
}

/**
 * The route keypad (公車搜尋鍵盤), all from the data: `keys` are leading prefixes for the
 * coloured keys (紅 藍 小 F …, as routePrefixes); `words` are the words route names share
 * (幹線, 通勤, 市民 …): the first and last two characters of every non-numeric run of two or
 * more characters, kept when at least `minCount` routes carry them. Search matches inside a
 * name, so tapping 幹線 lists 敦化幹線, 信義幹線 …
 */
export function busKeypad(net: BusNetwork, maxKeys = 12, maxWords = 16, minCount = 3): { keys: string[]; words: string[] } {
  const keys = routePrefixes(net, maxKeys, minCount);
  const counts = new Map<string, Set<string>>();
  for (const r of net.routes) {
    const name = r.nameZh.normalize('NFKC');
    const seen = new Set<string>();
    for (const run of name.match(/[^\d\sA-Za-z()（）［］\[\]·・.\-－]{2,}/g) ?? []) {
      seen.add(run.slice(0, 2));
      seen.add(run.slice(-2));
    }
    for (const w of seen) {
      const set = counts.get(w) ?? new Set<string>();
      set.add(name);
      counts.set(w, set);
    }
  }
  const words = [...counts.entries()]
    .filter(([w, names]) => names.size >= minCount && !keys.includes(w))
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0], 'zh-Hant'))
    .slice(0, maxWords)
    .map(([w]) => w);
  return { keys, words };
}

// ── nearby ──────────────────────────────────────────────────────────────────

export interface NearbyPlace { place: BusPlace; distance: number }

/** Places within the radius, nearest first. */
export function nearbyPlaces(net: BusNetwork, lat: number, lon: number, radiusM: number, limit: number): NearbyPlace[] {
  // A degree box first: haversine over ~10k places on every move is wasted work.
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const out: NearbyPlace[] = [];
  for (const p of net.places) {
    if (Math.abs(p.lat - lat) > dLat || Math.abs(p.lon - lon) > dLon) continue;
    const d = haversineM(lat, lon, p.lat, p.lon);
    if (d <= radiusM) out.push({ place: p, distance: d });
  }
  return out.sort((a, b) => a.distance - b.distance).slice(0, limit);
}

/** Route names served at a place, natural order (for the list cards and map pins). */
export function placeRouteNames(net: BusNetwork, place: BusPlace): string[] {
  const routes = place.routeKeys.map((k) => net.routeByKey.get(k)).filter((r): r is BusRoute => !!r);
  const names = [...new Set(routes.sort(compareRoutes).map((r) => r.nameZh))];
  return names;
}
