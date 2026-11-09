/**
 * BikeSearch — the 單車 (YouBike) tab: nationwide docks around the rider, map first,
 * with a list view, rent/return modes, name search and saved docks.
 *
 * Data: /api/youbike (src/lib/youbikeFeed.ts). Every count comes from that live feed;
 * a failed refresh keeps the last real reading labelled with its time, and a failed
 * first load shows 「無法取得」 — never a guessed count. Polls every 60 s while the
 * tab is visible, and stops after 10 idle minutes until the rider interacts again.
 *
 * Location follows the app's rules (CLAUDE.md "Prompt geolocation only on first
 * visit"): it uses App's live fix or the recorded tap location and never prompts on
 * mount; the locate button asks with maximumAge 0 and records the tap location.
 *
 * Query log (existing `query_logs` table, transport_type 'bike'): once per settled
 * nearby result set, once per settled search, once per dock opened — never per poll.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bike, ChevronRight, Crosshair, List, Loader2, Map as MapIcon, MapPin, Navigation, RefreshCw, Search, Star, X, AlertTriangle } from 'lucide-react';
import { getYouBikeByIds, getYouBikeNearby, searchYouBike, type BikeDockWithDistance, type BikeQueryResult } from '../lib/api';
import { BIKE_AREAS, bikeAreaName } from '../lib/youbikeFeed';
import { getCurrentGeo, getGeoPref, getSavedLocation, isAutomatedClient, isGeoRequestPending, isGeoSupported, queryGeoPermission, requestGeolocation, saveLocation, type GeoCoords } from '../lib/geo';
import { logQuery } from '../lib/queryLogger';
import { taiwanDateString } from '../lib/taiwanDate';
import BikeMap, { dockLevel, type BikeMode, type MapView } from './BikeMap';

const POLL_MS = 60_000;
const IDLE_STOP_MS = 10 * 60_000;
const NEARBY_RADIUS_M = 1000;
const NEARBY_LIMIT = 30;
const LOG_SETTLE_MS = 2_000;
const FAVS_KEY = 'tw-bike-favs';
const FAVS_MAX = 20;
/** Sheet height before it is first measured (px); the sheet then sizes to its content. */
const SHEET_INITIAL = 196;

type Trigger = 'auto' | 'locate' | 'area';
interface QueryCenter { lat: number; lon: number; radius: number; trigger: Trigger }
interface Loadable {
  status: 'idle' | 'loading' | 'ok' | 'error';
  data: BikeQueryResult | null;
}

function readFavs(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(FAVS_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && /^\d{4,12}$/.test(x)).slice(0, FAVS_MAX) : [];
  } catch {
    return [];
  }
}
function writeFavs(ids: string[]) {
  try { localStorage.setItem(FAVS_KEY, JSON.stringify(ids.slice(0, FAVS_MAX))); } catch { /* storage unavailable */ }
}

function clockOf(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false });
}

function distanceDisplay(m: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  return m < 1000 ? t('bike.meters', { n: Math.round(m / 5) * 5 || m }) : t('bike.km', { n: (m / 1000).toFixed(1) });
}
const walkMinutes = (m: number) => Math.max(1, Math.round(m / 75));
/** Beyond this a walking time is meaningless (a search can match docks in another city). */
const WALK_MAX_M = 3000;
function distanceLine(d: BikeDockWithDistance, t: (k: string, o?: Record<string, unknown>) => string, zh: boolean): string {
  if (d.distance === null) return bikeAreaName(d.area, zh);
  if (d.distance > WALK_MAX_M) return `${distanceDisplay(d.distance, t)} · ${bikeAreaName(d.area, zh)}`;
  return `${distanceDisplay(d.distance, t)} · ${t('bike.walkMinutes', { minutes: walkMinutes(d.distance) })}`;
}

/** Count the rider is deciding on in this mode. */
const countOf = (d: BikeDockWithDistance, mode: BikeMode) => (mode === 'rent' ? d.bikes : d.docks);

/** The nearest dock that comfortably serves the mode (3+), else the nearest with any. */
function pickHighlight(docks: BikeDockWithDistance[], mode: BikeMode): BikeDockWithDistance | null {
  const open = docks.filter(d => !d.suspended);
  return open.find(d => countOf(d, mode) >= 3) ?? open.find(d => countOf(d, mode) >= 1) ?? null;
}

