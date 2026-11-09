/**
 * youbikeFeed.ts — nationwide YouBike dock data, shared by the Vercel Function
 * (`api/youbike.ts`) and the dev middleware in `vite.config.ts`, and its types by
 * the browser. Pure: no Node or DOM globals; the caller passes `fetchJson`.
 *
 * Sources (pinned by `npm run test:youbike`):
 * - Primary: YouBike's own nationwide feed `apis.youbike.com.tw/json/station-yb2.json`
 *   — 14 operating areas, ~9,800 docks, refreshed about once a minute. It is the
 *   operator's website/app backend, not a documented open-data API, so its shape can
 *   change without notice; a payload that normalises to too few docks counts as a
 *   failure rather than an empty country.
 * - Fallback: data.taipei's YouBike2.0 feed (Taipei City only), used only when the
 *   primary has failed and no recent primary snapshot is held. The two are never
 *   merged: a reply carries one snapshot and names its source.
 *
 * Never invent counts: a row without readable bike/dock numbers is dropped, and a
 * suspended dock (official `status` ≠ 1, Taipei `act` ≠ "1") is returned flagged so
 * the UI can say 「暫停營運」 instead of showing 0.
 */

export const OFFICIAL_FEED_URL = 'https://apis.youbike.com.tw/json/station-yb2.json';
export const TAIPEI_FEED_URL = 'https://tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json';

/** Below this the official payload is treated as broken, not as "few docks". */
export const OFFICIAL_MIN_DOCKS = 3000;
export const TAIPEI_MIN_DOCKS = 300;

/** Upstream refreshes about once a minute; re-downloading faster buys nothing. */
export const FEED_TTL_MS = 60_000;
/** A held snapshot older than this is no longer served when a refresh fails. */
export const FEED_MAX_STALE_MS = 15 * 60_000;

/** The detail-panel lookup's reach (kept from the Taipei-only version). */
export const NEAREST_MAX_M = 1500;

export type BikeSource = 'official' | 'taipei';

export interface BikeDock {
  id: string;
  name: string;
  nameEn: string;
  /** YouBike area code ('00' 臺北市 …); see BIKE_AREAS. */
  area: string;
  district: string;
  districtEn: string;
  address: string;
  addressEn: string;
  lat: number;
  lng: number;
  /** Bikes available to rent (all types). */
  bikes: number;
  /** Of which YouBike 2.0E (electric-assist); null when the source has no breakdown. */
  ebikes: number | null;
  /** Empty docks available to return a bike. */
  docks: number;
  total: number;
  suspended: boolean;
  /** The dock's own update time as the source wrote it ("2026-11-09 13:35:31"). */
  updateTime: string | null;
}

export interface BikeDockWithDistance extends BikeDock {
  /** Metres from the query point; null for a search without a position. */
  distance: number | null;
}

export interface BikeQueryResult {
  docks: BikeDockWithDistance[];
  source: BikeSource;
  /** When the snapshot was fetched (ISO). */
  asOf: string;
  /** True when a refresh failed and an older snapshot is being served. */
  stale: boolean;
}

/** YouBike operating areas, north to south (codes from apis.youbike.com.tw/json/area-all.json). */
export const BIKE_AREAS: ReadonlyArray<{ code: string; zh: string; en: string }> = [
  { code: '00', zh: '臺北市', en: 'Taipei City' },
  { code: '05', zh: '新北市', en: 'New Taipei City' },
  { code: '07', zh: '桃園市', en: 'Taoyuan City' },
  { code: '09', zh: '新竹市', en: 'Hsinchu City' },
  { code: '0B', zh: '新竹縣', en: 'Hsinchu County' },
  { code: '10', zh: '新竹科學園區', en: 'Hsinchu Science Park' },
  { code: '0A', zh: '苗栗縣', en: 'Miaoli County' },
  { code: '01', zh: '臺中市', en: 'Taichung City' },
  { code: '08', zh: '嘉義市', en: 'Chiayi City' },
  { code: '11', zh: '嘉義縣', en: 'Chiayi County' },
  { code: '13', zh: '臺南市', en: 'Tainan City' },
  { code: '12', zh: '高雄市', en: 'Kaohsiung City' },
  { code: '14', zh: '屏東縣', en: 'Pingtung County' },
  { code: '15', zh: '臺東縣', en: 'Taitung County' },
];

