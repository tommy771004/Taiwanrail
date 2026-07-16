/**
 * JourneyPlanner — door-to-door multimodal trip planning over the TDX MaaS
 * Routing API (/api/maas/routing via getRouting). Rendered as a full-screen
 * portal modal (matches StationPickerModal styling) and self-loads stations,
 * so App.tsx only needs an open/close trigger.
 *
 * NOTE: the per-leg `sections` shape from TDX is under-documented; leg fields
 * are mapped defensively in src/lib/api.ts and confirmed via
 * `npm run probe-routing`. Reconcile legMeta() codes with that output.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Navigation, MapPin, X, Search, Loader2, ArrowRight, Clock, Repeat, ChevronDown,
  Footprints, Bike, Car, Train, Bus, TramFront, Ship, CableCar, Plane, Gauge, Wallet,
  ExternalLink,
} from 'lucide-react';
import {
  getRouting, getTRAStations, getTHSRStations, stationCoord, geocodePlace,
  getTRABookingDeepLinkByUuid, getHSRBookingDeepLinkByUuid,
  type Station, type RouteResult, type RouteLeg, type LatLon, type TransitMode, type GeoPlace,
} from '../lib/api';
import { requestGeolocation, getCurrentGeo } from '../lib/geo';
import { isMobileDevice } from '../lib/device';
import { logQuery } from '../lib/queryLogger';
import { useQueryThrottle } from '../hooks/useQueryThrottle';
import { COUNTY_ORDER } from './StationPickerModal';
import JourneyProgressBar from './JourneyProgressBar';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Render inline as a page panel (third tab) instead of a modal overlay. */
  inline?: boolean;
  /** Fired when a route search is initiated (used to collapse the search card). */
  onSearch?: () => void;
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

// Per-mode colour token. Rail keeps the brand emerald/orange; other modes use
// muted, dark-mode-friendly tints so a multi-leg timeline reads at a glance
// (label always present too — colour is never the sole signal).
type Tint = 'walk' | 'bike' | 'car' | 'tra' | 'hsr' | 'metro' | 'lrt' | 'bus' | 'ferry' | 'cable' | 'air' | 'default';

