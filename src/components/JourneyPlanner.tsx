/**
 * JourneyPlanner — door-to-door multimodal trip planning over the TDX MaaS
 * Routing API (/api/maas/routing via getRouting). Rendered as a full-screen
 * portal modal (matches StationPickerModal styling) and self-loads stations,
 * so App.tsx only needs an open/close trigger.
 *
 * NOTE: the per-leg `sections` shape from TDX is under-documented; leg fields
 * are mapped defensively in src/lib/api.ts and confirmed via
 * `npm run probe-routing`. Reconcile legKind() codes (src/lib/journeyGroups.ts)
 * with that output.
 *
 * Results: one routing call, then the routes are sorted client-side into tabs by
 * the kinds of transport they ride (全部 / 捷運＋台鐵 / 公車＋台鐵 …), each tab
 * showing its fastest time. Every route is a compact row — time, clock range,
 * fare, a chip per leg and when the first ride leaves — that expands into the
 * leg timeline.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Navigation, MapPin, X, Search, Loader2, ArrowRight, Clock, Repeat, ChevronDown,
  Footprints, Bike, Car, Train, Bus, TramFront, Ship, CableCar, Plane, Gauge, Wallet,
  ExternalLink, LocateFixed, ChevronRight, RotateCw,
} from 'lucide-react';
import {
  getRouting, getTRAStations, getTHSRStations, stationCoord, geocodePlace,
  getTRABookingDeepLinkByUuid, getHSRBookingDeepLinkByUuid, WEB_BOOKING_URL,
  type Station, type RouteResult, type RouteLeg, type LatLon, type TransitMode, type GeoPlace,
} from '../lib/api';
import { requestGeolocation, getCurrentGeo, isGeoSupported, type GeoCoords } from '../lib/geo';
import { isMobileDevice } from '../lib/device';
import { logQuery } from '../lib/queryLogger';
import { taiwanDateString } from '../lib/taiwanDate';
import { useQueryThrottle } from '../hooks/useQueryThrottle';
import { COUNTY_ORDER } from './StationPickerModal';
import {
  legKind, groupRoutes, fastestOf, routeTotalFare, firstRideLeg, minutesUntilDeparture,
  legMinutes, taipeiClock, type LegKind, type RouteGroup,
} from '../lib/journeyGroups';
import { metroLineByName, metroLineColor, metroLineInkColor } from '../lib/metro';
import { useTaipeiClock } from '../hooks/useTaipeiClock';
import { formatServiceTime, taipeiNowMinutes } from '../lib/trainPosition';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Render inline as a page panel (third tab) instead of a modal overlay. */
  inline?: boolean;
  /** Fired when a route search is initiated (used to collapse the search card). */
  onSearch?: () => void;
  /** Live geolocation coordinates from App.tsx when available. */
  geoCoords?: GeoCoords | null;
}

type Endpoint =
  | { kind: 'gps'; coord: LatLon | null }
  | { kind: 'station'; system: 'train' | 'hsr'; station: Station }
  | { kind: 'place'; name: string; coord: LatLon };

const ALL_TRANSIT: { code: TransitMode; zh: string; en: string }[] = [
  { code: 3, zh: '高鐵', en: 'HSR' },
  { code: 4, zh: '台鐵', en: 'TRA' },
  { code: 6, zh: '捷運', en: 'Metro' },
  { code: 5, zh: '公車', en: 'Bus' },
  { code: 7, zh: '輕軌', en: 'LRT' },
];

// Per-kind colour token. Rail keeps the brand emerald/orange; other modes use
// muted, dark-mode-friendly tints so a multi-leg timeline reads at a glance
// (label always present too — colour is never the sole signal).
const LEG_TINT: Record<LegKind, { fg: string; bg: string; line: string }> = {
  walk:    { fg: 'text-slate-500 dark:text-slate-400',     bg: 'bg-slate-100 dark:bg-slate-800',          line: 'bg-slate-300 dark:bg-slate-700' },
  bike:    { fg: 'text-lime-600 dark:text-lime-400',       bg: 'bg-lime-100 dark:bg-lime-500/15',         line: 'bg-lime-400/40' },
  car:     { fg: 'text-slate-600 dark:text-slate-300',     bg: 'bg-slate-100 dark:bg-slate-800',          line: 'bg-slate-300 dark:bg-slate-700' },
  tra:     { fg: 'text-blue-600 dark:text-blue-400',       bg: 'bg-blue-100 dark:bg-blue-500/15',         line: 'bg-blue-400/40' },
  hsr:     { fg: 'text-orange-600 dark:text-orange-400',   bg: 'bg-orange-100 dark:bg-orange-500/15',     line: 'bg-orange-400/40' },
  metro:   { fg: 'text-cyan-600 dark:text-cyan-400',       bg: 'bg-cyan-100 dark:bg-cyan-500/15',         line: 'bg-cyan-400/40' },
  lrt:     { fg: 'text-teal-600 dark:text-teal-400',       bg: 'bg-teal-100 dark:bg-teal-500/15',         line: 'bg-teal-400/40' },
  bus:     { fg: 'text-violet-600 dark:text-violet-400',   bg: 'bg-violet-100 dark:bg-violet-500/15',     line: 'bg-violet-400/40' },
  ferry:   { fg: 'text-sky-600 dark:text-sky-400',         bg: 'bg-sky-100 dark:bg-sky-500/15',           line: 'bg-sky-400/40' },
  cable:   { fg: 'text-fuchsia-600 dark:text-fuchsia-400', bg: 'bg-fuchsia-100 dark:bg-fuchsia-500/15',   line: 'bg-fuchsia-400/40' },
  air:     { fg: 'text-indigo-600 dark:text-indigo-400',   bg: 'bg-indigo-100 dark:bg-indigo-500/15',     line: 'bg-indigo-400/40' },
  other:   { fg: 'text-slate-500 dark:text-slate-400',     bg: 'bg-slate-100 dark:bg-slate-800',          line: 'bg-slate-300 dark:bg-slate-700' },
};

