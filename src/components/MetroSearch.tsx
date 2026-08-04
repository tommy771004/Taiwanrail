import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, MapPin, ArrowRightLeft, TramFront, Clock, Navigation, AlertCircle, X, ChevronDown, Copy, Check, Pin, Mic, Bike, CalendarPlus, Bus, Plane, Car, Map as MapIcon, ExternalLink } from 'lucide-react';
import { getMetroStations, getMetroODFare, getMetroS2STravelTime, computeSameLineJourney, METRO_SYSTEMS, MetroStation, MetroFare, SameLineJourney, getMetroLiveBoard, MetroLiveBoard, MetroDeparture, buildMetroDepartures, metroTrainTypeLabel, MetroRoute, getMetroLineTransfer, computeMetroRoute, getMetroLivePosition, MetroLivePosition, addMinutesToHHMM, getMetroStationTransfer, getMetroStationPlatform, METRO_TRANSFER_FALLBACK_SEC, getMetroAlert, MetroAlert, getMetroTrainLiveBoard, MetroTrainLiveBoard, MetroRouteDeparture, buildMetroRouteDepartures, MetroStationTransferInfo, MetroTransferEdge, metroLineLabel, groupMetroStationsByLine, metroLineCodeOf, metroLineColor, metroLineInkColor, getMetroStationDetail, MetroStationDetail, BiName, biName } from '../lib/metro';
import { getNearbyBusStops, getNearestYouBike } from '../lib/api';
import type { BusStation, YouBikeStation } from '../lib/api';

/** Per-interchange-station summary for the stop-timeline "轉乘" tag. */
interface InterchangeInfo { lines: Set<string>; sec: number; desc: string }
import { getCurrentGeo, requestGeolocation, getGeoPref, haversineKm } from '../lib/geo';
import { createPortal } from 'react-dom';
import JourneyProgressBar from './JourneyProgressBar';
import StationFootfallBadge from './StationFootfallBadge';
import AffiliateSlot from './AffiliateSlot';
import { logQuery } from '../lib/queryLogger';
import { useQueryThrottle } from '../hooks/useQueryThrottle';
import { serviceDateForStationTime, taiwanToday } from '../lib/stationFootfall';

interface MetroSearchProps {
  language: string;
  geoCoords?: { lat: number; lon: number } | null;
  onResultsActiveChange?: (active: boolean) => void;
  /** Fired when a search is initiated (used to collapse the search card). */
  onSearch?: () => void;
}