const LEG_TINT: Record<Tint, { fg: string; bg: string; line: string }> = {
  walk:    { fg: 'text-slate-500 dark:text-slate-400',     bg: 'bg-slate-100 dark:bg-slate-800',          line: 'bg-slate-300 dark:bg-slate-700' },
  bike:    { fg: 'text-lime-600 dark:text-lime-400',       bg: 'bg-lime-100 dark:bg-lime-500/15',         line: 'bg-lime-400/40' },
  car:     { fg: 'text-slate-600 dark:text-slate-300',     bg: 'bg-slate-100 dark:bg-slate-800',          line: 'bg-slate-300 dark:bg-slate-700' },
  tra:     { fg: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-100 dark:bg-emerald-500/15',   line: 'bg-emerald-400/40' },
  hsr:     { fg: 'text-orange-600 dark:text-orange-400',   bg: 'bg-orange-100 dark:bg-orange-500/15',     line: 'bg-orange-400/40' },
  metro:   { fg: 'text-sky-600 dark:text-sky-400',         bg: 'bg-sky-100 dark:bg-sky-500/15',           line: 'bg-sky-400/40' },
  lrt:     { fg: 'text-teal-600 dark:text-teal-400',       bg: 'bg-teal-100 dark:bg-teal-500/15',         line: 'bg-teal-400/40' },
  bus:     { fg: 'text-amber-600 dark:text-amber-400',     bg: 'bg-amber-100 dark:bg-amber-500/15',       line: 'bg-amber-400/40' },
  ferry:   { fg: 'text-blue-600 dark:text-blue-400',       bg: 'bg-blue-100 dark:bg-blue-500/15',         line: 'bg-blue-400/40' },
  cable:   { fg: 'text-violet-600 dark:text-violet-400',   bg: 'bg-violet-100 dark:bg-violet-500/15',     line: 'bg-violet-400/40' },
  air:     { fg: 'text-indigo-600 dark:text-indigo-400',   bg: 'bg-indigo-100 dark:bg-indigo-500/15',     line: 'bg-indigo-400/40' },
  default: { fg: 'text-slate-500 dark:text-slate-400',     bg: 'bg-slate-100 dark:bg-slate-800',          line: 'bg-slate-300 dark:bg-slate-700' },
};

// Mode → icon + label + tint. Codes follow the MaaS transit/mile coding; '3' is
// HSR in transit context (shared-bike in mile context) — reconcile after the probe.
function legMeta(mode: string, zh: boolean): { Icon: typeof Train; label: string; tint: Tint } {
  switch (mode) {
    case '0': return { Icon: Footprints, label: zh ? '步行' : 'Walk', tint: 'walk' };
    case '1': return { Icon: Bike, label: zh ? '自行車' : 'Bike', tint: 'bike' };
    case '2': return { Icon: Car, label: zh ? '開車' : 'Car', tint: 'car' };
    case '3': return { Icon: Train, label: zh ? '高鐵' : 'HSR', tint: 'hsr' };
    case '4': return { Icon: Train, label: zh ? '台鐵' : 'TRA', tint: 'tra' };
    case '5': return { Icon: Bus, label: zh ? '公車' : 'Bus', tint: 'bus' };
    case '6': return { Icon: TramFront, label: zh ? '捷運' : 'Metro', tint: 'metro' };
    case '7': return { Icon: TramFront, label: zh ? '輕軌' : 'LRT', tint: 'lrt' };
    case '8': return { Icon: Ship, label: zh ? '渡輪' : 'Ferry', tint: 'ferry' };
    case '9': return { Icon: CableCar, label: zh ? '纜車' : 'Cable Car', tint: 'cable' };
    case '20': return { Icon: Plane, label: zh ? '航空' : 'Air', tint: 'air' };
  }
  // Keyword fallback — tolerate string mode values (e.g. "WALK", "Rail", "高鐵").
  const m = mode.toLowerCase();
  const has = (...ks: string[]) => ks.some(k => m.includes(k));
  if (has('walk', 'foot', '步行', '徒步')) return { Icon: Footprints, label: zh ? '步行' : 'Walk', tint: 'walk' };
  if (has('thsr', 'hsr', '高鐵')) return { Icon: Train, label: zh ? '高鐵' : 'HSR', tint: 'hsr' };
  if (has('tra', 'rail', 'train', '台鐵', '臺鐵', '火車')) return { Icon: Train, label: zh ? '台鐵' : 'TRA', tint: 'tra' };
  if (has('mrt', 'metro', 'subway', '捷運')) return { Icon: TramFront, label: zh ? '捷運' : 'Metro', tint: 'metro' };
  if (has('lrt', 'light', 'tram', '輕軌')) return { Icon: TramFront, label: zh ? '輕軌' : 'LRT', tint: 'lrt' };
  if (has('bus', 'coach', '公車', '客運', '巴士')) return { Icon: Bus, label: zh ? '公車' : 'Bus', tint: 'bus' };
  if (has('bike', 'cycle', 'bicycle', '單車', '自行車', 'youbike')) return { Icon: Bike, label: zh ? '單車' : 'Bike', tint: 'bike' };
  if (has('car', 'taxi', 'drive', 'yoxi', '計程車', '開車')) return { Icon: Car, label: zh ? '開車' : 'Car', tint: 'car' };
  if (has('ferry', 'boat', 'ship', '渡輪', '船')) return { Icon: Ship, label: zh ? '渡輪' : 'Ferry', tint: 'ferry' };
  if (has('cable', '纜車')) return { Icon: CableCar, label: zh ? '纜車' : 'Cable Car', tint: 'cable' };
  if (has('air', 'flight', 'plane', '航空', '飛機')) return { Icon: Plane, label: zh ? '航空' : 'Air', tint: 'air' };
  return { Icon: Navigation, label: mode || (zh ? '路段' : 'Leg'), tint: 'default' };
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

function fmtClock(iso?: string): string {
  if (!iso) return '';
  // Format an ISO time in Taipei TZ; tolerate already-short "HH:mm".
  const m = /T(\d{2}:\d{2})/.exec(iso);
  if (m) return m[1];
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 5);
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei',
  }).format(d);
}