export function bikeAreaName(code: string, zh: boolean): string {
  const a = BIKE_AREAS.find(x => x.code === code);
  return a ? (zh ? a.zh : a.en) : '';
}

// ─── parsing helpers ──────────────────────────────────────────────────────

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

/** "YouBike2.0_捷運科技大樓站" → "捷運科技大樓站" (the Taipei feed prefixes every name). */
export function stripYouBikePrefix(name: string): string {
  return name.replace(/^YouBike\s*2(?:\.0)?E?_/i, '').trim();
}

function validLatLng(lat: number | null, lng: number | null): lat is number {
  return lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

function rowsOf(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  const o = json as { retVal?: unknown; data?: unknown } | null;
  if (o && Array.isArray(o.retVal)) return o.retVal;
  if (o && o.retVal && typeof o.retVal === 'object') return Object.values(o.retVal);
  if (o && Array.isArray(o.data)) return o.data;
  return [];
}

/** apis.youbike.com.tw/json/station-yb2.json → BikeDock[]. */
export function normalizeOfficialFeed(json: unknown): BikeDock[] {
  const out: BikeDock[] = [];
  for (const raw of rowsOf(json)) {
    const r = raw as Record<string, unknown>;
    const id = str(r.station_no);
    const lat = num(r.lat);
    const lng = num(r.lng);
    const bikes = num(r.available_spaces);
    const docks = num(r.empty_spaces);
    if (!id || !validLatLng(lat, lng) || bikes === null || docks === null) continue;
    const detail = (r.available_spaces_detail ?? null) as Record<string, unknown> | null;
    const ebikes = detail && typeof detail === 'object' ? num(detail.eyb) : null;
    out.push({
      id,
      name: stripYouBikePrefix(str(r.name_tw)),
      nameEn: stripYouBikePrefix(str(r.name_en)),
      area: str(r.area_code),
      district: str(r.district_tw),
      districtEn: str(r.district_en),
      address: str(r.address_tw),
      addressEn: str(r.address_en),
      lat,
      lng: lng as number,
      bikes,
      ebikes,
      docks,
      total: num(r.parking_spaces) ?? bikes + docks,
      suspended: num(r.status) !== 1,
      updateTime: str(r.updated_at) || null,
    });
  }
  return out;
}

/** data.taipei YouBike2.0 feed → BikeDock[] (Taipei City only, no e-bike breakdown). */
export function normalizeTaipeiFeed(json: unknown): BikeDock[] {
  const out: BikeDock[] = [];
  for (const raw of rowsOf(json)) {
    const r = raw as Record<string, unknown>;
    const id = str(r.sno);
    const lat = num(r.latitude ?? r.lat);
    const lng = num(r.longitude ?? r.lng);
    const bikes = num(r.available_rent_bikes ?? r.sbi);
    const docks = num(r.available_return_bikes ?? r.bemp);
    if (!id || !validLatLng(lat, lng) || bikes === null || docks === null) continue;
    out.push({
      id,
      name: stripYouBikePrefix(str(r.sna)),
      nameEn: stripYouBikePrefix(str(r.snaen)),
      area: '00',
      district: str(r.sarea),
      districtEn: str(r.sareaen),
      address: str(r.ar),
      addressEn: str(r.aren),
      lat,
      lng: lng as number,
      bikes,
      ebikes: null,
      docks,
      total: num(r.Quantity ?? r.tot) ?? bikes + docks,
      suspended: str(r.act) !== '1',
      updateTime: str(r.mday ?? r.updateTime ?? r.srcUpdateTime) || null,
    });
  }
  return out;
}

// ─── queries ──────────────────────────────────────────────────────────────

export function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Docks within `radiusM` of a point, nearest first. */
export function nearbyDocks(
  docks: readonly BikeDock[],
  lat: number,
  lon: number,
  radiusM: number,
  limit: number,
): BikeDockWithDistance[] {
  const hits: BikeDockWithDistance[] = [];
  for (const d of docks) {
    const distance = haversineM(lat, lon, d.lat, d.lng);
    if (distance <= radiusM) hits.push({ ...d, distance: Math.round(distance) });
  }
  hits.sort((a, b) => (a.distance as number) - (b.distance as number));
  return hits.slice(0, limit);
}

/** Nearest dock within `maxM`, or null. */
export function nearestDock(docks: readonly BikeDock[], lat: number, lon: number, maxM: number): BikeDockWithDistance | null {
  return nearbyDocks(docks, lat, lon, maxM, 1)[0] ?? null;
}

/**
 * Fold text for matching: full-width → half-width, case, whitespace, and 台 ≡ 臺 —
 * the feed spells 臺中車站 while riders type 台中車站.
 */
export function foldSearchText(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/台/g, '臺').replace(/\s+/g, '');
}