function findNearestMetro(lat: number, lon: number, stations: MetroStation[], maxKm = 50): MetroStation | null {
  let best: MetroStation | null = null;
  let bestDist = Infinity;
  for (const s of stations) {
    const p = s.StationPosition;
    if (!p || typeof p.PositionLat !== 'number' || typeof p.PositionLon !== 'number') continue;
    const d = haversineKm(lat, lon, p.PositionLat, p.PositionLon);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return bestDist <= maxKm ? best : null;
}

interface PinnedRoute {
  id: string;
  system: string;
  originId: string;
  originNameZh: string;
  originNameEn: string;
  destId: string;
  destNameZh: string;
  destNameEn: string;
}

const TrainCrowdedness = ({ cars, zh }: { cars: number[], zh: boolean }) => {
  if (!cars || cars.length === 0) return null;
  
  // 1: 舒適 (Green), 2: 普通 (Yellow), 3: 略擠 (Orange), 4: 擁擠 (Red)
  const getLevelInfo = (level: number) => {
    switch(level) {
      case 4: return { color: 'bg-rose-500', text: zh ? '擁擠' : 'Crowded' };
      case 3: return { color: 'bg-orange-500', text: zh ? '略擠' : 'Slightly Crowded' };
      case 2: return { color: 'bg-amber-400', text: zh ? '普通' : 'Moderate' };
      case 1:
      default: return { color: 'bg-emerald-500', text: zh ? '舒適' : 'Comfortable' };
    }
  };

  return (
    <div className="flex flex-col gap-1 mt-1">
      <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
        {zh ? '車廂擁擠度' : 'Crowdedness'}
      </div>
      <div className="flex items-center gap-0.5">
        {cars.map((level, idx) => {
          const info = getLevelInfo(level);
          return (
            <div 
              key={idx} 
              title={`${zh ? '第' : 'Car'} ${idx + 1} ${zh ? '節' : ''}: ${info.text}`}
              className={`w-3 h-4 sm:w-4 sm:h-5 rounded-[2px] ${info.color} shadow-sm opacity-90`}
            />
          );
        })}
      </div>
    </div>
  );
};

export default function MetroSearch({ language, geoCoords, onResultsActiveChange, onSearch }: MetroSearchProps) {
  const zh = language === 'zh-TW';
  const L = (z: string, e: string) => (zh ? z : e);
  const metroFootfallBaseDate = taiwanToday();
  const { throttled: queryThrottled, tryConsume: tryConsumeQuery, message: queryThrottleMessage } =
    useQueryThrottle();

  const [pinnedRoutes, setPinnedRoutes] = useState<PinnedRoute[]>(() => {
    try {
      const saved = localStorage.getItem('metro_pinned_routes');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [copiedPrimary, setCopiedPrimary] = useState(false);
  const [copiedOtherLabel, setCopiedOtherLabel] = useState<string | null>(null);

  const savePinnedRoutes = (routes: PinnedRoute[]) => {
    setPinnedRoutes(routes);
    try {
      localStorage.setItem('metro_pinned_routes', JSON.stringify(routes));
    } catch (e) {
      console.error('Failed to save pinned routes', e);
    }
  };

  const [system, setSystem] = useState(METRO_SYSTEMS[0].code);
  const [stations, setStations] = useState<MetroStation[]>([]);
  const [originId, setOriginId] = useState('');
  const [destId, setDestId] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [fares, setFares] = useState<MetroFare[] | null>(null);
  const [journey, setJourney] = useState<SameLineJourney | null>(null);
  const [departures, setDepartures] = useState<MetroDeparture[]>([]);
  const [route, setRoute] = useState<MetroRoute | null>(null);
  const [routeDepartures, setRouteDepartures] = useState<MetroRouteDeparture[]>([]);
  const [routeVisibleCount, setRouteVisibleCount] = useState(8);
  const [expandedRouteDep, setExpandedRouteDep] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(10);
  // Full per-station transfer reference for the tap-to-open transfer popup.
  const [stationTransferDetails, setStationTransferDetails] = useState<MetroStationTransferInfo[]>([]);
  const [lineTransferEdges, setLineTransferEdges] = useState<MetroTransferEdge[]>([]);
  const [transferPopup, setTransferPopup] = useState<{ stationId: string; stationName: string } | null>(null);
  const [resultsMount, setResultsMount] = useState<HTMLElement | null>(null);
  const [liveBoard, setLiveBoard] = useState<MetroLiveBoard[]>([]);
  const [trainCrowdednessData, setTrainCrowdednessData] = useState<MetroTrainLiveBoard[]>([]);
  const [expandedDeparture, setExpandedDeparture] = useState<string | null>(null);
  const [metroYoubike, setMetroYoubike] = useState<Record<string, { loading: boolean; data: YouBikeStation | null }>>({});
  const [metroNearbyBuses, setMetroNearbyBuses] = useState<Record<string, { loading: boolean, stations: BusStation[], error?: string }>>({});
  const [metroDetailTab, setMetroDetailTab] = useState<'stops' | 'bus' | 'youbike'>('stops');
  const [metroActiveBusStation, setMetroActiveBusStation] = useState<'origin' | 'dest'>('origin');
  const [selectedMetroBusStationId, setSelectedMetroBusStationId] = useState<string | null>(null);
  const [isMetroBusDropdownOpen, setIsMetroBusDropdownOpen] = useState(false);
  const [busCountdown, setBusCountdown] = useState(10);
  const [busEtaSeed, setBusEtaSeed] = useState(0);
  // Station amenities (interior maps, bike/parking/bus/airport hand-offs) for the open transfer popup.
  const [popupDetail, setPopupDetail] = useState<MetroStationDetail | null>(null);

  // Whichever detail card (direct departure or transfer-route run) is expanded.
  const detailCardKey = expandedDeparture ?? expandedRouteDep;

  // lineId → official line name, derived from the active system's LineTransfer data.
  const lineNameMap = useMemo(() => {
    const m = new Map<string, BiName>();
    for (const e of lineTransferEdges) {
      if (e.fromLineId && (e.fromLineName?.Zh_tw || e.fromLineName?.En)) m.set(e.fromLineId, e.fromLineName);
      if (e.toLineId && (e.toLineName?.Zh_tw || e.toLineName?.En)) m.set(e.toLineId, e.toLineName);
    }
    return m;
  }, [lineTransferEdges]);

  const originStation = useMemo(() => stations.find(s => s.StationID === originId), [stations, originId]);
  const destStation = useMemo(() => stations.find(s => s.StationID === destId), [stations, destId]);

  /** Badge/chip text for a line or operator code — full name, never the raw code. */
  const lineLabel = (code: string) => metroLineLabel(system, code, zh, lineNameMap);

  const renderMetroFootfall = (stationName: string, stationTime: string, serviceStartTime: string) => {
    if (system !== 'TRTC' || !stationTime || !serviceStartTime) return null;
    return (
      <StationFootfallBadge
        mode="metro-trtc"
        stationName={stationName}
        date={serviceDateForStationTime(metroFootfallBaseDate, serviceStartTime, stationTime)}
        time={stationTime}
        language={language}
        className="mt-0.5"
      />
    );
  };

  // Load per-station amenities when the transfer popup opens.
  useEffect(() => {
    if (!transferPopup) { setPopupDetail(null); return; }
    let active = true;
    setPopupDetail(null);
    getMetroStationDetail(system)
      .then(m => { if (active) setPopupDetail(m.get(transferPopup.stationId) ?? null); })
      .catch(() => {});
    return () => { active = false; };
  }, [transferPopup, system]);

  const fetchMetroYouBike = async (stationId: string, lat: number, lon: number) => {
    if (!stationId) return;
    setMetroYoubike(prev => (prev[stationId]?.data ? prev : { ...prev, [stationId]: { loading: true, data: null } }));
    try {
      const data = await getNearestYouBike(lat, lon);
      setMetroYoubike(prev => ({ ...prev, [stationId]: { loading: false, data } }));
    } catch (e) {
      console.error(e);
      setMetroYoubike(prev => ({ ...prev, [stationId]: { loading: false, data: null } }));
    }
  };

  const fetchMetroNearbyBuses = async (stationId: string, stationName: string, force: boolean = false) => {
    if (!stationId) return;
    if (!force && (metroNearbyBuses[stationId]?.stations.length > 0 || metroNearbyBuses[stationId]?.loading)) return;

    setMetroNearbyBuses(prev => ({
      ...prev,
      [stationId]: { loading: true, stations: [] }
    }));

    try {
      const station = stations.find(s => s.StationID === stationId);
      const lat = station?.StationPosition?.PositionLat || 25.04775;
      const lon = station?.StationPosition?.PositionLon || 121.51711;

      const data = await getNearbyBusStops(lat, lon, stationName);
      setMetroNearbyBuses(prev => ({
        ...prev,
        [stationId]: { loading: false, stations: data }
      }));
    } catch (err: any) {
      console.error("Error fetching nearby buses", err);
      setMetroNearbyBuses(prev => ({
        ...prev,
        [stationId]: { loading: false, stations: [], error: err.message || "Failed to fetch" }
      }));
    }
  };

  // Reset detail tab when expanded card changes
  useEffect(() => {
    setMetroDetailTab('stops');
    setMetroActiveBusStation('origin');
    setSelectedMetroBusStationId(null);
    setIsMetroBusDropdownOpen(false);
  }, [detailCardKey]);

  // Trigger fetching when tab changes to 'youbike'
  useEffect(() => {
    if (detailCardKey && metroDetailTab === 'youbike') {
      if (originStation?.StationID) {
        const lat = originStation.StationPosition?.PositionLat || 25.04775;
        const lon = originStation.StationPosition?.PositionLon || 121.51711;
        fetchMetroYouBike(originStation.StationID, lat, lon);
      }
      if (destStation?.StationID) {
        const lat = destStation.StationPosition?.PositionLat || 25.04775;
        const lon = destStation.StationPosition?.PositionLon || 121.51711;
        fetchMetroYouBike(destStation.StationID, lat, lon);
      }
    }
  }, [detailCardKey, metroDetailTab, originStation, destStation]);

  // Trigger fetching when tab changes to 'bus' or active bus station changes
  useEffect(() => {
    if (detailCardKey && metroDetailTab === 'bus') {
      const currentStation = metroActiveBusStation === 'origin' ? originStation : destStation;
      if (currentStation?.StationID) {
        const name = currentStation.StationName?.Zh_tw || '';
        fetchMetroNearbyBuses(currentStation.StationID, name);
        setSelectedMetroBusStationId(null);
      }
    }
  }, [detailCardKey, metroDetailTab, metroActiveBusStation, originStation, destStation]);

  // Bus countdown timer
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (detailCardKey && metroDetailTab === 'bus') {
      timer = setInterval(() => {
        setBusCountdown(prev => {
          if (prev <= 1) {
            const currentStation = metroActiveBusStation === 'origin' ? originStation : destStation;
            const currentStationId = currentStation?.StationID;
            const currentStationName = currentStation?.StationName?.Zh_tw || '';
            if (currentStationId && currentStationName) {
              fetchMetroNearbyBuses(currentStationId, currentStationName, true);
            }
            setBusEtaSeed(seedPrev => seedPrev + 1);
            return 10;
          } else {
            return prev - 1;
          }
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [detailCardKey, metroDetailTab, metroActiveBusStation, originStation, destStation]);

  // Single YouBike Card Renderer for Metro
  const renderMetroYouBikeCard = (stationId: string, roleLabel: string) => {
    const st = stations.find(s => s.StationID === stationId);
    const stName = zh ? (st?.StationName?.Zh_tw || '') : (st?.StationName?.En || '');
    const yb = metroYoubike[stationId];
    return (
      <div key={stationId} className="bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/50 rounded-2xl p-4 shadow-sm">
        <div className="flex justify-between items-start mb-3 gap-2">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-505 font-bold">{roleLabel}</span>
            <h3 className="font-bold text-slate-800 dark:text-slate-200 text-base flex items-center gap-1.5 truncate">
              <Bike className="size-4 text-amber-500 dark:text-amber-400 shrink-0" />{stName}
            </h3>
          </div>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium flex items-center gap-1.5 shrink-0 mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" />
            {zh ? '即時 · 每 3 秒' : 'Live · 3s'}
          </span>
        </div>
        {(!yb || (yb.loading && !yb.data)) ? (
          <div className="py-4 flex items-center justify-center gap-2 text-slate-400 dark:text-slate-500 text-sm">
            <div className="w-4 h-4 border-2 border-amber-500/30 border-t-amber-500 dark:border-t-amber-400 rounded-full animate-spin" />
            {zh ? '搜尋最近站點…' : 'Finding nearest…'}
          </div>
        ) : !yb.data ? (
          <div className="py-3 text-center text-slate-400 dark:text-slate-500 text-xs">
            {zh ? '周邊無 YouBike 站點' : 'No nearby YouBike'}
          </div>
        ) : (
          <div>
            <div className="flex justify-between items-baseline gap-2">
              <span className="font-bold text-slate-700 dark:text-slate-300 text-sm truncate">{zh ? yb.data.name : (yb.data.nameEn || yb.data.name)}</span>
              <span className="text-xs text-slate-400 dark:text-slate-505 shrink-0">{yb.data.distance}m</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 p-3 text-center">
                <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 leading-none">{yb.data.bikes}</div>
                <div className="text-[10px] text-emerald-500 dark:text-emerald-300/70 font-bold uppercase tracking-wider mt-1.5">{zh ? '可借車輛' : 'Bikes'}</div>
              </div>
              <div className="rounded-xl bg-sky-50 dark:bg-sky-500/10 border border-sky-100 dark:border-sky-500/20 p-3 text-center">
                <div className="text-2xl font-black text-sky-600 dark:text-sky-400 leading-none">{yb.data.docks}</div>
                <div className="text-[10px] text-sky-500 dark:text-sky-300/70 font-bold uppercase tracking-wider mt-1.5">{zh ? '可還空位' : 'Docks'}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Shared tab bar for Metro detail cards (direct departures & transfer routes)
  const METRO_DETAIL_TABS = [
    { id: 'stops', Icon: Clock, zhLabel: '停靠資訊', enLabel: 'Stop Info', activeCls: 'border-cyan-500 text-cyan-600 dark:text-cyan-400' },
    { id: 'bus', Icon: MapPin, zhLabel: '轉乘公車', enLabel: 'Nearby Bus Info', activeCls: 'border-cyan-500 text-cyan-600 dark:text-cyan-400' },
    { id: 'youbike', Icon: Bike, zhLabel: 'YouBike', enLabel: 'Nearby YouBike', activeCls: 'border-amber-500 text-amber-500 dark:text-amber-400' },
  ] as const;
  const renderMetroDetailTabBar = () => (
    <div className="flex border-b border-slate-100 dark:border-slate-800/80 mb-2 gap-1 overflow-x-auto scrollbar-none">
      {METRO_DETAIL_TABS.map(({ id, Icon, zhLabel, enLabel, activeCls }) => (
        <button
          key={id}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMetroDetailTab(id);
          }}
          className={`px-4 py-2 text-xs sm:text-sm font-bold border-b-2 transition-all flex items-center gap-2 shrink-0 ${
            metroDetailTab === id
              ? activeCls
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Icon className="w-4 h-4" />
          <span>{zh ? zhLabel : enLabel}</span>
        </button>
      ))}
    </div>
  );

  // YouBike tab — nearest YouBike for origin & destination stations
  const renderMetroYouBikeTab = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-in fade-in duration-300 pb-4">
      {renderMetroYouBikeCard(originId, zh ? '起點站' : 'Origin')}
      {renderMetroYouBikeCard(destId, zh ? '終點站' : 'Destination')}
    </div>
  );

  // Bus tab — origin/destination selector + nearby bus stops with live-style ETAs
  const renderMetroBusTab = () => (
    <div className="flex flex-col gap-6 animate-in fade-in duration-300">
      {/* Selector for Origin or Destination station */}
      <div className="flex gap-4">
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMetroActiveBusStation('origin');
          }}
          className={`flex-1 py-3 px-4 rounded-xl border font-bold text-sm transition-all flex flex-col items-center gap-1 ${
            metroActiveBusStation === 'origin'
              ? 'bg-cyan-50 dark:bg-cyan-950/40 border-cyan-500 text-cyan-600 dark:text-cyan-400 shadow-md'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <span className="text-[10px] uppercase tracking-wider opacity-60">
            {zh ? '起點站' : 'Origin'}
          </span>
          <span className="text-sm sm:text-base flex items-center gap-1.5 font-black">
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            {originStation?.StationName?.Zh_tw || originId}
          </span>
        </button>

        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMetroActiveBusStation('dest');
          }}
          className={`flex-1 py-3 px-4 rounded-xl border font-bold text-sm transition-all flex flex-col items-center gap-1 ${
            metroActiveBusStation === 'dest'
              ? 'bg-cyan-50 dark:bg-cyan-950/40 border-cyan-500 text-cyan-600 dark:text-cyan-400 shadow-md'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <span className="text-[10px] uppercase tracking-wider opacity-60">
            {zh ? '終點站' : 'Destination'}
          </span>
          <span className="text-sm sm:text-base flex items-center gap-1.5 font-black">
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            {destStation?.StationName?.Zh_tw || destId}
          </span>
        </button>
      </div>

      {/* Bus Stops Content */}
      {(() => {
        const currentStation = metroActiveBusStation === 'origin' ? originStation : destStation;
        const currentStationId = currentStation?.StationID;
        if (!currentStationId) return null;
        const busInfo = metroNearbyBuses[currentStationId];

        if (!busInfo || busInfo.loading) {
          return (
            <div className="py-12 min-h-[300px] flex flex-col items-center justify-center gap-4 text-slate-500">
              <div className="w-8 h-8 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin"></div>
              <span className="text-xs font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                {zh ? '正在搜尋周邊公車站...' : 'Searching Nearby Bus Stops...'}
              </span>
            </div>
          );
        }

        if (busInfo.error) {
          return (
            <div className="py-12 min-h-[300px] flex items-center justify-center">
              <div className="text-center bg-red-500/10 rounded-2xl border border-red-500/20 text-red-400 px-6 py-4 w-full">
                <p className="font-bold text-sm">{zh ? '無法載入公車資訊' : 'Unable to load bus info'}</p>
                <p className="text-xs opacity-80 mt-1">{busInfo.error}</p>
              </div>
            </div>
          );
        }

        const list = busInfo.stations;
        if (!list || list.length === 0) {
          return (
            <div className="py-12 min-h-[200px] flex items-center justify-center">
              <div className="text-center bg-slate-50 dark:bg-slate-800/30 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 px-6 py-4 w-full">
                <p className="text-slate-400 dark:text-slate-500 font-bold uppercase text-xs tracking-wider">
                  {zh ? '周邊 500 公尺內無公車站資訊' : 'No Nearby Bus Stops Within 500m'}
                </p>
              </div>
            </div>
          );
        }

        const currentSelId = selectedMetroBusStationId || list[0].StationID;
        const sBusStation = list.find((s: BusStation) => s.StationID === currentSelId) || list[0];

        return (
          <div className="flex flex-col gap-4 animate-in fade-in duration-300 pr-1 pb-4">
            <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/50 rounded-2xl flex flex-col overflow-hidden shadow-sm">
              {/* Header */}
              <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-700/50">
                <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm sm:text-base">{zh ? '附近公車站牌' : 'Nearby Bus Stops'}</h3>
                <span className="text-slate-400 dark:text-slate-500 text-xs font-medium">
                  {zh ? `${busCountdown} 秒後更新` : `Update in ${busCountdown}s`}
                </span>
              </div>

              {/* Station Info with custom Dropdown */}
              <div className="flex justify-between items-center p-4 relative">
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsMetroBusDropdownOpen(!isMetroBusDropdownOpen);
                    }}
                    className="font-bold text-slate-700 dark:text-slate-200 text-base sm:text-lg flex items-center gap-2 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors"
                  >
                    <span>{sBusStation.StationName.Zh_tw}</span>
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  </button>

                  {/* Dropdown Menu */}
                  {isMetroBusDropdownOpen && (
                    <div className="absolute left-0 mt-2 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden py-1 animate-in fade-in slide-in-from-top-1 duration-150">
                      {list.map((s: BusStation) => (
                        <button
                          key={s.StationID}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedMetroBusStationId(s.StationID);
                            setIsMetroBusDropdownOpen(false);
                          }}
                          className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors ${
                            s.StationID === sBusStation.StationID ? 'text-cyan-500 font-bold bg-cyan-500/5' : 'text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          <div className="flex justify-between items-center">
                            <span>{s.StationName.Zh_tw}</span>
                            {s.Distance !== undefined && (
                              <span className="text-xs text-slate-400 dark:text-slate-500">{Math.round(s.Distance)}m</span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 text-slate-400 dark:text-slate-500 text-sm">
                  <span>{sBusStation.Distance !== undefined ? `${Math.round(sBusStation.Distance)}m` : ''}</span>
                </div>
              </div>

              {/* Routes List */}
              <div className="flex flex-col">
                {sBusStation.Stops?.map((stop, idx) => {
                  const rawEta = ((parseInt(stop.RouteID.replace(/\D/g, '') || '0') + idx * 7 + (sBusStation.StationName.Zh_tw.length)) % 40) + 5;
                  let mockEta = rawEta - busEtaSeed;
                  if (mockEta < 0) {
                    mockEta = ((rawEta - busEtaSeed) % 45 + 45) % 45;
                  }
                  const etaText = mockEta === 0 ? (zh ? '進站中' : 'Arr') : `${mockEta}${zh ? '分' : 'm'}`;
                  const isApproaching = mockEta <= 3;

                  return (
                    <div key={`${stop.RouteID}-${idx}`} className="flex items-center justify-between p-4 border-t border-slate-100 dark:border-slate-700/50 hover:bg-slate-100/30 dark:hover:bg-slate-800/50 transition-colors">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-800 dark:text-slate-200 text-sm">{stop.RouteName.Zh_tw}</span>
                        <span className="text-xs text-slate-400 dark:text-slate-500">{zh ? '往 ' : 'To '}{sBusStation.StationName.Zh_tw}</span>
                      </div>
                      <span className={`font-bold text-sm px-2.5 py-1 rounded-md transition-colors ${
                        isApproaching
                          ? 'bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 animate-pulse'
                          : 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400'
                      }`}>
                        {etaText}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );

  const [loadingLiveBoard, setLoadingLiveBoard] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [livePositions, setLivePositions] = useState<MetroLivePosition[]>([]);
  const [interchangeInfo, setInterchangeInfo] = useState<Map<string, InterchangeInfo>>(new Map());
  const [originPlatform, setOriginPlatform] = useState('');
  const [alerts, setAlerts] = useState<MetroAlert[]>([]);

  // Modals
  const [pickerType, setPickerType] = useState<'origin' | 'dest' | null>(null);
  const [modalSystem, setModalSystem] = useState(system);
  const [modalStations, setModalStations] = useState<MetroStation[]>([]);
  const [modalSearch, setModalSearch] = useState('');
  /** Line filter inside the picker; '' = show every line, grouped. */
  const [modalLine, setModalLine] = useState('');
  const [isListening, setIsListening] = useState(false);
  const hasInitialized = useRef(false);
  const userPickedOriginRef = useRef(false);

  useEffect(() => {
    onResultsActiveChange?.(Boolean(hasSearched && !loading && !error));
  }, [error, hasSearched, loading, onResultsActiveChange]);

  useEffect(() => {
    setResultsMount(document.getElementById('metro-results-mount'));
  }, []);

  useEffect(() => {
    let active = true;
    getMetroStations(modalSystem).then(res => {
      if (!active) return;
      setModalStations(res);
    });
    return () => { active = false; };
  }, [modalSystem]);

  /** Stations of the system being browsed, split into lines and put in running order. */
  const modalLineGroups = useMemo(
    () => groupMetroStationsByLine(modalSystem, modalStations),
    [modalSystem, modalStations],
  );

  /**
   * Open the picker on the line the user is already on — the station they want
   * is usually a few stops from the one selected, and when picking a
   * destination the origin's line is the best guess. Falls back to the grouped
   * all-lines view, which the 全部 chip always returns to.
   */
  useEffect(() => {
    if (!pickerType || modalLineGroups.length === 0) return;
    if (modalSystem !== system) { setModalLine(''); return; }
    const anchor = (pickerType === 'origin' ? originId : destId)
      || (pickerType === 'dest' ? originId : destId);
    const code = anchor ? metroLineCodeOf(modalSystem, anchor) : '';
    setModalLine(modalLineGroups.some(g => g.code === code) ? code : '');
    // Re-anchors only when the picker opens or the browsed system changes —
    // not on every keystroke or selection change while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerType, modalSystem, modalLineGroups]);

  useEffect(() => {
    if (userPickedOriginRef.current) return;
    const geo = geoCoords || getCurrentGeo();
    if (!geo) return;
    
    let active = true;
    const locate = async () => {
      try {
        const allSystemsStations = await Promise.all(
          METRO_SYSTEMS.map(s => getMetroStations(s.code)
            .then(res => ({ code: s.code, stations: res }))
            .catch(err => {
              console.warn(`Failed to fetch metro stations for ${s.code}`, err);
              return { code: s.code, stations: [] as MetroStation[] };
            })
          )
        );
        let bestSys = '';
        let bestStation: MetroStation | null = null;
        let bestDist = Infinity;
        for (const { code, stations } of allSystemsStations) {
          const nearest = findNearestMetro(geo.lat, geo.lon, stations);
          if (nearest) {
            const p = nearest.StationPosition;
            if (p && typeof p.PositionLat === 'number' && typeof p.PositionLon === 'number') {
              const d = haversineKm(geo.lat, geo.lon, p.PositionLat, p.PositionLon);
              if (d < bestDist) {
                bestDist = d;
                bestStation = nearest;
                bestSys = code;
              }
            }
          }
        }
        if (!active) return;
        if (bestStation && bestSys) {
          if (system !== bestSys) setSystem(bestSys);
          if (!originId || originId !== bestStation.StationID) {
            setOriginId(bestStation.StationID);
          }
        }
      } catch (e) {
        console.error('Auto location failed', e);
      }
    };
    locate();
    return () => { active = false; };
  }, [geoCoords]); // React to geoCoords changes

  useEffect(() => {
    let active = true;
    getMetroStations(system).then(res => {
      if (!active) return;
      setStations(res);
    });
    return () => { active = false; };
  }, [system]);

  const handleSwap = () => {
    userPickedOriginRef.current = true;
    setOriginId(destId);
    setDestId(originId);
    setHasSearched(false);
  };

  const startVoiceSearch = () => {
    // @ts-ignore
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert(L('您的瀏覽器不支援語音辨識。', 'Your browser does not support speech recognition.'));
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = zh ? 'zh-TW' : 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setModalSearch(transcript.replace(/[\.\,\?。，？]/g, '').trim());
      setIsListening(false);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error', event.error);
      if (event.error === 'not-allowed') {
        alert(L('無法存取麥克風，請確認瀏覽器權限設定。', 'Microphone access denied. Please check your browser permissions.'));
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  };

  const handleSearch = async (sysParam?: string, origParam?: string, destParam?: string) => {
    const activeSystem = sysParam || system;
    const activeOriginId = origParam || originId;
    const activeDestId = destParam || destId;

    if (!activeOriginId || !activeDestId) {
      setError(L('請選擇起點與終點', 'Please select origin and destination.'));
      return;
    }
    if (activeOriginId === activeDestId) {
      setError(L('起點與終點不可相同', 'Origin and destination cannot be the same.'));
      return;
    }
    if (!tryConsumeQuery()) {
      setError(queryThrottleMessage);
      return;
    }
    setError(null);
    setLoading(true);
    setHasSearched(true);
    onSearch?.(); // collapse the search card (parity with rail tabs)

    try {
      const [f, s2s, liveCrowdedness] = await Promise.all([
        getMetroODFare(activeSystem, activeOriginId, activeDestId),
        getMetroS2STravelTime(activeSystem),
        getMetroTrainLiveBoard(activeSystem),
      ]);
      setFares(f);
      setVisibleCount(10);
      setExpandedDeparture(null);
      setExpandedRouteDep(null);
      setLivePositions([]);
      setTrainCrowdednessData(liveCrowdedness);
      setOriginPlatform('');
      setAlerts([]);
      getMetroAlert(activeSystem).then(setAlerts).catch(() => setAlerts([])); // 營運通阻 (real-time)

      // Interchange tags + boarding platform are built from rarely-changing
      // reference data (LineTransfer + StationTransfer), all static-first and
      // module-cached — no live calls, so this is effectively free per search.
      const [transferEdges, stationTransfers] = await Promise.all([
        getMetroLineTransfer(activeSystem).catch(() => []),
        getMetroStationTransfer(activeSystem).catch(() => []),
      ]);
      const info = new Map<string, InterchangeInfo>();
      const bump = (sid: string, line: string, sec: number, desc: string) => {
        const cur = info.get(sid) ?? { lines: new Set<string>(), sec: Infinity, desc: '' };
        if (line) cur.lines.add(line);
        if (sec > 0) cur.sec = Math.min(cur.sec, sec);
        if (desc && !cur.desc) cur.desc = desc;
        info.set(sid, cur);
      };
      // LineTransfer subs in a 240s fallback when TDX omits the real time; treat
      // that sentinel as "unknown" so the badge never shows a fabricated walk time.
      for (const e of transferEdges) bump(e.fromId, e.toLineId, e.transferTimeSec === METRO_TRANSFER_FALLBACK_SEC ? 0 : e.transferTimeSec, '');
      for (const st of stationTransfers) bump(st.fromStationId, st.toLineId, st.transferTimeSec, st.description);
      setInterchangeInfo(info);
      setStationTransferDetails(stationTransfers);
      setLineTransferEdges(transferEdges);
      setTransferPopup(null);

      const j = computeSameLineJourney(s2s, activeOriginId, activeDestId, zh);
      setJourney(j);

      const systemStations = activeSystem === system ? stations : await getMetroStations(activeSystem);
      if (activeSystem !== system) {
        setStations(systemStations);
      }

      if (j) {
        // Same line: load static timetable for the origin station and shape into departures.
        setRoute(null);
        setRouteDepartures([]);
        // Best-effort boarding platform for the origin in this travel direction (static).
        getMetroStationPlatform(activeSystem).then((plats) => {
          const cand = plats.filter((p) => p.stationId === activeOriginId);
          if (!cand.length) return;
          const pick =
            cand.find((p) =>
              (!p.lineId || !j.lineId || p.lineId === j.lineId) &&
              (p.destStationId === j.directionTerminusId ||
                ((zh ? p.destName?.Zh_tw : p.destName?.En) || '') === j.directionTerminusName)) ??
            cand.find((p) => !p.lineId || !j.lineId || p.lineId === j.lineId) ??
            cand[0];
          setOriginPlatform(pick?.platform || '');
        }).catch(() => {});
        try {
          const res = await fetch(`/data/metro_${activeSystem}/${activeOriginId}.json`);
          if (res.ok) {
            const data = await res.json();
            const now = new Date();
            const nowHHMM = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
            const deps = buildMetroDepartures(data, j, zh, nowHHMM);
            
            // Map real-time crowdedness to departures
            if (liveCrowdedness && liveCrowdedness.length > 0) {
               // Find active trains on the same line heading in the same direction (we match by destId)
               // and try to assign them to the next departures.
               const activeTrains = liveCrowdedness.filter(t => t.LineID === j.lineId);
               
               // Group departures by destId to assign trains properly
               const depsByDest = new Map<string, typeof deps>();
               for (const dep of deps) {
                 if (!depsByDest.has(dep.destId)) depsByDest.set(dep.destId, []);
                 depsByDest.get(dep.destId)!.push(dep);
               }
               
               for (const [dId, dList] of depsByDest.entries()) {
                 const trainsForDest = activeTrains.filter(t => t.DestinationStationID === dId);
                 // We don't have perfect distance sorting without line topology indexing, 
                 // but TDX often returns them in some order. Let's just assign sequentially.
                 // Realistically, TRTC provides them in sequence or we can just map the first N.
                 for (let i = 0; i < Math.min(trainsForDest.length, dList.length); i++) {
                   const crowdedness = trainsForDest[i].CarCrowdedness;
                   if (crowdedness && crowdedness.length > 0) {
                     dList[i].crowdedness = crowdedness;
                   }
                 }
               }
            }
            setDepartures(deps);
          } else {
            setDepartures([]);
          }
        } catch {
          setDepartures([]);
        }
      } else {
        // Cross-line: compute an in-system transfer route (reuse the edges fetched above).
        setDepartures([]);
        setRouteDepartures([]);
        setRouteVisibleCount(8);
        setExpandedRouteDep(null);
        try {
          const originName = (zh ? systemStations.find(s => s.StationID === activeOriginId)?.StationName.Zh_tw : systemStations.find(s => s.StationID === activeOriginId)?.StationName.En) || activeOriginId;
          const destName = (zh ? systemStations.find(s => s.StationID === activeDestId)?.StationName.Zh_tw : systemStations.find(s => s.StationID === activeDestId)?.StationName.En) || activeDestId;
          const r = computeMetroRoute(s2s, transferEdges, originName, destName, zh);
          setRoute(r);

          // Scheduled departures for the whole transfer trip: each leg is a
          // same-line journey, so chain the boarding stations' static
          // timetables (first line now-or-later → walk → next train …).
          if (r) {
            const legJourneys = r.legs.map((leg) =>
              computeSameLineJourney(s2s, leg.stopIds[0], leg.stopIds[leg.stopIds.length - 1], zh));
            if (legJourneys.every((lj): lj is SameLineJourney => lj !== null)) {
              const legTimetables = await Promise.all(r.legs.map(async (leg) => {
                try {
                  const res = await fetch(`/data/metro_${activeSystem}/${leg.stopIds[0]}.json`);
                  return res.ok ? await res.json() : [];
                } catch { return []; }
              }));
              const now = new Date();
              const nowHHMM = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
              setRouteDepartures(buildMetroRouteDepartures(
                legTimetables,
                legJourneys,
                r.transfers.map((t) => t.transferTimeSec),
                zh,
                nowHHMM,
              ));
            }
          }
        } catch (e) {
          console.error(e);
          setRoute(null);
        }
      }

      // Fire-and-forget analytics, mirroring other timetable searches.
      logQuery({
        transportType: 'metro',
        originStationId: activeOriginId,
        originStationName: (zh ? systemStations.find(s => s.StationID === activeOriginId)?.StationName.Zh_tw : systemStations.find(s => s.StationID === activeOriginId)?.StationName.En) || activeOriginId,
        destStationId: activeDestId,
        destStationName: (zh ? systemStations.find(s => s.StationID === activeDestId)?.StationName.Zh_tw : systemStations.find(s => s.StationID === activeDestId)?.StationName.En) || activeDestId,
        queryDate: new Date().toISOString().slice(0, 10),
        tripType: 'one-way',
        activeFilter: activeSystem,
        resultCount: j ? 1 : 0,
      });
    } catch (e) {
      console.error(e);
      setError(L('無法取得捷運資料', 'Failed to fetch metro data.'));
    } finally {
      setLoading(false);
    }
  };

  const useCurrentLocation = async () => {
    try {
      const geo = await requestGeolocation();
      const allSystemsStations = await Promise.all(
        METRO_SYSTEMS.map(s => getMetroStations(s.code).then(res => ({ code: s.code, stations: res })))
      );
      let bestSys = '';
      let bestStation: MetroStation | null = null;
      let bestDist = Infinity;
      
      for (const { code, stations } of allSystemsStations) {
        const nearest = findNearestMetro(geo.lat, geo.lon, stations);
        if (nearest) {
          const p = nearest.StationPosition;
          if (p && typeof p.PositionLat === 'number' && typeof p.PositionLon === 'number') {
            const d = haversineKm(geo.lat, geo.lon, p.PositionLat, p.PositionLon);
            if (d < bestDist) {
              bestDist = d;
              bestStation = nearest;
              bestSys = code;
            }
          }
        }
      }

      if (bestStation && bestSys) {
        userPickedOriginRef.current = true;
        if (system !== bestSys) {
          setSystem(bestSys);
          if (pickerType === 'origin') setDestId('');
          else setOriginId('');
        }
        if (pickerType === 'origin') setOriginId(bestStation.StationID);
        else setDestId(bestStation.StationID);
        setPickerType(null);
        setHasSearched(false);
      } else {
        setError(L('附近無捷運站', 'No metro stations nearby.'));
      }
    } catch {
      setError(L('無法取得目前位置，請改選手動選擇車站。', 'Could not get location. Please select manually.'));
    }
  };

  const getStationName = (s?: MetroStation) => {
    if (!s) return '';
    return (zh ? s.StationName.Zh_tw : s.StationName.En) || s.StationName.Zh_tw || '';
  };

  // Fare breakdown: headline the full/adult fare (not the cheapest concession),
  // list the remaining passenger categories (學生/敬老/兒童/愛心/電子票證…) as chips.
  const fareList = fares ?? [];
  const primaryFare = fareList.find(f => f.category === 'full') ?? fareList[0] ?? null;
  const otherFares = fareList.filter(f => f !== primaryFare);
  const fareLabel = (f: MetroFare) => (zh ? f.label : f.labelEn) || f.label;
  const sameLineRideStopCount = journey ? Math.max(0, journey.stopNames.length - 1) : 0;
  const routeRideStopCount = route?.legs.reduce((sum, leg) => sum + Math.max(0, leg.stopNames.length - 1), 0) ?? 0;

  /**
   * Per-leg stop diagram for a transfer route. With a scheduled run (`rd`)
   * every stop shows its actual clock time; without one it falls back to the
   * cumulative "+N 分" offsets — the same visual as the single-line diagram.
   */
  const renderRouteLegDiagram = (r: MetroRoute, rd?: MetroRouteDeparture) => (
    <div className="flex flex-col gap-4">
      {r.legs.map((leg, i) => {
        // Offset of this leg's boarding stop from the journey start
        // (previous rides + previous transfer walks).
        const legStartSec = r.legs
          .slice(0, i)
          .reduce((acc, l, k) => acc + l.rideTimeSec + (r.transfers[k]?.transferTimeSec ?? 0), 0);
        return (
          <React.Fragment key={i}>
            <div className="rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200/70 dark:border-white/10 p-3 sm:p-4">
              <div className="flex items-start gap-3 mb-3">
                <span className="mt-0.5 self-start px-2.5 py-1 rounded-md text-xs font-black tracking-widest bg-cyan-100 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 ring-1 ring-inset ring-cyan-500/20 whitespace-nowrap">
                  {lineLabel(leg.lineId)}
                </span>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="font-bold text-slate-900 dark:text-white">{leg.fromName} → {leg.toName}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {rd ? (
                      <>
                        <span className="font-bold tabular-nums text-slate-700 dark:text-slate-200">{rd.legs[i]?.departureTime}→{rd.legs[i]?.arrivalTime}</span>
                        {' · '}
                        {L(`往${rd.legs[i]?.destName}`, `to ${rd.legs[i]?.destName}`)}
                        {' · '}
                        {L(`經 ${Math.max(0, leg.stopNames.length - 1)} 站`, `${Math.max(0, leg.stopNames.length - 1)} stops`)}
                      </>
                    ) : (
                      <>
                        {L(`經 ${Math.max(0, leg.stopNames.length - 1)} 站`, `${Math.max(0, leg.stopNames.length - 1)} stops`)}
                        {' · '}
                        {Math.ceil(leg.rideTimeSec / 60)} {L('分鐘', 'min')}
                      </>
                    )}
                  </span>
                </div>
              </div>

              <div className="relative pl-1">
                {leg.stopNames.map((name, stopIndex) => {
                  const isFirst = stopIndex === 0;
                  const isLast = stopIndex === leg.stopNames.length - 1;
                  const isJourneyOrigin = i === 0 && isFirst;
                  const isJourneyDest = i === r.legs.length - 1 && isLast;
                  const isTransferStop = isLast && i < r.legs.length - 1;
                  const sid = leg.stopIds?.[stopIndex];
                  const ic = (!isFirst && !isLast && sid) ? interchangeInfo.get(sid) : undefined;
                  const offsetSec = legStartSec + (leg.stopOffsetsSec?.[stopIndex] ?? 0);
                  const stationTime = rd
                    ? addMinutesToHHMM(rd.legs[i]?.departureTime ?? '00:00', leg.stopOffsetsSec?.[stopIndex] ?? 0)
                    : '';
                  return (
                    <div key={`${leg.lineId}-${name}-${stopIndex}`} className="flex items-stretch gap-3">
                      <div className="flex flex-col items-center w-5 shrink-0 relative">
                        {!isFirst && <div className="w-[2px] h-1/2 absolute top-0 bg-cyan-500/30" />}
                        {!isLast && <div className="w-[2px] h-1/2 absolute bottom-0 bg-cyan-500/30" />}
                        <div className={`relative z-10 mt-[14px] w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 ${
                          isFirst || isLast ? 'bg-amber-400' : 'bg-white !border-cyan-300 dark:!border-cyan-700'
                        }`} />
                      </div>
                      <div className="flex flex-1 items-center justify-between gap-2 py-2.5 border-b border-slate-100 dark:border-white/5 min-w-0">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                          <span className={`text-sm sm:text-base font-black tracking-tight truncate ${
                            (isJourneyOrigin || isJourneyDest) ? 'text-amber-600 dark:text-amber-400'
                              : isFirst || isLast ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'
                          }`}>{name}</span>
                          {(isJourneyOrigin || isJourneyDest) && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-600 dark:text-amber-400 text-[9px] font-black uppercase tracking-widest">
                              {isJourneyOrigin ? L('起點', 'Origin') : L('終點', 'Dest')}
                            </span>
                          )}
                          {isFirst && !isJourneyOrigin && (
                            <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 text-[9px] font-black uppercase tracking-widest">
                              {L('上車', 'Board')}
                            </span>
                          )}
                          {isTransferStop && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-600 dark:text-amber-400 text-[9px] font-black uppercase tracking-widest">
                              {L('轉乘', 'Transfer')}
                            </span>
                          )}
                            {ic && (ic.lines.size > 0 || (Number.isFinite(ic.sec) && ic.sec > 0)) && (
                            <button
                              type="button"
                              title={ic.desc || undefined}
                              onClick={(e) => { e.stopPropagation(); if (sid) setTransferPopup({ stationId: sid, stationName: name }); }}
                              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-slate-700/70 text-slate-600 dark:text-slate-300 text-[9px] font-black uppercase tracking-widest cursor-pointer hover:bg-slate-300/80 dark:hover:bg-slate-600/80 hover:text-slate-800 dark:hover:text-white transition-colors"
                            >
                              <ArrowRightLeft className="w-2.5 h-2.5" />
                              {L('轉乘', 'Transfer')}
                              {ic.lines.size > 0 ? ` ${[...ic.lines].map(c => lineLabel(c)).join('/')}` : ''}
                              {Number.isFinite(ic.sec) && ic.sec > 0 ? ` · ${Math.ceil(ic.sec / 60)}${L('分', 'm')}` : ''}
                            </button>
                            )}
                          </div>
                          {rd && renderMetroFootfall(name, stationTime, rd.legs[i]?.departureTime ?? '')}
                        </div>
                        <span className="font-mono font-bold tabular-nums text-xs sm:text-sm text-slate-500 dark:text-slate-400 shrink-0">
                          {rd
                            ? stationTime
                            : <>+{Math.ceil(offsetSec / 60)} {L('分', 'm')}</>}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {i < r.legs.length - 1 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-xs font-semibold text-amber-700 dark:text-amber-300 flex-wrap">
                <ArrowRightLeft className="w-4 h-4 shrink-0" />
                {L(`在 ${r.transfers[i]?.stationName ?? ''} 轉乘 · 步行約 ${Math.ceil((r.transfers[i]?.transferTimeSec ?? 0) / 60)} 分`,
                   `Transfer at ${r.transfers[i]?.stationName ?? ''} · ~${Math.ceil((r.transfers[i]?.transferTimeSec ?? 0) / 60)} min walk`)}
                {rd && (rd.legs[i + 1]?.waitSec ?? 0) > 0 && (
                  <span className="opacity-80">{L(`· 候車 ${Math.ceil((rd.legs[i + 1]?.waitSec ?? 0) / 60)} 分`, `· ${Math.ceil((rd.legs[i + 1]?.waitSec ?? 0) / 60)} min wait`)}</span>
                )}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );

  const isPinned = pinnedRoutes.some(r => r.system === system && r.originId === originId && r.destId === destId);

  const togglePinRoute = () => {
    if (!originStation || !destStation) return;
    const key = `${system}-${originId}-${destId}`;
    if (isPinned) {
      savePinnedRoutes(pinnedRoutes.filter(r => r.id !== key));
    } else {
      const newPin: PinnedRoute = {
        id: key,
        system,
        originId,
        originNameZh: originStation.StationName.Zh_tw,
        originNameEn: originStation.StationName.En,
        destId,
        destNameZh: destStation.StationName.Zh_tw,
        destNameEn: destStation.StationName.En,
      };
      savePinnedRoutes([...pinnedRoutes, newPin]);
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col items-center w-full">
      
      {/* Pinned Routes / My Commute Section */}
      {pinnedRoutes.length > 0 && (
        <div className="w-full max-w-3xl mb-6 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center gap-1.5 mb-2.5 px-1">
            <span className="p-1 rounded bg-cyan-100 dark:bg-cyan-900/40 text-cyan-600 dark:text-cyan-400">
              <Pin className="w-3.5 h-3.5 fill-current" />
            </span>
            <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {L('我的常用路線', 'My Commute')}
            </span>
          </div>
          <div className="flex gap-2 flex-wrap">
            {pinnedRoutes.map((r) => {
              const sysMeta = METRO_SYSTEMS.find(s => s.code === r.system);
              return (
                <div
                  key={r.id}
                  className="group/commute flex items-center bg-white/65 dark:bg-slate-900/50 backdrop-blur border border-slate-200/60 dark:border-slate-800 rounded-2xl px-3.5 py-2 hover:border-cyan-300 dark:hover:border-cyan-800 hover:shadow-sm transition-all duration-300 text-xs sm:text-sm"
                >
                  <button
                    onClick={() => {
                      setSystem(r.system);
                      setOriginId(r.originId);
                      setDestId(r.destId);
                      handleSearch(r.system, r.originId, r.destId);
                    }}
                    className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300 hover:text-cyan-600 dark:hover:text-cyan-400 cursor-pointer"
                  >
                    {sysMeta && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-extrabold scale-90">
                        {(zh ? sysMeta.zh : sysMeta.en).replace("捷運", "").replace("Metro", "").trim()}
                      </span>
                    )}
                    <span>{zh ? r.originNameZh : r.originNameEn}</span>
                    <span className="text-slate-400 group-hover/commute:translate-x-0.5 transition-transform">→</span>
                    <span>{zh ? r.destNameZh : r.destNameEn}</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      savePinnedRoutes(pinnedRoutes.filter(x => x.id !== r.id));
                    }}
                    className="ml-2.5 p-0.5 rounded-full text-slate-400 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-all cursor-pointer"
                    title={L('移除常用路線', 'Remove')}
                  >
                    <X className="w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Station Selector & Swap (Similar to App.tsx Rail Search) */}
      <div className="relative z-50 flex flex-row items-center justify-between mb-8 w-full max-w-3xl backdrop-blur-2xl border border-cyan-200/50 dark:border-cyan-400/15 rounded-[2.5rem] p-3 sm:p-6 bg-white/70 dark:bg-slate-900/55 shadow-[inset_0_1px_1px_rgba(255,255,255,0.45),0_20px_50px_-26px_rgba(8,145,178,0.4)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.06),0_24px_64px_-32px_rgba(6,182,212,0.55)]">
        
        {/* Origin */}
        <div className="flex-1 flex flex-col min-w-0">
          <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-cyan-600/70 dark:text-cyan-400/70 mb-1 px-3">
            {L('出發', 'FROM')}
          </span>
          <button
            onClick={() => { setModalSystem(system); setPickerType('origin'); }}
            className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-2xl hover:bg-white/60 dark:hover:bg-slate-800/60 transition-all min-w-0 group"
          >
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-cyan-100 dark:bg-cyan-900/50 flex items-center justify-center shrink-0 group-hover:scale-110 group-hover:bg-cyan-200 dark:group-hover:bg-cyan-800/60 transition-all">
              <MapPin className="w-4 h-4 sm:w-5 sm:h-5 text-cyan-600 dark:text-cyan-400" />
            </div>
            <span className="text-xl sm:text-3xl font-black text-slate-800 dark:text-white truncate tabular-nums tracking-tight">
              {getStationName(originStation) || L('選擇起點', 'Origin')}
            </span>
          </button>
        </div>

        {/* Swap Button */}
        <div className="relative z-10 px-2 sm:px-4 flex shrink-0 justify-center">
          <button
            onClick={handleSwap}
            className="group p-3 sm:p-4 rounded-full bg-white dark:bg-slate-800 shadow-sm sm:shadow-md border border-slate-100 dark:border-slate-700 hover:shadow-lg transition-all hover:scale-110 active:scale-95"
            aria-label={L('對調起訖站', 'Swap stations')}
          >
            <ArrowRightLeft className="w-5 h-5 sm:w-6 sm:h-6 text-cyan-500 group-hover:text-cyan-600 dark:group-hover:text-cyan-400 group-hover:rotate-180 transition-all duration-500" />
          </button>
        </div>

        {/* Destination */}
        <div className="flex-1 flex flex-col items-end min-w-0">
          <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-cyan-600/70 dark:text-cyan-400/70 mb-1 px-3 text-right">
            {L('抵達', 'TO')}
          </span>
          <button
            onClick={() => { setModalSystem(system); setPickerType('dest'); }}
            className="flex items-center justify-end gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-2xl hover:bg-white/60 dark:hover:bg-slate-800/60 transition-all min-w-0 w-full group"
          >
            <span className="text-xl sm:text-3xl font-black text-slate-800 dark:text-white truncate text-right tabular-nums tracking-tight">
              {getStationName(destStation) || L('選擇終點', 'Dest')}
            </span>
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-cyan-100 dark:bg-cyan-900/50 flex items-center justify-center shrink-0 group-hover:scale-110 group-hover:bg-cyan-200 dark:group-hover:bg-cyan-800/60 transition-all">
              <MapPin className="w-4 h-4 sm:w-5 sm:h-5 text-cyan-600 dark:text-cyan-400" />
            </div>
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 text-sm font-medium text-rose-600 bg-rose-50 px-4 py-2 rounded-lg">
          {error}
        </div>
      )}

      {/* Search Button */}
      <div className="w-full max-w-3xl px-2 sm:px-0">
         <button
          onClick={() => handleSearch()}
          disabled={loading || queryThrottled || !originId || !destId}
          className="w-full flex items-center justify-center gap-2 sm:gap-3 py-3.5 sm:py-4 rounded-2xl sm:rounded-3xl bg-gradient-to-r from-cyan-600 to-teal-600 text-white text-base sm:text-lg font-bold ring-1 ring-inset ring-white/15 shadow-[0_10px_34px_-8px_rgba(8,145,178,0.5)] hover:from-cyan-500 hover:to-teal-500 hover:shadow-[0_14px_44px_-8px_rgba(8,145,178,0.6)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all disabled:opacity-50 disabled:hover:translate-y-0 disabled:active:scale-100 disabled:cursor-not-allowed"
        >
          {loading ? (
            <div className="w-5 h-5 sm:w-6 sm:h-6 border-3 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Search className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.5]" />
          )}
          <span>{loading ? L('查詢中...', 'Searching...') : L('查詢捷運資訊', 'Search Metro')}</span>
        </button>
      </div>

      {/* Results — portaled to the App-level mount so they sit where rail results do */}
      {resultsMount && hasSearched && !loading && !error && createPortal(
        <section className="max-w-5xl mx-auto px-4 md:px-8 pb-32 relative z-20 scroll-mt-24 animate-in fade-in slide-in-from-bottom-4 duration-500">

          {/* Service alerts (營運通阻) */}
          {alerts.length > 0 && (
            <div className="mb-4 rounded-2xl border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/15 p-4">
              <div className="flex items-center gap-2 mb-2 text-amber-700 dark:text-amber-400 font-black text-sm uppercase tracking-wider">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {L('營運通阻', 'Service Alerts')}
                <span className="text-[11px] font-bold opacity-70">({alerts.length})</span>
              </div>
              <ul className="flex flex-col gap-1.5">
                {alerts.slice(0, 5).map((a, i) => (
                  <li key={i} className="text-sm text-amber-800/90 dark:text-amber-300/90 leading-snug">
                    <span className="font-semibold">{a.title || a.description}</span>
                    {a.description && a.title && a.description !== a.title && (
                      <span className="opacity-80"> — {a.description}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Summary header (出發站 / 抵達站 / 票價) */}
          <div className="mb-6 rounded-3xl p-6 bg-gradient-to-br from-cyan-700 via-cyan-800 to-teal-900 text-white ring-1 ring-inset ring-white/10 shadow-[0_24px_60px_-28px_rgba(8,145,178,0.6)] flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg sm:text-2xl font-black tracking-tight flex items-center gap-2">
                  <TramFront className="w-6 h-6 shrink-0" />
                  <span>{getStationName(originStation) || '—'}</span>
                  <span className="opacity-70">→</span>
                  <span>{getStationName(destStation) || '—'}</span>
                </h2>
                <button
                  onClick={togglePinRoute}
                  className={`p-2 rounded-xl transition-all duration-300 flex items-center justify-center cursor-pointer ${
                    isPinned
                      ? 'bg-amber-400 text-slate-900 shadow-[0_4px_12px_rgba(251,191,36,0.4)] scale-105 hover:scale-110'
                      : 'bg-white/10 text-white hover:bg-white/20 ring-1 ring-white/20'
                  }`}
                  title={isPinned ? L('從常用路線移除', 'Unpin commute route') : L('加入常用路線', 'Pin commute route')}
                >
                  <Pin className={`w-4 h-4 ${isPinned ? 'fill-current' : ''}`} />
                </button>
              </div>
              <div className="flex items-center gap-2 bg-white/10 ring-1 ring-inset ring-white/20 rounded-2xl px-4 py-2 shadow-[0_4px_16px_-6px_rgba(0,0,0,0.4)]">
                {primaryFare ? (
                  <div className="flex items-center gap-2">
                    <span className="text-2xl sm:text-3xl font-black tabular-nums">NT${primaryFare.price}</span>
                    <span className="text-sm font-semibold opacity-90">{fareLabel(primaryFare) || L('全票', 'Adult')}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(String(primaryFare.price));
                        setCopiedPrimary(true);
                        setTimeout(() => setCopiedPrimary(false), 2000);
                      }}
                      className="p-1 rounded bg-white/10 hover:bg-white/25 text-white/80 hover:text-white transition-all cursor-pointer flex items-center justify-center"
                      title={L('複製票價', 'Copy fare')}
                    >
                      {copiedPrimary ? (
                        <Check className="w-3.5 h-3.5 text-emerald-300" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                ) : (
                  <span className="text-sm font-semibold opacity-90">{L('尚無票價資訊', 'No fare data')}</span>
                )}
              </div>
            </div>
            {(journey || route) && (
              <div className="flex items-center gap-2 text-sm font-semibold text-white/90">
                <Clock className="w-4 h-4" />
                {journey ? (
                  <>
                    <span>{Math.ceil(journey.travelTimeSec / 60)} {L('分鐘', 'min')}</span>
                    <span className="opacity-70">·</span>
                    <span>{L(`經 ${journey.stopNames.length - 1} 站`, `${journey.stopNames.length - 1} stops`)}</span>
                  </>
                ) : route ? (
                  <>
                    <span>{Math.ceil(route.totalTimeSec / 60)} {L('分鐘', 'min')}</span>
                    <span className="opacity-70">·</span>
                    <span>{L(`轉乘 ${route.transferCount} 次`, `${route.transferCount} transfer${route.transferCount === 1 ? '' : 's'}`)}</span>
                  </>
                ) : null}
              </div>
            )}
            {otherFares.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-white/15">
                <span className="text-[11px] font-bold uppercase tracking-wider text-white/60 mr-1">{L('其他票種', 'Other fares')}</span>
                {otherFares.map((fare, i) => {
                  const labelStr = `${fare.category}-${i}`;
                  const isCopied = copiedOtherLabel === labelStr;
                  return (
                    <button
                      key={labelStr}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(String(fare.price));
                        setCopiedOtherLabel(labelStr);
                        setTimeout(() => setCopiedOtherLabel(null), 2000);
                      }}
                      className={`flex items-center gap-1.5 bg-white/15 hover:bg-white/25 active:scale-95 rounded-lg px-2.5 py-1 text-left cursor-pointer transition-all border ${
                        isCopied ? 'border-emerald-400 text-emerald-300' : 'border-transparent text-white'
                      }`}
                      title={L(`點擊複製 ${fareLabel(fare)} 票價`, `Click to copy ${fareLabel(fare)} fare`)}
                    >
                      <span className="text-[11px] font-semibold opacity-80">{fareLabel(fare)}</span>
                      <span className="text-sm font-black tabular-nums">${fare.price}</span>
                      {isCopied ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3 opacity-50" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {journey ? (
            departures.length > 0 ? (
              <>
                <h3 className="mb-4 px-2 text-xs sm:text-sm font-black text-slate-950 dark:text-white tracking-widest uppercase">
                  {L(`近期班次 · ${departures.length} 班`, `Upcoming · ${departures.length}`)}
                </h3>
                <div className="flex flex-col gap-3">
                  {departures.slice(0, visibleCount).map((d) => {
                    const key = `${d.departureTime}-${d.seq}`;
                    const isExpanded = expandedDeparture === key;
                    const isExpress = d.trainType === 1;
                    return (
                      <div
                        key={key}
                        className={`w-full rounded-2xl border bg-white dark:bg-slate-900 shadow-sm hover:shadow-[0_20px_50px_-12px_rgba(0,0,0,0.15)] hover:scale-[1.01] hover:border-cyan-300 dark:hover:border-cyan-800 transition-all duration-300 overflow-hidden ${
                          isExpanded ? 'border-cyan-200 dark:border-cyan-800 bg-gradient-to-br from-white to-cyan-50/40 dark:from-slate-900 dark:to-cyan-950/20 shadow-md' : 'border-slate-100 dark:border-slate-800'
                        }`}
                      >
                        <button
                          onClick={async () => {
                            if (!isExpanded) {
                              setExpandedDeparture(key);
                              setLoadingLiveBoard(true);
                              try {
                                const [board, positions] = await Promise.all([
                                  getMetroLiveBoard(system, originId),
                                  getMetroLivePosition(system),
                                ]);
                                setLiveBoard(board.filter(b => b.DestinationStationID === d.destId));
                                setLivePositions(positions);
                              } catch (e) {
                                console.error(e);
                              } finally {
                                setLoadingLiveBoard(false);
                              }
                            } else {
                              setExpandedDeparture(null);
                            }
                          }}
                          className="w-full text-left px-4 sm:px-6 py-4 cursor-pointer select-none"
                        >
                          <div className="grid grid-cols-12 gap-x-4 items-center">
                            {/* Train type + direction */}
                            <div className="col-span-4 sm:col-span-3 flex flex-col gap-1.5 min-w-0">
                              <span className={`self-start px-2 py-1 rounded-md text-xs sm:text-sm font-bold tracking-widest ${
                                isExpress ? 'bg-[#feebd6] text-[#d85e01]' : 'bg-[#e0f7fa] text-[#0e7490]'
                              }`}>
                                {metroTrainTypeLabel(d.trainType, zh)}
                              </span>
                              <span className="text-[11px] text-slate-500 truncate">
                                {L('往', 'To')} {d.destName}
                              </span>
                              {d.crowdedness && d.crowdedness.length > 0 && (
                                <TrainCrowdedness cars={d.crowdedness} zh={zh} />
                              )}
                            </div>

                            {/* Departure — duration — arrival & Progress Bar (Restructured Grid Layout) */}
                            <div className="col-span-8 sm:col-span-7 grid grid-cols-1 gap-3.5 justify-center">
                              {/* Time display sub-row */}
                              <div className="flex items-center justify-between gap-2 sm:gap-3">
                                <div className="text-left shrink-0">
                                  <p className={`font-black text-2xl sm:text-4xl tracking-tighter tabular-nums leading-none ${isExpanded ? 'text-cyan-600' : 'text-slate-900 dark:text-white'}`}>
                                    {d.departureTime}
                                  </p>
                                </div>
                                <div className="flex-1 text-center min-w-0 px-1">
                                  <p className="text-xs text-slate-500 font-medium mb-1">
                                    {Math.ceil(journey.travelTimeSec / 60)} {L('分鐘', 'min')}
                                  </p>
                                  <div className="relative w-full h-px bg-slate-200 dark:bg-slate-700 my-1">
                                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-cyan-400 border-2 border-white dark:border-slate-900"></div>
                                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-cyan-600 border-2 border-white dark:border-slate-900"></div>
                                  </div>
                                  <p className="text-[0.65rem] font-semibold text-slate-400 tracking-wide uppercase">
                                    {L('直達', 'Direct')}
                                  </p>
                                </div>
                                <div className="text-right shrink-0">
                                  <p className="font-black text-2xl sm:text-4xl tracking-tighter tabular-nums leading-none text-slate-900 dark:text-white">
                                    {d.arrivalTime}
                                  </p>
                                </div>
                              </div>

                              {/* Progress Bar & Station labels */}
                              <div className="w-full">
                                <JourneyProgressBar
                                  departureTime={d.departureTime}
                                  arrivalTime={d.arrivalTime}
                                  zh={zh}
                                  originName={getStationName(stations.find(s => s.StationID === originId)) || originId}
                                  destName={getStationName(stations.find(s => s.StationID === destId)) || destId}
                                />
                              </div>
                            </div>

                            {/* Chevron */}
                            <div className="hidden sm:flex col-span-2 justify-end">
                              <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                            </div>
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="px-4 sm:px-6 pb-5 animate-in slide-in-from-top-2 fade-in duration-200">
                            <div className="pt-4 border-t border-slate-200 dark:border-slate-700 flex flex-col gap-4">
                              {/* Category tabs selection for Metro Search detail card */}
                              {renderMetroDetailTabBar()}

                              {metroDetailTab === 'stops' ? (
                                <div className="flex flex-col gap-4">
                                  {/* Live board */}
                                  <div>
                                    <h4 className="font-bold text-slate-800 dark:text-slate-100 mb-2 text-sm flex items-center gap-2">
                                      <Clock className="w-4 h-4 text-cyan-500" />
                                      {L('即時看板', 'Live Board')}
                                    </h4>
                                    {loadingLiveBoard ? (
                                      <div className="flex items-center gap-2 text-sm text-slate-500 py-2">
                                        <div className="w-4 h-4 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
                                        {L('載入即時看板...', 'Loading live board...')}
                                      </div>
                                    ) : liveBoard.length > 0 ? (
                                      <div className="flex flex-col gap-2">
                                        {liveBoard.map((lb, i) => (
                                          <div key={i} className="flex items-center gap-3 p-3 bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800">
                                            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                            <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
                                              {zh ? lb.DestinationStationName.Zh_tw : lb.DestinationStationName.En}
                                            </span>
                                            <div className="ml-auto">
                                              {lb.EstimateTime <= 0 ? (
                                                <span className="text-sm font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 px-2 py-0.5 rounded-md">
                                                  {L('進站中', 'Approaching')}
                                                </span>
                                              ) : (
                                                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-md">
                                                  {lb.EstimateTime} {L('分', 'min')}
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <div className="text-sm text-slate-500 py-2">
                                        {L('目前無即時動態資料', 'No live data available at the moment.')}
                                      </div>
                                    )}
                                  </div>

                                  {/* Stop sequence */}
                                  <div>
                                    <div className="flex items-center justify-between mb-3">
                                      <h4 className="font-bold text-slate-800 dark:text-slate-100 text-sm flex items-center gap-2">
                                        <MapPin className="w-4 h-4 text-cyan-500" />
                                        {L('停靠資訊', 'Stops')}
                                      </h4>
                                      {livePositions.some(lp => journey.stopIds.includes(lp.stationId)) && (
                                        <span className="flex items-center gap-1.5 text-[10px] font-black text-cyan-600 dark:text-cyan-400 border border-cyan-500/30 px-2 py-1 rounded-md uppercase tracking-tighter">
                                          <span className="flex h-1.5 w-1.5 rounded-full bg-cyan-500 animate-pulse" />
                                          {L('即時位置', 'Live Position')}
                                        </span>
                                      )}
                                    </div>
                                    <div className="relative px-1">
                                      {journey.stopIds.map((sid, i) => {
                                        const name = journey.stopNames[i];
                                        const isOrigin = i === 0;
                                        const isDest = i === journey.stopIds.length - 1;
                                        const clock = addMinutesToHHMM(d.departureTime, journey.stopOffsetsSec[i]);
                                        const liveHere = livePositions.some(lp =>
                                          lp.stationId === sid && (!lp.lineId || !journey.lineId || lp.lineId === journey.lineId));
                                        const ic = (!isOrigin && !isDest) ? interchangeInfo.get(sid) : undefined;
                                        return (
                                          <div key={`${sid}-${i}`} className="flex items-stretch gap-3 relative">
                                            {/* Timeline column */}
                                            <div className="flex flex-col items-center w-5 shrink-0 relative">
                                              {!isOrigin && <div className="w-[2px] h-1/2 absolute top-0 bg-cyan-500/30" />}
                                              {!isDest && <div className="w-[2px] h-1/2 absolute bottom-0 bg-cyan-500/30" />}
                                              <div className={`relative z-10 mt-[18px] w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 transition-all ${
                                                liveHere ? 'bg-cyan-500 ring-4 ring-cyan-400/30 scale-125 animate-pulse' :
                                                (isOrigin || isDest) ? 'bg-amber-400' : 'bg-white !border-cyan-300 dark:!border-cyan-700'
                                              }`} />
                                            </div>
                                            {/* Content column */}
                                            <div className={`flex flex-1 items-center justify-between gap-2 py-2.5 border-b border-slate-100 dark:border-slate-800 min-w-0 ${
                                              liveHere ? 'bg-cyan-50/70 dark:bg-cyan-950/30 -mx-2 px-2 rounded-xl border-transparent' : ''
                                            }`}>
                                              <div className="flex min-w-0 flex-col gap-0.5">
                                                <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                                <span className={`text-sm sm:text-base font-black tracking-tight truncate ${
                                                  liveHere ? 'text-cyan-700 dark:text-cyan-300' :
                                                  (isOrigin || isDest) ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-slate-100'
                                                }`}>{name}</span>
                                                {liveHere && (
                                                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 text-[9px] font-black uppercase tracking-widest animate-pulse">
                                                    <TramFront className="w-3 h-3" />{L('列車', 'Train')}
                                                  </span>
                                                )}
                                                {(isOrigin || isDest) && (
                                                  <span className="px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-600 dark:text-amber-400 text-[9px] font-black uppercase tracking-widest">
                                                    {isOrigin ? L('起點', 'Origin') : L('終點', 'Dest')}
                                                  </span>
                                                )}
                                                {isOrigin && originPlatform && (
                                                  <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 text-[9px] font-black uppercase tracking-widest">
                                                    {L(`月台 ${originPlatform}`, `Platform ${originPlatform}`)}
                                                  </span>
                                                )}
                                                  {ic && (ic.lines.size > 0 || (Number.isFinite(ic.sec) && ic.sec > 0)) && (
                                                  <button
                                                    type="button"
                                                    title={ic.desc || undefined}
                                                    onClick={(e) => { e.stopPropagation(); if (sid) setTransferPopup({ stationId: sid, stationName: name }); }}
                                                    className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-slate-700/70 text-slate-600 dark:text-slate-300 text-[9px] font-black uppercase tracking-widest cursor-pointer hover:bg-slate-300/80 dark:hover:bg-slate-600/80 hover:text-slate-800 dark:hover:text-white transition-colors"
                                                  >
                                                    <ArrowRightLeft className="w-2.5 h-2.5" />
                                                    {L('轉乘', 'Transfer')}
                                                    {ic.lines.size > 0 ? ` ${[...ic.lines].map(c => lineLabel(c)).join('/')}` : ''}
                                                    {Number.isFinite(ic.sec) && ic.sec > 0 ? ` · ${Math.ceil(ic.sec / 60)}${L('分', 'm')}` : ''}
                                                  </button>
                                                  )}
                                                </div>
                                                {renderMetroFootfall(name, clock, d.departureTime)}
                                              </div>
                                              <span className="font-mono font-bold tabular-nums text-xs sm:text-sm text-slate-500 dark:text-slate-400 shrink-0">{clock}</span>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                              ) : metroDetailTab === 'youbike' ? (
                                /* YOUBIKE TAB CONTENT — 起點站與終點站各自最近的 YouBike */
                                renderMetroYouBikeTab()
                              ) : (
                                /* STATION/BUS TAB CONTENT */
                                renderMetroBusTab()
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {departures.length > visibleCount && (
                  <button
                    onClick={() => setVisibleCount(v => v + 10)}
                    className="mt-4 w-full py-3 rounded-2xl border border-cyan-200 dark:border-cyan-800 text-cyan-700 dark:text-cyan-400 font-bold text-sm hover:bg-cyan-50 dark:hover:bg-cyan-900/20 transition-colors"
                  >
                    {L(`查看更多 (+${Math.min(10, departures.length - visibleCount)})`, `Show more (+${Math.min(10, departures.length - visibleCount)})`)}
                  </button>
                )}
              </>
            ) : (
              <>
                <h3 className="mb-4 px-2 text-xs sm:text-sm font-black text-slate-950 dark:text-white tracking-widest uppercase">
                  {L(`建議路線 · ${sameLineRideStopCount} 站 · 直達`, `Suggested Route · ${sameLineRideStopCount} stops · Direct`)}
                </h3>
                <div className="rounded-3xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/70 backdrop-blur-xl shadow-[0_24px_60px_-34px_rgba(8,145,178,0.4)] p-4 sm:p-6">
                  <div className="mb-4 flex items-start gap-3 rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-3">
                    <AlertCircle className="mt-0.5 w-4 h-4 shrink-0 text-amber-500" />
                    <p className="text-xs sm:text-sm font-semibold leading-relaxed text-amber-700 dark:text-amber-300/90">
                      {L('目前沒有可顯示的班次時刻，先顯示乘車站點順序。', 'No displayable departures right now; showing the ride stop sequence.')}
                    </p>
                  </div>

                  <div className="relative pl-1">
                    {journey.stopIds.map((sid, i) => {
                      const name = journey.stopNames[i];
                      const isOrigin = i === 0;
                      const isDest = i === journey.stopIds.length - 1;
                      const ic = (!isOrigin && !isDest) ? interchangeInfo.get(sid) : undefined;
                      return (
                        <div key={`${sid}-${i}`} className="flex items-stretch gap-3">
                          <div className="flex flex-col items-center w-5 shrink-0 relative">
                            {!isOrigin && <div className="w-[2px] h-1/2 absolute top-0 bg-cyan-500/30" />}
                            {!isDest && <div className="w-[2px] h-1/2 absolute bottom-0 bg-cyan-500/30" />}
                            <div className={`relative z-10 mt-[18px] w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 ${
                              (isOrigin || isDest) ? 'bg-amber-400' : 'bg-white !border-cyan-300 dark:!border-cyan-700'
                            }`} />
                          </div>
                          <div className="flex flex-1 items-center justify-between gap-2 py-2.5 border-b border-slate-100 dark:border-white/5 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                              <span className={`text-sm sm:text-base font-black truncate ${
                                (isOrigin || isDest) ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-slate-100'
                              }`}>{name}</span>
                              {(isOrigin || isDest) && (
                                <span className="px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-600 dark:text-amber-400 text-[9px] font-black uppercase tracking-widest">
                                  {isOrigin ? L('起點', 'Origin') : L('終點', 'Dest')}
                                </span>
                              )}
                              {isOrigin && originPlatform && (
                                <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 text-[9px] font-black uppercase tracking-widest">
                                  {L(`月台 ${originPlatform}`, `Platform ${originPlatform}`)}
                                </span>
                              )}
                              {ic && (ic.lines.size > 0 || (Number.isFinite(ic.sec) && ic.sec > 0)) && (
                                <button
                                  type="button"
                                  title={ic.desc || undefined}
                                  onClick={(e) => { e.stopPropagation(); if (sid) setTransferPopup({ stationId: sid, stationName: name }); }}
                                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-slate-700/70 text-slate-600 dark:text-slate-300 text-[9px] font-black uppercase tracking-widest cursor-pointer hover:bg-slate-300/80 dark:hover:bg-slate-600/80 hover:text-slate-800 dark:hover:text-white transition-colors"
                                >
                                  <ArrowRightLeft className="w-2.5 h-2.5" />
                                  {L('轉乘', 'Transfer')}
                                  {ic.lines.size > 0 ? ` ${[...ic.lines].map(c => lineLabel(c)).join('/')}` : ''}
                                  {Number.isFinite(ic.sec) && ic.sec > 0 ? ` · ${Math.ceil(ic.sec / 60)}${L('分', 'm')}` : ''}
                                </button>
                              )}
                            </div>
                            <span className="font-mono font-bold tabular-nums text-xs sm:text-sm text-slate-500 dark:text-slate-400 shrink-0">
                              +{Math.ceil(journey.stopOffsetsSec[i] / 60)} {L('分', 'm')}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )
          ) : route ? (
            routeDepartures.length > 0 ? (
              <>
                <h3 className="mb-4 px-2 text-xs sm:text-sm font-black text-slate-950 dark:text-white tracking-widest uppercase">
                  {L(`近期班次 · ${routeDepartures.length} 班 · 轉乘 ${route.transferCount} 次`, `Upcoming · ${routeDepartures.length} · ${route.transferCount} transfer${route.transferCount === 1 ? '' : 's'}`)}
                </h3>
                <div className="flex flex-col gap-3">
                  {routeDepartures.slice(0, routeVisibleCount).map((rd) => {
                    const key = `${rd.departureTime}-${rd.seq}`;
                    const isExpanded = expandedRouteDep === key;
                    return (
                      <div
                        key={key}
                        className={`rounded-3xl border bg-white dark:bg-slate-900 shadow-sm overflow-hidden transition-all duration-300 ${
                          isExpanded
                            ? 'border-cyan-200 dark:border-cyan-800 bg-gradient-to-br from-white to-cyan-50/40 dark:from-slate-900 dark:to-cyan-950/20 shadow-md'
                            : 'border-slate-100 dark:border-slate-800 hover:border-cyan-300 dark:hover:border-cyan-800 hover:shadow-md'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setExpandedRouteDep(isExpanded ? null : key)}
                          className="w-full text-left px-4 sm:px-6 py-4 cursor-pointer select-none"
                        >
                          {/* Big times + duration strip, mirroring the single-line departure card */}
                          <div className="flex items-center gap-3">
                            <span className="text-2xl sm:text-3xl font-black tracking-tighter tabular-nums text-slate-900 dark:text-white shrink-0">{rd.departureTime}</span>
                            <div className="flex-1 flex flex-col items-center gap-0.5 px-1 min-w-0">
                              <span className="text-[0.625rem] font-bold text-cyan-600 dark:text-cyan-400">{Math.round(rd.totalTimeSec / 60)} {L('分鐘', 'min')}</span>
                              <div className="w-full h-[2px] rounded-full bg-slate-200 dark:bg-slate-700 relative">
                                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500" />
                                <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500" />
                              </div>
                              <span className="text-[0.625rem] font-bold text-amber-600 dark:text-amber-400">{L(`轉乘 ${route.transferCount} 次`, `${route.transferCount} transfer${route.transferCount === 1 ? '' : 's'}`)}</span>
                            </div>
                            <span className="text-2xl sm:text-3xl font-black tracking-tighter tabular-nums text-slate-900 dark:text-white shrink-0">{rd.arrivalTime}</span>
                          </div>

                          {/* Per-leg schedule breakdown */}
                          <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center gap-x-1.5 gap-y-1 flex-wrap text-[0.6875rem] font-semibold text-slate-500 dark:text-slate-400">
                            {rd.legs.map((lg, k) => (
                              <React.Fragment key={k}>
                                {k > 0 && (
                                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300">
                                    <ArrowRightLeft className="w-3 h-3 shrink-0" />
                                    {route.transfers[k - 1]?.stationName ?? ''}
                                    {` · ${L('步行', 'walk')} ${Math.ceil((route.transfers[k - 1]?.transferTimeSec ?? 0) / 60)}${L('分', 'm')}`}
                                    {lg.waitSec > 0 ? ` · ${L('候車', 'wait')} ${Math.ceil(lg.waitSec / 60)}${L('分', 'm')}` : ''}
                                  </span>
                                )}
                                <span className="px-1.5 py-0.5 rounded-md bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 font-black tracking-widest">{lineLabel(route.legs[k]?.lineId ?? '')}</span>
                                <span className="tabular-nums font-bold text-slate-700 dark:text-slate-200">{lg.departureTime}→{lg.arrivalTime}</span>
                                <span className="opacity-80 truncate max-w-[9rem]">{L(`往${lg.destName}`, `to ${lg.destName}`)}</span>
                              </React.Fragment>
                            ))}
                          </div>

                          <div className="mt-2 flex items-center justify-center gap-1 text-[0.625rem] font-bold text-slate-400 dark:text-slate-500">
                            {isExpanded ? L('收合詳情', 'Hide details') : L('查看詳情', 'View details')}
                            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                          </div>
                        </button>

                        {/* Detail card: route diagram + nearby bus / YouBike tabs (mirrors TRA/THSR detail card) */}
                        {isExpanded && (
                          <div className="px-4 sm:px-6 pb-5 animate-in fade-in slide-in-from-top-2 duration-300">
                            <div className="pt-4 border-t border-slate-200 dark:border-slate-700 flex flex-col gap-4">
                              {renderMetroDetailTabBar()}
                              {metroDetailTab === 'stops' ? (
                                renderRouteLegDiagram(route, rd)
                              ) : metroDetailTab === 'youbike' ? (
                                renderMetroYouBikeTab()
                              ) : (
                                renderMetroBusTab()
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {routeDepartures.length > routeVisibleCount && (
                    <button
                      onClick={() => setRouteVisibleCount(v => v + 8)}
                      className="w-full py-3 rounded-2xl border border-cyan-200 dark:border-cyan-800 text-cyan-700 dark:text-cyan-400 font-bold text-sm hover:bg-cyan-50 dark:hover:bg-cyan-900/20 transition-colors"
                    >
                      {L(`查看更多 (+${Math.min(8, routeDepartures.length - routeVisibleCount)})`, `Show more (+${Math.min(8, routeDepartures.length - routeVisibleCount)})`)}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <h3 className="mb-4 px-2 text-xs sm:text-sm font-black text-slate-950 dark:text-white tracking-widest uppercase">
                  {L(`建議路線 · ${routeRideStopCount} 站 · 轉乘 ${route.transferCount} 次`, `Suggested Route · ${routeRideStopCount} stops · ${route.transferCount} transfer${route.transferCount === 1 ? '' : 's'}`)}
                </h3>
                <div className="rounded-3xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/70 backdrop-blur-xl shadow-[0_24px_60px_-34px_rgba(8,145,178,0.4)] p-4 sm:p-6">
                  <div className="mb-4 flex items-start gap-3 rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-3">
                    <AlertCircle className="mt-0.5 w-4 h-4 shrink-0 text-amber-500" />
                    <p className="text-xs sm:text-sm font-semibold leading-relaxed text-amber-700 dark:text-amber-300/90">
                      {L('目前沒有可顯示的班次時刻，先顯示乘車站點順序。', 'No displayable departures right now; showing the ride stop sequence.')}
                    </p>
                  </div>
                  {renderRouteLegDiagram(route)}
                </div>
              </>
            )
          ) : (
            <div className="flex flex-col items-center justify-center p-6 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-2xl text-center gap-3">
              <AlertCircle className="w-8 h-8 text-amber-500" />
              <div>
                <h4 className="font-bold text-amber-700 dark:text-amber-500 mb-1">{L('查無路線', 'No Route Found')}</h4>
                <p className="text-sm text-amber-600/80 dark:text-amber-400/80 max-w-sm">
                  {L('此區間無法在系統內轉乘，請改用「規劃」功能查詢跨運具路線。', 'No in-system transfer route for this segment. Try the "Plan" tab for multimodal routing.')}
                </p>
              </div>
            </div>
          )}

          {/* 推廣版位（docs/affiliate-integration-spec.md §4.2）：查到結果才顯示，
              category='metro' 讓維護端能為捷運版位單獨投放。
              同線行程用 `journey`、跨線用 `route`，兩者都算有結果。 */}
          {(journey || route) && (
            <AffiliateSlot
              category="metro"
              keyword={destStation?.StationName?.[zh ? 'Zh_tw' : 'En'] || null}
              language={language}
            />
          )}
        </section>,
        resultsMount
      )}

      {/* Station Picker Modal */}
      {pickerType && createPortal(
        <div 
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/80 backdrop-blur-md p-4 sm:p-6"
          onClick={() => setPickerType(null)}
        >
          <div 
            onClick={e => e.stopPropagation()}
            className="w-full max-w-4xl max-h-[85dvh] flex flex-col bg-white dark:bg-slate-900 rounded-3xl sm:rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
          >
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-lg text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <TramFront className="w-5 h-5 text-cyan-500" />
                {pickerType === 'origin' ? L('選擇起點', 'Choose Origin') : L('選擇終點', 'Choose Destination')}
              </h3>
              <button 
                onClick={() => setPickerType(null)}
                className="p-2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 space-y-3">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={modalSearch}
                  onChange={(e) => setModalSearch(e.target.value)}
                  placeholder={L('搜尋車站 (可用語音)', 'Search station (Voice supported)')}
                  className="w-full pl-11 pr-12 py-3 bg-slate-100/80 dark:bg-slate-800/80 rounded-2xl text-base outline-none focus:ring-2 focus:ring-cyan-400/50 transition-all shadow-inner"
                />
                <button
                  onClick={startVoiceSearch}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full transition-all ${
                    isListening ? 'bg-rose-100 text-rose-500 animate-pulse' : 'bg-slate-200/50 dark:bg-slate-700/50 text-slate-500 hover:text-cyan-600 dark:hover:text-cyan-400'
                  }`}
                  title={L('語音輸入', 'Voice Search')}
                >
                  <Mic className="w-4 h-4" />
                </button>
              </div>
              <button
                onClick={useCurrentLocation}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 font-semibold transition hover:bg-cyan-100 dark:hover:bg-cyan-500/20"
              >
                <Navigation className="w-4 h-4" /> {L('使用目前位置', 'Use current location')}
              </button>
            </div>

            <div className="flex flex-col sm:flex-row flex-1 min-h-0">
              {/* Left Sidebar - Systems */}
              <div className="w-full sm:w-1/3 md:w-1/4 flex-shrink-0 border-b sm:border-b-0 sm:border-r border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 p-2 sm:p-4 overflow-y-auto soft-scrollbar flex sm:flex-col gap-1 sm:gap-2">
                {METRO_SYSTEMS.map(sys => (
                  <button
                    key={sys.code}
                    onClick={() => {
                      setModalSystem(sys.code);
                      setModalSearch('');
                    }}
                    className={`px-4 py-3 rounded-2xl text-sm font-bold transition-all whitespace-nowrap sm:whitespace-normal text-left ${
                      modalSystem === sys.code
                        ? 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-400 shadow-sm ring-1 ring-cyan-200 dark:ring-cyan-800'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    {zh ? sys.zh : sys.en}
                  </button>
                ))}
              </div>
              
              {/* Right Content — line filter + stations in line order */}
              {(() => {
                const q = modalSearch.trim().toLowerCase();
                const searching = q !== '';
                const matches = (s: MetroStation) =>
                  getStationName(s).toLowerCase().includes(q) ||
                  (s.StationName.Zh_tw || '').includes(modalSearch.trim()) ||
                  (s.StationName.En || '').toLowerCase().includes(q) ||
                  s.StationID.toLowerCase().includes(q);
                // Search spans every line (the filter chips are for browsing);
                // otherwise show the picked line, or all lines grouped.
                const visibleGroups = searching
                  ? modalLineGroups
                      .map(g => ({ ...g, stations: g.stations.filter(matches) }))
                      .filter(g => g.stations.length > 0)
                  : modalLine
                    ? modalLineGroups.filter(g => g.code === modalLine)
                    : modalLineGroups;

                return (
                  <div className="w-full sm:w-2/3 md:w-3/4 flex flex-col min-h-0">
                    {/* Line chips — a single-line system has nothing to choose */}
                    {modalLineGroups.length > 1 && !searching && (
                      <div className="flex sm:flex-wrap gap-1.5 overflow-x-auto sm:overflow-visible soft-scrollbar px-2 sm:px-4 pt-2 sm:pt-4 pb-2 shrink-0">
                        <button
                          onClick={() => setModalLine('')}
                          className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
                            modalLine === ''
                              ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 border-transparent'
                              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-400'
                          }`}
                        >
                          {L('全部', 'All')}
                          <span className="tabular-nums opacity-60">{modalStations.length}</span>
                        </button>
                        {modalLineGroups.map(g => {
                          const color = metroLineColor(modalSystem, g.code);
                          const active = modalLine === g.code;
                          return (
                            <button
                              key={g.code}
                              onClick={() => setModalLine(g.code)}
                              style={active
                                ? { backgroundColor: color, borderColor: color, color: metroLineInkColor(modalSystem, g.code) }
                                : { borderColor: `${color}59` }}
                              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
                                active ? 'shadow-sm' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                              }`}
                            >
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-black/10"
                                style={{ backgroundColor: active ? 'currentColor' : color }}
                              />
                              <span className="whitespace-nowrap">{metroLineLabel(modalSystem, g.code, zh)}</span>
                              <span className="tabular-nums opacity-60">{g.stations.length}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div className="flex-1 overflow-y-auto soft-scrollbar px-2 sm:px-4 pb-4 pt-2">
                      {visibleGroups.length === 0 ? (
                        <p className="py-12 text-center text-sm text-slate-400">
                          {L('查無車站', 'No stations found')}
                        </p>
                      ) : visibleGroups.map(group => {
                        const color = metroLineColor(modalSystem, group.code);
                        const lineName = metroLineLabel(modalSystem, group.code, zh);
                        const head = getStationName(group.stations[0]);
                        const tail = getStationName(group.stations[group.stations.length - 1]);
                        return (
                          <section key={group.code} className="mb-5 last:mb-0">
                            {/* Header doubles as the "you are on this line" cue and,
                                via the termini, tells riders which way the list runs. */}
                            <div className="sticky top-0 z-10 -mx-2 sm:-mx-4 px-2 sm:px-4 py-1.5 bg-white/95 dark:bg-slate-900/95 backdrop-blur flex items-center gap-2">
                              <span className="w-1.5 h-4 rounded-full shrink-0" style={{ backgroundColor: color }} />
                              <span className="text-xs font-black text-slate-700 dark:text-slate-200 whitespace-nowrap">{lineName}</span>
                              {!searching && head && tail && (
                                <span className="text-[10px] text-slate-400 truncate">{head} ⇄ {tail}</span>
                              )}
                              <span className="ml-auto text-[10px] font-bold tabular-nums text-slate-400 shrink-0">{group.stations.length}</span>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mt-2">
                              {group.stations.map(s => {
                                const name = getStationName(s);
                                const isSelected = pickerType === 'origin' ? s.StationID === originId : s.StationID === destId;
                                const isOtherEndpoint = pickerType === 'origin' ? s.StationID === destId : s.StationID === originId;

                                return (
                                  <button
                                    key={s.StationID}
                                    disabled={isOtherEndpoint && modalSystem === system}
                                    onClick={() => {
                                      userPickedOriginRef.current = true;
                                      if (modalSystem !== system) {
                                          setSystem(modalSystem);
                                          if (pickerType === 'origin') setDestId('');
                                          else setOriginId('');
                                      }
                                      if (pickerType === 'origin') setOriginId(s.StationID);
                                      else setDestId(s.StationID);
                                      setPickerType(null);
                                      setHasSearched(false);
                                    }}
                                    style={{ borderLeftColor: color }}
                                    className={`
                                      p-3 rounded-2xl text-sm font-medium transition-all border border-l-4 text-left flex flex-col gap-1
                                      ${isOtherEndpoint && modalSystem === system ? 'opacity-30 cursor-not-allowed bg-slate-50 dark:bg-slate-800/50 border-transparent' :
                                        isSelected
                                          ? 'bg-cyan-50 dark:bg-cyan-900/20 border-cyan-200 dark:border-cyan-800 text-cyan-700 dark:text-cyan-400 shadow-sm'
                                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-cyan-300 hover:bg-cyan-50/30'
                                      }
                                    `}
                                  >
                                    <span className="truncate w-full">{name}</span>
                                    <span className="flex items-center gap-1 w-full text-[10px] text-slate-400">
                                      {searching && <span className="truncate">{lineName}</span>}
                                      <span className="font-mono opacity-60 ml-auto shrink-0">{s.StationID}</span>
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Station transfer info popup — opened by tapping a ⇄ badge on any stop timeline */}
      {transferPopup && createPortal(
        (() => {
          const seen = new Set<string>();
          const details = stationTransferDetails
            .filter(t => t.fromStationId === transferPopup.stationId)
            .filter(t => {
              const k = `${t.toLineId}|${t.description}`;
              if (seen.has(k)) return false;
              seen.add(k);
              return true;
            });
          const coveredLines = new Set(details.map(d => d.toLineId).filter(Boolean));
          const extraSeen = new Set<string>();
          const extras = lineTransferEdges.filter(e => {
            if (e.fromId !== transferPopup.stationId || !e.toLineId || coveredLines.has(e.toLineId)) return false;
            if (extraSeen.has(e.toLineId)) return false;
            extraSeen.add(e.toLineId);
            return true;
          });
          const stationMeta = stations.find(s => s.StationID === transferPopup.stationId);
          // KLRT packs "中文;English" into one address string.
          const pickAddr = (addr?: string) => {
            if (!addr) return '';
            const parts = addr.split(';');
            return ((zh ? parts[0] : (parts[1] ?? parts[0])) || '').trim();
          };
          const biText = (n: BiName) => biName(n, zh);
          const sectionTitle = (icon: React.ReactNode, label: string) => (
            <div className="mt-4 mb-2 flex items-center gap-1.5 text-[0.625rem] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
              {icon}{label}
            </div>
          );
          const amenityRow = (
            key: string,
            item: { name: BiName; floor: string; url: string; note: string },
            Icon: typeof Bike,
            iconCls: string,
            linkLabel: string,
          ) => (
            <div key={key} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <Icon className={`w-3.5 h-3.5 shrink-0 ${iconCls}`} />
              <span className="font-bold">{biText(item.name)}</span>
              {item.floor && <span className="text-slate-400">{item.floor}</span>}
              {item.note && <span className="text-slate-500">{item.note}</span>}
              {item.url && (
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-0.5 font-bold text-cyan-600 dark:text-cyan-400 hover:underline">
                  {linkLabel}<ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          );
          return (
            <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center sm:p-4">
              <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setTransferPopup(null)} />
              <div className="relative w-full sm:max-w-md max-h-[80dvh] overflow-y-auto soft-scrollbar bg-white dark:bg-slate-900 rounded-t-[2rem] sm:rounded-[2.5rem] p-6 sm:p-8 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl border border-slate-100 dark:border-slate-800 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <button
                  onClick={() => setTransferPopup(null)}
                  className="absolute top-5 right-5 p-2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                  aria-label={L('關閉', 'Close')}
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-cyan-100 dark:bg-cyan-500/15 flex items-center justify-center shrink-0">
                    <ArrowRightLeft className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <h4 className="text-lg font-black text-slate-900 dark:text-white tracking-tight truncate">{transferPopup.stationName}</h4>
                    <span className="text-[0.625rem] font-bold uppercase tracking-widest text-slate-400">{L('站內轉乘資訊', 'In-station transfers')}</span>
                  </div>
                </div>
                {/* Station facts — straight from the TDX Station dataset */}
                {stationMeta && (stationMeta.StationAddress || stationMeta.LocationCity || stationMeta.BikeAllowOnHoliday !== undefined) && (
                  <div className="mt-4 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10 p-3.5 flex flex-col gap-1.5">
                    {(stationMeta.LocationCity || stationMeta.LocationTown) && (
                      <span className="text-[0.625rem] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                        {(stationMeta.LocationCity ?? '') + (stationMeta.LocationTown ?? '')}
                      </span>
                    )}
                    {stationMeta.StationAddress && (
                      <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300 flex items-start gap-1.5">
                        <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5 text-cyan-500" />
                        {pickAddr(stationMeta.StationAddress)}
                      </p>
                    )}
                    {stationMeta.BikeAllowOnHoliday !== undefined && (
                      <span className={`self-start px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${
                        stationMeta.BikeAllowOnHoliday
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          : 'bg-slate-200/70 dark:bg-slate-700/70 text-slate-500 dark:text-slate-400'
                      }`}>
                        <Bike className="inline w-3 h-3 mr-1 -mt-0.5" />
                        {stationMeta.BikeAllowOnHoliday
                          ? L('假日可攜自行車進站', 'Bikes allowed on holidays')
                          : L('假日不開放攜自行車進站', 'No bikes on holidays')}
                      </span>
                    )}
                  </div>
                )}

                {/* Rail transfers (LineTransfer + StationTransfer walking directions) */}
                {(details.length > 0 || extras.length > 0) &&
                  sectionTitle(<ArrowRightLeft className="w-3 h-3" />, L('軌道轉乘', 'Rail transfers'))}
                <div className="flex flex-col gap-2.5">
                  {details.map((d, i) => (
                    <div key={`d-${i}`} className="rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10 p-3.5">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md text-xs font-black tracking-widest bg-cyan-100 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 ring-1 ring-inset ring-cyan-500/20">
                          {d.toLineId ? lineLabel(d.toLineId) : L('轉乘', 'Transfer')}
                        </span>
                        {d.transferTimeSec > 0 && (
                          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                            {L(`約 ${Math.ceil(d.transferTimeSec / 60)} 分鐘`, `~${Math.ceil(d.transferTimeSec / 60)} min`)}
                          </span>
                        )}
                      </div>
                      {d.description && (
                        <p className="mt-1.5 text-xs leading-relaxed whitespace-pre-line text-slate-600 dark:text-slate-300">{d.description}</p>
                      )}
                    </div>
                  ))}
                  {extras.map((e, i) => (
                    <div key={`e-${i}`} className="rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10 p-3.5 flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md text-xs font-black tracking-widest bg-cyan-100 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 ring-1 ring-inset ring-cyan-500/20">
                        {lineLabel(e.toLineId)}
                      </span>
                      <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                        {e.transferTimeSec !== METRO_TRANSFER_FALLBACK_SEC
                          ? L(`約 ${Math.ceil(e.transferTimeSec / 60)} 分鐘`, `~${Math.ceil(e.transferTimeSec / 60)} min`)
                          : L('轉乘時間依現場動線為準', 'Walk time varies on site')}
                      </span>
                    </div>
                  ))}
                  {details.length === 0 && extras.length === 0 &&
                    !(popupDetail && (popupDetail.airports.length || popupDetail.buses.length || popupDetail.bikes.length || popupDetail.parkings.length || popupDetail.interiorMaps.length)) && (
                    <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
                      {L('此站暫無詳細轉乘資訊。', 'No detailed transfer info for this station.')}
                    </p>
                  )}
                </div>

                {/* Airport hand-offs (StationTransfer) */}
                {popupDetail && popupDetail.airports.length > 0 && (
                  <>
                    {sectionTitle(<Plane className="w-3 h-3" />, L('機場轉乘', 'Airport transfer'))}
                    <div className="flex flex-col gap-2.5">
                      {popupDetail.airports.map((a, i) => (
                        <div key={`a-${i}`} className="rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10 p-3.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-slate-700 dark:text-slate-200">{biText(a.name)}</span>
                            {a.floor && <span className="text-[10px] font-bold text-slate-400">{a.floor}</span>}
                          </div>
                          {a.note && <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{a.note}</p>}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Bus routes at this station (StationTransfer — static route list, no ETAs) */}
                {popupDetail && popupDetail.buses.length > 0 && (
                  <>
                    {sectionTitle(<Bus className="w-3 h-3" />, L('公車轉乘路線', 'Bus connections'))}
                    <div className="flex flex-wrap gap-1.5">
                      {popupDetail.buses.slice(0, 16).map((b, i) => (
                        <span key={`b-${i}`} title={biText(b.operator) || undefined} className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                          {biText(b.routeName)}
                          {b.destination && <span className="ml-1 font-medium opacity-70">{b.destination}</span>}
                        </span>
                      ))}
                      {popupDetail.buses.length > 16 && (
                        <span className="px-2 py-1 text-[11px] font-bold text-slate-400">
                          +{popupDetail.buses.length - 16}
                        </span>
                      )}
                    </div>
                  </>
                )}

                {/* YouBike / parking hand-offs (StationTransfer) */}
                {popupDetail && (popupDetail.bikes.length > 0 || popupDetail.parkings.length > 0) && (
                  <>
                    {sectionTitle(<Car className="w-3 h-3" />, L('自行車與停車', 'Bike & parking'))}
                    <div className="flex flex-col gap-2">
                      {popupDetail.bikes.map((b, i) => amenityRow(`bk-${i}`, b, Bike, 'text-amber-500', L('官網', 'Site')))}
                      {popupDetail.parkings.map((p, i) => amenityRow(`pk-${i}`, p, Car, 'text-sky-500', L('資訊', 'Info')))}
                    </div>
                  </>
                )}

                {/* Interior station maps (official metro.taipei images) */}
                {popupDetail && popupDetail.interiorMaps.length > 0 && (
                  <>
                    {sectionTitle(<MapIcon className="w-3 h-3" />, L('車站平面圖', 'Station maps'))}
                    <div className="flex flex-col gap-1.5">
                      {popupDetail.interiorMaps.map((m, i) => (
                        <a
                          key={`m-${i}`}
                          href={m.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-bold text-cyan-600 dark:text-cyan-400 hover:underline"
                        >
                          <ExternalLink className="w-3 h-3 shrink-0" />
                          {biText(m.name) || L('車站平面圖', 'Station map')}
                        </a>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })(),
        document.body
      )}
    </div>
  );
}
