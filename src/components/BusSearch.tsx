/**
 * BusSearch — the 公車 tab: 臺北、新北、桃園、臺中、高雄 city buses, map first, with a list
 * view, one search box for routes and stops, a stop page and a route page.
 *
 * Data (CLAUDE.md 公車): stops and routes come from the static snapshot (public/data/bus/,
 * src/lib/busData.ts), so the map, the nearby list and the search cost no TDX call. Only an
 * opened stop page, route page or the 常用 list asks TDX for arrival times
 * (src/lib/busEta.ts), through URLs every rider of the same stop or route shares for 60 s.
 * Polled every 60 s while the tab is visible and the rider is active; stopped after 10 idle
 * minutes. An unreadable time is 無資料 — never a guessed minute.
 *
 * Location follows the app's rules, exactly as BikeSearch: App's live fix or the recorded tap
 * location, a single background re-ask after an earlier 'granted', and the locate button.
 *
 * Query log (`query_logs`, transport_type 'bus'): once per settled nearby set, settled search,
 * opened stop page and opened route page — never per poll.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowLeft, ArrowRightLeft, Bus, ChevronRight, Crosshair, Grid3x3, List, Loader2, Map as MapIcon, MapPin, Navigation, RefreshCw, Search, Star, X } from 'lucide-react';
import {
  BUS_REGIONS,
  busCityInfo,
  busRegionInfo,
  busRegionsAt,
  haversineM,
  headingLabel,
  nearbyPlaces,
  placeRouteNames,
  placeSides,
  routeDirections,
  busKeypad,
  searchBus,
  type BusCityCode,
  type BusNetwork,
  type BusPattern,
  type BusPlace,
  type BusPlaceRow,
  type BusRegionCode,
  type BusRoute,
} from '../lib/busData';
import { emptyEtaIndex, etaFor, etaRank, etaText, isEtaExpired, NO_ETA, type BusEta, type BusEtaIndex } from '../lib/busEta';
import { getBusRouteEta, getBusStopsEta, loadBusRegions } from '../lib/busApi';
import { getCurrentGeo, getGeoPref, getSavedLocation, isAutomatedClient, isGeoRequestPending, isGeoSupported, queryGeoPermission, requestGeolocation, saveLocation, type GeoCoords } from '../lib/geo';
import { logQuery } from '../lib/queryLogger';
import { taiwanDateString } from '../lib/taiwanDate';
import BusMap, { type BusMapView, type BusPin } from './BusMap';
import BusKeypad from './BusKeypad';
import { useFillViewport } from '../lib/useFillViewport';

const POLL_MS = 60_000;
const IDLE_STOP_MS = 10 * 60_000;
const NEARBY_RADIUS_M = 600;
const NEARBY_WIDE_M = 1500;
const NEARBY_LIMIT = 20;
const MAP_PIN_LIMIT = 150;
const MAP_PIN_MIN_ZOOM = 14;
const LOG_SETTLE_MS = 2_000;
const FAVS_KEY = 'tw-bus-stop-favs';
const FAVS_MAX = 30;
const SHEET_INITIAL = 180;
const WALK_MAX_M = 3000;
const PAD_MODE_KEY = 'tw-bus-pad';

/** Keypad or phone keyboard: the rider's last choice, else the keypad on touch screens. */
function initialPadMode(): 'pad' | 'text' {
  try {
    const v = localStorage.getItem(PAD_MODE_KEY);
    if (v === 'pad' || v === 'text') return v;
  } catch { /* storage blocked */ }
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 'pad' : 'text';
}

function savePadMode(mode: 'pad' | 'text') {
  try { localStorage.setItem(PAD_MODE_KEY, mode); } catch { /* storage blocked */ }
}

// ── strings (kept in this lazy chunk, not in the app-wide i18n bundle) ──────────

const ZH = {
  title: '公車',
  cities: '臺北・新北・桃園・臺中・高雄',
  loading: '正在讀取公車站牌…',
  searchLabel: '搜尋公車路線或站牌',
  placeholder: '路線號碼或站名',
  clear: '清除搜尋',
  locate: '使用目前位置',
  locating: '定位中…',
  map: '地圖',
  list: '列表',
  viewLabel: '顯示方式',
  nearHere: '目前位置附近',
  needLocation: '尚未取得位置。開啟定位後，會依距離列出附近的公車站牌；也可以直接搜尋路線或站名。',
  chooseRegion: '或選擇縣市：',
  unsupported: '這裡不在公車分頁的範圍內。目前提供臺北、新北、桃園、臺中、高雄的市區公車。',
  nearbyCount: (n: number) => `附近 ${n} 個站牌`,
  byDistance: '依距離',
  noneNearby: (d: string) => `附近 ${d} 內沒有公車站牌`,
  dataFailed: '公車站牌資料暫時無法讀取',
  dataMissing: (names: string) => `${names}的站牌資料暫時無法讀取，這些縣市的站牌不會出現。`,
  retry: '重試',
  routes: '路線',
  stops: '站牌',
  noResults: (q: string) => `找不到符合「${q}」的路線或站牌`,
  searchAll: '搜尋全部縣市',
  scope: '搜尋範圍',
  all: '全部',
  pad: '路線鍵盤',
  padWords: '路線分類',
  padHide: '收起鍵盤',
  padKeyboard: '改用手機鍵盤',
  padClear: '清除',
  padBackspace: '刪除一字',
  foldHint: '「台」「臺」、全形半形視為相同',
  more: (n: number) => `還有 ${n} 筆，請輸入更多字`,
  live: (t: string) => `即時 ${t}`,
  stale: (t: string) => `${t} 的資料`,
  etaLoading: '讀取到站時間…',
  etaFailed: '到站時間暫時無法取得',
  refresh: '重新整理',
  back: '返回',
  navigate: '步行導航',
  navigateAria: (n: string) => `步行導航到 ${n}（Google 地圖，另開新頁）`,
  walk: (d: string, m: number) => `${d} · 步行約 ${m} 分`,
  toward: (x: string) => `往 ${x}`,
  loop: '循環線',
  side: (i: number, h: string) => (h ? `站位 ${i} · ${h}` : `站位 ${i}`),
  fav: (r: string) => `收藏 ${r} 在這站`,
  unfav: (r: string) => `取消收藏 ${r}`,
  favs: '常用 · 最快到站在上',
  favsEmpty: '在站牌頁按 ☆，常搭的路線和站就會出現在這裡。',
  favsElsewhere: (n: number) => `另有 ${n} 筆在其他縣市，切換縣市後顯示。`,
  openRoute: (r: string, x: string) => `${r} 往 ${x}，查看路線`,
  yourStop: '你的站',
  busNear: '公車即將到站',
  stopCount: (n: number) => `${n} 站`,
  direction: '行駛方向',
  source: '資料來源：交通部 TDX。站牌與路線為定期快照，到站時間每分鐘更新。',
  snapshot: (d: string) => `站牌資料 ${d}`,
  zoomIn: '放大地圖以顯示站牌',
  mapLabel: '公車站牌地圖',
  pinLabel: (n: string, c: number) => `${n}，${c} 條路線`,
  meters: (n: number) => `${n} 公尺`,
  km: (n: string) => `${n} 公里`,
  locationDenied: '定位權限被拒，請在瀏覽器設定中允許',
  locationFailed: '無法取得目前位置',
  etaNote: '「表定」是時刻表時間，不是即時位置。',
};