/**
 * Name / district / address search, optionally inside one area. Every
 * whitespace-separated token must match. Ranked: name starts with the query, name
 * contains it, anything else; then by distance when a position is given.
 */
export function searchDocks(
  docks: readonly BikeDock[],
  query: string,
  opts: { area?: string | null; lat?: number | null; lon?: number | null; limit: number },
): BikeDockWithDistance[] {
  const tokens = query.split(/\s+/).map(foldSearchText).filter(Boolean);
  const whole = foldSearchText(query);
  const hasPos = typeof opts.lat === 'number' && typeof opts.lon === 'number';
  const ranked: Array<{ d: BikeDockWithDistance; rank: number }> = [];
  for (const d of docks) {
    if (opts.area && d.area !== opts.area) continue;
    const name = foldSearchText(d.name);
    const nameEn = foldSearchText(d.nameEn);
    const hay = `${name}|${nameEn}|${foldSearchText(d.district)}|${foldSearchText(d.address)}|${foldSearchText(d.addressEn)}|${foldSearchText(bikeAreaName(d.area, true))}`;
    if (tokens.length && !tokens.every(t => hay.includes(t))) continue;
    const rank = !whole ? 2 : name.startsWith(whole) || nameEn.startsWith(whole) ? 0 : name.includes(whole) || nameEn.includes(whole) ? 1 : 2;
    const distance = hasPos ? Math.round(haversineM(opts.lat as number, opts.lon as number, d.lat, d.lng)) : null;
    ranked.push({ d: { ...d, distance }, rank });
  }
  ranked.sort((a, b) =>
    a.rank - b.rank
    || (a.d.distance ?? 0) - (b.d.distance ?? 0)
    || a.d.name.length - b.d.name.length
    || a.d.name.localeCompare(b.d.name, 'zh-Hant'));
  return ranked.slice(0, opts.limit).map(x => x.d);
}

// ─── snapshot source ──────────────────────────────────────────────────────

export interface DockSnapshot {
  docks: BikeDock[];
  source: BikeSource;
  fetchedAt: number;
}

export interface DockSource {
  /** The current snapshot, or null when nothing usable could be loaded. */
  get(): Promise<{ snapshot: DockSnapshot; stale: boolean } | null>;
}

