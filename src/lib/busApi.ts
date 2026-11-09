/**
 * 公車分頁的資料取得（只被 lazy 的 BusSearch 匯入，不進主 bundle）。
 *
 * Static: public/data/bus/<City>.json, one file per city, fetched once per tab session and
 * decoded by src/lib/busData.ts. A missing or unreadable file gives null, and the tab says
 * so — there is no live fallback for stops and routes (the gateway does not allow them).
 *
 * Live: TDX EstimatedTimeOfArrival through fetchTDXApi (gate ticket, CDN-shared URLs from
 * src/lib/busEta.ts). A failed call gives no rows, which the tab shows as 無資料.
 */
import { fetchTDXApi } from './api';
import { buildBusNetwork, busRegionInfo, parseBusCityFile, type BusCityCode, type BusCityFile, type BusNetwork, type BusRegionCode } from './busData';
import { busRouteEtaUrl, busStopEtaUrls, emptyEtaIndex, indexEtaRows, type BusEtaIndex } from './busEta';

const fileCache = new Map<BusCityCode, Promise<BusCityFile | null>>();

function loadCityFile(city: BusCityCode): Promise<BusCityFile | null> {
  let p = fileCache.get(city);
  if (!p) {
    p = fetch(`/data/bus/${city}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => parseBusCityFile(raw, city))
      .catch(() => null);
    // A failure is not remembered: the next attempt (retry button) asks again.
    p.then((f) => { if (!f) fileCache.delete(city); });
    fileCache.set(city, p);
  }
  return p;
}

const networkCache = new Map<BusRegionCode, Promise<BusNetwork | null>>();

export interface BusRegionLoad {
  network: BusNetwork | null;
  /** Cities of the region whose file could not be read (their stops are missing). */
  missing: BusCityCode[];
}

/** One region's stops and routes (臺北＋新北 together). Null network only when every file failed. */
export async function loadBusRegion(region: BusRegionCode): Promise<BusRegionLoad> {
  const info = busRegionInfo(region);
  if (!info) return { network: null, missing: [] };
  const files = await Promise.all(info.cities.map(loadCityFile));
  const ok = files.filter((f): f is BusCityFile => !!f);
  const missing = info.cities.filter((_, i) => !files[i]);
  if (!ok.length) return { network: null, missing };
  if (!missing.length) {
    let p = networkCache.get(region);
    if (!p) {
      p = Promise.resolve(buildBusNetwork(ok));
      networkCache.set(region, p);
    }
    return { network: await p, missing };
  }
  return { network: buildBusNetwork(ok), missing };
}

/** Several regions (the 全部 search scope) as one network. */
export async function loadBusRegions(regions: readonly BusRegionCode[]): Promise<BusRegionLoad> {
  if (regions.length === 1) return loadBusRegion(regions[0]);
  const cities = [...new Set(regions.flatMap((r) => busRegionInfo(r)?.cities ?? []))];
  const files = await Promise.all(cities.map(loadCityFile));
  const ok = files.filter((f): f is BusCityFile => !!f);
  return { network: ok.length ? buildBusNetwork(ok) : null, missing: cities.filter((_, i) => !files[i]) };
}

/** ETA for a set of stops, grouped by city (each city is its own TDX URL). */
export async function getBusStopsEta(stops: readonly { city: BusCityCode; uid: string }[], fresh = false): Promise<BusEtaIndex> {
  const byCity = new Map<BusCityCode, string[]>();
  for (const s of stops) {
    const list = byCity.get(s.city) ?? [];
    list.push(s.uid);
    byCity.set(s.city, list);
  }
  const urls = [...byCity.entries()].flatMap(([city, uids]) => busStopEtaUrls(city, uids));
  const replies = await Promise.all(urls.map((u) => fetchTDXApi<unknown>(u, { fresh }).catch(() => [])));
  const index = emptyEtaIndex();
  for (const r of replies) indexEtaRows(r, index);
  return index;
}

/** ETA for every stop of one route (both directions). */
export async function getBusRouteEta(city: BusCityCode, routeNameZh: string, routeUid: string, fresh = false): Promise<BusEtaIndex> {
  const url = busRouteEtaUrl(city, routeNameZh, routeUid);
  if (!url) return emptyEtaIndex();
  const reply = await fetchTDXApi<unknown>(url, { fresh }).catch(() => []);
  return indexEtaRows(reply);
}