function fmtDuration(sec: number, zh: boolean): string {
  const min = Math.round(sec / 60);
  if (min < 60) return zh ? `${min} 分` : `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  if (zh) return r ? `${h} 小時 ${r} 分` : `${h} 小時`;
  return r ? `${h} h ${r} m` : `${h} h`;
}

export default function JourneyPlanner({ isOpen, onClose, inline = false, onSearch }: Props) {
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

  // Lazy-load both station catalogues on first open (api.ts caches them).
  useEffect(() => {
    if (!active || traStations.length) return;
    getTRAStations().then(setTraStations).catch(() => {});
    getTHSRStations().then(setThsrStations).catch(() => {});
    // Seed origin from a previously-granted location, if any.
    const g = getCurrentGeo();
    if (g && !origin) setOrigin({ kind: 'gps', coord: { lat: g.lat, lon: g.lon } });
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Universal/app links only open the T-EX / e訂通 app on a top-level
    // navigation, so on mobile stay in this tab (the assign() branch below);
    // desktop keeps the popup, opened synchronously to satisfy blockers.
    const bookingWindow = isMobileDevice() ? null : window.open('about:blank', '_blank');
    if (bookingWindow) bookingWindow.opener = null;
    setBookingUuid(uuid);
    setError(null);

    try {
      const url = agency === 'hsr'
        ? await getHSRBookingDeepLinkByUuid(uuid)
        : await getTRABookingDeepLinkByUuid(uuid);
      if (bookingWindow) {
        bookingWindow.location.replace(url);
      } else {
        window.location.assign(url);
      }
    } catch {
      bookingWindow?.close();
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
      const g = await requestGeolocation();
      const ep: Endpoint = { kind: 'gps', coord: { lat: g.lat, lon: g.lon } };
      editing === 'origin' ? setOrigin(ep) : setDestination(ep);
      setEditing(null);
    } catch {
      setError(L('無法取得目前位置，請改選車站。', 'Could not get your location — pick a station instead.'));
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

  const handleSearch = async () => {
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
    setResults(null);
    onSearch?.(); // collapse the search card (parity with rail tabs)
    try {
      const routes = await getRouting({
        origin: o,
        destination: d,
        gc: gc === 'fast' ? 1 : 0,
        top: 5,
        transit: [...transit],
      });
      setResults(routes);
      setOpenRoute(0);
      if (inline && routes.length > 0) {
        window.setTimeout(() => {
          document.getElementById('plan-results-section')?.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          });
        }, 100);
      }
      if (routes.length === 0) {
        setError(L('查無路線，請調整運具或端點。', 'No routes found — adjust modes or endpoints.'));
      }
      // Fire-and-forget analytics, mirroring the timetable search.
      logQuery({
        transportType: 'planner',
        originStationId: origin.kind === 'station' ? origin.station.StationID : origin.kind.toUpperCase(),
        originStationName: endpointLabel(origin, ''),
        destStationId: destination.kind === 'station' ? destination.station.StationID : destination.kind.toUpperCase(),
        destStationName: endpointLabel(destination, ''),
        queryDate: new Date().toISOString().slice(0, 10),
        tripType: 'one-way',
        activeFilter: `maas:${gc}`,
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
          <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-emerald-600/70 dark:text-emerald-400/70 mb-1 px-3">
            {L('出發', 'FROM')}
          </span>
          <button
            onClick={() => { setEditing('origin'); setSearch(''); }}
            className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-2xl hover:bg-white/60 dark:hover:bg-slate-800/60 transition-all min-w-0 group"
          >
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center shrink-0 group-hover:scale-110 transition-all">
              <MapPin className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <span className={`text-xl sm:text-3xl font-black truncate tracking-tight ${origin ? 'text-slate-800 dark:text-white' : 'text-slate-400'}`}>
              {endpointLabel(origin, L('選擇起點', 'Origin'))}
            </span>
          </button>
        </div>

        {/* Swap */}
        <div className="relative z-10 px-2 sm:px-4 flex shrink-0 justify-center">
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
          <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-emerald-600/70 dark:text-emerald-400/70 mb-1 px-3 text-right">
            {L('抵達', 'TO')}
          </span>
          <button
            onClick={() => { setEditing('dest'); setSearch(''); }}
            className="flex items-center justify-end gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-2xl hover:bg-white/60 dark:hover:bg-slate-800/60 transition-all min-w-0 w-full group"
          >
            <span className={`text-xl sm:text-3xl font-black truncate text-right tracking-tight ${destination ? 'text-slate-800 dark:text-white' : 'text-slate-400'}`}>
              {endpointLabel(destination, L('選擇終點', 'Dest'))}
            </span>
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-rose-100 dark:bg-rose-900/50 flex items-center justify-center shrink-0 group-hover:scale-110 transition-all">
              <MapPin className="w-4 h-4 sm:w-5 sm:h-5 text-rose-500 dark:text-rose-400" />
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

      {/* Search button — Metro-style full width */}
      <div className="w-full max-w-3xl px-2 sm:px-0">
        <button
          onClick={handleSearch}
          disabled={loading || queryThrottled}
          className="w-full flex items-center justify-center gap-2 sm:gap-3 py-3.5 sm:py-4 rounded-2xl sm:rounded-3xl bg-emerald-600 text-white text-base sm:text-lg font-bold shadow-[0_8px_30px_rgba(5,150,105,0.3)] hover:bg-emerald-500 hover:shadow-[0_8px_40px_rgba(5,150,105,0.4)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all disabled:opacity-60 disabled:hover:translate-y-0 disabled:active:scale-100 disabled:cursor-not-allowed"
        >
          {loading ? (
            <Loader2 className="w-5 h-5 sm:w-6 sm:h-6 animate-spin" />
          ) : (
            <Search className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.5]" />
          )}
          <span>{loading ? L('規劃中...', 'Planning...') : L('規劃路線', 'Plan route')}</span>
        </button>
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

  const resultList = results && results.length > 0 ? (
    <section id="plan-results-section" className="relative max-w-5xl mx-auto px-4 md:px-8 pb-32 z-20 scroll-mt-24">
      {/* Soft emerald glow for depth behind the results */}
      <div aria-hidden className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 w-[34rem] max-w-full h-40 rounded-full bg-emerald-500/10 blur-3xl" />

      <div className="relative max-w-5xl mx-auto">
        <h3 className="mb-4 px-1 text-[11px] font-black uppercase tracking-[0.2em] text-emerald-800/70">
          {L(`建議路線 · ${results.length}`, `Routes · ${results.length}`)}
        </h3>

        <div className="space-y-3.5">
          {results.map((r, i) => {
            const open = openRoute === i;
            return (
              <div
                key={i}
                className={`group rounded-3xl border overflow-hidden transition-all duration-300 bg-gradient-to-b from-white to-slate-50/60 dark:from-slate-900 dark:to-slate-900/50 hover:scale-[1.01] hover:shadow-[0_20px_50px_-12px_rgba(0,0,0,0.15)] ${
                  open
                    ? 'border-emerald-300/70 dark:border-emerald-700/50 shadow-[0_16px_50px_-18px_rgba(16,185,129,0.35)] scale-[1.01]'
                    : 'border-slate-200/80 dark:border-slate-800 shadow-[0_8px_30px_-16px_rgba(0,0,0,0.4)] hover:border-emerald-300/50 dark:hover:border-emerald-800/60'
                }`}
              >
                <button
                  onClick={() => setOpenRoute(open ? null : i)}
                  className="w-full px-5 py-5 text-left cursor-pointer"
                >
                  <div className="grid grid-cols-12 gap-y-4 gap-x-4 items-center">
                    {/* Column 1: Duration info */}
                    <div className="col-span-12 sm:col-span-3 flex flex-col gap-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Clock className="w-4 h-4 text-emerald-500 shrink-0" />
                        <span className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 dark:text-white">
                          {fmtDuration(r.travelTimeSec, zh)}
                        </span>
                        {i === 0 && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                            {gc === 'fast' ? L('最快', 'Fastest') : L('最省', 'Cheapest')}
                          </span>
                        )}
                      </div>
                      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        {L(`轉乘 ${r.transfers} 次`, `${r.transfers} transfer${r.transfers === 1 ? '' : 's'}`)}
                      </span>
                    </div>

                    {/* Column 2: Time display & Progress Bar (separating time from progress bar & station labels) */}
                    <div className="col-span-12 sm:col-span-6 grid grid-cols-1 gap-3">
                      {/* Time display sub-row */}
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-left shrink-0">
                          <p className="font-black text-2xl sm:text-3xl tracking-tighter tabular-nums leading-none text-slate-900 dark:text-white">
                            {fmtClock(r.startTime)}
                          </p>
                        </div>
                        <div className="flex-1 text-center min-w-0 px-1">
                          <div className="relative w-full h-px bg-slate-200 dark:bg-slate-700">
                            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-emerald-400 border border-white dark:border-slate-900"></div>
                            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-emerald-600 border border-white dark:border-slate-900"></div>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-black text-2xl sm:text-3xl tracking-tighter tabular-nums leading-none text-slate-900 dark:text-white">
                            {fmtClock(r.endTime)}
                          </p>
                        </div>
                      </div>

                      {/* Journey progress bar with station labels */}
                      <div className="w-full">
                        <JourneyProgressBar
                          departureTime={fmtClock(r.startTime)}
                          arrivalTime={fmtClock(r.endTime)}
                          zh={zh}
                          originName={endpointLabel(origin, '')}
                          destName={endpointLabel(destination, '')}
                        />
                      </div>
                    </div>

                    {/* Column 3: Mode chips & Chevron */}
                    <div className="col-span-12 sm:col-span-3 flex items-center justify-between sm:justify-end gap-3 shrink-0">
                      <div className="flex items-center gap-1 flex-wrap">
                        {r.legs.slice(0, 5).map((leg, k) => {
                          const { Icon, tint } = legMeta(leg.mode, zh);
                          const c = LEG_TINT[tint];
                          return (
                            <span key={k} className={`p-1.5 rounded-lg ${c.bg} ${c.fg}`} title={leg.lineName || ''}>
                              <Icon className="w-3.5 h-3.5" />
                            </span>
                          );
                        })}
                      </div>
                      <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
                    </div>
                  </div>
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
                              {(tint === 'tra' || tint === 'hsr') && leg.bookingUuid && (
                                <button
                                  type="button"
                                  disabled={bookingUuid === leg.bookingUuid}
                                  onClick={() => void openRailBooking(leg.bookingUuid!, tint)}
                                  className={`ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-white transition-colors disabled:cursor-wait disabled:opacity-60 ${
                                    tint === 'hsr'
                                      ? 'bg-orange-600 hover:bg-orange-500'
                                      : 'bg-emerald-600 hover:bg-emerald-500'
                                  }`}
                                  aria-label={L(
                                    `開啟${tint === 'hsr' ? '高鐵 T-EX' : '台鐵 e 訂通'}`,
                                    `Open ${tint === 'hsr' ? 'HSR T-EX' : 'TRA e-booking'}`,
                                  )}
                                >
                                  {bookingUuid === leg.bookingUuid
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    : <ExternalLink className="h-3.5 w-3.5" />}
                                  {L('訂票', 'Book')}
                                </button>
                              )}
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
              </div>
            );
          })}
        </div>
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