export function createDockSource(opts: {
  fetchJson: (url: string) => Promise<unknown>;
  now?: () => number;
  ttlMs?: number;
  maxStaleMs?: number;
}): DockSource {
  const now = opts.now ?? (() => Date.now());
  const ttl = opts.ttlMs ?? FEED_TTL_MS;
  const maxStale = opts.maxStaleMs ?? FEED_MAX_STALE_MS;
  let held: DockSnapshot | null = null;
  let inFlight: Promise<{ snapshot: DockSnapshot; stale: boolean } | null> | null = null;

  const load = async (url: string, parse: (j: unknown) => BikeDock[], min: number): Promise<BikeDock[] | null> => {
    try {
      const docks = parse(await opts.fetchJson(url));
      return docks.length >= min ? docks : null;
    } catch {
      return null;
    }
  };

  const refresh = async () => {
    const official = await load(OFFICIAL_FEED_URL, normalizeOfficialFeed, OFFICIAL_MIN_DOCKS);
    if (official) {
      held = { docks: official, source: 'official', fetchedAt: now() };
      return { snapshot: held, stale: false };
    }
    // A recent nationwide snapshot beats a fresh Taipei-only one.
    if (held && held.source === 'official' && now() - held.fetchedAt <= maxStale) {
      return { snapshot: held, stale: true };
    }
    const taipei = await load(TAIPEI_FEED_URL, normalizeTaipeiFeed, TAIPEI_MIN_DOCKS);
    if (taipei) {
      held = { docks: taipei, source: 'taipei', fetchedAt: now() };
      return { snapshot: held, stale: false };
    }
    if (held && now() - held.fetchedAt <= maxStale) return { snapshot: held, stale: true };
    return null;
  };

  return {
    async get() {
      if (held && now() - held.fetchedAt < ttl) return { snapshot: held, stale: false };
      if (!inFlight) inFlight = refresh().finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}

// ─── HTTP contract (shared by api/youbike.ts and the dev middleware) ──────

function clampInt(v: string | null, min: number, max: number, dflt: number): number {
  const n = v === null ? NaN : Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
}

function coord(v: string | null, lim: number): number | null {
  const n = v === null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) && Math.abs(n) <= lim ? n : null;
}

/**
 * Answer one /api/youbike request.
 * - no `mode`, `lat`+`lon`: the nearest dock within 1.5 km as `{ station }` — the
 *   original contract the TRA/THSR detail panel's YouBikeCard reads.
 * - `mode=nearby&lat&lon[&radius][&limit]`: docks around a point, nearest first.
 * - `mode=search&q[&area][&lat&lon]`: name / address search, optionally in one area.
 * - `mode=ids&ids=a,b`: specific docks (the rider's saved ones).
 */
export async function answerYoubikeQuery(
  params: URLSearchParams,
  source: DockSource,
): Promise<{ status: number; body: unknown }> {
  const mode = params.get('mode');
  const lat = coord(params.get('lat'), 90);
  const lon = coord(params.get('lon'), 180);

  if (!mode) {
    if (lat === null || lon === null) return { status: 400, body: { error: 'lat/lon required' } };
    const got = await source.get();
    if (!got) return { status: 200, body: { station: null, error: 'fetch_failed' } };
    const d = nearestDock(got.snapshot.docks, lat, lon, NEAREST_MAX_M);
    if (!d) return { status: 200, body: { station: null } };
    return {
      status: 200,
      body: {
        station: {
          name: d.name,
          nameEn: d.nameEn,
          lat: d.lat,
          lng: d.lng,
          bikes: d.bikes,
          docks: d.docks,
          total: d.total,
          distance: d.distance,
          updateTime: d.updateTime,
          act: d.suspended ? '0' : '1',
        },
      },
    };
  }

  let pick: (docks: BikeDock[]) => BikeDockWithDistance[];
  if (mode === 'nearby') {
    if (lat === null || lon === null) return { status: 400, body: { error: 'lat/lon required' } };
    const radius = clampInt(params.get('radius'), 100, 3000, 800);
    const limit = clampInt(params.get('limit'), 1, 60, 30);
    pick = docks => nearbyDocks(docks, lat, lon, radius, limit);
  } else if (mode === 'search') {
    const q = (params.get('q') || '').trim().slice(0, 40);
    const areaParam = params.get('area');
    const area = areaParam && BIKE_AREAS.some(a => a.code === areaParam) ? areaParam : null;
    if (!q) return { status: 400, body: { error: 'q required' } };
    const limit = clampInt(params.get('limit'), 1, 60, 40);
    pick = docks => searchDocks(docks, q, { area, lat, lon, limit });
  } else if (mode === 'ids') {
    const ids = (params.get('ids') || '').split(',').map(s => s.trim()).filter(s => /^\d{4,12}$/.test(s)).slice(0, 20);
    if (!ids.length) return { status: 400, body: { error: 'ids required' } };
    const want = new Set(ids);
    pick = docks => docks.filter(d => want.has(d.id)).map(d => ({
      ...d,
      distance: lat !== null && lon !== null ? Math.round(haversineM(lat, lon, d.lat, d.lng)) : null,
    }));
  } else {
    return { status: 400, body: { error: 'unknown mode' } };
  }

  const got = await source.get();
  if (!got) return { status: 503, body: { error: 'fetch_failed', docks: [] } };
  const result: BikeQueryResult = {
    docks: pick(got.snapshot.docks),
    source: got.snapshot.source,
    asOf: new Date(got.snapshot.fetchedAt).toISOString(),
    stale: got.stale,
  };
  return { status: 200, body: result };
}