const EN: typeof ZH = {
  title: 'Bus',
  cities: 'Taipei · New Taipei · Taoyuan · Taichung · Kaohsiung',
  loading: 'Loading bus stops…',
  searchLabel: 'Search bus routes or stops',
  placeholder: 'Route number or stop name',
  clear: 'Clear search',
  locate: 'Use my location',
  locating: 'Locating…',
  map: 'Map',
  list: 'List',
  viewLabel: 'View',
  nearHere: 'Near you',
  needLocation: 'No location yet. Turn on location to list the bus stops around you, or search a route or stop.',
  chooseRegion: 'Or pick a city:',
  unsupported: 'This area is not covered. The Bus tab covers city buses in Taipei, New Taipei, Taoyuan, Taichung and Kaohsiung.',
  nearbyCount: (n: number) => `${n} stops nearby`,
  byDistance: 'By distance',
  noneNearby: (d: string) => `No bus stops within ${d}`,
  dataFailed: 'Bus stop data is unavailable right now',
  dataMissing: (names: string) => `Stop data for ${names} is unavailable right now; its stops are not shown.`,
  retry: 'Retry',
  routes: 'Routes',
  stops: 'Stops',
  noResults: (q: string) => `No routes or stops match “${q}”`,
  searchAll: 'Search all cities',
  scope: 'Search in',
  all: 'All',
  pad: 'Route keypad',
  padWords: 'Route groups',
  padHide: 'Hide keypad',
  padKeyboard: 'Use phone keyboard',
  padClear: 'Clear',
  padBackspace: 'Delete',
  foldHint: 'Full-width and half-width characters match',
  more: (n: number) => `${n} more — type more to narrow down`,
  live: (t: string) => `Live ${t}`,
  stale: (t: string) => `As of ${t}`,
  etaLoading: 'Loading arrival times…',
  etaFailed: 'Arrival times are unavailable right now',
  refresh: 'Refresh',
  back: 'Back',
  navigate: 'Walk there',
  navigateAria: (n: string) => `Walking directions to ${n} (Google Maps, opens a new tab)`,
  walk: (d: string, m: number) => `${d} · ${m} min walk`,
  toward: (x: string) => `To ${x}`,
  loop: 'Loop',
  side: (i: number, h: string) => (h ? `Stop ${i} · ${h}` : `Stop ${i}`),
  fav: (r: string) => `Save ${r} at this stop`,
  unfav: (r: string) => `Remove ${r}`,
  favs: 'Saved · soonest first',
  favsEmpty: 'Tap ☆ on a stop page to keep your usual route and stop here.',
  favsElsewhere: (n: number) => `${n} more in other cities; switch city to see them.`,
  openRoute: (r: string, x: string) => `${r} to ${x}, open route`,
  yourStop: 'Your stop',
  busNear: 'Bus arriving',
  stopCount: (n: number) => `${n} stops`,
  direction: 'Direction',
  source: 'Source: MOTC TDX. Stops and routes are a periodic snapshot; arrival times update every minute.',
  snapshot: (d: string) => `Stop data ${d}`,
  zoomIn: 'Zoom in to show stops',
  mapLabel: 'Bus stop map',
  pinLabel: (n: string, c: number) => `${n}, ${c} routes`,
  meters: (n: number) => `${n} m`,
  km: (n: string) => `${n} km`,
  locationDenied: 'Location permission denied. Allow it in your browser settings.',
  locationFailed: 'Could not get your location',
  etaNote: '“Sched.” is a timetable time, not a live position.',
};

type Strings = typeof ZH;

// ── helpers ──────────────────────────────────────────────────────────────────

function clockOf(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false });
}

function dateOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
}

const distanceText = (m: number, S: Strings) => (m < 1000 ? S.meters(Math.round(m / 5) * 5 || Math.round(m)) : S.km((m / 1000).toFixed(1)));
const walkMinutes = (m: number) => Math.max(1, Math.round(m / 75));

const placeName = (p: BusPlace, zh: boolean) => (zh ? p.nameZh : p.nameEn || p.nameZh);
const routeName = (r: BusRoute, zh: boolean) => (zh ? r.nameZh : r.nameEn || r.nameZh);
const stationName = (s: { nameZh: string; nameEn: string }, zh: boolean) => (zh ? s.nameZh : s.nameEn || s.nameZh);

/** A StopUID at the place — the stable id the query log keeps (place ids follow the file order). */
function placeStopUid(p: BusPlace): string {
  const v = p.stations[0]?.visits[0];
  return v ? v.pattern.stops[v.pos].uid : p.id;
}

function googleWalkUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=walking`;
}

interface Fav { c: BusCityCode; r: string; d: number; s: string[] }

function readFavs(): Fav[] {
  try {
    const v = JSON.parse(localStorage.getItem(FAVS_KEY) || '[]');
    if (!Array.isArray(v)) return [];
    return v.filter((f): f is Fav =>
      !!f && typeof f === 'object' && !!busCityInfo(f.c) && typeof f.r === 'string' && Number.isInteger(f.d)
      && Array.isArray(f.s) && f.s.length > 0 && f.s.every((x: unknown) => typeof x === 'string')).slice(0, FAVS_MAX);
  } catch {
    return [];
  }
}
function writeFavs(f: Fav[]) {
  try { localStorage.setItem(FAVS_KEY, JSON.stringify(f.slice(0, FAVS_MAX))); } catch { /* storage unavailable */ }
}
const favKey = (c: string, r: string, d: number) => `${c}|${r}|${d}`;

type Screen =
  | { kind: 'place'; place: BusPlace }
  | { kind: 'route'; route: BusRoute; focusUid: string | null };

type NetState = { status: 'idle' | 'loading' | 'ok' | 'error'; network: BusNetwork | null; missing: BusCityCode[] };

interface EtaState {
  key: string;
  status: 'loading' | 'ok' | 'error';
  index: BusEtaIndex;
}

/** The text and colour of an ETA, with an expired reading shown as 無資料. */
function EtaValue({ eta, zh, large = false }: { eta: BusEta; zh: boolean; large?: boolean }) {
  if (eta.kind === 'minutes') {
    return (
      <span className={`${large ? 'text-[22px]' : 'text-lg'} font-black tabular-nums text-slate-900 dark:text-white whitespace-nowrap`}>
        {eta.minutes}<span className="text-xs font-bold ml-0.5">{zh ? ' 分' : ' min'}</span>
      </span>
    );
  }
  const tone =
    eta.kind === 'arriving' ? 'text-red-700 dark:text-red-400 font-black'
      : eta.kind === 'scheduled' ? 'text-slate-700 dark:text-slate-200 font-bold'
        : 'text-slate-500 dark:text-slate-400 font-bold';
  return <span className={`text-[13px] ${tone} whitespace-nowrap`}>{etaText(eta, zh)}</span>;
}

function RoutePill({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <span className={`inline-flex items-center justify-center ${small ? 'min-w-[34px] h-6 px-1.5 text-[12px] rounded-md' : 'min-w-[48px] h-8 px-2 text-sm rounded-[9px]'} bg-violet-700 text-white font-black tabular-nums shrink-0`}>
      {name}
    </span>
  );
}

// ── component ────────────────────────────────────────────────────────────────

interface Props {
  geoCoords?: { lat: number; lon: number } | null;
  /** A position this tab asked the browser for itself, handed back so App uses it too. */
  onAutoLocated?: (g: GeoCoords) => void;
}

export default function BusSearch({ geoCoords, onAutoLocated }: Props) {
  const { i18n } = useTranslation();
  const zh = i18n.language !== 'en';
  const S = zh ? ZH : EN;

  const [view, setView] = useState<'map' | 'list'>('map');
  const [me, setMe] = useState<{ lat: number; lon: number } | null>(null);
  const [center, setCenter] = useState<{ lat: number; lon: number; trigger: 'auto' | 'locate' } | null>(null);
  const [manualRegion, setManualRegion] = useState<BusRegionCode | null>(null);
  const [net, setNet] = useState<NetState>({ status: 'idle', network: null, missing: [] });
  const [netNonce, setNetNonce] = useState(0);
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [pad, setPad] = useState(false);
  const [padMode, setPadMode] = useState<'pad' | 'text'>(initialPadMode);
  const [padH, setPadH] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const padRef = useRef<HTMLDivElement | null>(null);
  const [scope, setScope] = useState<BusRegionCode | 'all' | null>(null);
  const [searchNet, setSearchNet] = useState<NetState>({ status: 'idle', network: null, missing: [] });
  const [screens, setScreens] = useState<Screen[]>([]);
  const [favs, setFavs] = useState<Fav[]>(() => readFavs());
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [mapView, setMapView] = useState<BusMapView | null>(null);
  const [fitNonce, setFitNonce] = useState(0);
  const [eta, setEta] = useState<EtaState | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const userPlacedRef = useRef(false);
  const lastViewRef = useRef<BusMapView | null>(null);
  const lastInteractRef = useRef(Date.now());
  const topRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  const mapBoxRef = useRef<HTMLDivElement | null>(null);
  const [sheetH, setSheetH] = useState(SHEET_INITIAL);

  const screen = screens[screens.length - 1] ?? null;
  const searching = q.length > 0;
  const mapFill = useFillViewport(mapBoxRef, view === 'map' && !searching && !screen, { min: 340, max: 760 });

  useEffect(() => {
    const el = sheetRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setSheetH(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [view, screen, searching]);

  useEffect(() => {
    const bump = () => { lastInteractRef.current = Date.now(); };
    window.addEventListener('pointerdown', bump, { passive: true });
    window.addEventListener('keydown', bump);
    window.addEventListener('scroll', bump, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('keydown', bump);
      window.removeEventListener('scroll', bump);
    };
  }, []);

  // ── position (same rules as BikeSearch) ─────────────────────────────────
  useEffect(() => {
    if (userPlacedRef.current) return;
    const live = geoCoords || getCurrentGeo();
    const p = live ? { lat: live.lat, lon: live.lon } : (() => {
      const saved = getSavedLocation();
      return saved ? { lat: saved.lat, lon: saved.lon } : null;
    })();
    if (!p) return;
    setMe(p);
    setCenter({ ...p, trigger: 'auto' });
    setFitNonce((n) => n + 1);
  }, [geoCoords]);

  const geoCoordsRef = useRef(geoCoords);
  geoCoordsRef.current = geoCoords;
  const onAutoLocatedRef = useRef(onAutoLocated);
  onAutoLocatedRef.current = onAutoLocated;
  useEffect(() => {
    if (!isGeoSupported() || isAutomatedClient()) return;
    if (geoCoordsRef.current || getCurrentGeo() || getSavedLocation()) return;
    if (getGeoPref() !== 'granted') return;
    let cancelled = false;
    queryGeoPermission().then((state) => {
      if (cancelled || state === 'denied' || isGeoRequestPending()) return;
      if (geoCoordsRef.current || getCurrentGeo() || userPlacedRef.current) return;
      requestGeolocation(8000)
        .then((g) => {
          if (onAutoLocatedRef.current) { onAutoLocatedRef.current(g); return; }
          if (cancelled || userPlacedRef.current) return;
          const p = { lat: g.lat, lon: g.lon };
          setMe(p);
          setCenter({ ...p, trigger: 'auto' });
          setFitNonce((n) => n + 1);
        })
        .catch(() => { /* background: the empty state offers 使用目前位置 */ });
    });
    return () => { cancelled = true; };
  }, []);

  const locate = async () => {
    setLocating(true);
    setLocError(null);
    try {
      const geo = await requestGeolocation(8000, 0);
      saveLocation(geo);
      userPlacedRef.current = true;
      const p = { lat: geo.lat, lon: geo.lon };
      setMe(p);
      setManualRegion(null);
      setQuery('');
      setScreens([]);
      setCenter({ ...p, trigger: 'locate' });
      setFitNonce((n) => n + 1);
    } catch (err) {
      const denied = (err as GeolocationPositionError | undefined)?.code === 1;
      setLocError(denied ? S.locationDenied : S.locationFailed);
    } finally {
      setLocating(false);
    }
  };

  // ── which cities to load ────────────────────────────────────────────────
  const regionsHere = useMemo(() => (center ? busRegionsAt(center.lat, center.lon) : []), [center]);
  const activeRegions: BusRegionCode[] = manualRegion ? [manualRegion] : regionsHere;
  const activeKey = activeRegions.join('+');

  useEffect(() => {
    if (!activeKey) { setNet({ status: 'idle', network: null, missing: [] }); return; }
    let live = true;
    setNet((s) => ({ status: 'loading', network: s.network, missing: [] }));
    loadBusRegions(activeKey.split('+') as BusRegionCode[]).then((r) => {
      if (!live) return;
      setNet({ status: r.network ? 'ok' : 'error', network: r.network, missing: r.missing });
    });
    return () => { live = false; };
  }, [activeKey, netNonce]);

  // Search scope: the rider's choice, else where they are, else 臺北＋新北.
  const scopeRegions: BusRegionCode[] = scope === 'all' ? BUS_REGIONS.map((r) => r.code) : scope ? [scope] : activeRegions.length ? activeRegions : ['north'];
  const scopeKey = scopeRegions.join('+');
  useEffect(() => {
    if (scopeKey === activeKey && net.network) { setSearchNet(net); return; }
    let live = true;
    setSearchNet((s) => ({ status: 'loading', network: s.network, missing: [] }));
    loadBusRegions(scopeKey.split('+') as BusRegionCode[]).then((r) => {
      if (live) setSearchNet({ status: r.network ? 'ok' : 'error', network: r.network, missing: r.missing });
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, activeKey, net.network, netNonce]);

  // Typing filters at once on the device; a short pause keeps each keystroke from re-sorting.
  useEffect(() => {
    const v = query.trim();
    if (!v) { setQ(''); return; }
    const id = window.setTimeout(() => setQ(v), 120);
    return () => window.clearTimeout(id);
  }, [query]);

  const network = net.network;
  const nearby = useMemo(() => {
    if (!network || !center) return { list: [], radius: NEARBY_RADIUS_M };
    const close = nearbyPlaces(network, center.lat, center.lon, NEARBY_RADIUS_M, NEARBY_LIMIT);
    if (close.length) return { list: close, radius: NEARBY_RADIUS_M };
    return { list: nearbyPlaces(network, center.lat, center.lon, NEARBY_WIDE_M, NEARBY_LIMIT), radius: NEARBY_WIDE_M };
  }, [network, center]);

  const results = useMemo(
    () => (searching && searchNet.network ? searchBus(searchNet.network, q, { lat: me?.lat, lon: me?.lon }) : null),
    [searching, searchNet.network, q, me?.lat, me?.lon],
  );
  const keypad = useMemo(() => (searchNet.network ? busKeypad(searchNet.network) : { keys: [], words: [] }), [searchNet.network]);

  // Map pins: places in view, from the static data only.
  const pins: BusPin[] = useMemo(() => {
    if (!network || !mapView || mapView.zoom < MAP_PIN_MIN_ZOOM) return [];
    return nearbyPlaces(network, mapView.lat, mapView.lon, Math.min(mapView.radiusM, 4000), MAP_PIN_LIMIT).map(({ place }) => ({
      id: place.id,
      lat: place.lat,
      lon: place.lon,
      count: place.routeKeys.length,
      label: S.pinLabel(placeName(place, zh), place.routeKeys.length),
    }));
  }, [network, mapView, S, zh]);

  const fitTo = useMemo(() => {
    if (center) return { lat: center.lat, lon: center.lon, zoom: 16 };
    const r = manualRegion ? busRegionInfo(manualRegion) : null;
    if (r) return { lat: (r.bbox[0] + r.bbox[2]) / 2, lon: (r.bbox[1] + r.bbox[3]) / 2, zoom: 13 };
    return null;
  }, [center, manualRegion]);

  // ── favourites ──────────────────────────────────────────────────────────
  const toggleFav = (row: BusPlaceRow) => {
    const k = favKey(row.route.city, row.route.uid, row.direction);
    setFavs((prev) => {
      const has = prev.some((f) => favKey(f.c, f.r, f.d) === k && f.s.some((s) => row.stopUids.includes(s)));
      const next = has
        ? prev.filter((f) => !(favKey(f.c, f.r, f.d) === k && f.s.some((s) => row.stopUids.includes(s))))
        : [{ c: row.route.city, r: row.route.uid, d: row.direction, s: [...row.stopUids].sort() }, ...prev].slice(0, FAVS_MAX);
      writeFavs(next);
      return next;
    });
  };
  const isFav = (row: BusPlaceRow) =>
    favs.some((f) => f.c === row.route.city && f.r === row.route.uid && f.d === row.direction && f.s.some((s) => row.stopUids.includes(s)));

  /** Saved route+stop pairs this network can show, each with its stop's place. */
  const favRows = useMemo(() => {
    if (!network) return { rows: [], elsewhere: favs.length };
    const rows: { fav: Fav; route: BusRoute; place: BusPlace | null; toward: { nameZh: string; nameEn: string } }[] = [];
    let elsewhere = 0;
    for (const f of favs) {
      const route = network.routeByKey.get(`${f.c}|${f.r}`);
      if (!route) { elsewhere++; continue; }
      let place: BusPlace | null = null;
      let pattern: BusPattern | null = null;
      for (const p of route.patterns) {
        const s = p.stops.find((x) => f.s.includes(x.uid));
        if (s && (!pattern || p.stops.length > pattern.stops.length)) { pattern = p; place = s.station.place; }
      }
      if (!pattern) { elsewhere++; continue; }
      rows.push({ fav: f, route, place, toward: pattern.stops[pattern.stops.length - 1].station });
    }
    return { rows, elsewhere };
  }, [network, favs]);

  // ── arrival times: one target at a time ─────────────────────────────────
  const etaTarget = useMemo((): { key: string; load: (fresh: boolean) => Promise<BusEtaIndex> } | null => {
    if (screen?.kind === 'place') {
      const stops = placeSides(screen.place).flatMap((s) => s.rows.flatMap((r) => r.stopUids.map((uid) => ({ city: r.route.city, uid }))));
      const key = `place:${screen.place.id}`;
      return { key, load: (fresh) => getBusStopsEta(stops, fresh) };
    }
    if (screen?.kind === 'route') {
      const r = screen.route;
      return { key: `route:${r.key}`, load: (fresh) => getBusRouteEta(r.city, r.nameZh, r.uid, fresh) };
    }
    if (!screen && view === 'list' && !searching && favRows.rows.length) {
      const stops = favRows.rows.flatMap((x) => x.fav.s.map((uid) => ({ city: x.fav.c, uid })));
      const key = `favs:${stops.map((s) => s.uid).sort().join(',')}`;
      return { key, load: (fresh) => getBusStopsEta(stops, fresh) };
    }
    return null;
  }, [screen, view, searching, favRows]);

  const etaSeqRef = useRef(0);
  const loadEta = useCallback(async (target: NonNullable<typeof etaTarget>, kind: 'first' | 'poll' | 'manual') => {
    const seq = ++etaSeqRef.current;
    if (kind === 'first') setEta({ key: target.key, status: 'loading', index: emptyEtaIndex() });
    if (kind === 'manual') setRefreshing(true);
    try {
      const index = await target.load(kind === 'manual');
      if (seq !== etaSeqRef.current) return;
      setEta((prev) => {
        if (index.rows > 0) return { key: target.key, status: 'ok', index };
        // A failed refresh keeps the last real reading (its time is shown and it expires).
        if (prev && prev.key === target.key && prev.index.rows > 0) return { ...prev, status: 'error' };
        return { key: target.key, status: 'error', index };
      });
    } finally {
      if (kind === 'manual') setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!etaTarget) { setEta(null); return; }
    loadEta(etaTarget, 'first');
    const tick = () => {
      if (document.hidden) return;
      if (Date.now() - lastInteractRef.current > IDLE_STOP_MS) return;
      loadEta(etaTarget, 'poll');
    };
    const id = window.setInterval(tick, POLL_MS);
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // The key, not the object identity, decides when to start over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etaTarget?.key, loadEta]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const etaIndex = eta && etaTarget && eta.key === etaTarget.key ? eta.index : null;
  const etaExpired = !!etaIndex && isEtaExpired(etaIndex.asOf, now);
  const etaOf = (routeUid: string, stopUids: readonly string[]): BusEta =>
    !etaIndex || etaExpired ? NO_ETA : etaFor(etaIndex, routeUid, stopUids);

  // ── navigation ──────────────────────────────────────────────────────────
  const scrollTop = () => topRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
  const openPlace = (place: BusPlace) => { setPad(false); setScreens((s) => [...s, { kind: 'place', place }]); scrollTop(); };
  const openRoute = (route: BusRoute, focusUid: string | null) => { setPad(false); setScreens((s) => [...s, { kind: 'route', route, focusUid }]); scrollTop(); };
  const back = () => { setScreens((s) => s.slice(0, -1)); scrollTop(); };

  // ── route keypad ───────────────────────────────────────────────────────
  // The input runs with inputMode="none" while the keypad is the rider's choice, so focusing it
  // opens the keypad instead of the phone keyboard; the keyboard key switches back (and is
  // remembered). inputMode is also set on the element directly: iOS only raises the keyboard
  // for a focus() made inside the same tap.
  const revealForm = () => {
    const el = formRef.current;
    if (el && el.getBoundingClientRect().top > window.innerHeight * 0.3) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const showPad = () => {
    const el = inputRef.current;
    if (el) { el.inputMode = 'none'; el.blur(); }
    setPadMode('pad');
    savePadMode('pad');
    setPad(true);
    revealForm();
  };
  const switchToKeyboard = () => {
    const el = inputRef.current;
    setPad(false);
    setPadMode('text');
    savePadMode('text');
    if (el) { el.inputMode = 'search'; el.blur(); el.focus(); }
  };
  const onInputFocus = () => {
    if (padMode !== 'pad' || pad) return;
    setPad(true);
    revealForm();
  };
  useEffect(() => {
    if (!pad) return;
    // A tap elsewhere closes it (a click, so scrolling the results under it does not).
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && (padRef.current?.contains(t) || formRef.current?.contains(t))) return;
      setPad(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPad(false); };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    const el = padRef.current;
    const ro = el && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => setPadH(Math.round(el.getBoundingClientRect().height))) : null;
    if (el) { setPadH(Math.round(el.getBoundingClientRect().height)); ro?.observe(el); }
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      ro?.disconnect();
    };
  }, [pad]);

  // ── query log ───────────────────────────────────────────────────────────
  const regionLabel = (codes: readonly BusRegionCode[]) => codes.join('+') || 'none';
  const loggedNearbyRef = useRef('');
  useEffect(() => {
    if (searching || !center || !nearby.list.length) return;
    const key = `${center.lat.toFixed(3)},${center.lon.toFixed(3)}`;
    if (loggedNearbyRef.current === key) return;
    const top = nearby.list[0].place;
    const count = nearby.list.length;
    const trigger = center.trigger;
    const timer = window.setTimeout(() => {
      loggedNearbyRef.current = key;
      logQuery({ transportType: 'bus', originStationId: placeStopUid(top), originStationName: top.nameZh, queryDate: taiwanDateString(), activeFilter: `nearby:${trigger}`, resultCount: count });
    }, LOG_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [searching, center, nearby]);

  const loggedSearchRef = useRef('');
  useEffect(() => {
    if (!searching || !results || searchNet.status === 'loading') return;
    const key = `${q}|${scopeKey}`;
    if (loggedSearchRef.current === key) return;
    const first = results.routes[0]?.route.uid ?? (results.places[0] ? placeStopUid(results.places[0].place) : `?${q}`.slice(0, 20));
    const count = results.routes.length + results.places.length;
    const timer = window.setTimeout(() => {
      loggedSearchRef.current = key;
      logQuery({ transportType: 'bus', originStationId: first, originStationName: q.slice(0, 100), queryDate: taiwanDateString(), activeFilter: `search:${scope === 'all' ? 'all' : regionLabel(scopeRegions)}`, resultCount: count });
    }, LOG_SETTLE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching, results, q, scopeKey, searchNet.status]);

  const loggedScreensRef = useRef(new Set<string>());
  useEffect(() => {
    if (!screen) return;
    const id = screen.kind === 'place' ? placeStopUid(screen.place) : screen.route.uid;
    const k = `${screen.kind}:${id}`;
    if (loggedScreensRef.current.has(k)) return;
    loggedScreensRef.current.add(k);
    if (screen.kind === 'place') {
      const cities = [...new Set(screen.place.stations.map((s) => busCityInfo(s.city)?.region ?? s.city))];
      logQuery({ transportType: 'bus', originStationId: id, originStationName: screen.place.nameZh, queryDate: taiwanDateString(), activeFilter: `stop:${cities.join('+')}`, resultCount: screen.place.routeKeys.length });
    } else {
      logQuery({ transportType: 'bus', originStationId: id, originStationName: screen.route.nameZh, queryDate: taiwanDateString(), activeFilter: `route:${screen.route.city}`, resultCount: 1 });
    }
  }, [screen]);

  // ── rendering ───────────────────────────────────────────────────────────
  const statusPill = (
    <EtaStatus S={S} eta={eta && etaTarget && eta.key === etaTarget.key ? eta : null} expired={etaExpired} refreshing={refreshing} onRefresh={() => etaTarget && loadEta(etaTarget, 'manual')} />
  );

  const regionNames = (codes: readonly BusRegionCode[]) => codes.map((c) => (zh ? busRegionInfo(c)?.zh : busRegionInfo(c)?.en) ?? c).join(zh ? '、' : ', ');
  const missingNames = (cities: readonly BusCityCode[]) => cities.map((c) => (zh ? busCityInfo(c)?.zh : busCityInfo(c)?.en) ?? c).join(zh ? '、' : ', ');

  if (screen?.kind === 'place') {
    return (
      <div ref={topRef} className="flex flex-col gap-3 scroll-mt-24">
        <PlacePage
          S={S} zh={zh} place={screen.place} me={me}
          onBack={back} status={statusPill}
          etaOf={etaOf} isFav={isFav} onFav={toggleFav}
          onRoute={(row) => openRoute(row.route, row.stopUids[0] ?? null)}
        />
        <p className="m-0 text-[11px] text-slate-500 dark:text-slate-400 text-center">{S.source}</p>
      </div>
    );
  }
  if (screen?.kind === 'route') {
    return (
      <div ref={topRef} className="flex flex-col gap-3 scroll-mt-24">
        <RoutePage
          S={S} zh={zh} route={screen.route} focusUid={screen.focusUid}
          onBack={back} status={statusPill}
          etaOf={etaOf} arriving={etaIndex && !etaExpired ? etaIndex.arrivingStops : null}
          onStop={(place) => place && openPlace(place)}
        />
        <p className="m-0 text-[11px] text-slate-500 dark:text-slate-400 text-center">{S.source}</p>
      </div>
    );
  }

  const noPosition = !center && !manualRegion;
  const outside = !!center && !manualRegion && regionsHere.length === 0;
  const firstLoading = net.status === 'loading' && !net.network;

  const viewBtn = (on: boolean) =>
    `min-h-[40px] px-3.5 sm:px-4 rounded-[10px] text-sm font-extrabold inline-flex items-center justify-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
      on ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm' : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
    }`;
  const chip = (on: boolean) =>
    `shrink-0 min-h-[36px] px-3.5 rounded-full text-[13px] font-bold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
      on ? 'bg-slate-900 border-slate-900 text-white dark:bg-white dark:text-slate-900 dark:border-white' : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300'
    }`;

  const regionChips = (onPick: (r: BusRegionCode) => void, selected: readonly BusRegionCode[]) => (
    <div className="flex flex-wrap gap-2">
      {BUS_REGIONS.map((r) => (
        <button key={r.code} type="button" aria-pressed={selected.length === 1 && selected[0] === r.code} onClick={() => onPick(r.code)} className={chip(selected.length === 1 && selected[0] === r.code)}>
          {zh ? r.zh : r.en}
        </button>
      ))}
    </div>
  );

  const placeCard = (place: BusPlace, distance: number | null, compact: boolean) => {
    const names = network ? placeRouteNames(network, place) : [];
    const shown = names.slice(0, compact ? 5 : 8);
    return (
      <button
        key={place.id}
        type="button"
        onClick={() => openPlace(place)}
        className={`${compact ? 'snap-start shrink-0 w-[240px]' : 'w-full'} text-left rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 px-3.5 py-3 flex flex-col gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500`}
      >
        <span className="flex items-start justify-between gap-2">
          <span className="text-[15px] font-extrabold text-slate-900 dark:text-white truncate">{placeName(place, zh)}</span>
          <span className="shrink-0 inline-flex items-center gap-0.5 text-xs font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap">
            {distance !== null ? distanceText(distance, S) : ''}
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </span>
        </span>
        <span className="flex flex-wrap gap-1.5">
          {shown.map((n) => <span key={n} className="px-2 py-0.5 rounded-lg bg-violet-50 dark:bg-violet-500/15 text-violet-800 dark:text-violet-200 text-[13px] font-black">{n}</span>)}
          {names.length > shown.length && <span className="px-1 py-0.5 text-[12px] font-bold text-slate-500 dark:text-slate-400">+{names.length - shown.length}</span>}
        </span>
      </button>
    );
  };

  return (
    <div ref={topRef} className="flex flex-col gap-3 sm:gap-4 scroll-mt-24">
      {/* The selected tab already names the page; the heading stays for screen readers. */}
      <h2 className="sr-only">{S.title} · {S.cities}</h2>

      {/* Search + locate */}
      <form ref={formRef} role="search" className="flex gap-2 scroll-mt-24" onSubmit={(e) => { e.preventDefault(); setQ(query.trim()); setPad(false); inputRef.current?.blur(); }}>
        <label className="flex-1 min-w-0 flex items-center gap-2 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 pl-3 pr-1 min-h-[46px] focus-within:ring-2 focus-within:ring-violet-500">
          <Search className="w-[18px] h-[18px] text-slate-500 shrink-0" aria-hidden="true" />
          <span className="sr-only">{S.searchLabel}</span>
          <input
            ref={inputRef}
            type="search"
            enterKeyHint="search"
            inputMode={padMode === 'pad' ? 'none' : 'search'}
            onFocus={onInputFocus}
            onClick={onInputFocus}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={S.placeholder}
            autoComplete="off"
            className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[15px] text-slate-900 dark:text-white placeholder:text-slate-400 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label={S.clear} className="w-10 h-10 rounded-xl inline-flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={() => (pad ? setPad(false) : showPad())}
            aria-label={S.pad}
            aria-expanded={pad}
            title={S.pad}
            className={`w-10 h-10 rounded-xl inline-flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${pad ? 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200' : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'}`}
          >
            <Grid3x3 className="w-[18px] h-[18px]" aria-hidden="true" />
          </button>
        </label>
        {isGeoSupported() && (
          <button
            type="button"
            onClick={locate}
            disabled={locating}
            aria-label={locating ? S.locating : S.locate}
            title={S.locate}
            className="w-[46px] h-[46px] shrink-0 rounded-2xl border border-violet-200 dark:border-violet-400/30 bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 inline-flex items-center justify-center hover:bg-violet-100 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            {locating ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> : <Crosshair className="w-5 h-5" aria-hidden="true" />}
          </button>
        )}
      </form>
      {locError && <p role="alert" className="m-0 text-sm font-bold text-red-700 dark:text-red-300">{locError}</p>}

      {searching ? (
        <SearchResults
          S={S} zh={zh} q={q} results={results} loading={searchNet.status === 'loading' && !searchNet.network}
          failed={searchNet.status === 'error'} missing={searchNet.missing.length ? missingNames(searchNet.missing) : ''}
          scope={scope} scopeRegions={scopeRegions} onScope={setScope} chip={chip}
          multiCity={new Set(scopeRegions.flatMap((r) => busRegionInfo(r)?.cities ?? [])).size > 1}
          onRoute={(r) => openRoute(r, null)} onPlace={openPlace} networkOf={searchNet.network}
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex items-center gap-1.5 text-sm font-bold text-slate-700 dark:text-slate-200">
              {center && !outside ? (
                <>
                  <MapPin className="w-4 h-4 text-violet-700 dark:text-violet-300 shrink-0" aria-hidden="true" />
                  <span className="truncate">{S.nearHere}{activeRegions.length ? ` · ${regionNames(activeRegions)}` : ''}</span>
                </>
              ) : manualRegion ? (
                <span className="truncate">{regionNames([manualRegion])}</span>
              ) : null}
            </div>
            <div role="group" aria-label={S.viewLabel} className="shrink-0 inline-flex rounded-[13px] bg-slate-100 dark:bg-white/5 p-[3px]">
              <button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')} className={viewBtn(view === 'map')}>
                <MapIcon className="w-4 h-4" aria-hidden="true" />{S.map}
              </button>
              <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} className={viewBtn(view === 'list')}>
                <List className="w-4 h-4" aria-hidden="true" />{S.list}
              </button>
            </div>
          </div>

          {(noPosition || outside) && (
            <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-violet-300 dark:border-violet-400/30 bg-white dark:bg-white/5 px-4 py-3">
              <div className="flex items-center gap-3">
                <p className="m-0 flex-1 text-sm font-bold text-slate-700 dark:text-slate-200 leading-relaxed">{outside ? S.unsupported : S.needLocation}</p>
                {noPosition && isGeoSupported() && (
                  <button type="button" onClick={locate} disabled={locating} className="shrink-0 min-h-[40px] px-4 rounded-xl bg-violet-700 text-white text-sm font-extrabold disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-violet-500">
                    {S.locate}
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{S.chooseRegion}</span>
                {regionChips((r) => { setManualRegion(r); setFitNonce((n) => n + 1); }, manualRegion ? [manualRegion] : [])}
              </div>
            </div>
          )}
          {manualRegion && center && (
            <button type="button" onClick={() => { setManualRegion(null); setFitNonce((n) => n + 1); }} className="self-start text-sm font-bold text-violet-700 dark:text-violet-300 underline underline-offset-4">
              {S.nearHere}
            </button>
          )}

          {net.status === 'error' && (
            <div role="alert" className="flex items-center gap-3 rounded-2xl border border-red-200 dark:border-red-500/30 bg-white dark:bg-red-500/5 px-4 py-2.5">
              <AlertTriangle className="w-5 h-5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
              <p className="m-0 flex-1 text-sm font-black text-red-800 dark:text-red-300">{S.dataFailed}</p>
              <button type="button" onClick={() => setNetNonce((n) => n + 1)} className="shrink-0 min-h-[40px] px-4 rounded-xl bg-violet-700 text-white text-sm font-extrabold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-violet-500">{S.retry}</button>
            </div>
          )}
          {net.missing.length > 0 && net.network && (
            <p className="m-0 text-sm font-bold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-2xl px-4 py-2.5">{S.dataMissing(missingNames(net.missing))}</p>
          )}

          {view === 'map' ? (
            <div ref={mapBoxRef} style={mapFill} className="relative isolate -mx-5 sm:mx-0 h-[68vh] min-h-[340px] max-h-[760px] sm:rounded-3xl overflow-hidden border-y sm:border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-slate-800">
              <BusMap
                pins={pins}
                selectedId={null}
                onSelect={(id) => { const p = id && network ? network.placeById.get(id) : null; if (p) openPlace(p); }}
                me={me}
                fitKey={`${fitNonce}`}
                fitTo={fitTo}
                bottomInset={sheetH}
                initialView={lastViewRef.current}
                onViewSettled={(v) => { lastViewRef.current = v; setMapView(v); }}
                ariaLabel={S.mapLabel}
              />
              {network && mapView && mapView.zoom < MAP_PIN_MIN_ZOOM && (
                <span className="absolute z-[1000] left-1/2 -translate-x-1/2 top-3 rounded-full bg-slate-900/90 text-white text-xs font-bold px-3 py-1.5 shadow">{S.zoomIn}</span>
              )}
              {/* The one locate button is beside the search box. */}
              <section
                ref={sheetRef}
                aria-label={S.nearbyCount(nearby.list.length)}
                className="absolute z-[1000] inset-x-0 bottom-0 sm:left-4 sm:right-auto sm:bottom-4 sm:w-[400px] flex flex-col overflow-hidden bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-[0_-10px_30px_rgba(15,23,42,0.14)] border-t sm:border border-slate-200 dark:border-white/10"
                style={{ maxHeight: '62%' }}
              >
                <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                  <h3 className="m-0 text-[15px] font-black text-slate-900 dark:text-white">{S.nearbyCount(nearby.list.length)}</h3>
                  {nearby.list.length > 0 && <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{S.byDistance}</span>}
                </div>
                {firstLoading ? (
                  <p className="m-0 px-4 pb-4 text-sm font-bold text-slate-600 dark:text-slate-300 inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-violet-700" aria-hidden="true" />{S.loading}</p>
                ) : !center ? (
                  <p className="m-0 px-4 pb-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{manualRegion ? S.zoomIn : S.needLocation}</p>
                ) : network && !nearby.list.length && !outside ? (
                  <p className="m-0 px-4 pb-4 text-sm font-bold text-slate-700 dark:text-slate-200">{S.noneNearby(distanceText(nearby.radius, S))}</p>
                ) : (
                  <div className="flex gap-2.5 overflow-x-auto px-4 pb-4 snap-x soft-scrollbar">
                    {nearby.list.map((n) => placeCard(n.place, n.distance, true))}
                  </div>
                )}
              </section>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              <section aria-label={S.favs} className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 px-4 py-3 flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="m-0 inline-flex items-center gap-1.5 text-[15px] font-black text-slate-900 dark:text-white">
                    <Star className="w-4 h-4 fill-amber-400 text-amber-600" aria-hidden="true" />{S.favs}
                  </h3>
                  {favRows.rows.length > 0 && statusPill}
                </div>
                {favRows.rows.length === 0 ? (
                  <p className="m-0 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{S.favsEmpty}</p>
                ) : (
                  <ul className="m-0 p-0 list-none">
                    {[...favRows.rows]
                      .map((x) => ({ ...x, eta: etaOf(x.route.uid, x.fav.s) }))
                      .sort((a, b) => etaRank(a.eta) - etaRank(b.eta))
                      .map((x) => (
                        <li key={`${x.fav.c}|${x.fav.r}|${x.fav.d}|${x.fav.s.join(',')}`} className="border-t first:border-t-0 border-slate-100 dark:border-white/10">
                          <button
                            type="button"
                            onClick={() => openRoute(x.route, x.fav.s[0])}
                            className="w-full text-left flex items-center gap-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded-lg"
                          >
                            <RoutePill name={routeName(x.route, zh)} />
                            <span className="flex-1 min-w-0 flex flex-col">
                              <span className="text-sm font-bold text-slate-900 dark:text-white truncate">{S.toward(stationName(x.toward, zh))}</span>
                              <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{x.place ? placeName(x.place, zh) : ''}</span>
                            </span>
                            <EtaValue eta={x.eta} zh={zh} />
                            <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                  </ul>
                )}
                {favRows.elsewhere > 0 && <p className="m-0 text-xs text-slate-500 dark:text-slate-400">{S.favsElsewhere(favRows.elsewhere)}</p>}
              </section>
              {center && (
                <h3 className="m-0 mt-2 text-[15px] font-black text-slate-900 dark:text-white">{S.nearbyCount(nearby.list.length)}</h3>
              )}
              {firstLoading && <p className="m-0 text-sm font-bold text-slate-600 dark:text-slate-300 inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-violet-700" aria-hidden="true" />{S.loading}</p>}
              {center && network && !nearby.list.length && !outside && <p className="m-0 text-sm font-bold text-slate-700 dark:text-slate-200">{S.noneNearby(distanceText(nearby.radius, S))}</p>}
              <ul className="m-0 p-0 list-none flex flex-col gap-2.5">
                {nearby.list.map((n) => <li key={n.place.id}>{placeCard(n.place, n.distance, false)}</li>)}
              </ul>
            </div>
          )}
        </>
      )}

      <p className="m-0 text-[11px] text-slate-500 dark:text-slate-400 text-center">
        {S.source}{network?.updated ? ` ${S.snapshot(dateOf(network.updated))}` : ''}
      </p>

      {pad && (
        <>
          {/* Room under the results, so the last of them can scroll above the keypad. */}
          <div aria-hidden="true" style={{ height: padH }} />
          <BusKeypad
            panelRef={padRef}
            keys={keypad.keys}
            words={keypad.words}
            labels={{ pad: S.pad, words: S.padWords, hide: S.padHide, keyboard: S.padKeyboard, clear: S.padClear, backspace: S.padBackspace }}
            onType={(t) => setQuery((v) => v + t)}
            onWord={(w) => setQuery(w)}
            onClear={() => setQuery('')}
            onBackspace={() => setQuery((v) => Array.from(v).slice(0, -1).join(''))}
            onKeyboard={switchToKeyboard}
            onHide={() => setPad(false)}
          />
        </>
      )}
    </div>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────────

function EtaStatus({ S, eta, expired, refreshing, onRefresh }: { S: Strings; eta: EtaState | null; expired: boolean; refreshing: boolean; onRefresh: () => void }) {
  let label: ReactNode = null;
  if (!eta || (eta.status === 'loading' && eta.index.rows === 0)) {
    label = <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300"><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />{S.etaLoading}</span>;
  } else if (eta.index.rows === 0) {
    label = <span className="text-xs font-extrabold text-red-700 dark:text-red-300">{S.etaFailed}</span>;
  } else if (eta.status === 'error' || expired) {
    label = <span className="text-xs font-extrabold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-white/10 rounded-full px-2 py-1">{S.stale(clockOf(eta.index.asOf))}</span>;
  } else {
    label = (
      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-green-700 dark:text-green-400">
        <span className="w-1.5 h-1.5 rounded-full bg-green-600" aria-hidden="true" />{S.live(clockOf(eta.index.asOf))}
      </span>
    );
  }
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      {label}
      <button
        type="button"
        onClick={onRefresh}
        aria-label={S.refresh}
        title={S.refresh}
        className="w-9 h-9 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 inline-flex items-center justify-center text-slate-600 dark:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
      >
        <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
      </button>
    </div>
  );
}

function BackHeader({ S, onBack, title, subtitle, action }: { S: Strings; onBack: () => void; title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <button
        type="button"
        onClick={onBack}
        aria-label={S.back}
        className="w-11 h-11 shrink-0 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 inline-flex items-center justify-center text-slate-700 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
      >
        <ArrowLeft className="w-5 h-5" aria-hidden="true" />
      </button>
      <div className="flex-1 min-w-0">
        <h2 className="m-0 text-xl font-black leading-snug text-slate-900 dark:text-white break-words">{title}</h2>
        {subtitle && <p className="m-0 mt-0.5 text-xs font-bold text-slate-600 dark:text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function PlacePage({ S, zh, place, me, onBack, status, etaOf, isFav, onFav, onRoute }: {
  S: Strings; zh: boolean; place: BusPlace; me: { lat: number; lon: number } | null;
  onBack: () => void; status: ReactNode;
  etaOf: (routeUid: string, stopUids: readonly string[]) => BusEta;
  isFav: (row: BusPlaceRow) => boolean; onFav: (row: BusPlaceRow) => void; onRoute: (row: BusPlaceRow) => void;
}) {
  const sides = useMemo(() => placeSides(place), [place]);
  const d = me ? haversineM(me.lat, me.lon, place.lat, place.lon) : null;
  const cities = [...new Set(place.stations.map((s) => (zh ? busCityInfo(s.city)?.zh : busCityInfo(s.city)?.en) ?? s.city))].join(zh ? '、' : ', ');
  const name = placeName(place, zh);
  const subtitle = [cities, d !== null && d <= WALK_MAX_M ? S.walk(distanceText(d, S), walkMinutes(d)) : d !== null ? distanceText(d, S) : ''].filter(Boolean).join(' · ');
  return (
    <section aria-label={name} className="flex flex-col gap-3">
      <BackHeader
        S={S}
        onBack={onBack}
        title={name}
        subtitle={subtitle}
        action={(
          <a
            href={googleWalkUrl(place.lat, place.lon)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={S.navigateAria(name)}
            className="shrink-0 min-h-[44px] px-3 rounded-xl bg-violet-700 hover:bg-violet-800 text-white no-underline inline-flex items-center gap-1.5 text-sm font-extrabold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-violet-500"
          >
            <Navigation className="w-4 h-4" aria-hidden="true" />{S.navigate}
          </a>
        )}
      />
      <div className="flex justify-end">{status}</div>
      {sides.map((side, i) => {
        const label = headingLabel(side.heading, zh);
        return (
          <section key={i} aria-label={sides.length > 1 ? S.side(i + 1, label) : name} className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden">
            {sides.length > 1 && (
              <h3 className="m-0 px-4 py-2 text-[13px] font-black text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-white/5 border-b border-slate-100 dark:border-white/10">{S.side(i + 1, label)}</h3>
            )}
            <ul className="m-0 p-0 list-none">
              {side.rows.map((row) => {
                const fav = isFav(row);
                const toward = row.loop ? S.loop : S.toward(zh ? row.towardZh : row.towardEn || row.towardZh);
                const rName = routeName(row.route, zh);
                return (
                  <li key={`${row.route.key}#${row.direction}`} className="flex items-center border-t first:border-t-0 border-slate-100 dark:border-white/10">
                    <button
                      type="button"
                      onClick={() => onFav(row)}
                      aria-pressed={fav}
                      aria-label={fav ? S.unfav(rName) : S.fav(rName)}
                      className="w-12 h-14 shrink-0 inline-flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500"
                    >
                      <Star className={`w-5 h-5 ${fav ? 'fill-amber-400 text-amber-600' : 'text-slate-400'}`} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRoute(row)}
                      aria-label={`${S.openRoute(rName, row.loop ? S.loop : zh ? row.towardZh : row.towardEn || row.towardZh)}, ${etaText(etaOf(row.route.uid, row.stopUids), zh)}`}
                      className="flex-1 min-w-0 min-h-[56px] pr-3 flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500"
                    >
                      <RoutePill name={rName} />
                      <span className="flex-1 min-w-0 text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{toward}</span>
                      <EtaValue eta={etaOf(row.route.uid, row.stopUids)} zh={zh} />
                      <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <p className="m-0 text-xs text-slate-500 dark:text-slate-400">{S.etaNote}</p>
    </section>
  );
}

