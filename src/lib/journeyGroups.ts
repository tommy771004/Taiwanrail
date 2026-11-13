/**
 * journeyGroups.ts — 規劃 results: what kind of trip each route is, and the tabs
 * that sort one search's routes by it.
 *
 * Pure (no DOM, no fetch). One routing call returns up to `top` routes; this file
 * only classifies what came back — it never asks for more routes per category.
 * Every figure it produces comes from the routes themselves: a category's time is
 * its fastest route's own travel time, a fare is shown only when every ride leg was
 * priced, and a departure countdown only when the first ride leg has a time.
 */
import type { RouteLeg, RouteResult } from './api';

/** What a leg is, for its icon, colour and category. */
export type LegKind =
  | 'walk' | 'bike' | 'car'
  | 'hsr' | 'tra' | 'metro' | 'lrt' | 'bus' | 'ferry' | 'cable' | 'air'
  | 'other';

/** Legs you ride on a scheduled service. Walking, cycling and driving are not. */
export const RIDE_KINDS: readonly LegKind[] = ['hsr', 'tra', 'metro', 'lrt', 'bus', 'ferry', 'cable', 'air'];

const isRide = (k: LegKind) => RIDE_KINDS.includes(k);

/**
 * TDX MaaS mode → kind. Numeric codes follow the MaaS transit/mile coding ('3' is
 * HSR in the transit list); string modes (category names such as "MRT", "TRA",
 * "walk") fall through to keyword matching.
 */
export function legKind(mode: string): LegKind {
  switch (mode) {
    case '0': return 'walk';
    case '1': return 'bike';
    case '2': return 'car';
    case '3': return 'hsr';
    case '4': return 'tra';
    case '5': return 'bus';
    case '6': return 'metro';
    case '7': return 'lrt';
    case '8': return 'ferry';
    case '9': return 'cable';
    case '20': return 'air';
  }
  const m = mode.toLowerCase();
  const has = (...ks: string[]) => ks.some(k => m.includes(k));
  // 'tra' only as a whole word: as a substring it is inside "transit" — the coarse
  // kind normalizeLeg falls back to when a ride has no category — and "transport".
  const word = (k: string) => new RegExp(`(^|[^a-z])${k}([^a-z]|$)`).test(m);
  if (has('walk', 'foot', '步行', '徒步')) return 'walk';
  if (has('thsr', 'hsr', 'high speed', 'highspeed', '高鐵')) return 'hsr';
  if (has('mrt', 'metro', 'subway', '捷運')) return 'metro';
  if (has('lrt', 'light', 'tram', '輕軌')) return 'lrt';
  if (word('tra') || has('rail', 'train', '台鐵', '臺鐵', '火車')) return 'tra';
  if (has('bus', 'coach', '公車', '客運', '巴士')) return 'bus';
  if (has('bike', 'cycle', 'bicycle', '單車', '自行車', 'youbike')) return 'bike';
  if (has('cable', 'gondola', '纜車')) return 'cable';
  if (has('car', 'taxi', 'drive', 'yoxi', '計程車', '開車')) return 'car';
  if (has('ferry', 'boat', 'ship', '渡輪', '船')) return 'ferry';
  if (has('air', 'flight', 'plane', '航空', '飛機')) return 'air';
  return 'other';
}

/** The ride kinds a route uses, once each, in RIDE_KINDS order. */
export function routeRideKinds(route: RouteResult): LegKind[] {
  const used = new Set(route.legs.map(l => legKind(l.mode)));
  return RIDE_KINDS.filter(k => used.has(k));
}

/** Category key: the ride kinds joined by '+', or 'walk' for a route with no ride. */
export function routeCategory(route: RouteResult): string {
  const kinds = routeRideKinds(route);
  return kinds.length ? kinds.join('+') : 'walk';
}

export interface RouteGroup {
  key: string;
  kinds: LegKind[];
  /** Indexes into the routes array, in the order the API ranked them. */
  indexes: number[];
  fastestSec: number;
}

