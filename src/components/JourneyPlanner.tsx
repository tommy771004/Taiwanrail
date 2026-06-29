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
  Navigation, MapPin, X, Search, Loader2, ArrowRight, Clock, Repeat,
  Footprints, Bike, Car, Train, Bus, TramFront, Ship, CableCar, Plane, Gauge, Wallet,
} from 'lucide-react';
import {
  getRouting, getTRAStations, getTHSRStations, stationCoord, geocodePlace,
  type Station, type RouteResult, type RouteLeg, type LatLon, type TransitMode, type GeoPlace,
} from '../lib/api';
import { requestGeolocation, getCurrentGeo } from '../lib/geo';
import { logQuery } from '../lib/queryLogger';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Render inline as a page panel (third tab) instead of a modal overlay. */
  inline?: boolean;
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

// Mode → icon + label. Codes follow the MaaS transit/mile coding; '3' is HSR in
// transit context (shared-bike in mile context) — reconcile after the probe.
function legMeta(mode: string, zh: boolean): { Icon: typeof Train; label: string } {
  switch (mode) {
    case '0': return { Icon: Footprints, label: zh ? '步行' : 'Walk' };
    case '1': return { Icon: Bike, label: zh ? '自行車' : 'Bike' };
    case '2': return { Icon: Car, label: zh ? '開車' : 'Car' };
    case '3': return { Icon: Train, label: zh ? '高鐵' : 'HSR' };
    case '4': return { Icon: Train, label: zh ? '台鐵' : 'TRA' };
    case '5': return { Icon: Bus, label: zh ? '公車' : 'Bus' };
    case '6': return { Icon: TramFront, label: zh ? '捷運' : 'Metro' };
    case '7': return { Icon: TramFront, label: zh ? '輕軌' : 'LRT' };
    case '8': return { Icon: Ship, label: zh ? '渡輪' : 'Ferry' };
    case '9': return { Icon: CableCar, label: zh ? '纜車' : 'Cable Car' };
    case '20': return { Icon: Plane, label: zh ? '航空' : 'Air' };
  }
  // Keyword fallback — tolerate string mode values (e.g. "WALK", "Rail", "高鐵").
  const m = mode.toLowerCase();
  const has = (...ks: string[]) => ks.some(k => m.includes(k));
  if (has('walk', 'foot', '步行', '徒步')) return { Icon: Footprints, label: zh ? '步行' : 'Walk' };
  if (has('thsr', 'hsr', '高鐵')) return { Icon: Train, label: zh ? '高鐵' : 'HSR' };
  if (has('tra', 'rail', 'train', '台鐵', '臺鐵', '火車')) return { Icon: Train, label: zh ? '台鐵' : 'TRA' };
  if (has('mrt', 'metro', 'subway', '捷運')) return { Icon: TramFront, label: zh ? '捷運' : 'Metro' };
  if (has('lrt', 'light', 'tram', '輕軌')) return { Icon: TramFront, label: zh ? '輕軌' : 'LRT' };
  if (has('bus', 'coach', '公車', '客運', '巴士')) return { Icon: Bus, label: zh ? '公車' : 'Bus' };
  if (has('bike', 'cycle', 'bicycle', '單車', '自行車', 'youbike')) return { Icon: Bike, label: zh ? '單車' : 'Bike' };
  if (has('car', 'taxi', 'drive', '計程車', '開車')) return { Icon: Car, label: zh ? '開車' : 'Car' };
  if (has('ferry', 'boat', 'ship', '渡輪', '船')) return { Icon: Ship, label: zh ? '渡輪' : 'Ferry' };
  if (has('cable', '纜車')) return { Icon: CableCar, label: zh ? '纜車' : 'Cable Car' };
  if (has('air', 'flight', 'plane', '航空', '飛機')) return { Icon: Plane, label: zh ? '航空' : 'Air' };
  return { Icon: Navigation, label: mode || (zh ? '路段' : 'Leg') };
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

export default function JourneyPlanner({ isOpen, onClose, inline = false }: Props) {
  const { i18n } = useTranslation();
  const zh = i18n.language === 'zh-TW';
  const L = useCallback((z: string, e: string) => (zh ? z : e), [zh]);
  const active = inline || isOpen; // inline tab is always "open" while mounted

  const [traStations, setTraStations] = useState<Station[]>([]);
  const [thsrStations, setThsrStations] = useState<Station[]>([]);

  const [origin, setOrigin] = useState<Endpoint | null>(null);
  const [destination, setDestination] = useState<Endpoint | null>(null);
  const [editing, setEditing] = useState<'origin' | 'dest' | null>(null);
  const [search, setSearch] = useState('');
  const [places, setPlaces] = useState<GeoPlace[]>([]);
  const [geoLoading, setGeoLoading] = useState(false);

  const [gc, setGc] = useState<'fast' | 'cheap'>('fast');
  const [transit, setTransit] = useState<Set<TransitMode>>(new Set(ALL_TRANSIT.map(m => m.code)));

  const [results, setResults] = useState<RouteResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openRoute, setOpenRoute] = useState<number | null>(0);

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

  if (!active) return null;

  const endpointLabel = (ep: Endpoint | null, placeholder: string): string => {
    if (!ep) return placeholder;
    if (ep.kind === 'gps') return L('目前位置', 'Current location');
    if (ep.kind === 'place') return ep.name;
    return (zh ? ep.station.StationName?.Zh_tw : ep.station.StationName?.En) || ep.station.StationID;
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
    setLoading(true);
    setResults(null);
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
      if (routes.length === 0) {
        setError(L('查無路線，請調整運具或端點。', 'No routes found — adjust modes or endpoints.'));
      }
      // Fire-and-forget analytics, mirroring the timetable search.
      logQuery({
        transportType: origin.kind === 'station' ? origin.system : 'train',
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

  const card = (
    <div
      onClick={inline ? undefined : (e) => e.stopPropagation()}
      className={inline
        ? 'relative w-full max-w-md mx-auto min-h-[62dvh] flex flex-col bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 overflow-hidden'
        : 'relative w-full max-w-md max-h-[90dvh] min-h-0 flex flex-col bg-white dark:bg-slate-900 rounded-3xl sm:rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-[0_40px_80px_-15px_rgba(0,0,0,0.5)] p-4 sm:p-5 animate-in fade-in zoom-in-95 duration-300 overflow-hidden'}
    >
        {/* Header */}
        <div className="flex items-center gap-3 mb-4 px-1">
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

        <div className="flex-1 min-h-0 overflow-y-auto soft-scrollbar px-1 space-y-3">
          {/* Endpoints */}
          <div className="relative flex flex-col gap-2">
            {(['origin', 'dest'] as const).map(which => {
              const ep = which === 'origin' ? origin : destination;
              return (
                <button
                  key={which}
                  onClick={() => { setEditing(which); setSearch(''); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-slate-100/80 dark:bg-slate-800/80 text-left hover:ring-2 ring-emerald-400/40 transition"
                >
                  <MapPin className={`w-4 h-4 shrink-0 ${which === 'origin' ? 'text-emerald-500' : 'text-rose-500'}`} />
                  <span className={`text-sm font-medium truncate ${ep ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400'}`}>
                    {endpointLabel(ep, which === 'origin' ? L('選擇起點', 'Choose origin') : L('選擇終點', 'Choose destination'))}
                  </span>
                </button>
              );
            })}
            <button
              onClick={swap}
              aria-label={L('對調起訖', 'Swap')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-500 shadow-sm hover:rotate-180 transition-transform duration-300"
            >
              <Repeat className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Preference: fastest vs cheapest */}
          <div className="flex items-center gap-2 bg-slate-100/70 dark:bg-slate-800/70 rounded-2xl p-1">
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
          <div className="flex flex-wrap gap-1.5">
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

          {/* Search button */}
          <button
            onClick={handleSearch}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-emerald-600 text-white font-bold shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 disabled:opacity-60 transition"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
            {L('規劃路線', 'Plan route')}
          </button>

          {error && (
            <p className="text-sm text-center text-rose-500 bg-rose-50 dark:bg-rose-500/10 rounded-xl py-2 px-3">{error}</p>
          )}

          {/* Results */}
          {results && results.map((r, i) => (
            <div key={i} className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <button
                onClick={() => setOpenRoute(openRoute === i ? null : i)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-100">
                    <Clock className="w-4 h-4 text-emerald-500" />
                    {fmtDuration(r.travelTimeSec, zh)}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {fmtClock(r.startTime)} → {fmtClock(r.endTime)} · {L(`轉乘 ${r.transfers} 次`, `${r.transfers} transfer${r.transfers === 1 ? '' : 's'}`)}
                  </div>
                </div>
                {/* Mode summary icons */}
                <div className="flex items-center gap-1 text-slate-400">
                  {r.legs.slice(0, 5).map((leg, k) => {
                    const { Icon } = legMeta(leg.mode, zh);
                    return <Icon key={k} className="w-3.5 h-3.5" />;
                  })}
                </div>
              </button>

              {openRoute === i && (
                <ol className="px-4 pb-3 pt-1 space-y-3 border-t border-slate-100 dark:border-slate-800">
                  {r.legs.length === 0 && (
                    <li className="text-xs text-slate-400 pt-2">{L('此路線無詳細分段資料。', 'No leg details for this route.')}</li>
                  )}
                  {r.legs.map((leg: RouteLeg, k) => {
                    const { Icon, label } = legMeta(leg.mode, zh);
                    return (
                      <li key={k} className="flex gap-3 pt-2">
                        <div className="flex flex-col items-center">
                          <div className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                            <Icon className="w-4 h-4" />
                          </div>
                          {k < r.legs.length - 1 && <div className="flex-1 w-px bg-slate-200 dark:bg-slate-700 my-1" />}
                        </div>
                        <div className="flex-1 min-w-0 pb-1">
                          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                            <span>{leg.lineName || label}</span>
                            {leg.durationSec != null && (
                              <span className="text-[11px] font-medium text-slate-400">{fmtDuration(leg.durationSec, zh)}</span>
                            )}
                          </div>
                          {(leg.fromName || leg.toName) && (
                            <div className="flex items-center gap-1 text-xs text-slate-500 mt-0.5 truncate">
                              <span className="truncate">{leg.fromName}</span>
                              <ArrowRight className="w-3 h-3 shrink-0" />
                              <span className="truncate">{leg.toName}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                            {(leg.departTime || leg.arriveTime) && (
                              <span>{fmtClock(leg.departTime)}{leg.arriveTime ? `–${fmtClock(leg.arriveTime)}` : ''}</span>
                            )}
                            {leg.fare != null && <span>NT$ {leg.fare}</span>}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          ))}

          {results === null && !loading && !error && (
            <p className="text-xs text-center text-slate-400 pt-4 pb-2">
              {L('資料來源：交通部 TDX 跨運具旅運規劃。', 'Source: MOTC TDX cross-modal routing.')}
            </p>
          )}
        </div>

        {/* Endpoint picker overlay */}
        {editing && (
          <div className="absolute inset-0 bg-white dark:bg-slate-900 rounded-3xl sm:rounded-[2.5rem] p-4 sm:p-5 flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <h4 className="font-bold text-slate-800 dark:text-slate-100">
                {editing === 'origin' ? L('選擇起點', 'Choose origin') : L('選擇終點', 'Choose destination')}
              </h4>
              <button onClick={() => setEditing(null)} className="ml-auto p-2 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-500">
                <X className="w-5 h-5" />
              </button>
            </div>
            <button
              onClick={useCurrentLocation}
              className="w-full flex items-center gap-2 px-4 py-3 mb-2 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-semibold"
            >
              <Navigation className="w-4 h-4" /> {L('使用目前位置', 'Use current location')}
            </button>
            <div className="relative mb-2">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={L('搜尋車站…', 'Search stations…')}
                className="w-full pl-11 pr-4 py-3 bg-slate-100/80 dark:bg-slate-800/80 rounded-2xl text-base outline-none focus:ring-2 ring-emerald-400/50"
              />
            </div>
            <div className="flex-1 overflow-y-auto soft-scrollbar space-y-1">
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
          </div>
        )}
    </div>
  );

  if (inline) return card;

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/80 backdrop-blur-md p-4 sm:p-6"
      onClick={onClose}
    >
      {card}
    </div>,
    document.body,
  );
}