function googleWalkUrl(d: BikeDockWithDistance): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}&travelmode=walking`;
}

interface Props {
  geoCoords?: { lat: number; lon: number } | null;
  /** A position this tab asked the browser for itself, handed back so App (台鐵／高鐵) uses it too. */
  onAutoLocated?: (g: GeoCoords) => void;
}

export default function BikeSearch({ geoCoords, onAutoLocated }: Props) {
  const { t, i18n } = useTranslation();
  const zh = i18n.language !== 'en';
  const nameOf = (d: BikeDockWithDistance) => (zh ? d.name : d.nameEn || d.name);

  const [mode, setMode] = useState<BikeMode>('rent');
  const [view, setView] = useState<'map' | 'list'>('map');
  const [me, setMe] = useState<{ lat: number; lon: number } | null>(null);
  const [center, setCenter] = useState<QueryCenter | null>(null);
  const [nearby, setNearby] = useState<Loadable>({ status: 'idle', data: null });
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [area, setArea] = useState<string | null>(null);
  const [search, setSearch] = useState<Loadable>({ status: 'idle', data: null });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [favIds, setFavIds] = useState<string[]>(() => readFavs());
  const [favs, setFavs] = useState<BikeDockWithDistance[]>([]);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [areaPrompt, setAreaPrompt] = useState<MapView | null>(null);
  const [fitNonce, setFitNonce] = useState(0);
  const [searchNonce, setSearchNonce] = useState(0);

  const userPlacedRef = useRef(false);
  const lastViewRef = useRef<MapView | null>(null);
  // The sheet over the map is as tall as its content, so a short dock detail does not
  // leave an empty band covering the map; its measured height is what the map keeps clear.
  const sheetRef = useRef<HTMLElement | null>(null);
  const [sheetH, setSheetH] = useState(SHEET_INITIAL);
  useEffect(() => {
    const el = sheetRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setSheetH(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);
  const lastInteractRef = useRef(Date.now());
  const loadSeqRef = useRef(0);

  const searching = submitted.length > 0;
  const active: Loadable = searching ? search : nearby;
  const docks = active.data?.docks ?? [];
  const selected = selectedId ? docks.find(d => d.id === selectedId) ?? favs.find(d => d.id === selectedId) ?? null : null;
  const highlight = useMemo(() => (searching ? null : pickHighlight(docks, mode)), [docks, mode, searching]);
  const ordered = useMemo(() => {
    if (!highlight) return docks;
    return [highlight, ...docks.filter(d => d.id !== highlight.id)];
  }, [docks, highlight]);

  // Any interaction resumes polling after the idle stop.
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

  // Position: App's live fix, else the recorded tap location. Never prompts here.
  useEffect(() => {
    if (userPlacedRef.current) return;
    const live = geoCoords || getCurrentGeo();
    const p = live ? { lat: live.lat, lon: live.lon } : (() => {
      const saved = getSavedLocation();
      return saved ? { lat: saved.lat, lon: saved.lon } : null;
    })();
    if (!p) return;
    setMe(p);
    setCenter({ ...p, radius: NEARBY_RADIUS_M, trigger: 'auto' });
    setFitNonce(n => n + 1);
  }, [geoCoords]);

  // The rider allowed location before, but the browser has since forgotten it (Safari after
  // about a day) and no locate tap was ever recorded. App does not re-ask when 台鐵／高鐵 still
  // hold a cached nearest station, which leaves this tab with no position at all, so ask once
  // here — the same rule as App's: only after an earlier 'granted', never after 'denied' or an
  // unanswered first prompt, and never while another request (App's) is still waiting. A refusal
  // writes 'denied' (requestGeolocation), and it is never asked again. Background: no saved
  // location is written and no error is shown.
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
          // App passes the fix back down as geoCoords, and the effect above re-centres on it.
          if (onAutoLocatedRef.current) { onAutoLocatedRef.current(g); return; }
          if (cancelled || userPlacedRef.current) return;
          const p = { lat: g.lat, lon: g.lon };
          setMe(p);
          setCenter({ ...p, radius: NEARBY_RADIUS_M, trigger: 'auto' });
          setFitNonce(n => n + 1);
        })
        .catch(() => { /* background: the empty state already offers 使用目前位置 */ });
    });
    return () => { cancelled = true; };
  }, []);

  // Nearby docks for the current centre; polled while visible and not idle.
  const loadNearby = useCallback(async (c: QueryCenter, kind: 'first' | 'poll' | 'manual') => {
    const seq = ++loadSeqRef.current;
    if (kind === 'first') setNearby(s => ({ status: 'loading', data: s.data }));
    if (kind === 'manual') setRefreshing(true);
    try {
      const r = await getYouBikeNearby(c.lat, c.lon, c.radius, NEARBY_LIMIT);
      if (seq !== loadSeqRef.current) return;
      setNearby({ status: 'ok', data: r });
      // A new place (not a poll, not "search this area") frames its docks once.
      if (kind === 'first' && c.trigger !== 'area') setFitNonce(n => n + 1);
    } catch {
      if (seq !== loadSeqRef.current) return;
      // Keep the last real reading (its time is shown), never invent one.
      setNearby(s => ({ status: 'error', data: kind === 'first' ? null : s.data }));
    } finally {
      if (kind === 'manual') setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!center || searching) return;
    loadNearby(center, 'first');
    const tick = () => {
      if (document.hidden) return;
      if (Date.now() - lastInteractRef.current > IDLE_STOP_MS) return;
      loadNearby(center, 'poll');
    };
    const id = window.setInterval(tick, POLL_MS);
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [center, searching, loadNearby]);

  // Search: Enter submits at once; typing submits after a pause (2+ characters).
  useEffect(() => {
    const q = query.trim();
    if (!q) { setSubmitted(''); return; }
    if (q.length < 2) return;
    const id = window.setTimeout(() => setSubmitted(q), 450);
    return () => window.clearTimeout(id);
  }, [query]);

  useEffect(() => {
    if (!submitted) { setSearch({ status: 'idle', data: null }); return; }
    let live = true;
    setSearch(s => ({ status: 'loading', data: s.data }));
    searchYouBike(submitted, { area, lat: me?.lat, lon: me?.lon })
      .then(r => { if (live) { setSearch({ status: 'ok', data: r }); setFitNonce(n => n + 1); } })
      .catch(() => { if (live) setSearch({ status: 'error', data: null }); });
    return () => { live = false; };
  }, [submitted, area, me?.lat, me?.lon, searchNonce]);

  // Saved docks: fetched when the set changes or the list is opened (not polled).
  useEffect(() => {
    if (!favIds.length) { setFavs([]); return; }
    let live = true;
    getYouBikeByIds(favIds, me)
      .then(r => { if (live) setFavs(r.docks); })
      .catch(() => { /* the section just stays as it was */ });
    return () => { live = false; };
  }, [favIds, view, me]);

  // Selection that left the data set is dropped.
  useEffect(() => {
    if (selectedId && !docks.some(d => d.id === selectedId) && !favs.some(d => d.id === selectedId)) setSelectedId(null);
  }, [docks, favs, selectedId]);

  // ── query log ──────────────────────────────────────────────────────────
  const loggedNearbyRef = useRef('');
  useEffect(() => {
    if (searching || !center || nearby.status !== 'ok' || !nearby.data) return;
    const key = `${center.lat.toFixed(3)},${center.lon.toFixed(3)}:${mode}`;
    if (loggedNearbyRef.current === key) return;
    const data = nearby.data;
    const timer = window.setTimeout(() => {
      loggedNearbyRef.current = key;
      const top = pickHighlight(data.docks, mode) ?? data.docks[0];
      logQuery({
        transportType: 'bike',
        originStationId: top?.id ?? '',
        originStationName: top ? top.name : '',
        queryDate: taiwanDateString(),
        activeFilter: `nearby:${mode}:${center.trigger}`,
        resultCount: data.docks.length,
      });
    }, LOG_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [searching, center, nearby, mode]);

  const loggedSearchRef = useRef('');
  useEffect(() => {
    if (!searching || search.status !== 'ok' || !search.data) return;
    const key = `${submitted}|${area ?? ''}`;
    if (loggedSearchRef.current === key) return;
    const data = search.data;
    const timer = window.setTimeout(() => {
      loggedSearchRef.current = key;
      logQuery({
        transportType: 'bike',
        // A zero-result query still gets its own row (the dedupe keys on this id).
        originStationId: data.docks[0]?.id ?? `?${submitted}`.slice(0, 20),
        originStationName: submitted,
        queryDate: taiwanDateString(),
        activeFilter: `search:${area ?? 'all'}`,
        resultCount: data.docks.length,
      });
    }, LOG_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [searching, search, submitted, area]);

  const loggedDocksRef = useRef(new Set<string>());
  const openDock = (id: string | null) => {
    setSelectedId(id);
    if (!id || loggedDocksRef.current.has(id)) return;
    const d = docks.find(x => x.id === id) ?? favs.find(x => x.id === id);
    if (!d) return;
    loggedDocksRef.current.add(id);
    logQuery({
      transportType: 'bike',
      originStationId: d.id,
      originStationName: d.name,
      queryDate: taiwanDateString(),
      activeFilter: `dock:${mode}`,
      resultCount: 1,
    });
  };

  // ── actions ────────────────────────────────────────────────────────────
  const locate = async () => {
    setLocating(true);
    setLocError(null);
    try {
      const geo = await requestGeolocation(8000, 0);
      saveLocation(geo); // 按定位 = 記下這個位置，台鐵／高鐵／捷運共用
      userPlacedRef.current = true;
      const p = { lat: geo.lat, lon: geo.lon };
      setMe(p);
      setQuery('');
      setSubmitted('');
      setAreaPrompt(null);
      setSelectedId(null);
      setCenter({ ...p, radius: NEARBY_RADIUS_M, trigger: 'locate' });
      setFitNonce(n => n + 1);
    } catch (err) {
      const denied = (err as GeolocationPositionError | undefined)?.code === 1;
      setLocError(denied ? t('bike.locationDenied') : t('bike.locationFailed'));
    } finally {
      setLocating(false);
    }
  };

  const recenter = () => {
    if (!me) { locate(); return; }
    setAreaPrompt(null);
    if (center && (center.lat !== me.lat || center.lon !== me.lon)) {
      setCenter({ ...me, radius: NEARBY_RADIUS_M, trigger: 'auto' });
    }
    setFitNonce(n => n + 1);
  };

  const searchThisArea = () => {
    if (!areaPrompt) return;
    userPlacedRef.current = true;
    setSelectedId(null);
    setCenter({ lat: areaPrompt.lat, lon: areaPrompt.lon, radius: Math.min(3000, Math.max(300, areaPrompt.radiusM)), trigger: 'area' });
    setAreaPrompt(null);
  };

  const clearSearch = () => {
    setQuery('');
    setSubmitted('');
    setArea(null);
    setSelectedId(null);
    setFitNonce(n => n + 1);
  };

  const toggleFav = (id: string) => {
    setFavIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [id, ...prev].slice(0, FAVS_MAX);
      writeFavs(next);
      return next;
    });
  };

  const onUserMove = useCallback((v: MapView) => {
    if (submitted) return;
    const c = center;
    if (!c) { setAreaPrompt(v); return; }
    const dLat = (v.lat - c.lat) * 111_320;
    const dLon = (v.lon - c.lon) * 111_320 * Math.cos((c.lat * Math.PI) / 180);
    const moved = Math.hypot(dLat, dLon) > Math.max(150, c.radius * 0.3);
    const zoomedOut = v.radiusM > c.radius * 1.8;
    setAreaPrompt(moved || zoomedOut ? v : null);
  }, [center, submitted]);
  const onViewSettled = useCallback((v: MapView) => { lastViewRef.current = v; }, []);

  // ── status line ────────────────────────────────────────────────────────
  const asOf = active.data?.asOf ?? null;
  const isStale = !!active.data && (active.status === 'error' || active.data.stale);
  const placeLabel = (() => {
    if (searching) return null;
    const first = docks[0];
    const areaName = first ? bikeAreaName(first.area, zh) : '';
    const district = first ? (zh ? first.district : first.districtEn) : '';
    const where = [areaName, district].filter(Boolean).join(zh ? '' : ', ');
    if (!center) return null;
    return center.trigger === 'area' ? where : `${t('bike.nearHere')}${where ? ` · ${where}` : ''}`;
  })();

  const segBtn = (on: boolean) =>
    `min-h-[40px] px-3.5 sm:px-4 rounded-[10px] text-sm font-extrabold inline-flex items-center justify-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${
      on ? 'bg-orange-600 text-white shadow-sm' : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
    }`;
  const viewBtn = (on: boolean) =>
    `min-h-[40px] px-3.5 sm:px-4 rounded-[10px] text-sm font-extrabold inline-flex items-center justify-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${
      on ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm' : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
    }`;

  const noPosition = !center && !searching;
  const showNone = !searching && nearby.status === 'ok' && docks.length === 0;
  const showSearchNone = searching && search.status === 'ok' && docks.length === 0;
  const firstLoading = active.status === 'loading' && !active.data;
  const loadFailed = active.status === 'error' && !active.data;

  return (
    <div className="flex flex-col gap-3 sm:gap-4 mt-4 sm:mt-6">
      {/* Heading */}
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-xl sm:text-2xl font-black tracking-tight text-slate-900 dark:text-white">{t('bike.title')}</h2>
        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{t('bike.areas')}</span>
      </div>

      {/* Search + locate */}
      <form
        role="search"
        className="flex gap-2"
        onSubmit={e => { e.preventDefault(); const q = query.trim(); setSubmitted(q); }}
      >
        <label className="flex-1 min-w-0 flex items-center gap-2 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 pl-3 pr-1 min-h-[46px] focus-within:ring-2 focus-within:ring-orange-500">
          <Search className="w-[18px] h-[18px] text-slate-500 shrink-0" aria-hidden="true" />
          <span className="sr-only">{t('bike.searchLabel')}</span>
          <input
            type="search"
            enterKeyHint="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('bike.searchPlaceholder')}
            className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[15px] text-slate-900 dark:text-white placeholder:text-slate-400 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button type="button" onClick={clearSearch} aria-label={t('bike.clearSearch')} className="w-10 h-10 rounded-xl inline-flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </label>
        {isGeoSupported() && (
          <button
            type="button"
            onClick={locate}
            disabled={locating}
            aria-label={locating ? t('bike.locating') : t('bike.locate')}
            title={t('bike.locate')}
            className="w-[46px] h-[46px] shrink-0 rounded-2xl border border-orange-200 dark:border-orange-400/30 bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-300 inline-flex items-center justify-center hover:bg-orange-100 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          >
            {locating ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> : <Crosshair className="w-5 h-5" aria-hidden="true" />}
          </button>
        )}
      </form>
      {locError && <p role="alert" className="m-0 text-sm font-bold text-red-700 dark:text-red-300">{locError}</p>}

      {/* Mode + view */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div role="group" aria-label={t('bike.modeLabel')} className="inline-flex rounded-[13px] bg-slate-100 dark:bg-white/5 p-[3px]">
          <button type="button" aria-pressed={mode === 'rent'} onClick={() => setMode('rent')} className={segBtn(mode === 'rent')}>{t('bike.rent')}</button>
          <button type="button" aria-pressed={mode === 'return'} onClick={() => setMode('return')} className={segBtn(mode === 'return')}>{t('bike.return')}</button>
        </div>
        <div role="group" aria-label={t('bike.viewLabel')} className="inline-flex rounded-[13px] bg-slate-100 dark:bg-white/5 p-[3px]">
          <button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')} className={viewBtn(view === 'map')}>
            <MapIcon className="w-4 h-4" aria-hidden="true" />{t('bike.map')}
          </button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} className={viewBtn(view === 'list')}>
            <List className="w-4 h-4" aria-hidden="true" />{t('bike.list')}
          </button>
        </div>
      </div>

      {/* Area chips while searching */}
      {searching && (
        <div className="-mx-5 sm:mx-0 px-5 sm:px-0 flex gap-2 overflow-x-auto soft-scrollbar pb-1" role="group" aria-label={t('bike.allAreas')}>
          {[{ code: null as string | null, label: t('bike.allAreas') }, ...BIKE_AREAS.map(a => ({ code: a.code as string | null, label: zh ? a.zh : a.en }))].map(a => (
            <button
              key={a.code ?? 'all'}
              type="button"
              aria-pressed={area === a.code}
              onClick={() => setArea(a.code)}
              className={`shrink-0 min-h-[36px] px-3.5 rounded-full text-[13px] font-bold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${
                area === a.code ? 'bg-slate-900 border-slate-900 text-white dark:bg-white dark:text-slate-900 dark:border-white' : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* Status line */}
      <div className="flex items-center justify-between gap-3 min-h-[36px]">
        <div className="min-w-0 flex items-center gap-1.5 text-sm font-bold text-slate-700 dark:text-slate-200">
          {searching ? (
            <span className="truncate">
              {search.status === 'loading' ? t('bike.searching') : t('bike.results', { count: docks.length })}
              <span className="ml-2 text-xs font-semibold text-slate-500 dark:text-slate-400">{t('bike.foldHint')}</span>
            </span>
          ) : placeLabel ? (
            <>
              <MapPin className="w-4 h-4 text-orange-600 shrink-0" aria-hidden="true" />
              <span className="truncate">{placeLabel}</span>
            </>
          ) : null}
        </div>
        {active.data && (
          <div className="flex items-center gap-2 shrink-0">
            {isStale ? (
              <span className="text-xs font-extrabold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-white/10 rounded-full px-2 py-1">{t('bike.staleBadge', { time: clockOf(asOf) })}</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-green-700 dark:text-green-400">
                <span className="w-1.5 h-1.5 rounded-full bg-green-600" aria-hidden="true" />{t('bike.live', { time: clockOf(asOf) })}
              </span>
            )}
            {!searching && center && (
              <button
                type="button"
                onClick={() => loadNearby(center, 'manual')}
                aria-label={t('bike.refresh')}
                title={t('bike.refresh')}
                className="w-9 h-9 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 inline-flex items-center justify-center text-slate-600 dark:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Banners */}
      {active.data?.source === 'taipei' && (
        <p className="m-0 text-sm font-bold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-2xl px-4 py-2.5">{t('bike.taipeiFallback')}</p>
      )}
      {active.status === 'error' && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-red-200 dark:border-red-500/30 bg-white dark:bg-red-500/5 px-4 py-3">
          <AlertTriangle className="w-5 h-5 text-red-700 dark:text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="m-0 text-sm font-black text-red-800 dark:text-red-300">{t('bike.loadFailed')}</p>
            {active.data && <p className="m-0 mt-1 text-xs text-slate-600 dark:text-slate-300">{t('bike.loadFailedStale', { time: clockOf(asOf) })}</p>}
          </div>
          <button
            type="button"
            onClick={() => (searching ? setSearchNonce(n => n + 1) : center && loadNearby(center, 'manual'))}
            className="shrink-0 min-h-[40px] px-4 rounded-xl bg-orange-600 text-white text-sm font-extrabold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-orange-500"
          >
            {t('bike.retry')}
          </button>
        </div>
      )}
      {noPosition && (
        <div className="flex items-center gap-3 rounded-2xl border border-dashed border-orange-300 dark:border-orange-400/30 bg-white dark:bg-white/5 px-4 py-3">
          <p className="m-0 flex-1 text-sm font-bold text-slate-700 dark:text-slate-200 leading-relaxed">{t('bike.needLocation')}</p>
          {isGeoSupported() && (
            <button type="button" onClick={locate} disabled={locating} className="shrink-0 min-h-[40px] px-4 rounded-xl bg-orange-600 text-white text-sm font-extrabold disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-orange-500">
              {t('bike.locate')}
            </button>
          )}
        </div>
      )}

      {view === 'map' ? (
        <div className="relative isolate -mx-5 sm:mx-0 h-[68vh] min-h-[440px] max-h-[760px] sm:rounded-3xl overflow-hidden border-y sm:border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-slate-800">
          <BikeMap
            docks={docks}
            mode={mode}
            selectedId={selectedId}
            onSelect={openDock}
            me={me}
            fitKey={`${fitNonce}`}
            bottomInset={sheetH}
            initialView={lastViewRef.current}
            onUserMove={onUserMove}
            onViewSettled={onViewSettled}
          />

          {areaPrompt && !searching && (
            <button
              type="button"
              onClick={searchThisArea}
              className="absolute z-[1000] left-1/2 -translate-x-1/2 top-3 inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-full bg-slate-900 text-white text-sm font-extrabold shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-orange-500"
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />{t('bike.searchArea')}
            </button>
          )}

          {/* Legend + recenter, above the sheet */}
          <div className="absolute z-[1000] left-3 right-3 flex items-end justify-between gap-2 pointer-events-none" style={{ bottom: sheetH + 12 }}>
            <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-white/95 dark:bg-slate-900/90 px-2.5 py-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-200 shadow">
              <span>{mode === 'rent' ? t('bike.legendRent') : t('bike.legendReturn')}</span>
              <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-orange-600" aria-hidden="true" />{t('bike.legendMany')}</span>
              <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-white border-2 border-amber-500" aria-hidden="true" />{t('bike.legendFew')}</span>
              <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-slate-300" aria-hidden="true" />{mode === 'rent' ? t('bike.legendNoBikes') : t('bike.legendNoDocks')}</span>
            </div>
            <button
              type="button"
              onClick={recenter}
              aria-label={t('bike.recenter')}
              title={t('bike.recenter')}
              className="pointer-events-auto w-[46px] h-[46px] rounded-2xl bg-white dark:bg-slate-900 shadow-lg inline-flex items-center justify-center text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
            >
              <Crosshair className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>

          {/* Bottom sheet */}
          <section
            aria-label={selected ? nameOf(selected) : t('bike.nearbyCount', { count: docks.length })}
            className="absolute z-[1000] inset-x-0 bottom-0 sm:left-4 sm:right-auto sm:bottom-4 sm:w-[400px] flex flex-col overflow-hidden bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-[0_-10px_30px_rgba(15,23,42,0.14)] border-t sm:border border-slate-200 dark:border-white/10"
            ref={sheetRef}
            style={{ maxHeight: '62%' }}
          >
            {selected ? (
              <DockDetail dock={selected} mode={mode} zh={zh} fav={favIds.includes(selected.id)} onFav={() => toggleFav(selected.id)} onClose={() => setSelectedId(null)} asOf={asOf} stale={isStale} />
            ) : (
              <div className="flex flex-col">
                <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                  <h3 className="m-0 text-[15px] font-black text-slate-900 dark:text-white">
                    {searching ? t('bike.results', { count: docks.length }) : t('bike.nearbyCount', { count: docks.length })}
                  </h3>
                  {!searching && docks.length > 0 && <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{t('bike.byDistance')}</span>}
                </div>
                {firstLoading ? (
                  <p className="m-0 px-4 pb-4 text-sm font-bold text-slate-600 dark:text-slate-300 inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-orange-600" aria-hidden="true" />{t('bike.loading')}</p>
                ) : loadFailed ? (
                  <p className="m-0 px-4 pb-4 text-sm font-bold text-red-700 dark:text-red-300">{t('bike.loadFailed')}</p>
                ) : noPosition ? (
                  <p className="m-0 px-4 pb-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{t('bike.needLocation')}</p>
                ) : showNone ? (
                  <EmptyNearby radius={center?.radius ?? NEARBY_RADIUS_M} />
                ) : showSearchNone ? (
                  <p className="m-0 px-4 pb-4 text-sm font-bold text-slate-600 dark:text-slate-300">{t('bike.noResults', { q: submitted })}</p>
                ) : (
                  <div className="flex gap-2.5 overflow-x-auto px-4 pb-4 snap-x soft-scrollbar">
                    {ordered.map(d => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => openDock(d.id)}
                        className={`snap-start shrink-0 w-[250px] text-left rounded-2xl border bg-white dark:bg-white/5 px-3.5 py-3 flex flex-col gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${
                          highlight?.id === d.id ? 'border-2 border-orange-300 dark:border-orange-400/50' : 'border-slate-200 dark:border-white/10'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400">
                          {highlight?.id === d.id && (
                            <span className="text-[10px] font-black text-white bg-orange-600 rounded-full px-1.5 py-0.5">{mode === 'rent' ? t('bike.nearestWithBikes') : t('bike.nearestWithDocks')}</span>
                          )}
                          {distanceLine(d, t, zh)}
                        </span>
                        <span className="text-[15px] font-extrabold text-slate-900 dark:text-white truncate">{nameOf(d)}</span>
                        <DockCounts dock={d} mode={mode} compact />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {firstLoading && <p className="m-0 text-sm font-bold text-slate-600 dark:text-slate-300 inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-orange-600" aria-hidden="true" />{t('bike.loading')}</p>}
          {showNone && <div className="rounded-2xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 py-4"><EmptyNearby radius={center?.radius ?? NEARBY_RADIUS_M} /></div>}
          {showSearchNone && <p className="m-0 text-sm font-bold text-slate-600 dark:text-slate-300">{t('bike.noResults', { q: submitted })}</p>}
          <ul className="m-0 p-0 list-none flex flex-col gap-2.5">
            {ordered.map(d => (
              <li key={d.id}>
                <DockCard dock={d} mode={mode} zh={zh} highlight={highlight?.id === d.id} expanded={selectedId === d.id} onToggle={() => openDock(selectedId === d.id ? null : d.id)} fav={favIds.includes(d.id)} onFav={() => toggleFav(d.id)} />
              </li>
            ))}
          </ul>
          {!searching && favs.length > 0 && (
            <>
              <h3 className="m-0 mt-3 inline-flex items-center gap-1.5 text-[15px] font-black text-slate-900 dark:text-white">
                <Star className="w-4 h-4 fill-amber-400 text-amber-600" aria-hidden="true" />{t('bike.favorites')}
              </h3>
              <ul className="m-0 p-0 list-none flex flex-col gap-2.5">
                {favs.map(d => (
                  <li key={`fav-${d.id}`}>
                    <DockCard dock={d} mode={mode} zh={zh} highlight={false} expanded={selectedId === d.id} onToggle={() => openDock(selectedId === d.id ? null : d.id)} fav onFav={() => toggleFav(d.id)} showArea />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <p className="m-0 text-[11px] text-slate-500 dark:text-slate-400 text-center">
        {active.data?.source === 'taipei' ? t('bike.sourceTaipei') : t('bike.source')}
      </p>
    </div>
  );
}

function EmptyNearby({ radius }: { radius: number }) {
  const { t } = useTranslation();
  return (
    <div className="px-4 pb-4 flex flex-col gap-1">
      <p className="m-0 text-sm font-black text-slate-800 dark:text-slate-100">
        {t('bike.noneNearby', { distance: radius >= 1000 ? t('bike.km', { n: radius / 1000 }) : t('bike.meters', { n: radius }) })}
      </p>
      <p className="m-0 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{t('bike.noneNearbyHint')}</p>
    </div>
  );
}

/** 可借 / 可還 numbers, the mode's one large; words, not colour, carry the warning. */
function DockCounts({ dock, mode, compact = false }: { dock: BikeDockWithDistance; mode: BikeMode; compact?: boolean }) {
  const { t } = useTranslation();
  if (dock.suspended) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-[11px] font-black text-slate-700 dark:text-slate-200 bg-slate-200 dark:bg-white/10 rounded-full px-2.5 py-1">{t('bike.suspended')}</span>
      </span>
    );
  }
  const primary = countOf(dock, mode);
  const secondary = mode === 'rent' ? dock.docks : dock.bikes;
  const level = dockLevel(primary, false);
  const warn = level === 'none'
    ? (mode === 'rent' ? t('bike.noBikes') : t('bike.noDocks'))
    : level === 'low'
      ? (mode === 'rent' ? t('bike.fewLeft') : t('bike.fewDocks'))
      : null;
  return (
    <span className="flex items-end gap-5">
      <span className="flex flex-col">
        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{mode === 'rent' ? t('bike.canRent') : t('bike.canReturnSpaces')}</span>
        <span className="flex items-baseline gap-1.5">
          <span className={`${compact ? 'text-[26px]' : 'text-[30px]'} font-black leading-none tabular-nums ${
            level === 'none' ? 'text-slate-400' : level === 'ok' ? 'text-orange-700 dark:text-orange-400' : 'text-slate-900 dark:text-white'
          }`}>{primary}</span>
          {warn && <span className="text-xs font-extrabold text-amber-700 dark:text-amber-400">{warn}</span>}
        </span>
      </span>
      <span className="flex flex-col">
        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{mode === 'rent' ? t('bike.canReturn') : t('bike.canRent')}</span>
        <span className="text-lg font-extrabold leading-none tabular-nums text-slate-700 dark:text-slate-200">{secondary}</span>
      </span>
    </span>
  );
}

function TypeChip({ dock }: { dock: BikeDockWithDistance }) {
  const { t } = useTranslation();
  if (dock.suspended || dock.ebikes === null || dock.bikes === 0) return null;
  return (
    <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-white/10 rounded-full px-2 py-0.5 tabular-nums">
      {t('bike.typeBreakdown', { yb2: Math.max(0, dock.bikes - dock.ebikes), eyb: dock.ebikes })}
    </span>
  );
}

function DockActions({ dock, zh, fav, onFav }: { dock: BikeDockWithDistance; zh: boolean; fav: boolean; onFav: () => void }) {
  const { t } = useTranslation();
  const name = zh ? dock.name : dock.nameEn || dock.name;
  return (
    <div className="flex gap-2">
      <a
        href={googleWalkUrl(dock)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t('bike.navigateAria', { name })}
        className="flex-1 min-h-[48px] rounded-2xl bg-orange-600 hover:bg-orange-700 text-white no-underline inline-flex items-center justify-center gap-2 text-[15px] font-extrabold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-orange-500"
      >
        <Navigation className="w-4 h-4" aria-hidden="true" />{t('bike.navigate')}
        <span className="text-[11px] font-bold opacity-90">{t('bike.navigateExternal')}</span>
      </a>
      <button
        type="button"
        onClick={onFav}
        aria-pressed={fav}
        aria-label={fav ? t('bike.removeFav') : t('bike.saveFav')}
        title={fav ? t('bike.removeFav') : t('bike.saveFav')}
        className="w-12 h-12 shrink-0 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 inline-flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
      >
        <Star className={`w-5 h-5 ${fav ? 'fill-amber-400 text-amber-600' : 'text-slate-500'}`} aria-hidden="true" />
      </button>
    </div>
  );
}

function DockDetail({ dock, mode, zh, fav, onFav, onClose, asOf, stale }: {
  dock: BikeDockWithDistance; mode: BikeMode; zh: boolean; fav: boolean; onFav: () => void; onClose: () => void; asOf: string | null; stale: boolean;
}) {
  const { t } = useTranslation();
  const name = zh ? dock.name : dock.nameEn || dock.name;
  const address = zh ? dock.address : dock.addressEn || dock.address;
  return (
    <div className="min-h-0 flex flex-col px-4 pt-3 pb-4 gap-3 overflow-y-auto">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-xs font-bold">
            {dock.distance !== null && (
              <span className="text-blue-700 dark:text-blue-300">{dock.distance > WALK_MAX_M ? distanceDisplay(dock.distance, t) : t('bike.walkFrom', { distance: distanceDisplay(dock.distance, t), minutes: walkMinutes(dock.distance) })}</span>
            )}
            {asOf && (stale
              ? <span className="text-slate-600 dark:text-slate-300">{t('bike.staleBadge', { time: clockOf(asOf) })}</span>
              : <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400"><span className="w-1.5 h-1.5 rounded-full bg-green-600" aria-hidden="true" />{t('bike.live', { time: clockOf(asOf) })}</span>)}
          </div>
          <h3 className="m-0 mt-1 text-lg font-black text-slate-900 dark:text-white leading-snug">{name}</h3>
          <p className="m-0 mt-0.5 text-xs text-slate-600 dark:text-slate-400">{[address, bikeAreaName(dock.area, zh)].filter(Boolean).join(' · ')}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={t('bike.close')} className="w-10 h-10 shrink-0 rounded-xl border border-slate-200 dark:border-white/10 inline-flex items-center justify-center text-slate-600 dark:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      {dock.suspended ? (
        <p className="m-0 text-sm font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/10 rounded-2xl px-4 py-3">{t('bike.suspended')} — {t('bike.suspendedNote')}</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <Tile label={t('bike.canRent')} value={dock.bikes} accent={mode === 'rent'} sub={dock.ebikes !== null && dock.bikes > 0 ? t('bike.typeBreakdown', { yb2: Math.max(0, dock.bikes - dock.ebikes), eyb: dock.ebikes }) : null} />
          <Tile label={t('bike.canReturnSpaces')} value={dock.docks} accent={mode === 'return'} sub={null} />
          <Tile label={t('bike.totalSpaces')} value={dock.total} accent={false} sub={null} muted />
        </div>
      )}
      <DockActions dock={dock} zh={zh} fav={fav} onFav={onFav} />
    </div>
  );
}

function Tile({ label, value, accent, sub, muted = false }: { label: string; value: number; accent: boolean; sub: string | null; muted?: boolean }) {
  return (
    <div className={`rounded-2xl border px-3 py-2.5 flex flex-col gap-1 ${accent ? 'bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-400/30' : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10'}`}>
      <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400">{label}</span>
      <span className={`text-[26px] font-black leading-none tabular-nums ${accent ? 'text-orange-700 dark:text-orange-400' : muted ? 'text-slate-600 dark:text-slate-300' : 'text-slate-900 dark:text-white'}`}>{value}</span>
      {sub && <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 tabular-nums">{sub}</span>}
    </div>
  );
}

function DockCard({ dock, mode, zh, highlight, expanded, onToggle, fav, onFav, showArea = false }: {
  dock: BikeDockWithDistance; mode: BikeMode; zh: boolean; highlight: boolean; expanded: boolean; onToggle: () => void; fav: boolean; onFav: () => void; showArea?: boolean;
}) {
  const { t } = useTranslation();
  const name = zh ? dock.name : dock.nameEn || dock.name;
  const address = zh ? dock.address : dock.addressEn || dock.address;
  const dim = dock.suspended || countOf(dock, mode) === 0;
  return (
    <div className={`rounded-2xl border shadow-sm ${highlight ? 'border-2 border-orange-300 dark:border-orange-400/50' : 'border-slate-100 dark:border-white/10'} ${dim ? 'bg-slate-50 dark:bg-white/[0.03]' : 'bg-white dark:bg-white/5'}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full text-left px-4 py-3 flex flex-col gap-2 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
      >
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0 flex items-center gap-1.5">
            {highlight && (
              <span className="shrink-0 text-[10px] font-black text-white bg-orange-600 rounded-full px-1.5 py-0.5">{mode === 'rent' ? t('bike.nearestWithBikes') : t('bike.nearestWithDocks')}</span>
            )}
            {fav && <Star className="w-3.5 h-3.5 shrink-0 fill-amber-400 text-amber-600" aria-hidden="true" />}
            <span className={`text-base font-extrabold truncate ${dim ? 'text-slate-600 dark:text-slate-300' : 'text-slate-900 dark:text-white'}`}>{name}</span>
          </span>
          <span className="shrink-0 inline-flex items-center gap-1 text-[13px] font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap">
            {distanceLine(dock, t, zh)}
            <ChevronRight className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`} aria-hidden="true" />
          </span>
        </span>
        <span className="flex items-end justify-between gap-3">
          <DockCounts dock={dock} mode={mode} />
          <TypeChip dock={dock} />
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
          {[showArea ? bikeAreaName(dock.area, zh) : '', zh ? dock.district : dock.districtEn, address].filter(Boolean).join(' · ')}
        </span>
      </button>
      {expanded && (
        <div className="px-4 pb-4 flex flex-col gap-2">
          {!dock.suspended && (
            <p className="m-0 text-xs text-slate-600 dark:text-slate-300 inline-flex items-center gap-1.5">
              <Bike className="w-3.5 h-3.5" aria-hidden="true" />{t('bike.totalOf', { count: dock.total })}
            </p>
          )}
          {dock.suspended && <p className="m-0 text-xs text-slate-600 dark:text-slate-300">{t('bike.suspendedNote')}</p>}
          <DockActions dock={dock} zh={zh} fav={fav} onFav={onFav} />
        </div>
      )}
    </div>
  );
}