/** Group routes by category, fastest category first (ties keep the API's order). */
export function groupRoutes(routes: readonly RouteResult[]): RouteGroup[] {
  const byKey = new Map<string, RouteGroup>();
  routes.forEach((r, i) => {
    const key = routeCategory(r);
    let g = byKey.get(key);
    if (!g) {
      g = { key, kinds: routeRideKinds(r), indexes: [], fastestSec: Infinity };
      byKey.set(key, g);
    }
    g.indexes.push(i);
    if (r.travelTimeSec > 0 && r.travelTimeSec < g.fastestSec) g.fastestSec = r.travelTimeSec;
  });
  const groups = [...byKey.values()];
  groups.forEach(g => { if (!Number.isFinite(g.fastestSec)) g.fastestSec = 0; });
  // Array.prototype.sort is stable, so equal times keep first-seen order. A group
  // with no usable time (0) goes last rather than reading as the fastest.
  return groups.sort((a, b) => (a.fastestSec || Infinity) - (b.fastestSec || Infinity));
}

/** Fastest travel time over all routes, 0 when none carries one. */
export function fastestOf(routes: readonly RouteResult[]): number {
  const times = routes.map(r => r.travelTimeSec).filter(t => t > 0);
  return times.length ? Math.min(...times) : 0;
}

/**
 * Total fare of the ride legs, or undefined when any ride leg has no fare — a sum
 * of the priced legs alone would read as the whole trip's price and be too low.
 */
export function routeTotalFare(route: RouteResult): number | undefined {
  const rides = route.legs.filter(l => isRide(legKind(l.mode)));
  if (!rides.length || rides.some(l => l.fare == null)) return undefined;
  return rides.reduce((sum, l) => sum + (l.fare ?? 0), 0);
}

/** The first leg you board, if any. */
export function firstRideLeg(route: RouteResult): RouteLeg | undefined {
  return route.legs.find(l => isRide(legKind(l.mode)));
}

const DAY_MIN = 24 * 60;

const TAIPEI_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/**
 * Taipei calendar date and minute-of-day of a routing timestamp. A timestamp with
 * an explicit zone (Z / ±hh:mm) is converted; one without is already Taipei local
 * time, which is what the routing API's request parameters use. "HH:mm" alone has
 * no date.
 */
export function taipeiTimeOf(value: string | undefined): { date?: string; minutes: number } | null {
  if (!value) return null;
  const s = value.trim();
  const short = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (short) return { minutes: Number(short[1]) * 60 + Number(short[2]) };
  const iso = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(s);
  if (!iso) return null;
  const [, date, hh, mm, zone] = iso;
  if (!zone || /^\+08:?00$/.test(zone)) return { date, minutes: Number(hh) * 60 + Number(mm) };
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const parts = Object.fromEntries(TAIPEI_PARTS.formatToParts(d).map(p => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
  };
}

/** "HH:mm" in Taipei time, or '' when the value cannot be read. */
export function taipeiClock(value: string | undefined): string {
  const t = taipeiTimeOf(value);
  if (!t) return '';
  const h = Math.floor(t.minutes / 60);
  const m = t.minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Whole minutes until `departTime`, from `nowMinutes` (Taipei minute-of-day; the
 * app's clock runs 0–3 h as 24–27 h, so it is folded back here) on `today`.
 * Null when the departure is on another day, already gone, or unreadable — the
 * caller then shows the scheduled clock time instead of a countdown.
 */
export function minutesUntilDeparture(
  departTime: string | undefined,
  nowMinutes: number,
  today: string,
): number | null {
  const t = taipeiTimeOf(departTime);
  if (!t) return null;
  const now = ((nowMinutes % DAY_MIN) + DAY_MIN) % DAY_MIN;
  let diff = t.minutes - now;
  if (t.date && t.date !== today) {
    // A trip planned just before midnight can board just after it.
    const next = nextDate(today);
    if (t.date !== next) return null;
    diff += DAY_MIN;
  } else if (!t.date && diff < -12 * 60) {
    diff += DAY_MIN;
  }
  if (diff < 0) return null;
  return Math.floor(diff);
}

function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** A leg's length in whole minutes: its own duration, else its clock times, else null. */
export function legMinutes(leg: RouteLeg): number | null {
  if (leg.durationSec != null && leg.durationSec > 0) return Math.max(1, Math.round(leg.durationSec / 60));
  const a = taipeiTimeOf(leg.departTime);
  const b = taipeiTimeOf(leg.arriveTime);
  if (!a || !b) return null;
  let diff = b.minutes - a.minutes;
  if (diff < 0) diff += DAY_MIN;
  return diff > 0 ? diff : null;
}
