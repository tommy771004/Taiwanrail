/**
 * Nearby-bus route helpers for the 轉乘公車 panels (TRA/THSR detail and metro
 * detail). Pure apart from the small localStorage pair at the bottom, which is
 * SSR-guarded like the other client libs.
 */
import type { BusRoute, BusStation } from './api';

/**
 * Stable identity of a route: RouteUID is city-prefixed, so 台北「1」and
 * 新北「1」stay distinct. The offline sample data has no RouteUID; its bare
 * RouteID is the best it can offer.
 */
export function busRouteKey(route: BusRoute): string {
  return route.RouteUID || `id:${route.RouteID}`;
}

/** Favourites first, each group keeping the order the stop listed them in. */
export function orderFavoritesFirst(routes: readonly BusRoute[], favorites: ReadonlySet<string>): BusRoute[] {
  const fav: BusRoute[] = [];
  const rest: BusRoute[] = [];
  for (const r of routes) (favorites.has(busRouteKey(r)) ? fav : rest).push(r);
  return [...fav, ...rest];
}

export interface OtherStopRoute {
  route: BusRoute;
  /** The nearest other stop that serves it — where the rider would board. */
  station: BusStation;
}

/**
 * Routes that the selected stop does NOT serve but another nearby stop does,
 * each paired with the nearest such stop. Sorted by that stop's distance, then
 * by route name, so the closest alternatives come first.
 */
export function collectOtherStopRoutes(stations: readonly BusStation[], selectedStationId: string): OtherStopRoute[] {
  const selected = stations.find((s) => s.StationID === selectedStationId);
  const atSelected = new Set((selected?.Stops ?? []).map(busRouteKey));
  const best = new Map<string, OtherStopRoute>();
  for (const station of stations) {
    if (station.StationID === selectedStationId) continue;
    for (const route of station.Stops ?? []) {
      const key = busRouteKey(route);
      if (atSelected.has(key)) continue;
      const current = best.get(key);
      if (!current || (station.Distance ?? Infinity) < (current.station.Distance ?? Infinity)) {
        best.set(key, { route, station });
      }
    }
  }
  return [...best.values()].sort(
    (a, b) =>
      (a.station.Distance ?? Infinity) - (b.station.Distance ?? Infinity) ||
      a.route.RouteName.Zh_tw.localeCompare(b.route.RouteName.Zh_tw, 'zh-Hant', { numeric: true }),
  );
}

/** Add the key if absent, remove it if present. */
export function toggleFavorite(favorites: readonly string[], key: string): string[] {
  return favorites.includes(key) ? favorites.filter((k) => k !== key) : [...favorites, key];
}

// --- persistence -----------------------------------------------------------

export const BUS_FAVORITES_KEY = 'tw-bus-route-favs';
/** Fired on window after a save, so every open panel re-reads the list. */
export const BUS_FAVORITES_EVENT = 'tw-bus-route-favs-change';

export function loadBusFavorites(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(BUS_FAVORITES_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

export function saveBusFavorites(favorites: readonly string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(BUS_FAVORITES_KEY, JSON.stringify(favorites));
  } catch {
    // Storage full or blocked (private mode): the toggle still applies for this page.
  }
  window.dispatchEvent(new Event(BUS_FAVORITES_EVENT));
}