function RoutePage({ S, zh, route, focusUid, onBack, status, etaOf, arriving, onStop }: {
  S: Strings; zh: boolean; route: BusRoute; focusUid: string | null;
  onBack: () => void; status: ReactNode;
  etaOf: (routeUid: string, stopUids: readonly string[]) => BusEta;
  arriving: Set<string> | null;
  onStop: (place: BusPlace | null) => void;
}) {
  const dirs = useMemo(() => routeDirections(route), [route]);
  const initial = Math.max(0, focusUid ? dirs.findIndex((p) => p.stops.some((s) => s.uid === focusUid)) : 0);
  const [dirIdx, setDirIdx] = useState(initial);
  useEffect(() => { setDirIdx(initial); /* a new route or focus starts on its own direction */ }, [route.key, focusUid]); // eslint-disable-line react-hooks/exhaustive-deps
  const pattern = dirs[Math.min(dirIdx, dirs.length - 1)];
  const focusRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: 'center', behavior: 'auto' });
  }, [pattern]);
  if (!pattern) return null;
  const last = (p: BusPattern) => p.stops[p.stops.length - 1].station;
  const rName = routeName(route, zh);
  const dep = zh ? route.depZh : route.depEn || route.depZh;
  const dest = zh ? route.destZh : route.destEn || route.destZh;
  const city = (zh ? busCityInfo(route.city)?.zh : busCityInfo(route.city)?.en) ?? route.city;
  return (
    <section aria-label={rName} className="flex flex-col gap-3">
      <BackHeader
        S={S}
        onBack={onBack}
        title={<span className="inline-flex items-center gap-2"><Bus className="w-5 h-5 text-violet-700 dark:text-violet-300" aria-hidden="true" />{rName}</span>}
        subtitle={<span className="inline-flex items-center gap-1 flex-wrap">{city} · {dep}<ArrowRightLeft className="w-3 h-3" aria-hidden="true" />{dest}</span>}
      />
      {dirs.length > 1 && (
        <div role="group" aria-label={S.direction} className="grid grid-cols-2 gap-1 rounded-[13px] bg-slate-100 dark:bg-white/5 p-[3px]">
          {dirs.map((p, i) => (
            <button
              key={i}
              type="button"
              aria-pressed={i === dirIdx}
              onClick={() => setDirIdx(i)}
              className={`min-h-[42px] px-2 rounded-[10px] text-sm font-extrabold truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                i === dirIdx ? 'bg-white dark:bg-slate-900 text-violet-800 dark:text-violet-200 shadow-sm' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              {S.toward(stationName(last(p), zh))}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{S.stopCount(pattern.stops.length)}</span>
        {status}
      </div>
      <ol className="m-0 p-0 list-none rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden">
        {pattern.stops.map((s, i) => {
          const focus = s.uid === focusUid;
          const here = !!arriving?.has(s.uid);
          const eta = etaOf(route.uid, [s.uid]);
          return (
            <li key={`${s.uid}-${i}`} ref={focus ? focusRef : undefined} className={`relative border-t first:border-t-0 border-slate-100 dark:border-white/10 ${focus ? 'bg-violet-50 dark:bg-violet-500/10' : ''}`}>
              <button
                type="button"
                onClick={() => onStop(s.station.place)}
                className="w-full min-h-[52px] pl-3 pr-3 flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500"
              >
                <span className="relative w-6 self-stretch flex justify-center shrink-0" aria-hidden="true">
                  <span className={`absolute w-[3px] bg-violet-200 dark:bg-violet-500/40 ${i === 0 ? 'top-1/2' : 'top-0'} ${i === pattern.stops.length - 1 ? 'bottom-1/2' : 'bottom-0'}`} />
                  {here ? (
                    <span className="relative z-10 self-center w-6 h-6 rounded-full bg-violet-700 text-white inline-flex items-center justify-center"><Bus className="w-3.5 h-3.5" /></span>
                  ) : (
                    <span className={`relative z-10 self-center w-3 h-3 rounded-full border-[3px] ${focus ? 'border-violet-700 bg-violet-700' : 'border-violet-400 bg-white dark:bg-slate-900'}`} />
                  )}
                </span>
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className={`text-sm truncate ${focus ? 'font-black text-violet-900 dark:text-violet-100' : 'font-bold text-slate-800 dark:text-slate-100'}`}>{stationName(s.station, zh)}</span>
                  {(focus || here) && (
                    <span className="text-[11px] font-black text-violet-700 dark:text-violet-300">{[focus ? S.yourStop : '', here ? S.busNear : ''].filter(Boolean).join(' · ')}</span>
                  )}
                </span>
                <EtaValue eta={eta} zh={zh} />
              </button>
            </li>
          );
        })}
      </ol>
      <p className="m-0 text-xs text-slate-500 dark:text-slate-400">{S.etaNote}</p>
    </section>
  );
}

function SearchResults({ S, zh, q, results, loading, failed, missing, scope, scopeRegions, onScope, chip, multiCity, onRoute, onPlace, networkOf }: {
  S: Strings; zh: boolean; q: string;
  results: ReturnType<typeof searchBus> | null; loading: boolean; failed: boolean; missing: string;
  scope: BusRegionCode | 'all' | null; scopeRegions: BusRegionCode[]; onScope: (s: BusRegionCode | 'all') => void;
  chip: (on: boolean) => string; multiCity: boolean;
  onRoute: (r: BusRoute) => void; onPlace: (p: BusPlace) => void; networkOf: BusNetwork | null;
}) {
  const ROUTES_SHOWN = 30;
  const PLACES_SHOWN = 20;
  const selected = scope ?? (scopeRegions.length === 1 ? scopeRegions[0] : null);
  const empty = !!results && results.routes.length === 0 && results.places.length === 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="-mx-5 sm:mx-0 px-5 sm:px-0 flex gap-2 overflow-x-auto soft-scrollbar pb-1" role="group" aria-label={S.scope}>
        {BUS_REGIONS.map((r) => (
          <button key={r.code} type="button" aria-pressed={selected === r.code} onClick={() => onScope(r.code)} className={chip(selected === r.code)}>{zh ? r.zh : r.en}</button>
        ))}
        <button type="button" aria-pressed={scope === 'all'} onClick={() => onScope('all')} className={chip(scope === 'all')}>{S.all}</button>
      </div>
      <p className="m-0 text-xs font-semibold text-slate-500 dark:text-slate-400">{S.foldHint}</p>
      {missing && !failed && <p className="m-0 text-sm font-bold text-amber-800 dark:text-amber-300">{S.dataMissing(missing)}</p>}
      {loading && <p className="m-0 text-sm font-bold text-slate-600 dark:text-slate-300 inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-violet-700" aria-hidden="true" />{S.loading}</p>}
      {failed && <p role="alert" className="m-0 text-sm font-bold text-red-700 dark:text-red-300">{S.dataFailed}</p>}
      {empty && (
        <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 px-4 py-4 flex flex-col gap-3 items-start">
          <p className="m-0 text-sm font-bold text-slate-700 dark:text-slate-200">{S.noResults(q)}</p>
          {scope !== 'all' && (
            <button type="button" onClick={() => onScope('all')} className="min-h-[40px] px-4 rounded-xl bg-violet-700 text-white text-sm font-extrabold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-violet-500">{S.searchAll}</button>
          )}
        </div>
      )}
      {results && results.routes.length > 0 && (
        <section aria-label={S.routes} className="flex flex-col gap-1.5">
          <h3 className="m-0 text-[15px] font-black text-slate-900 dark:text-white">{S.routes} <span className="text-sm text-slate-500">{results.routes.length}</span></h3>
          <ul className="m-0 p-0 list-none rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden">
            {results.routes.slice(0, ROUTES_SHOWN).map(({ route }) => (
              <li key={route.key} className="border-t first:border-t-0 border-slate-100 dark:border-white/10">
                <button type="button" onClick={() => onRoute(route)} className="w-full min-h-[54px] px-3 flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500">
                  <RoutePill name={routeName(route, zh)} />
                  <span className="flex-1 min-w-0 text-sm font-bold text-slate-700 dark:text-slate-200 truncate">
                    {zh ? route.depZh : route.depEn || route.depZh} ⇄ {zh ? route.destZh : route.destEn || route.destZh}
                  </span>
                  {multiCity && <span className="shrink-0 text-[11px] font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-white/10 rounded-full px-2 py-0.5">{(zh ? busCityInfo(route.city)?.zh : busCityInfo(route.city)?.en) ?? route.city}</span>}
                  <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          {results.routes.length > ROUTES_SHOWN && <p className="m-0 text-xs text-slate-500 dark:text-slate-400">{S.more(results.routes.length - ROUTES_SHOWN)}</p>}
        </section>
      )}
      {results && results.places.length > 0 && (
        <section aria-label={S.stops} className="flex flex-col gap-1.5">
          <h3 className="m-0 text-[15px] font-black text-slate-900 dark:text-white">{S.stops} <span className="text-sm text-slate-500">{results.places.length}</span></h3>
          <ul className="m-0 p-0 list-none rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden">
            {results.places.slice(0, PLACES_SHOWN).map(({ place, distance }) => {
              const names = networkOf ? placeRouteNames(networkOf, place) : [];
              return (
                <li key={place.id} className="border-t first:border-t-0 border-slate-100 dark:border-white/10">
                  <button type="button" onClick={() => onPlace(place)} className="w-full min-h-[54px] px-3 py-2 flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500">
                    <MapPin className="w-5 h-5 text-violet-700 dark:text-violet-300 shrink-0" aria-hidden="true" />
                    <span className="flex-1 min-w-0 flex flex-col">
                      <span className="text-sm font-extrabold text-slate-900 dark:text-white truncate">{placeName(place, zh)}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{names.slice(0, 8).join('、')}{names.length > 8 ? '…' : ''}</span>
                    </span>
                    {distance !== null && <span className="shrink-0 text-xs font-bold text-slate-500 dark:text-slate-400">{distanceText(distance, S)}</span>}
                    <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
          {results.places.length > PLACES_SHOWN && <p className="m-0 text-xs text-slate-500 dark:text-slate-400">{S.more(results.places.length - PLACES_SHOWN)}</p>}
        </section>
      )}
    </div>
  );
}