const KIND_META: Record<LegKind, { Icon: typeof Train; zh: string; en: string }> = {
  walk: { Icon: Footprints, zh: '步行', en: 'Walk' },
  bike: { Icon: Bike, zh: '自行車', en: 'Bike' },
  car: { Icon: Car, zh: '開車', en: 'Car' },
  hsr: { Icon: Train, zh: '高鐵', en: 'HSR' },
  tra: { Icon: Train, zh: '台鐵', en: 'TRA' },
  metro: { Icon: TramFront, zh: '捷運', en: 'Metro' },
  lrt: { Icon: TramFront, zh: '輕軌', en: 'LRT' },
  bus: { Icon: Bus, zh: '公車', en: 'Bus' },
  ferry: { Icon: Ship, zh: '渡輪', en: 'Ferry' },
  cable: { Icon: CableCar, zh: '纜車', en: 'Cable Car' },
  air: { Icon: Plane, zh: '航空', en: 'Air' },
  other: { Icon: Navigation, zh: '路段', en: 'Leg' },
};

function legMeta(mode: string, zh: boolean): { Icon: typeof Train; label: string; tint: LegKind } {
  const kind = legKind(mode);
  const meta = KIND_META[kind];
  return { Icon: meta.Icon, label: zh ? meta.zh : meta.en, tint: kind };
}

// County bucket for the TRA-style picker. Handles both address shapes: TRA
// ("203001基隆市…", postal-prefixed) and THSR ("台北市…", no prefix), and
// normalizes 台→臺 so the two systems share one bucket per county.
function planCounty(station: Station): string {
  const addr = (station as { StationAddress?: string }).StationAddress;
  if (!addr) return '其他';
  const m = addr.replace(/^\d{3,6}/, '').match(/^([一-鿿]{2,3}[市縣])/);
  return m ? m[1].replace(/^台/, '臺') : '其他';
}

const fmtClock = taipeiClock;

function fmtDuration(sec: number, zh: boolean): string {
  const min = Math.round(sec / 60);
  if (min < 60) return zh ? `${min} 分鐘` : `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  if (zh) return r ? `${h} 小時 ${r} 分鐘` : `${h} 小時`;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export default function JourneyPlanner({ isOpen, onClose, inline = false, onSearch, geoCoords }: Props) {
  const { i18n } = useTranslation();
  const zh = i18n.language === 'zh-TW';
  const L = useCallback((z: string, e: string) => (zh ? z : e), [zh]);
  const active = inline || isOpen; // inline tab is always "open" while mounted
  const { throttled: queryThrottled, tryConsume: tryConsumeQuery, message: queryThrottleMessage } =
    useQueryThrottle();

  const [traStations, setTraStations] = useState<Station[]>([]);
  const [thsrStations, setThsrStations] = useState<Station[]>([]);

  const [origin, setOrigin] = useState<Endpoint | null>(null);
  const [destination, setDestination] = useState<Endpoint | null>(null);
  const [editing, setEditing] = useState<'origin' | 'dest' | null>(null);
  const [search, setSearch] = useState('');
  const [pickerCounty, setPickerCounty] = useState('');
  const [places, setPlaces] = useState<GeoPlace[]>([]);
  const [geoLoading, setGeoLoading] = useState(false);

  const [gc, setGc] = useState<'fast' | 'cheap'>('fast');
  const [transit, setTransit] = useState<Set<TransitMode>>(new Set(ALL_TRANSIT.map(m => m.code)));

  const [results, setResults] = useState<RouteResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openRoute, setOpenRoute] = useState<number | null>(0);
  const [bookingUuid, setBookingUuid] = useState<string | null>(null);
  /** Resolved deeplink awaiting the user's tap (mobile only — see openRailBooking). */
  const [bookingLink, setBookingLink] = useState<{ uuid: string; url: string } | null>(null);
  /** Result tab: 'all' or a RouteGroup key (see journeyGroups). */
  const [category, setCategory] = useState('all');
  /** Taipei minute the shown results were searched at (the trip leaves "now"). */
  const [searchedAt, setSearchedAt] = useState<number | null>(null);
  /** The 最快/最省 choice the shown results were searched with. */
  const [resultGc, setResultGc] = useState<'fast' | 'cheap'>('fast');
  // Drives the 「N 分鐘後發車」 countdowns; ticks only while results are shown.
  const nowMin = useTaipeiClock(!!results?.length);
  const groups = useMemo<RouteGroup[]>(() => (results ? groupRoutes(results) : []), [results]);

  // Lazy-load both station catalogues on first open (api.ts caches them).
  useEffect(() => {
    if (!active || traStations.length) return;
    getTRAStations().then(setTraStations).catch(() => {});
    getTHSRStations().then(setThsrStations).catch(() => {});
    // Seed origin from a previously-granted location, if any.
    const g = geoCoords || getCurrentGeo();
    if (g && !origin) setOrigin({ kind: 'gps', coord: { lat: g.lat, lon: g.lon } });
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // When initial geolocation resolves after JourneyPlanner is already mounted, seed origin if still empty.
  useEffect(() => {
    if (!active || !geoCoords || origin || results || loading) return;
    setOrigin({ kind: 'gps', coord: { lat: geoCoords.lat, lon: geoCoords.lon } });
  }, [geoCoords, active]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lock body scroll while open (modal only — the inline tab scrolls with the page).
  useEffect(() => {
    if (!isOpen || inline) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') (editing ? setEditing(null) : onClose()); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [isOpen, inline, editing, onClose]);

  // Debounced place geocoding while an endpoint is being edited (Nominatim 1 req/s policy).
  useEffect(() => {
    if (!active || !editing) return;
    const q = search.trim();
    if (q.length < 2) { setPlaces([]); setGeoLoading(false); return; }
    let cancelled = false;
    setGeoLoading(true);
    const timer = setTimeout(async () => {
      try {
        const r = await geocodePlace(q, zh ? 'zh-TW' : 'en');
        if (!cancelled) setPlaces(r);
      } catch {
        if (!cancelled) setPlaces([]);
      } finally {
        if (!cancelled) setGeoLoading(false);
      }
    }, 450);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search, editing, active, zh]);

  const combined = useMemo(
    () => [
      ...thsrStations.map(s => ({ system: 'hsr' as const, station: s })),
      ...traStations.map(s => ({ system: 'train' as const, station: s })),
    ],
    [traStations, thsrStations],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return combined.slice(0, 60);
    return combined.filter(({ station: s }) => {
      const name = (s.StationName?.Zh_tw || '') + (s.StationName?.En || '');
      return name.toLowerCase().includes(q) || s.StationID.includes(q);
    }).slice(0, 60);
  }, [combined, search]);

  // County buckets for the TRA-style 2-column picker (combined TRA + THSR).
  const countyList = useMemo(() => {
    const inData = new Set(combined.map(({ station }) => planCounty(station)));
    const ordered = COUNTY_ORDER.filter(c => inData.has(c));
    const others = [...inData].filter(c => !COUNTY_ORDER.includes(c));
    return [...ordered, ...others];
  }, [combined]);

  if (!active) return null;

  const searching = search.trim() !== '';
  const activeCounty = pickerCounty && countyList.includes(pickerCounty) ? pickerCounty : (countyList[0] || '');
  const stationsForCounty = combined.filter(({ station }) => planCounty(station) === activeCounty);

  const endpointLabel = (ep: Endpoint | null, placeholder: string): string => {
    if (!ep) return placeholder;
    if (ep.kind === 'gps') return L('目前位置', 'Current location');
    if (ep.kind === 'place') return ep.name;
    return (zh ? ep.station.StationName?.Zh_tw : ep.station.StationName?.En) || ep.station.StationID;
  };

  const openRailBooking = async (uuid: string, agency: 'tra' | 'hsr') => {
    if (!isMobileDevice()) {
      // TDX ships 城際運輸票務整合 for phones only, and a desktop has no app to
      // wake, so send it straight to the operator's web booking page —
      // synchronously, so the popup blocker still sees the click.
      const webWindow = window.open(WEB_BOOKING_URL[agency], '_blank');
      if (webWindow) webWindow.opener = null;
      return;
    }

    // Universal/app links only open the T-EX / e訂通 app on a *user-initiated*
    // navigation, and resolving the link is a network round-trip that outlives
    // the tap's user activation. So we hand the URL back to the UI as a real
    // link and let the user tap it.
    setBookingUuid(uuid);
    setBookingLink(null);
    setError(null);

    try {
      const url = agency === 'hsr'
        ? await getHSRBookingDeepLinkByUuid(uuid)
        : await getTRABookingDeepLinkByUuid(uuid);
      setBookingLink({ uuid, url });
    } catch {
      setError(L(
        `暫時無法取得${agency === 'hsr' ? '高鐵 T-EX' : '台鐵 e 訂通'}連結，請稍後再試。`,
        `The ${agency === 'hsr' ? 'HSR T-EX' : 'TRA e-booking'} link is temporarily unavailable. Please try again.`,
      ));
    } finally {
      setBookingUuid(null);
    }
  };

  const resolveCoord = (ep: Endpoint): LatLon | null =>
    ep.kind === 'station' ? stationCoord(ep.station) : ep.coord;

  const useCurrentLocation = async () => {
    try {
      const g = await requestGeolocation(8000, 0);
      const ep: Endpoint = { kind: 'gps', coord: { lat: g.lat, lon: g.lon } };
      editing === 'origin' ? setOrigin(ep) : setDestination(ep);
      setEditing(null);
    } catch {
      setError(L('無法取得目前位置，請改選車站。', 'Could not get your location — pick a station instead.'));
    }
  };

  /**
   * The locate icon beside 規劃路線: asks for location only on this tap and makes it the origin.
   * A destination that is already 目前位置 moves to the old origin rather than routing to itself.
   */
  const [locating, setLocating] = useState(false);
  const locateOrigin = async () => {
    setLocating(true);
    setError(null);
    try {
      const g = await requestGeolocation(8000, 0);
      if (destination?.kind === 'gps') setDestination(origin);
      setOrigin({ kind: 'gps', coord: { lat: g.lat, lon: g.lon } });
    } catch (err) {
      setError((err as GeolocationPositionError | undefined)?.code === 1
        ? L('定位權限被拒，請在瀏覽器設定中允許', 'Location blocked — allow it in browser settings')
        : L('無法取得目前位置，請改選車站。', 'Could not get your location — pick a station instead.'));
    } finally {
      setLocating(false);
    }
  };

  const pickStation = (system: 'train' | 'hsr', station: Station) => {
    const ep: Endpoint = { kind: 'station', system, station };
    editing === 'origin' ? setOrigin(ep) : setDestination(ep);
    setEditing(null);
    setSearch('');
    setPlaces([]);
  };

  const pickPlace = (p: GeoPlace) => {
    const ep: Endpoint = { kind: 'place', name: p.name, coord: { lat: p.lat, lon: p.lon } };
    editing === 'origin' ? setOrigin(ep) : setDestination(ep);
    setEditing(null);
    setSearch('');
    setPlaces([]);
  };

  const swap = () => { setOrigin(destination); setDestination(origin); };

  const toggleTransit = (code: TransitMode) => {
    setTransit(prev => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next.size ? next : prev; // keep at least one
    });
  };

  /**
   * `keep`: a refresh or 最快/最省 tap on the results — the shown routes stay up
   * until the new ones arrive, and a refusal or failure leaves them in place.
   */
  const handleSearch = async (gcChoice: 'fast' | 'cheap' = gc, keep = false) => {
    setError(null);
    if (!origin || !destination) {
      setError(L('請選擇起點與終點。', 'Please choose origin and destination.'));
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setError(L('路線規劃需要網路連線。', 'Trip planning requires a network connection.'));
      return;
    }
    const o = resolveCoord(origin);
    const d = resolveCoord(destination);
    if (!o || !d) {
      setError(L('無法取得座標，請重新選擇端點。', 'Missing coordinates — re-select an endpoint.'));
      return;
    }
    if (!tryConsumeQuery()) {
      setError(queryThrottleMessage);
      return;
    }
    setLoading(true);
    if (!keep) setResults(null);
    onSearch?.(); // collapse the search card (parity with rail tabs)
    try {
      const routes = await getRouting({
        origin: o,
        destination: d,
        gc: gcChoice === 'fast' ? 1 : 0,
        // The most the API returns in one call, so the result tabs have several
        // kinds of trip to sort; still a single request per search.
        top: 10,
        transit: [...transit],
      });
      // getRouting answers [] on failure as well as on no route, so a refresh that
      // comes back empty keeps the routes already on screen.
      const keepShown = keep && routes.length === 0;
      if (!keepShown) {
        setResults(routes);
        if (!keep) setCategory('all'); // a refresh stays on its tab while that tab still exists
        setSearchedAt(taipeiNowMinutes());
        setResultGc(gcChoice);
        setOpenRoute(null);
      }
      if (inline && routes.length > 0 && !keep) {
        window.setTimeout(() => {
          document.getElementById('plan-results-section')?.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          });
        }, 100);
      }
      if (keepShown) {
        setError(L(
          `暫時無法更新，以下仍是 ${searchedAt != null ? formatServiceTime(searchedAt) : ''} 的查詢結果。`,
          `Could not refresh — these are still the results from ${searchedAt != null ? formatServiceTime(searchedAt) : 'before'}.`,
        ));
      } else if (routes.length === 0) {
        setError(L('查無路線，請調整運具或端點。', 'No routes found — adjust modes or endpoints.'));
      }
      // Fire-and-forget analytics, mirroring the timetable search.
      logQuery({
        transportType: 'planner',
        originStationId: origin.kind === 'station' ? origin.station.StationID : origin.kind.toUpperCase(),
        originStationName: endpointLabel(origin, ''),
        destStationId: destination.kind === 'station' ? destination.station.StationID : destination.kind.toUpperCase(),
        destStationName: endpointLabel(destination, ''),
        queryDate: taiwanDateString(),
        tripType: 'one-way',
        activeFilter: `maas:${gcChoice}`,
        resultCount: routes.length,
      });
    } catch {
      setError(L('路線規劃服務暫時無法使用。', 'Routing service is temporarily unavailable.'));
    } finally {
      setLoading(false);
    }
  };

  // Search panel — mirrors the 捷運 (MetroSearch) layout: a wide horizontal
  // FROM · swap · TO row in one tinted container, then a full-width search
  // button. The planner-specific preference + transit-mode controls are kept
  // below the row. Colours stay emerald (vs. Metro's cyan).
  const searchPanel = (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col items-center w-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5 px-1">
        <div className="p-2 rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30">
          <Navigation className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-bold text-lg leading-tight text-slate-800 dark:text-slate-100">
            {L('路程規劃', 'Trip Planner')}
          </h3>
          <p className="text-[11px] font-medium text-slate-400">
            {L('跨交通工具路線', 'Door-to-door multimodal routes')}
          </p>
        </div>
        {!inline && (
          <button onClick={onClose} className="ml-auto p-2 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Endpoints — Metro-style horizontal row */}
      <div className="relative z-40 flex flex-row items-center justify-between mb-5 w-full max-w-3xl backdrop-blur-xl border border-emerald-100/50 dark:border-emerald-900/30 rounded-[2.5rem] p-3 sm:p-6 bg-emerald-50/60 dark:bg-emerald-900/20 shadow-[inset_0_2px_20px_rgba(16,185,129,0.15),0_8px_32px_-8px_rgba(5,150,105,0.08)]">

        {/* Origin */}
        <div className="flex-1 flex flex-col min-w-0">
          <span className="flex items-center gap-1 text-[10px] sm:text-xs font-bold uppercase tracking-wider text-emerald-600/70 dark:text-emerald-400/70 mb-1 px-2 sm:px-3">
            <MapPin className="sm:hidden w-3 h-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
            {L('出發', 'FROM')}
          </span>
          <button
            onClick={() => { setEditing('origin'); setSearch(''); }}
            className="flex items-center gap-2 sm:gap-3 px-2 sm:px-4 py-2.5 sm:py-3 rounded-2xl hover:bg-white/60 dark:hover:bg-slate-800/60 transition-all min-w-0 group"
          >
            <div className="hidden sm:flex w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/50 items-center justify-center shrink-0 group-hover:scale-110 transition-all">
              <MapPin className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <span className={`text-xl sm:text-3xl font-black truncate tracking-tight ${origin ? 'text-slate-800 dark:text-white' : 'text-slate-400'}`}>
              {endpointLabel(origin, L('選擇起點', 'Origin'))}
            </span>
          </button>
        </div>

        {/* Swap */}
        <div className="relative z-10 px-1 sm:px-4 flex shrink-0 justify-center">
          <button
            onClick={swap}
            aria-label={L('對調起訖', 'Swap')}
            className="group p-3 sm:p-4 rounded-full bg-white dark:bg-slate-800 shadow-sm sm:shadow-md border border-slate-100 dark:border-slate-700 hover:shadow-lg transition-all hover:scale-110 active:scale-95"
          >
            <Repeat className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-500 group-hover:rotate-180 transition-transform duration-500" />
          </button>
        </div>

        {/* Destination */}
        <div className="flex-1 flex flex-col items-end min-w-0">
          <span className="flex items-center justify-end gap-1 text-[10px] sm:text-xs font-bold uppercase tracking-wider text-emerald-600/70 dark:text-emerald-400/70 mb-1 px-2 sm:px-3 text-right">
            <MapPin className="sm:hidden w-3 h-3 shrink-0 text-rose-500 dark:text-rose-400" />
            {L('抵達', 'TO')}
          </span>
          <button
            onClick={() => { setEditing('dest'); setSearch(''); }}
            className="flex items-center justify-end gap-2 sm:gap-3 px-2 sm:px-4 py-2.5 sm:py-3 rounded-2xl hover:bg-white/60 dark:hover:bg-slate-800/60 transition-all min-w-0 w-full group"
          >
            <span className={`text-xl sm:text-3xl font-black truncate text-right tracking-tight ${destination ? 'text-slate-800 dark:text-white' : 'text-slate-400'}`}>
              {endpointLabel(destination, L('選擇終點', 'Dest'))}
            </span>
            <div className="hidden sm:flex w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-900/50 items-center justify-center shrink-0 group-hover:scale-110 transition-all">
              <MapPin className="w-5 h-5 text-rose-500 dark:text-rose-400" />
            </div>
          </button>
        </div>
      </div>

      {/* Preference + transit modes (planner-specific, kept below the row) */}
      <div className="w-full max-w-3xl flex flex-col items-center gap-3 mb-5 px-2 sm:px-0">
        {/* Fastest vs cheapest */}
        <div className="flex items-center gap-2 bg-slate-100/70 dark:bg-slate-800/70 rounded-2xl p-1 w-full max-w-xs">
          {([['fast', Gauge, L('最快', 'Fastest')], ['cheap', Wallet, L('最省', 'Cheapest')]] as const).map(([val, Icon, label]) => (
            <button
              key={val}
              onClick={() => setGc(val)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-bold transition ${
                gc === val ? 'bg-emerald-600 text-white shadow' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <Icon className="w-4 h-4" />{label}
            </button>
          ))}
        </div>
        {/* Transit modes */}
        <div className="flex flex-wrap justify-center gap-1.5">
          {ALL_TRANSIT.map(({ code, zh: z, en }) => {
            const on = transit.has(code);
            return (
              <button
                key={code}
                onClick={() => toggleTransit(code)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${
                  on
                    ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-300/60'
                    : 'bg-transparent text-slate-400 border-slate-200 dark:border-slate-700'
                }`}
              >
                {zh ? z : en}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="mb-4 w-full max-w-3xl text-sm font-medium text-center text-rose-600 bg-rose-50 dark:bg-rose-500/10 px-4 py-2 rounded-xl">
          {error}
        </div>
      )}

      {/* Search button + icon-only locate button on its right */}
      <div className="w-full max-w-3xl px-2 sm:px-0 flex items-center gap-2 sm:gap-3">
        <button
          onClick={() => void handleSearch()}
          disabled={loading || queryThrottled}
          className="flex-1 min-w-0 flex items-center justify-center gap-2 sm:gap-3 py-3.5 sm:py-4 rounded-2xl sm:rounded-3xl bg-emerald-600 text-white text-base sm:text-lg font-bold shadow-[0_8px_30px_rgba(5,150,105,0.3)] hover:bg-emerald-500 hover:shadow-[0_8px_40px_rgba(5,150,105,0.4)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all disabled:opacity-60 disabled:hover:translate-y-0 disabled:active:scale-100 disabled:cursor-not-allowed"
        >
          {loading ? (
            <Loader2 className="w-5 h-5 sm:w-6 sm:h-6 animate-spin" />
          ) : (
            <Search className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.5]" />
          )}
          <span>{loading ? L('規劃中...', 'Planning...') : L('規劃路線', 'Plan route')}</span>
        </button>
        {isGeoSupported() && (
          <button
            type="button"
            onClick={locateOrigin}
            disabled={locating}
            aria-label={L('以目前位置設為起點', 'Use current location as origin')}
            title={L('以目前位置設為起點', 'Use current location as origin')}
            className="shrink-0 w-[3.25rem] h-[3.25rem] sm:w-[3.75rem] sm:h-[3.75rem] rounded-2xl sm:rounded-3xl flex items-center justify-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm hover:bg-emerald-50 hover:border-emerald-200 dark:hover:bg-slate-700 active:scale-95 transition-all disabled:cursor-wait"
          >
            <LocateFixed className={`w-5 h-5 sm:w-6 sm:h-6 stroke-[2.25] ${locating ? 'animate-pulse' : ''}`} />
          </button>
        )}
      </div>

      {results === null && !loading && !error && (
        <p className="text-xs text-center text-slate-400 pt-4 pb-2">
          {L('資料來源：交通部 TDX 跨運具旅運規劃。', 'Source: MOTC TDX cross-modal routing.')}
        </p>
      )}
    </div>
  );

  // Endpoint picker — full-screen modal (mirrors MetroSearch's picker). Richer
  // than Metro's station-only list: also offers current location and geocoded
  // places, so the planner can route to arbitrary destinations.
  const pickerModal = editing ? createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/80 backdrop-blur-md p-4 sm:p-6"
      onClick={() => setEditing(null)}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[85dvh] flex flex-col bg-white dark:bg-slate-900 rounded-3xl sm:rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
      >
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-bold text-lg text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <MapPin className={`w-5 h-5 ${editing === 'origin' ? 'text-emerald-500' : 'text-rose-500'}`} />
            {editing === 'origin' ? L('選擇起點', 'Choose origin') : L('選擇終點', 'Choose destination')}
          </h3>
          <button onClick={() => setEditing(null)} className="p-2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <button
            onClick={useCurrentLocation}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-semibold transition hover:bg-emerald-100 dark:hover:bg-emerald-500/20"
          >
            <Navigation className="w-4 h-4" /> {L('使用目前位置', 'Use current location')}
          </button>
          <div className="relative mt-3">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={L('搜尋車站或地點…', 'Search stations or places…')}
              className="w-full pl-11 pr-4 py-3 bg-slate-100/80 dark:bg-slate-800/80 rounded-2xl text-base outline-none focus:ring-2 ring-emerald-400/50"
            />
          </div>
        </div>

        {!searching ? (
          /* TRA-style 2-column 縣市 / 車站 layout (combined TRA + THSR) */
          <div className="flex flex-1 min-h-0 p-4 pt-3 gap-2">
            {/* County sidebar */}
            <div className="w-[38%] sm:w-[32%] shrink-0 overflow-y-auto soft-scrollbar flex flex-col gap-0.5 pr-2 border-r border-slate-100 dark:border-slate-800">
              {countyList.map(county => {
                const count = combined.filter(({ station }) => planCounty(station) === county).length;
                const isActive = county === activeCounty;
                return (
                  <button
                    key={county}
                    onClick={() => setPickerCounty(county)}
                    className={`w-full text-left px-2.5 py-2 rounded-xl text-sm font-semibold transition-all flex items-center justify-between gap-1 ${
                      isActive
                        ? 'bg-emerald-600 text-white shadow-md'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="truncate">{county}</span>
                    <span className={`text-[10px] shrink-0 px-1.5 py-0.5 rounded-full font-bold tabular-nums ${
                      isActive ? 'bg-white/25 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                    }`}>{count}</span>
                  </button>
                );
              })}
            </div>

            {/* Stations in the active county */}
            <div className="flex-1 overflow-y-auto soft-scrollbar flex flex-col gap-0.5 pl-1">
              {stationsForCounty.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-sm">{L('此縣市無車站', 'No stations')}</div>
              ) : stationsForCounty.map(({ system, station }) => (
                <button
                  key={`${system}-${station.StationID}`}
                  onClick={() => pickStation(system, station)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-slate-100/80 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-300 font-medium"
                >
                  <span className="text-sm truncate">{(zh ? station.StationName?.Zh_tw : station.StationName?.En) || station.StationID}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                    system === 'hsr' ? 'bg-orange-100 text-orange-600 dark:bg-orange-500/15' : 'bg-blue-100 text-blue-600 dark:bg-blue-500/15'
                  }`}>{system === 'hsr' ? L('高鐵', 'HSR') : L('台鐵', 'TRA')}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Flat search results — stations + geocoded places */
          <div className="flex-1 overflow-y-auto soft-scrollbar p-4 space-y-1">
            {filtered.length > 0 && (
              <p className="px-2 pt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{L('車站', 'Stations')}</p>
            )}
            {filtered.map(({ system, station }) => (
              <button
                key={`${system}-${station.StationID}`}
                onClick={() => pickStation(system, station)}
                className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl hover:bg-slate-100/80 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-300 font-medium"
              >
                <span className="text-sm truncate">{(zh ? station.StationName?.Zh_tw : station.StationName?.En) || station.StationID}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                  system === 'hsr' ? 'bg-orange-100 text-orange-600 dark:bg-orange-500/15' : 'bg-blue-100 text-blue-600 dark:bg-blue-500/15'
                }`}>{system === 'hsr' ? L('高鐵', 'HSR') : L('台鐵', 'TRA')}</span>
              </button>
            ))}

            {(geoLoading || places.length > 0) && (
              <p className="px-2 pt-3 text-[10px] font-bold uppercase tracking-wide text-slate-400 flex items-center gap-1">
                {L('地點', 'Places')}
                {geoLoading && <Loader2 className="w-3 h-3 animate-spin" />}
              </p>
            )}
            {places.map((p, i) => (
              <button
                key={`place-${i}`}
                onClick={() => pickPlace(p)}
                className="w-full flex items-start gap-2 px-4 py-2.5 rounded-xl hover:bg-slate-100/80 dark:hover:bg-slate-800/80 text-left"
              >
                <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-rose-500" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-700 dark:text-slate-300 truncate">{p.name}</span>
                  {p.detail && <span className="block text-[11px] text-slate-400 truncate">{p.detail}</span>}
                </span>
              </button>
            ))}

            {!geoLoading && search.trim().length >= 2 && filtered.length === 0 && places.length === 0 && (
              <p className="py-8 text-center text-slate-400 text-sm">{L('查無車站或地點', 'No stations or places found')}</p>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  ) : null;

  const kindsLabel = (kinds: LegKind[]) =>
    kinds.length
      ? kinds.map(k => (zh ? KIND_META[k].zh : KIND_META[k].en)).join(zh ? '＋' : ' + ')
      : L('步行', 'Walk');

  /** One chip of the leg row: walking as icon + minutes, a ride as its line. */
  const legChip = (leg: RouteLeg) => {
    const kind = legKind(leg.mode);
    const { Icon } = KIND_META[kind];
    const c = LEG_TINT[kind];
    const kindName = zh ? KIND_META[kind].zh : KIND_META[kind].en;
    if (kind === 'walk' || kind === 'bike' || kind === 'car' || (kind === 'other' && !leg.lineName)) {
      const min = legMinutes(leg);
      return (
        <span
          className={`inline-flex items-center gap-0.5 h-7 px-1.5 rounded-lg text-xs font-bold tabular-nums ${c.bg} ${c.fg}`}
          title={min != null ? L(`${kindName} ${min} 分鐘`, `${kindName} ${min} min`) : kindName}
        >
          <Icon className="w-4 h-4" aria-hidden />
          <span className="sr-only">{kindName}</span>
          {min != null && <span>{min}</span>}
        </span>
      );
    }
    const name = leg.lineName || kindName;
    const line = kind === 'metro' || kind === 'lrt' ? metroLineByName(leg.lineName) : null;
    if (line) {
      const bg = metroLineColor(line.system, line.code);
      const ink = metroLineInkColor(line.system, line.code);
      return (
        <span
          className="inline-flex items-center h-7 max-w-[13rem] rounded-lg overflow-hidden text-xs font-bold"
          style={{ backgroundColor: bg, color: ink }}
          title={`${kindName} ${name}`}
        >
          <span className="h-full px-1.5 flex items-center bg-black/15">{line.code}</span>
          <span className="px-2 truncate">{name}</span>
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-center gap-1 h-7 max-w-[13rem] pl-1 pr-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200"
        title={`${kindName} ${name}`}
      >
        <span className={`shrink-0 flex items-center justify-center w-5 h-5 rounded-md ${c.bg} ${c.fg}`}>
          <Icon className="w-3.5 h-3.5" aria-hidden />
        </span>
        {name !== kindName && <span className="sr-only">{kindName}</span>}
        <span className="truncate">{name}</span>
      </span>
    );
  };

  /** 「14 分鐘後從南京三民發車」 from the first ride leg's own time; nothing without one. */
  const departLine = (r: RouteResult) => {
    const leg = firstRideLeg(r);
    if (!leg) return null;
    const from = leg.fromName;
    const n = minutesUntilDeparture(leg.departTime, nowMin, taiwanDateString());
    const clock = fmtClock(leg.departTime);
    if (n == null && !clock && !from) return null;
    const lead = n != null
      ? (n === 0 ? L('即將', 'Leaving now') : L(`${n} 分鐘後`, `In ${n} min`))
      : clock;
    return (
      <p className="mt-2.5 text-sm text-slate-500 dark:text-slate-400 truncate">
        {lead && (
          <span className={`font-bold tabular-nums ${n != null ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-200'}`}>
            {lead}
          </span>
        )}
        {zh
          ? (from ? `${lead ? ' ' : ''}從${from}${lead ? '發車' : '上車'}` : (lead ? ' 發車' : ''))
          : (from ? `${lead ? ' · ' : ''}${lead ? 'from' : 'Board at'} ${from}` : '')}
      </p>
    );
  };

  const activeCategory = groups.some(g => g.key === category) ? category : 'all';
  const visibleIdx = results
    ? (activeCategory === 'all'
      ? results.map((_, i) => i)
      : groups.find(g => g.key === activeCategory)!.indexes)
    : [];
  const allFastest = results ? fastestOf(results) : 0;
  const fastestIdx = results && allFastest ? results.findIndex(r => r.travelTimeSec === allFastest) : -1;
  const fares = results ? results.map(routeTotalFare) : [];
  const priced = fares.filter((f): f is number => f != null);
  // Only when every route is priced: an unpriced one could be the cheapest.
  const cheapestFare = priced.length >= 2 && priced.length === fares.length && new Set(priced).size > 1
    ? Math.min(...priced)
    : null;
  const cheapestIdx = cheapestFare != null ? fares.indexOf(cheapestFare) : -1;
  const tabs = results && groups.length > 1
    ? [
      { key: 'all', label: L('全部', 'All'), kinds: [] as LegKind[], sec: allFastest, count: results.length },
      ...groups.map(g => ({ key: g.key, label: kindsLabel(g.kinds), kinds: g.kinds, sec: g.fastestSec, count: g.indexes.length })),
    ]
    : [];

  const resultList = results && results.length > 0 ? (
    <section id="plan-results-section" className="relative max-w-5xl mx-auto px-4 md:px-8 pb-6 sm:pb-32 z-20 scroll-mt-24">
      {/* Soft emerald glow for depth behind the results */}
      <div aria-hidden className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 w-[34rem] max-w-full h-40 rounded-full bg-emerald-500/10 blur-3xl" />

      <div className="relative max-w-3xl mx-auto">
        {/* Kinds of trip found, each with its fastest time, then the result controls */}
        <div className="mb-3 rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
          {tabs.length > 0 && (
            <div
              role="tablist"
              aria-label={L('依交通方式分類', 'By kind of transport')}
              className="flex overflow-x-auto [scrollbar-width:none] border-b border-slate-100 dark:border-slate-800 px-2"
            >
              {tabs.map(t => {
                const on = activeCategory === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => { setCategory(t.key); setOpenRoute(null); }}
                    className={`relative shrink-0 flex flex-col items-start gap-0.5 px-3 pt-2.5 pb-3 transition-colors ${
                      on ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                    }`}
                  >
                    <span className="flex items-center gap-1 text-[11px] font-bold whitespace-nowrap">
                      {t.label}
                      <span className="opacity-60 tabular-nums">· {t.count}</span>
                    </span>
                    <span className="text-base font-black tabular-nums whitespace-nowrap">
                      {t.sec ? fmtDuration(t.sec, zh) : '—'}
                    </span>
                    {on && <span aria-hidden className="absolute left-2 right-2 bottom-0 h-[3px] rounded-full bg-emerald-500" />}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] px-3 py-2.5">
            <button
              type="button"
              onClick={() => void handleSearch(resultGc, true)}
              disabled={loading || queryThrottled}
              aria-label={L('重新查詢', 'Refresh')}
              title={L('重新查詢', 'Refresh')}
              className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-50"
            >
              <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            {searchedAt != null && (
              <span className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 tabular-nums">
                <Clock className="w-3.5 h-3.5" aria-hidden />
                {L(`${formatServiceTime(searchedAt)} 出發`, `Leave ${formatServiceTime(searchedAt)}`)}
              </span>
            )}
            <div className="shrink-0 flex items-center rounded-full bg-slate-100 dark:bg-slate-800 p-0.5" role="group" aria-label={L('排序偏好', 'Preference')}>
              {(['fast', 'cheap'] as const).map(v => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={resultGc === v}
                  disabled={loading || queryThrottled}
                  onClick={() => { if (v === resultGc) return; setGc(v); void handleSearch(v, true); }}
                  className={`inline-flex items-center gap-1 h-8 px-3 rounded-full text-xs font-bold transition ${
                    resultGc === v ? 'bg-emerald-600 text-white shadow' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  }`}
                >
                  {v === 'fast' ? <Gauge className="w-3.5 h-3.5" aria-hidden /> : <Wallet className="w-3.5 h-3.5" aria-hidden />}
                  {v === 'fast' ? L('最快', 'Fastest') : L('最省', 'Cheapest')}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <p role="alert" className="mb-3 text-sm font-medium text-center text-rose-600 bg-rose-50 dark:bg-rose-500/10 px-4 py-2 rounded-xl">
            {error}
          </p>
        )}

        <ul className={`space-y-3 transition-opacity ${loading ? 'opacity-50 pointer-events-none' : ''}`} aria-busy={loading}>
          {visibleIdx.map(i => {
            const r = results[i];
            const open = openRoute === i;
            const fare = fares[i];
            const start = fmtClock(r.startTime);
            const end = fmtClock(r.endTime);
            const chips = r.legs.filter(l => !(legKind(l.mode) === 'walk' && l.durationSec === 0));
            return (
              <li
                key={i}
                className={`rounded-3xl border overflow-hidden transition-all duration-300 bg-white dark:bg-slate-900 ${
                  open
                    ? 'border-emerald-300/70 dark:border-emerald-700/50 shadow-[0_16px_50px_-18px_rgba(16,185,129,0.35)]'
                    : 'border-slate-200/80 dark:border-slate-800 shadow-sm hover:border-emerald-300/50 dark:hover:border-emerald-800/60'
                }`}
              >
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenRoute(open ? null : i)}
                  className="w-full px-4 sm:px-5 py-4 text-left cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-2xl font-black tracking-tight tabular-nums text-slate-900 dark:text-white">
                          {r.travelTimeSec ? fmtDuration(r.travelTimeSec, zh) : L('時間未提供', 'Time n/a')}
                        </span>
                        {i === fastestIdx && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black tracking-wider bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                            {L('最快', 'Fastest')}
                          </span>
                        )}
                        {i === cheapestIdx && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black tracking-wider border border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400">
                            {L('最省', 'Cheapest')}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-600 dark:text-slate-300">
                        {start && end ? `${start} – ${end}` : start || end}
                        <span className="font-medium text-slate-400 dark:text-slate-500">
                          {(start || end) ? ' · ' : ''}
                          {r.transfers > 0
                            ? L(`轉乘 ${r.transfers} 次`, `${r.transfers} transfer${r.transfers === 1 ? '' : 's'}`)
                            : L('不需轉乘', 'No transfers')}
                        </span>
                      </p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1.5">
                      {fare != null && (
                        <span className="text-base font-bold tabular-nums text-slate-700 dark:text-slate-200">NT${fare}</span>
                      )}
                      <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
                    </div>
                  </div>

                  {chips.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1.5">
                      {chips.map((leg, k) => (
                        // The arrow wraps with the chip after it, so no line starts with a bare 「›」.
                        <span key={k} className="inline-flex items-center gap-x-1 min-w-0">
                          {k > 0 && <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-300 dark:text-slate-600" aria-hidden />}
                          {legChip(leg)}
                        </span>
                      ))}
                    </div>
                  )}

                  {departLine(r)}
                </button>

                {open && (
                  <ol className="px-5 pb-5 pt-3 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-950/30">
                    {r.legs.length === 0 && (
                      <li className="text-xs text-slate-400 py-2">{L('此路線無詳細分段資料。', 'No leg details for this route.')}</li>
                    )}
                    {r.legs.map((leg: RouteLeg, k) => {
                      const { Icon, label, tint } = legMeta(leg.mode, zh);
                      const c = LEG_TINT[tint];
                      const last = k === r.legs.length - 1;
                      return (
                        <li key={k} className="flex gap-3.5">
                          <div className="flex flex-col items-center">
                            <div className={`relative z-10 flex items-center justify-center w-9 h-9 rounded-xl ${c.bg} ${c.fg}`}>
                              <Icon className="w-4 h-4" />
                            </div>
                            {!last && <div className={`w-0.5 flex-1 my-1 rounded-full ${c.line}`} />}
                          </div>
                          <div className={`flex-1 min-w-0 ${last ? 'pb-1' : 'pb-5'}`}>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-bold text-slate-900 dark:text-white truncate">{leg.lineName || label}</span>
                              {leg.durationSec != null && (
                                <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold tabular-nums bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                                  {fmtDuration(leg.durationSec, zh)}
                                </span>
                              )}
                              {(tint === 'tra' || tint === 'hsr') && leg.bookingUuid && (() => {
                                const btnClass = `ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-white transition-colors disabled:cursor-wait disabled:opacity-60 no-underline ${
                                  tint === 'hsr'
                                    ? 'bg-orange-600 hover:bg-orange-500'
                                    : 'bg-emerald-600 hover:bg-emerald-500'
                                }`;
                                const appLabel = L(
                                  `開啟${tint === 'hsr' ? '高鐵 T-EX' : '台鐵 e 訂通'}`,
                                  `Open ${tint === 'hsr' ? 'HSR T-EX' : 'TRA e-booking'}`,
                                );
                                // Link ready: the user's own tap is what lets the OS
                                // hand the universal link to the app.
                                return bookingLink?.uuid === leg.bookingUuid ? (
                                  <a
                                    href={bookingLink.url}
                                    rel="noopener noreferrer"
                                    className={btnClass}
                                    aria-label={appLabel}
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    {L('點此開啟', 'Tap to open')}
                                  </a>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={bookingUuid === leg.bookingUuid}
                                    onClick={() => void openRailBooking(leg.bookingUuid!, tint)}
                                    className={btnClass}
                                    aria-label={appLabel}
                                  >
                                    {bookingUuid === leg.bookingUuid
                                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      : <ExternalLink className="h-3.5 w-3.5" />}
                                    {L('訂票', 'Book')}
                                  </button>
                                );
                              })()}
                            </div>
                            {(leg.fromName || leg.toName) && (
                              <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 min-w-0">
                                <span className="truncate">{leg.fromName}</span>
                                <ArrowRight className="w-3 h-3 shrink-0 text-slate-400" />
                                <span className="truncate">{leg.toName}</span>
                              </div>
                            )}
                            {(leg.departTime || leg.arriveTime || leg.fare != null) && (
                              <div className="mt-1.5 flex items-center gap-2 text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
                                {(leg.departTime || leg.arriveTime) && (
                                  <span className="px-1.5 py-0.5 rounded-md bg-slate-100/80 dark:bg-slate-800/60">
                                    {fmtClock(leg.departTime)}{leg.arriveTime ? `–${fmtClock(leg.arriveTime)}` : ''}
                                  </span>
                                )}
                                {leg.fare != null && (
                                  <span className="px-1.5 py-0.5 rounded-md font-semibold bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">NT$ {leg.fare}</span>
                                )}
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  ) : null;

  if (inline) {
    const resultsMount = typeof document !== 'undefined' ? document.getElementById('plan-results-mount') : null;
    return (
      <>
        {searchPanel}
        {pickerModal}
        {resultsMount && resultList ? createPortal(resultList, resultsMount) : null}
      </>
    );
  }

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/80 backdrop-blur-md p-4 sm:p-6 overflow-y-auto"
        onClick={onClose}
      >
        <div onClick={e => e.stopPropagation()} className="w-full max-w-3xl">
          {searchPanel}
        </div>
      </div>
      {pickerModal}
    </>,
    document.body,
  );
}
