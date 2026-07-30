/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Heart, Bell, Globe, ArrowRight, ArrowRightLeft, ArrowUp, ArrowDown, Calendar, User, Search, CheckCircle, AlertCircle, XCircle, X, ChevronDown, AlertTriangle, Train, Sun, CloudRain, Pencil, MapPin, Zap, Compass, MessageCircle, Send, TrendingUp, Sparkles, ExternalLink, Leaf, Settings, Clock, Bike, TramFront, CalendarPlus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { io, Socket } from 'socket.io-client';
import { getTRATimetableOD, getTHSRTimetableOD, DailyTimetableOD, getTRAStations, getTHSRStations, Station, getTRAODFare, getTHSRODFare, getTRATrainTimetable, getTHSRTrainTimetable, getTRALiveBoard, StopTime, getTRAAlerts, getTHSRAlerts, getTHSRLiveBoard, RailLiveBoard, preloadStaticData, getNearbyBusStops, BusStation, getNearestYouBike, YouBikeStation, getTRABookingDeepLink, getHSRBookingDeepLink } from './lib/api';
import { getTransfers } from './lib/transfers';
import { Helmet } from 'react-helmet-async';
import AdSlot from './components/AdSlot';
import NetworkStatus from './components/NetworkStatus';
import OfflineModeBanner from './components/OfflineModeBanner';
import ReliabilityBadge from './components/ReliabilityBadge';
import PlatformMode from './components/PlatformMode';
import RecentSearches from './components/RecentSearches';
import AffiliateMarquee from './components/AffiliateMarquee';
import AffiliateSlot from './components/AffiliateSlot';
import TransferMapModal from './components/TransferMapModal';
import JourneyProgressBar from './components/JourneyProgressBar';
import StationFootfallBadge from './components/StationFootfallBadge';
import AnimatedThemeToggler from './components/ui/animated-theme-toggler';
import { isMobileDevice } from './lib/device';
import {
  saveSnapshot,
  loadSnapshot,
  nextDepartureFromSnapshot,
  type SnapshotMeta,
  type Snapshot,
} from './lib/offlineSnapshot';
import { getReliability, recordDelayBatch } from './lib/delayReliability';
import {
  listRecentSearches,
  addRecentSearch,
  removeRecentSearch,
  clearRecentSearches,
  type RecentSearchEntry,
} from './lib/recentSearches';
import { logQuery } from './lib/queryLogger';
import { useQueryThrottle } from './hooks/useQueryThrottle';
import { planRailSearchStart, type RailSearchIntent } from './lib/searchIntentCommit';
import { shouldStartAlertPolling } from './lib/alertPollingPolicy';
import { requestGeolocation, findNearestStation, getGeoPref, setGeoPref, isGeoSupported, GeoCoords } from './lib/geo';
import { serviceDateForStationTime } from './lib/stationFootfall';

// Only initialize socket.io on same-origin hosts that actually run the Node server.
// Serverless hosts (Vercel, Netlify, GH Pages) don't support persistent sockets and
// would otherwise hit `/socket.io/?...` -> 404 repeatedly.
const isServerlessHost = typeof window !== 'undefined' &&
  /\.vercel\.app$|\.netlify\.app$|\.github\.io$|\.pages\.dev$/i.test(window.location.hostname);
const socket: Socket | null = isServerlessHost
  ? null
  : io({ autoConnect: true, reconnection: true, reconnectionAttempts: 3, timeout: 5000 });
if (socket) {
  socket.on('connect_error', () => {
    // Silently disable socket if the server isn't reachable in this environment.
    socket.disconnect();
  });
}

const PUBLIC_SITE_URL = (import.meta.env.VITE_APP_URL || 'https://taiwanrail.vercel.app').replace(/\/+$/, '');
const JourneyPlanner = React.lazy(() => import('./components/JourneyPlanner'));
const MetroSearch = React.lazy(() => import('./components/MetroSearch'));
const ExternalLinkModal = React.lazy(() => import('./components/ExternalLinkModal'));
const StationPickerModal = React.lazy(() => import('./components/StationPickerModal'));

const INDEXABLE_ROUTE_PATHS: Record<string, string> = {
  'train:1000:4400': '/routes/train/taipei-to-kaohsiung/',
  'train:1000:7000': '/routes/train/taipei-to-hualien/',
  'train:1000:3300': '/routes/train/taipei-to-taichung/',
  'train:1000:1210': '/routes/train/taipei-to-hsinchu/',
  'train:1000:7190': '/routes/train/taipei-to-yilan/',
  'train:1000:4220': '/routes/train/taipei-to-tainan/',
  'train:7000:6000': '/routes/train/hualien-to-taitung/',
  'train:3300:4400': '/routes/train/taichung-to-kaohsiung/',
  'train:1020:4400': '/routes/train/banqiao-to-kaohsiung/',
  'hsr:0990:1070': '/routes/hsr/nangang-to-zuoying/',
  'hsr:1000:1070': '/routes/hsr/taipei-to-zuoying/',
  'hsr:1000:1040': '/routes/hsr/taipei-to-taichung/',
  'hsr:1000:1060': '/routes/hsr/taipei-to-tainan/',
  'hsr:1000:1030': '/routes/hsr/taipei-to-hsinchu/',
  'hsr:1040:1070': '/routes/hsr/taichung-to-zuoying/',
  'hsr:1010:1040': '/routes/hsr/banqiao-to-taichung/',
  'hsr:1020:1040': '/routes/hsr/taoyuan-to-taichung/',
};

function getIndexableRoutePath(transport: 'hsr' | 'train', fromId: string, toId: string) {
  return INDEXABLE_ROUTE_PATHS[`${transport}:${fromId}:${toId}`] ?? null;
}

function normalizeSeoPath(pathname: string) {
  if (!pathname || pathname === '/') return '/';
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

function getAlternateLocalePaths(pathname: string) {
  const normalizedPath = normalizeSeoPath(pathname);
  const zhPath = normalizedPath.replace(/^\/en(?=\/)/, '') || '/';
  const enPath = zhPath === '/' ? '/en/' : `/en${zhPath}`;

  return { normalizedPath, zhPath, enPath };
}

export default function App() {
  const { t, i18n } = useTranslation();
  const [transportType, setTransportType] = useState<'hsr' | 'train'>(() => {
    if (typeof window === 'undefined') return 'train';
    const path = window.location.pathname;
    const routeMatch = path.match(/\/(routes|timetable)\/(train|hsr)\//i);
    if (routeMatch) {
      return routeMatch[2].toLowerCase() as 'hsr' | 'train';
    }
    const queryTransport = new URLSearchParams(window.location.search).get('transport');
    if (queryTransport === 'hsr') return 'hsr';
    
    // Check preferred transport in localStorage
    try {
      const pref = localStorage.getItem('preferred-transport');
      if (pref === 'hsr') return 'hsr';
    } catch(e) {}
    return 'train';
  });
  const [tripType, setTripType] = useState<'one-way' | 'round-trip'>('one-way');
  const [selectedDate, setSelectedDate] = useState('today');
  const [activeFilter, setActiveFilter] = useState('time');
  const [timeSortDirection, setTimeSortDirection] = useState<'asc' | 'desc'>('asc');
  const [expandedTrainId, setExpandedTrainId] = useState<string | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useState<Record<string, 'stops' | 'station' | 'youbike'>>({});
  const [activeBusStationId, setActiveBusStationId] = useState<Record<string, string>>({});
  const [selectedBusStationId, setSelectedBusStationId] = useState<Record<string, string>>({});
  const [isBusStationDropdownOpen, setIsBusStationDropdownOpen] = useState<Record<string, boolean>>({});
  const [nearbyBuses, setNearbyBuses] = useState<Record<string, { loading: boolean, stations: BusStation[], error?: string }>>({});
  const [busCountdown, setBusCountdown] = useState<Record<string, number>>({});
  const [busEtaSeed, setBusEtaSeed] = useState<Record<string, number>>({});
  // 最近 YouBike 站點即時資訊（每 3 秒輪詢），以台鐵/高鐵站 ID 為 key
  const [youbike, setYoubike] = useState<Record<string, { loading: boolean; data: YouBikeStation | null }>>({});

  const fetchYouBike = async (stationId: string, lat: number, lon: number) => {
    if (!stationId) return;
    setYoubike(prev => (prev[stationId]?.data ? prev : { ...prev, [stationId]: { loading: true, data: null } }));
    const data = await getNearestYouBike(lat, lon);
    setYoubike(prev => ({ ...prev, [stationId]: { loading: false, data } }));
  };

  // 單一車站的最近 YouBike 卡片（起點 / 終點各一張）
  const renderYouBikeCard = (stationId: string, roleLabel: string) => {
    const st = stations.find(s => s.StationID === stationId);
    const stName = i18n.language === 'zh-TW' ? (st?.StationName?.Zh_tw || '') : (st?.StationName?.En || '');
    const yb = youbike[stationId];
    return (
      <div key={stationId} className="bg-slate-800/40 border border-slate-700/50 rounded-3xl p-4 shadow-lg">
        <div className="flex justify-between items-start mb-3 gap-2">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{roleLabel}</span>
            <h3 className="font-bold text-slate-200 text-base flex items-center gap-1.5 truncate">
              <Bike className="size-4 text-amber-400 shrink-0" />{stName}
            </h3>
          </div>
          <span className="text-[10px] text-slate-500 font-medium flex items-center gap-1.5 shrink-0 mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {i18n.language === 'zh-TW' ? '即時 · 每 3 秒' : 'Live · 3s'}
          </span>
        </div>
        {(!yb || (yb.loading && !yb.data)) ? (
          <div className="py-4 flex items-center justify-center gap-2 text-slate-500 text-sm">
            <div className="w-4 h-4 border-2 border-amber-500/30 border-t-amber-400 rounded-full animate-spin" />
            {i18n.language === 'zh-TW' ? '搜尋最近站點…' : 'Finding nearest…'}
          </div>
        ) : !yb.data ? (
          <div className="py-3 text-center text-slate-500 text-xs">
            {i18n.language === 'zh-TW' ? '周邊無 YouBike 站點（僅支援臺北市）' : 'No nearby YouBike (Taipei City only)'}
          </div>
        ) : (
          <div>
            <div className="flex justify-between items-baseline gap-2">
              <span className="font-bold text-slate-300 text-sm truncate">{i18n.language === 'zh-TW' ? yb.data.name : (yb.data.nameEn || yb.data.name)}</span>
              <span className="text-xs text-slate-500 shrink-0">{yb.data.distance}m</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 text-center">
                <div className="text-2xl font-black text-emerald-400 leading-none">{yb.data.bikes}</div>
                <div className="text-[10px] text-emerald-300/70 font-bold uppercase tracking-wider mt-1.5">{i18n.language === 'zh-TW' ? '可借車輛' : 'Bikes'}</div>
              </div>
              <div className="rounded-xl bg-sky-500/10 border border-sky-500/20 p-3 text-center">
                <div className="text-2xl font-black text-sky-400 leading-none">{yb.data.docks}</div>
                <div className="text-[10px] text-sky-300/70 font-bold uppercase tracking-wider mt-1.5">{i18n.language === 'zh-TW' ? '可還空位' : 'Docks'}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const fetchNearbyBuses = async (stationId: string, stationName: string, force: boolean = false) => {
    if (!stationId) return;
    if (!force && (nearbyBuses[stationId]?.stations.length > 0 || nearbyBuses[stationId]?.loading)) return;

    setNearbyBuses(prev => ({
      ...prev,
      [stationId]: { loading: true, stations: [] }
    }));

    try {
      const station = stations.find(s => s.StationID === stationId);
      const lat = station?.StationPosition?.PositionLat || 25.04775;
      const lon = station?.StationPosition?.PositionLon || 121.51711;

      const data = await getNearbyBusStops(lat, lon, stationName);
      setNearbyBuses(prev => ({
        ...prev,
        [stationId]: { loading: false, stations: data }
      }));
    } catch (err: any) {
      console.error("Error fetching nearby buses", err);
      setNearbyBuses(prev => ({
        ...prev,
        [stationId]: { loading: false, stations: [], error: err.message || "Failed to fetch" }
      }));
    }
  };

  const [showPassedStops, setShowPassedStops] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [timetables, setTimetables] = useState<DailyTimetableOD[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const [stations, setStations] = useState<Station[]>([]);
  // Check if we are in the development/test environment (測試環境)
  const isDevEnv = typeof window !== 'undefined' && (
    window.location.hostname.includes('localhost') || 
    window.location.hostname.includes('127.0.0.1') || 
    window.location.hostname.includes('-dev-') ||
    import.meta.env.DEV
  );

  // Top-level view: 台鐵 / 高鐵 timetable search, or 規劃 (trip planner). Rail
  // search logic still keys off `transportType`; this just adds the 3rd tab.
  const [mainTab, setMainTab] = useState<'train' | 'hsr' | 'metro' | 'plan'>(() => {
    if (typeof window === 'undefined') return transportType;
    try {
      // If no route/query forces a rail mode, respect 'metro' preference
      const path = window.location.pathname;
      const routeMatch = path.match(/\/(routes|timetable)\/(train|hsr)\//i);
      const queryTransport = new URLSearchParams(window.location.search).get('transport');
      // Deep links from the SEO hub landing pages (/metro/, /journey/) open the
      // matching top-level view directly.
      if (queryTransport === 'metro') return 'metro';
      if (queryTransport === 'plan') return 'plan';
      if (!routeMatch && !queryTransport) {
        const pref = localStorage.getItem('preferred-transport');
        if (pref === 'metro') return 'metro';
      }
    } catch(e) {}
    return transportType;
  });

  // Keep preferred transport in state to reflect in UI
  const [preferredTransport, setPreferredTransport] = useState<'train' | 'hsr' | 'metro'>(() => {
    if (typeof window === 'undefined') return 'train';
    try {
      return (localStorage.getItem('preferred-transport') as 'train' | 'hsr' | 'metro') || 'train';
    } catch(e) {}
    return 'train';
  });

  const handleSetPreferredTransport = (mode: 'train' | 'hsr' | 'metro') => {
    setPreferredTransport(mode);
    try {
      localStorage.setItem('preferred-transport', mode);
    } catch(e) {}
    if (mode === 'metro') {
      setMainTab('metro');
    } else {
      setTransportType(mode);
      setMainTab(mode);
    }
  };
  // True for the two rail timetable tabs; metro & plan are self-contained views.
  const isRailTab = mainTab === 'train' || mainTab === 'hsr';
  const [metroResultsActive, setMetroResultsActive] = useState(false);
  const isMetroResultsActive = mainTab === 'metro' && metroResultsActive;
  // IDs start empty; fetchStations() fills them from real API data
  const [originStationId, setOriginStationId] = useState<string>('');
  const [destStationId, setDestStationId] = useState<string>('');
  const [swapRotation, setSwapRotation] = useState(0);
  const [returnDate, setReturnDate] = useState<string>('tomorrow');
  const [activeTab, setActiveTab] = useState<'outbound' | 'return'>('outbound');
  
  const [favorites, setFavorites] = useState<string[]>([]);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showWatchlistOnly, setShowWatchlistOnly] = useState(false);
  const [isOriginDropdownOpen, setIsOriginDropdownOpen] = useState(false);
  const [isDestDropdownOpen, setIsDestDropdownOpen] = useState(false);
  const [stationsLoading, setStationsLoading] = useState(false);
  const [stationsError, setStationsError] = useState<string | null>(null);

  // 地理位置定位（精準）：自動帶入最近起始站，查詢時一併記錄至 query log
  const [geoCoords, setGeoCoords] = useState<GeoCoords | null>(null);
  const [geoStatus, setGeoStatus] = useState<'idle' | 'requesting' | 'granted' | 'denied' | 'unsupported'>('idle');
  // 使用者一旦手動選/換起始站，定位就不再覆蓋（轉乘切換時重置）
  const userPickedOriginRef = useRef(false);
  const geoInitRef = useRef(false);

  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferStationName, setTransferStationName] = useState('');
  const [transferStationId, setTransferStationId] = useState('');
  const [transferTransportType, setTransferTransportType] = useState<'hsr' | 'train'>('hsr');
  const [transferTrainDirection, setTransferTrainDirection] = useState<number | undefined>(undefined);

  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const feedbackPopoverRef = useRef<HTMLDivElement | null>(null);
  const feedbackButtonRef = useRef<HTMLButtonElement | null>(null);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const { throttled: queryThrottled, tryConsume: tryConsumeQuery, message: queryThrottleMessage } = useQueryThrottle();
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission;
  });

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const submitFeedback = async () => {
    const trimmed = feedbackMessage.trim();
    if (!trimmed || feedbackSubmitting) return;
    setFeedbackSubmitting(true);
    try {
      let sessionId = 'unknown';
      try {
        sessionId = sessionStorage.getItem('_rl_sid') || crypto.randomUUID();
        sessionStorage.setItem('_rl_sid', sessionId);
      } catch { /* ignore */ }
      const w = window.innerWidth;
      const deviceType = w < 768 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop';
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          message: trimmed,
          language: navigator.language,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          deviceType,
          userAgent: navigator.userAgent.slice(0, 300),
          pagePath: window.location.pathname,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFeedbackMessage('');
      setIsFeedbackOpen(false);
      showToast(i18n.language === 'zh-TW' ? '感謝您的意見回饋！' : 'Thanks for your feedback!');
    } catch {
      showToast(i18n.language === 'zh-TW' ? '送出失敗，請稍後再試' : 'Submit failed, please try again later');
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  useEffect(() => {
    if (!isFeedbackOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        feedbackPopoverRef.current && !feedbackPopoverRef.current.contains(target) &&
        feedbackButtonRef.current && !feedbackButtonRef.current.contains(target)
      ) {
        setIsFeedbackOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFeedbackOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [isFeedbackOpen]);

  const fetchNearbyBusesRef = useRef(fetchNearbyBuses);
  const stationsRef = useRef(stations);
  const activeBusStationIdRef = useRef(activeBusStationId);
  const originStationIdRef = useRef(originStationId);
  const destStationIdRef = useRef(destStationId);
  const fetchYouBikeRef = useRef(fetchYouBike);

  useEffect(() => {
    fetchNearbyBusesRef.current = fetchNearbyBuses;
    stationsRef.current = stations;
    activeBusStationIdRef.current = activeBusStationId;
    originStationIdRef.current = originStationId;
    destStationIdRef.current = destStationId;
    fetchYouBikeRef.current = fetchYouBike;
  });

  // YouBike 分頁開啟時，每 3 秒輪詢起點站與終點站各自最近的 YouBike 站點
  useEffect(() => {
    if (!expandedTrainId) return;
    if (activeDetailTab[expandedTrainId] !== 'youbike') return;

    const tick = () => {
      [originStationIdRef.current, destStationIdRef.current].forEach(sid => {
        const st = stationsRef.current.find(s => s.StationID === sid);
        const lat = st?.StationPosition?.PositionLat;
        const lon = st?.StationPosition?.PositionLon;
        if (sid && typeof lat === 'number' && typeof lon === 'number') {
          fetchYouBikeRef.current(sid, lat, lon);
        }
      });
    };
    tick(); // 立即抓一次
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, [expandedTrainId, activeDetailTab]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (expandedTrainId) {
        const isStationTab = (activeDetailTab[expandedTrainId] || 'stops') === 'station';
        if (isStationTab) {
          setBusCountdown(prev => {
            const currentVal = prev[expandedTrainId] !== undefined ? prev[expandedTrainId] : 10;
            if (currentVal <= 1) {
              const currentStationId = activeBusStationIdRef.current[expandedTrainId] || originStationIdRef.current;
              const currentStationName = stationsRef.current.find(s => s.StationID === currentStationId)?.StationName?.Zh_tw || '';
              if (currentStationId && currentStationName) {
                fetchNearbyBusesRef.current(currentStationId, currentStationName, true);
              }
              setBusEtaSeed(seedPrev => ({
                ...seedPrev,
                [expandedTrainId]: (seedPrev[expandedTrainId] || 0) + 1
              }));
              return { ...prev, [expandedTrainId]: 10 };
            } else {
              return { ...prev, [expandedTrainId]: currentVal - 1 };
            }
          });
        }
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [expandedTrainId, activeDetailTab]);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isSettingsOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        settingsRef.current && !settingsRef.current.contains(target) &&
        settingsButtonRef.current && !settingsButtonRef.current.contains(target)
      ) {
        setIsSettingsOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsSettingsOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [isSettingsOpen]);

  useEffect(() => {
    // 20. Environmental Sync & Haptics
    if (expandedTrainId && window.navigator.vibrate) {
       window.navigator.vibrate(25);
       
       // Play a subtle sound if possible or other feedback
    }
  }, [expandedTrainId]);

  useEffect(() => {
    const handleFallback = () => {
      showToast(i18n.language === 'zh-TW' 
        ? '由於伺服器連線繁忙，目前顯示各車次預排資訊。資訊可能會有數分鐘誤差。' 
        : 'Server busy. Showing scheduled/cached info. Minimal delays might vary.');
    };
    window.addEventListener('tdx-api-fallback', handleFallback);
    return () => window.removeEventListener('tdx-api-fallback', handleFallback);
  }, [i18n.language]);

  const [fares, setFares] = useState<Record<string, number>>({});
  const [liveBoard, setLiveBoard] = useState<Record<string, number>>({});
  const [liveBoardDetails, setLiveBoardDetails] = useState<Record<string, any>>({});
  const [lastLiveUpdate, setLastLiveUpdate] = useState<Date | null>(null);
  const [trainStops, setTrainStops] = useState<Record<string, { stops: StopTime[], isMock?: boolean }>>({});
  const [stopsLoading, setStopsLoading] = useState<Record<string, boolean>>({});
  const [returnTimetables, setReturnTimetables] = useState<DailyTimetableOD[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // New states for disruption alerts and approaching station
  const [globalAlert, setGlobalAlert] = useState<{message: string, type: 'warning' | 'error' | 'info', url?: string, description?: string} | null>(null);
  const [isAlertCollapsed, setIsAlertCollapsed] = useState(true);
  const [isApproachingCollapsed, setIsApproachingCollapsed] = useState(true);
  const [cancelledTrains, setCancelledTrains] = useState<Set<string>>(new Set());
  const [dismissedTrains, setDismissedTrains] = useState<Set<string>>(new Set());

  // Collapsible search panel – defaults to expanded. Collapses after a successful search.
  const [isSearchCollapsed, setIsSearchCollapsed] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    if (mainTab !== 'metro') setMetroResultsActive(false);
  }, [mainTab]);

  // Offline / cached-snapshot mode state
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [activeSnapshot, setActiveSnapshot] = useState<Snapshot | null>(null);
  const [offlineBannerDismissed, setOfflineBannerDismissed] = useState(false);
  const [offlineTick, setOfflineTick] = useState(0);
  const lastSearchMetaRef = useRef<SnapshotMeta | null>(null);

  // Progressive offline UX: 'weak' -> 'switching' -> 'active' instead of slamming the banner in.
  const [offlineTransition, setOfflineTransition] = useState<'weak' | 'switching' | 'active' | null>(null);
  const offlineTimersRef = useRef<number[]>([]);

  // Fullscreen platform-mode view (opened by long-press on a card).
  const [platformModeTrainId, setPlatformModeTrainId] = useState<string | null>(null);

  // Recent-searches history displayed below the search panel.
  const [recentSearches, setRecentSearches] = useState<RecentSearchEntry[]>(() => listRecentSearches());
  const pendingRecentSearchRef = useRef<RecentSearchEntry | null>(null);
  /** Deep-link / SEO auto-search one-shot; only set after successful consume. */
  const hasAutoFiredRef = useRef(false);
  const [textSize, setTextSize] = useState<'small' | 'medium' | 'large'>(() => {
    return (localStorage.getItem('rail_textsize') as 'small' | 'medium' | 'large') || 'medium';
  });
  const [scrollY, setScrollY] = useState(0);
  const lastNotifiedRef = useRef<string | null>(null);

  // ExternalLinkModal State
  const [bookingModalState, setBookingModalState] = useState<{
    isOpen: boolean;
    trainNo: string;
    origin: string;
    destination: string;
    date: string;
    depTime: string;
    url: string;
    popupBlocked: boolean;
    usedFallback: boolean;
  }>({
    isOpen: false,
    trainNo: '',
    origin: '',
    destination: '',
    date: '',
    depTime: '12:00',
    url: '',
    popupBlocked: false,
    usedFallback: false,
  });

  // Parallax Scroll Tracking (Optimized with requestAnimationFrame)
  // Skipped entirely when the user prefers reduced motion (#4 a11y).
  useEffect(() => {
    const prefersReducedMotion = typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      setScrollY(0);
      return;
    }
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          setScrollY(window.scrollY);
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Apply root text size scaling and persist to localStorage
  useEffect(() => {
    localStorage.setItem('rail_textsize', textSize);
    const htmlObj = document.documentElement;
    if (textSize === 'small') {
      htmlObj.style.fontSize = '14px';
    } else if (textSize === 'large') {
      htmlObj.style.fontSize = '18px';
    } else {
      htmlObj.style.fontSize = '16px'; // default
    }
  }, [textSize]);

  // --- Notification Support ---
  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) {
      setNotificationPermission('unsupported');
      showToast(i18n.language === 'zh-TW' ? '此瀏覽器不支援系統通知' : 'This browser does not support notifications');
      return;
    }

    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      showToast(
        permission === 'granted'
          ? (i18n.language === 'zh-TW' ? '已開啟列車提醒通知' : 'Train alert notifications are enabled')
          : (i18n.language === 'zh-TW' ? '未開啟通知；可隨時在瀏覽器設定中變更' : 'Notifications were not enabled; you can change this in browser settings'),
      );
    }
  };

  const notifyUser = (title: string, body: string) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/pwa-192x192.png' });
    }
  };

  //新增這個將時間轉為絕對分鐘數的輔助函式 (處理跨夜排序)
const parseTimeForSort = (timeStr: string | undefined) => {
  if (!timeStr) return 9999;
  const [h, m] = timeStr.split(':').map(Number);
  // 將凌晨 0 點到 3 點的車次視為 24~27 點，確保它們排在當天清晨 6 點的車次之後
  const adjustedH = h < 4 ? h + 24 : h;
  return adjustedH * 60 + m;
};

  const getTwMinutes = () => {
    const now = new Date();
    const twTimeStr = new Intl.DateTimeFormat('zh-TW', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Taipei'
    }).format(now);
    const [h, m] = twTimeStr.split(':').map(Number);
    const adjustedH = h < 4 ? h + 24 : h;
    return adjustedH * 60 + m;
  };

  const timeToMinutes = (t: string | undefined) => {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    // 凌晨 0~3 點視為前一天的 24~27 點，避免跨午夜的車次（常見於台鐵）
    // 被誤判為「已過站」而整段都套上灰色遮罩
    const adjustedH = h < 4 ? h + 24 : h;
    return adjustedH * 60 + m;
  };

  // Removed approachingInfo from here

  useEffect(() => {
    if (!shouldStartAlertPolling(hasSearched)) return;

    const fetchAlerts = async () => {
      try {
        const [traAlerts, thsrAlerts] = await Promise.all([getTRAAlerts(), getTHSRAlerts()]);
        const rawAlerts = [...(Array.isArray(traAlerts) ? traAlerts : []), ...(Array.isArray(thsrAlerts) ? thsrAlerts : [])];

        const allAlerts = rawAlerts;

        if (allAlerts.length > 0) {
          const latest = allAlerts[0] as any;
          setGlobalAlert({
            message: latest.Title || latest.Description,
            type: latest.Level > 2 ? 'error' : 'warning',
            url: latest.Url || undefined,
            description: latest.Description || undefined,
          });

          const cancelledSet = new Set<string>();
          allAlerts.forEach(a => {
            const desc = a.Description || '';
            if (desc.includes('停駛') || desc.includes('取消') || desc.includes('Cancelled')) {
              const matches = desc.match(/\d{3,4}/g);
              if (matches) matches.forEach(m => cancelledSet.add(m));
            }
          });
          setCancelledTrains(cancelledSet);
        } else {
          setGlobalAlert({
            message: i18n.language === 'zh-TW' ? '雙鐵全線營運正常' : 'All TRA & THSR lines operating normally',
            type: 'info',
            description: i18n.language === 'zh-TW' ? '目前台鐵與高鐵全線營運正常，祝您旅途愉快！' : 'All TRA and THSR services are operating normally. Have a safe journey!'
          });
        }
      } catch (err) {
        console.warn('Could not fetch real alerts, falling back to default operational state');
        setGlobalAlert({
          message: i18n.language === 'zh-TW' ? '雙鐵全線營運正常' : 'All TRA & THSR lines operating normally',
          type: 'info',
          description: i18n.language === 'zh-TW' ? '目前台鐵與高鐵全線營運正常，祝您旅途愉快！' : 'All TRA and THSR services are operating normally. Have a safe journey!'
        });
      }
    };

    fetchAlerts();
    
    // Refresh alerts every 5 minutes
    const interval = setInterval(fetchAlerts, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [hasSearched]);

  const scrollToTrain = (trainId: string) => {
    // 1. Find the target train in the FULL filtered list
    const filtered = filteredTimetables;
    const index = filtered.findIndex(t => t.DailyTrainInfo.TrainNo === trainId);
    
    if (index !== -1) {
      // 2. Calculate which page it's on
      const targetPage = Math.floor(index / pageSize) + 1;
      
      // 3. Set the page if it's different
      if (currentPage !== targetPage) {
        setCurrentPage(targetPage);
      }
      
      // 4. Expand and scroll after a short delay (allowing DOM to update if page changed)
      setExpandedTrainId(trainId);
      setShowPassedStops(false);
      setTimeout(() => {
        const element = document.getElementById(`train-card-${trainId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Optional: Pulse effect to highlight
          element.classList.add('ring-4', 'ring-blue-400', 'ring-offset-4');
          setTimeout(() => element.classList.remove('ring-4', 'ring-blue-400', 'ring-offset-4'), 2000);
        }
      }, 300);
    } else {
      // If not in current filtered list, show toast or just try to scroll anyway
      showToast(t('app.toasts.trainNotFoundInList'));
    }
  };

  useEffect(() => {
    if (!socket) return;
    socket.on('connect', () => {
      console.log('Connected to WebSocket server');
    });

    socket.on('delay-update', (payload: { stationId: string, data: any[] }) => {
      const delayMap: Record<string, number> = {};
      payload.data.forEach(b => {
        delayMap[b.TrainNo] = b.DelayTime;
      });
      setLiveBoard(prev => ({ ...prev, ...delayMap }));
      setLastLiveUpdate(new Date());
      // Persist delay observations into rolling history for reliability scoring.
      recordDelayBatch(delayMap);
    });

    return () => {
      socket.off('connect');
      socket.off('delay-update');
    };
  }, []);

useEffect(() => {
  if (!socket || !socket.connected || !originStationId || !destStationId) return;
  
  socket.emit('subscribe-station', { stationId: originStationId, type: transportType });
  socket.emit('subscribe-station', { stationId: destStationId, type: transportType });

  return () => {
    // 切換車站前，先取消訂閱舊的車站
    socket.emit('unsubscribe-station', { stationId: originStationId, type: transportType });
    socket.emit('unsubscribe-station', { stationId: destStationId, type: transportType });
  };
}, [transportType, originStationId, destStationId]);

  useEffect(() => {
    preloadStaticData();
    const savedFavs = localStorage.getItem('rail_favs');
    if (savedFavs) setFavorites(JSON.parse(savedFavs));

    const savedWatch = localStorage.getItem('rail_watchlist');
    if (savedWatch) setWatchlist(JSON.parse(savedWatch));
  }, []);

  // Tunnel/offline mode: stage a gradual "weak → switching → active" transition so entering a
  // tunnel feels like a gentle fade rather than a sudden banner pop.
  useEffect(() => {
    const clearStagedTimers = () => {
      offlineTimersRef.current.forEach(id => window.clearTimeout(id));
      offlineTimersRef.current = [];
    };

    const handleOnline = () => {
      setIsOnline(true);
      clearStagedTimers();
      setOfflineTransition(null);
      setActiveSnapshot(null);
    };
    const handleOffline = () => {
      setIsOnline(false);
      const meta = lastSearchMetaRef.current;
      const snap = meta ? loadSnapshot(meta) : null;
      clearStagedTimers();
      setOfflineBannerDismissed(false);

      if (!snap) {
        // Nothing cached — skip straight to telling the user we're offline (handled by <NetworkStatus />).
        setOfflineTransition(null);
        return;
      }

      // Stage 1: signal detected weak.
      setOfflineTransition('weak');
      offlineTimersRef.current.push(window.setTimeout(() => {
        // Stage 2: switching over to cached snapshot.
        setOfflineTransition('switching');
      }, 1200));
      offlineTimersRef.current.push(window.setTimeout(() => {
        // Stage 3: offline-mode active, snapshot shown.
        setActiveSnapshot(snap);
        setTimetables(prev => (prev.length ? prev : snap.timetables));
        setReturnTimetables(prev => (prev.length ? prev : snap.returnTimetables));
        setOfflineTransition('active');
      }, 2400));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearStagedTimers();
    };
  }, []);

  // Tick once a minute so the offline countdown keeps moving without the network.
  useEffect(() => {
    if (!activeSnapshot) return;
    const id = setInterval(() => setOfflineTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, [activeSnapshot]);

  useEffect(() => {
    localStorage.setItem('rail_favs', JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    localStorage.setItem('rail_watchlist', JSON.stringify(watchlist));
  }, [watchlist]);

  const toggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const isFav = favorites.includes(id);
    setFavorites(prev => isFav ? prev.filter(f => f !== id) : [...prev, id]);
    showToast(t(isFav ? 'app.toasts.favRemoved' : 'app.toasts.favAdded'));
  };

  const toggleWatchlist = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const isWatch = watchlist.includes(id);
    setWatchlist(prev => isWatch ? prev.filter(w => w !== id) : [...prev, id]);
    showToast(t(isWatch ? 'app.toasts.watchRemoved' : 'app.toasts.watchAdded'));
  };

  const handleAddToCalendar = (e: React.MouseEvent, train: DailyTimetableOD, dep: string, arr: string) => {
    e.stopPropagation();
    const trainId = train.DailyTrainInfo?.TrainNo;
    const isHsr = transportType === 'hsr';
    const originName = train.OriginStationName?.Zh_tw || stations.find(s => s.StationID === originStationId)?.StationName?.Zh_tw || originStationId;
    const destName = train.DestinationStationName?.Zh_tw || stations.find(s => s.StationID === destStationId)?.StationName?.Zh_tw || destStationId;
    const typeName = train.DailyTrainInfo?.TrainTypeName?.Zh_tw || (isHsr ? '高鐵' : '火車');
    const title = `[${isHsr ? '高鐵' : '台鐵'}] ${trainId}車次: ${originName}➔${destName}`;
    const details = `搭乘 ${typeName} ${trainId}車次\n從 ${originName} 出發，前往 ${destName}。\n出發時間: ${dep}\n抵達時間: ${arr}`;
    
    // Convert YYYY-MM-DD and HH:mm to YYYYMMDDTHHMMSS
    const startStr = `${selectedDate.replace(/-/g, '')}T${dep.replace(':', '')}00`;
    let endStr = `${selectedDate.replace(/-/g, '')}T${arr.replace(':', '')}00`;
    if (arr < dep) {
      const nextDay = new Date(new Date(selectedDate).getTime() + 86400000);
      const nextDayStr = nextDay.toISOString().split('T')[0].replace(/-/g, '');
      endStr = `${nextDayStr}T${arr.replace(':', '')}00`;
    }

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    const isMac = /Macintosh/.test(navigator.userAgent);
    
    if (isIOS || isMac) {
      const icsString = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:${title}\nDTSTART;TZID=Asia/Taipei:${startStr}\nDTEND;TZID=Asia/Taipei:${endStr}\nDESCRIPTION:${details.replace(/\n/g, '\\n')}\nEND:VEVENT\nEND:VCALENDAR`;
      const uri = `data:text/calendar;charset=utf8,${encodeURIComponent(icsString)}`;
      const link = document.createElement('a');
      link.href = uri;
      link.download = `${trainId}.ics`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      const uri = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${startStr}/${endStr}&details=${encodeURIComponent(details)}&ctz=Asia/Taipei`;
      window.open(uri, '_blank');
    }
  };

  // Helper to format date as YYYY-MM-DD
const getFormattedDate = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  // 使用台北時區產生 YYYY-MM-DD
  const tzDate = new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric', 
    month: '2-digit', 
    day: '2-digit',
    timeZone: 'Asia/Taipei'
  }).format(d);
  
  return tzDate.replace(/\//g, '-'); // 將 "2023/10/05" 轉為 "2023-10-05"
};

  const dates = Array.from({ length: 14 }).map((_, i) => {
    const val = getFormattedDate(i);
    let label = '';
    if (i === 0) label = t('app.today');
    else if (i === 1) label = t('app.tomorrow');
    else if (i === 2) label = t('app.dayAfterTomorrow');
    else {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const day = d.getDay();
      const map = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const mapZh = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
      label = i18n.language === 'zh-TW' ? mapZh[day] : map[day];
    }

    return {
      id: i === 0 ? 'today' : i === 1 ? 'tomorrow' : `d${i}`,
      label: label,
      date: val.substring(5).replace('-', '月') + '日',
      value: val
    };
  });

  const handleBooking = async (e: React.MouseEvent, trainNo: string, depTime: string) => {
    e.stopPropagation();

    const isReturn = activeTab === 'return';
    const startId = isReturn ? destStationId : originStationId;
    const endId = isReturn ? originStationId : destStationId;
    const startStation = stations.find(s => s.StationID === startId)?.StationName?.Zh_tw || '';
    const endStation = stations.find(s => s.StationID === endId)?.StationName?.Zh_tw || '';
    const dateId = isReturn ? returnDate : selectedDate;
    const trainDate = (dates.find(d => d.id === dateId) || dates[0]).value;
    const fallbackUrl = transportType === 'hsr'
      ? 'https://irs.thsrc.com.tw/IMINT/'
      : 'https://www.railway.gov.tw/tra-tip-web/tip/tip001/tip123/query';

    // The T-EX / e訂通 deeplinks are universal/app links: iOS and Android only
    // hand them to the native app on a top-level navigation, and a script-driven
    // redirect inside a popup always renders the web fallback instead. So on
    // mobile we stay in this tab; on desktop (no app) we pre-open a tab
    // synchronously during the click so popup blockers allow it.
    const openInSameTab = isMobileDevice();
    const bookingWindow = openInSameTab ? null : window.open('about:blank', '_blank');
    if (bookingWindow) bookingWindow.opener = null;

    let url = fallbackUrl;
    let usedFallback = false;

    try {
      if (transportType === 'hsr') {
        url = await getHSRBookingDeepLink({
          startStation,
          endStation,
          trainDate,
          trainTime: depTime,
          trainNumber: trainNo,
        });
      } else {
        url = await getTRABookingDeepLink({
          startStation,
          endStation,
          trainDate,
          trainNumber: trainNo,
        });
      }
    } catch (error) {
      usedFallback = true;
      console.warn(`[${transportType.toUpperCase()} booking] Deeplink unavailable:`, error);
      showToast(
        i18n.language === 'zh-TW'
          ? `暫時無法取得${transportType === 'hsr' ? ' T-EX' : ' e 訂通'}連結，改開啟官方網站`
          : `${transportType === 'hsr' ? 'T-EX' : 'TRA app'} link unavailable; opening the official website`,
      );
    }

    if (bookingWindow) bookingWindow.location.replace(url);

    setBookingModalState({
      isOpen: true,
      trainNo,
      origin: startStation || '...',
      destination: endStation || '...',
      depTime,
      url,
      date: trainDate.replace(/-/g, '/'),
      popupBlocked: !openInSameTab && bookingWindow === null,
      usedFallback,
    });

    if (openInSameTab) {
      // Same-tab navigation lets the OS intercept the link and open the app;
      // if the app is not installed the store/fallback page loads instead.
      window.location.href = url;
    }
  };

  /**
   * Shared TRA/HSR path: consume → plan → optional toast / intent flags → parallel search.
   * @returns whether search work was started
   */
  const attemptRailSearch = (intent: RailSearchIntent): boolean => {
    // Auto paths wait quietly while the shared window is full (avoid re-toast loops).
    if (intent !== 'manual' && queryThrottled) return false;

    const plan = planRailSearchStart(tryConsumeQuery(), intent);
    if (!plan.runSearch) {
      if (plan.showThrottleMessage) showToast(queryThrottleMessage);
      return false;
    }
    if (plan.clearPending) pendingRecentSearchRef.current = null;
    if (plan.markAutoFired) hasAutoFiredRef.current = true;
    setHasSearched(true);
    setIsSearchCollapsed(true);
    if (plan.resetPage) setCurrentPage(1);
    fetchTimetable();
    fetchExtraData();
    if (plan.scrollToResults) {
      setTimeout(() => {
        document.getElementById('results-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 350);
    }
    return true;
  };

  const fetchTimetable = async () => {
    // Guard: never fetch with empty station IDs (happens briefly during transport-type switch)
    if (!originStationId || !destStationId) return;
    setIsLoading(true);
    setError(null);

    const dateObj = dates.find(d => d.id === selectedDate) || dates[0];
    const dateStr = dateObj.value;
    const returnDateObj = dates.find(d => d.id === returnDate) || dates[1];
    const meta: SnapshotMeta = {
      transportType,
      originId: originStationId,
      destId: destStationId,
      date: dateStr,
      tripType,
      returnDate: tripType === 'round-trip' ? returnDateObj.value : undefined,
    };
    lastSearchMetaRef.current = meta;
    setOfflineBannerDismissed(false);

    // Update URL query parameters dynamically on search for bookmarking and SEO sharing
    if (typeof window !== 'undefined') {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('transport', transportType);
        url.searchParams.set('fromId', originStationId);
        url.searchParams.set('toId', destStationId);
        window.history.pushState({}, '', url.pathname + url.search);
      } catch (e) {
        // Ignore iframe pushState domain mismatch errors
      }
    }

    try {
      let data: DailyTimetableOD[] = [];
      let returnData: DailyTimetableOD[] = [];

      if (transportType === 'hsr') {
        data = await getTHSRTimetableOD(originStationId, destStationId, dateStr);
        if (tripType === 'round-trip') {
          returnData = await getTHSRTimetableOD(destStationId, originStationId, returnDateObj.value);
        }
      } else {
        data = await getTRATimetableOD(originStationId, destStationId, dateStr);
        if (tripType === 'round-trip') {
          returnData = await getTRATimetableOD(destStationId, originStationId, returnDateObj.value);
        }
      }

const sortFn = (a: DailyTimetableOD, b: DailyTimetableOD) => {
  const timeA = a.OriginStopTime?.DepartureTime;
  const timeB = b.OriginStopTime?.DepartureTime;
  return parseTimeForSort(timeA) - parseTimeForSort(timeB);
};

      data.sort(sortFn);
      returnData.sort(sortFn);

      setTimetables(data);
      setReturnTimetables(returnData);

      // Cache snapshot so the user can survive a tunnel/no-signal moment later.
      saveSnapshot(meta, data, returnData);
      if (isOnline) setActiveSnapshot(null);

      // Record this search in the "最近搜尋" history (dedup by route+date inside the lib).
      const originName = stations.find(s => s.StationID === originStationId)?.StationName?.Zh_tw || originStationId;
      const destName = stations.find(s => s.StationID === destStationId)?.StationName?.Zh_tw || destStationId;

      // 記錄查詢 log（fire-and-forget，不阻塞主流程）
      logQuery({
        transportType,
        originStationId,
        originStationName: originName,
        destStationId,
        destStationName: destName,
        queryDate: dateStr,
        tripType,
        returnDate: tripType === 'round-trip' ? returnDateObj.value : undefined,
        activeFilter,
        resultCount: data.length,
      });

      setRecentSearches(addRecentSearch({
        transportType,
        originId: originStationId,
        destId: destStationId,
        originName,
        destName,
        tripType,
      }));
    } catch (err: any) {
      console.error(err);
      // Fall back to cached snapshot rather than blanking the UI.
      const snap = loadSnapshot(meta);
      if (snap) {
        setTimetables(snap.timetables);
        setReturnTimetables(snap.returnTimetables);
        setActiveSnapshot(snap);
        setError(null);
      } else {
        setError(err.message || '發生錯誤');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectRecentSearch = (entry: RecentSearchEntry) => {
    setTransportType(entry.transportType);
    setOriginStationId(entry.originId);
    setDestStationId(entry.destId);
    setTripType(entry.tripType);
    // Recent searches intentionally do not retain dates: always use today's
    // Taiwan-time departure date, with tomorrow as the round-trip return date.
    setSelectedDate('today');
    setReturnDate('tomorrow');
    // Queue a one-shot auto-fetch once React has applied the form state.
    pendingRecentSearchRef.current = entry;
  };

  // Fire search after a recent-search click, when form state has caught up.
  useEffect(() => {
    const pending = pendingRecentSearchRef.current;
    if (!pending) return;
    if (
      transportType === pending.transportType &&
      originStationId === pending.originId &&
      destStationId === pending.destId &&
      tripType === pending.tripType
    ) {
      attemptRailSearch('recent');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transportType, originStationId, destStationId, tripType, selectedDate, returnDate, queryThrottled]);

  const handleRemoveRecentSearch = (id: string) => {
    setRecentSearches(removeRecentSearch(id));
  };

  const handleClearRecentSearches = () => {
    clearRecentSearches();
    setRecentSearches([]);
  };

  const fetchStations = async () => {
    setStationsLoading(true);
    setStationsError(null);
    try {
      let data: Station[] = [];
      if (transportType === 'hsr') {
        data = await getTHSRStations();
      } else {
        data = await getTRAStations();
      }
      
      if (!data || data.length === 0) {
        throw new Error('No stations found');
      }

      setStations(data);

      // Honor ?fromId=&toId= deep links (from SEO route landing pages) or URL pathnames so
      // the search pre-fills when the user lands here from Google / sitemap.
      const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
      let fromIdParam = params?.get('fromId');
      let toIdParam = params?.get('toId');

      if (typeof window !== 'undefined' && (!fromIdParam || !toIdParam)) {
        const path = window.location.pathname;
        const routeMatch = path.match(/\/(routes|timetable)\/(train|hsr)\/([a-z0-9-]+)-to-([a-z0-9-]+)/i);
        const simpleTimetableMatch = path.match(/\/timetable\/([a-z0-9-]+)-to-([a-z0-9-]+)/i);
        const stationMatch = path.match(/\/(stations|station)\/([a-z0-9-]+)/i);
        const trainMatch = path.match(/\/(trains|train)\/([a-z0-9-]+)/i);

        const findStationBySlug = (slugStr: string, stationList: Station[]) => {
          const lower = slugStr.toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
          return stationList.find(s => {
            const sEn = (s?.StationName?.En || '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
            const sZh = (s?.StationName?.Zh_tw || '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
            return sEn === lower || sZh === lower;
          });
        };

        if (routeMatch) {
          const fromStation = findStationBySlug(routeMatch[3], data);
          const toStation = findStationBySlug(routeMatch[4], data);
          if (fromStation && toStation) {
            fromIdParam = fromStation.StationID;
            toIdParam = toStation.StationID;
          }
        } else if (simpleTimetableMatch) {
          const fromStation = findStationBySlug(simpleTimetableMatch[1], data);
          const toStation = findStationBySlug(simpleTimetableMatch[2], data);
          if (fromStation && toStation) {
            fromIdParam = fromStation.StationID;
            toIdParam = toStation.StationID;
          }
        } else if (stationMatch) {
          const s = findStationBySlug(stationMatch[2], data);
          if (s) {
            fromIdParam = s.StationID;
          }
        } else if (trainMatch) {
          const trainNo = trainMatch[2];
          setExpandedTrainId(trainNo);
        }
      }

      const validIds = new Set(data.map(s => s.StationID));
      if (fromIdParam && toIdParam && validIds.has(fromIdParam) && validIds.has(toIdParam)) {
        setOriginStationId(fromIdParam);
        setDestStationId(toIdParam);
      } else if (fromIdParam && !toIdParam && validIds.has(fromIdParam)) {
        setOriginStationId(fromIdParam);
        const dest = data.find(s => s.StationID !== fromIdParam)?.StationID ?? '';
        setDestStationId(dest);
      } else if (transportType === 'hsr') {
        const origin = data.find(s => s?.StationName?.Zh_tw && ['南港', '台北', '臺北'].includes(s.StationName.Zh_tw))?.StationID ?? data[0]?.StationID;
        const dest   = data.find(s => s?.StationName?.Zh_tw && ['左營', '高雄', '台南'].includes(s.StationName.Zh_tw) && s.StationID !== origin)?.StationID ?? data[data.length - 1]?.StationID;
        if (origin) setOriginStationId(origin);
        if (dest)   setDestStationId(dest);
      } else {
        const origin = data.find(s => s?.StationName?.Zh_tw && ['臺北', '台北'].includes(s.StationName.Zh_tw))?.StationID ?? data[0]?.StationID;
        const dest   = data.find(s => s?.StationName?.Zh_tw === '高雄')?.StationID ?? data[data.length - 1]?.StationID;
        if (origin) setOriginStationId(origin);
        if (dest)   setDestStationId(dest);
      }
    } catch (err: any) {
      console.error('Failed to fetch stations', err);
      setStationsError(err.message || 'Error');
    } finally {
      setStationsLoading(false);
    }
  };

  const fetchExtraData = async () => {
    if (!originStationId || !destStationId) return;
    try {
      if (transportType === 'hsr') {
        const fareData = await getTHSRODFare(originStationId, destStationId);
        const fareArr = Array.isArray(fareData) ? fareData : [];
        const f0 = fareArr[0]?.Fares?.[0] as any;
        const faresList = fareArr[0]?.Fares || [];
        
        const thsrFares = {
          standard: faresList.find((f: any) => (f.CabinClass === 1 && f.FareClass === 1) || String(f.TicketType || '').includes('標準'))?.Price,
          business: faresList.find((f: any) => (f.CabinClass === 2 && f.FareClass === 1) || String(f.TicketType || '').includes('商務'))?.Price,
          unreserved: faresList.find((f: any) => (f.CabinClass === 3 && f.FareClass === 1) || String(f.TicketType || '').includes('自由'))?.Price,
        };
        setFares(thsrFares as Record<string, number>);

        const boardData = await getTHSRLiveBoard(originStationId);
        const delayMap: Record<string, number> = {};
        const detailMap: Record<string, any> = {};
        (Array.isArray(boardData) ? boardData : []).forEach(b => {
          if (b?.TrainNo !== undefined) {
             delayMap[b.TrainNo] = b.DelayTime || 0;
             detailMap[b.TrainNo] = b;
          }
        });
        setLiveBoard(delayMap);
        setLiveBoardDetails(detailMap);
      } else {
        const fareData = await getTRAODFare(originStationId, destStationId);
        const fareMap: Record<string, number> = {};
        (Array.isArray(fareData) ? fareData : []).forEach(f => {
          if (f?.TrainType != null) {
            const typeStr = f.TrainType.toString();
            
            const stdFare = f.Fares?.find(x => x.CabinClass === 1 && (x.FareClass === 1 || String(x.TicketType || '').includes('成人')))?.Price 
                         ?? f.Fares?.find(x => x.CabinClass === 1)?.Price 
                         ?? f.Fares?.[0]?.Price ?? f.Fares?.[0]?.Fare;
                         
            const bizFare = f.Fares?.find(x => x.CabinClass === 2 && (x.FareClass === 1 || String(x.TicketType || '').includes('成人')))?.Price 
                         ?? f.Fares?.find(x => x.CabinClass === 2)?.Price;
                         
            if (stdFare !== undefined) {
              fareMap[`${typeStr}_standard`] = stdFare;
              fareMap[typeStr] = stdFare; // Backwards compatible for getPrice
            }
            if (bizFare !== undefined) fareMap[`${typeStr}_business`] = bizFare;
          }
        });
        setFares(fareMap);

        const boardData = await getTRALiveBoard(originStationId);
        const delayMap: Record<string, number> = {};
        const detailMap: Record<string, any> = {};
        (Array.isArray(boardData) ? boardData : []).forEach(b => {
          if (b?.TrainNo !== undefined) {
             delayMap[b.TrainNo] = b.DelayTime || 0;
             detailMap[b.TrainNo] = b;
          }
        });
        setLiveBoard(delayMap);
        setLiveBoardDetails(detailMap);
        setLastLiveUpdate(new Date());
      }
    } catch (e) {
      console.error('Failed to fetch extra data', e);
    }
  };

  // Live Board Polling Fallback with Adaptive Polling (Visibility API)
  useEffect(() => {
    let pollInterval: NodeJS.Timeout | null = null;
    
    const startPolling = () => {
      if (pollInterval) clearInterval(pollInterval);
      
      // If we are on serverless or socket isn't connected, and we have a search origin, poll!
      if ((isServerlessHost || !socket?.connected) && hasSearched && originStationId) {
        // Automatically lower frequency to 5 mins if the user's tab is hidden to save TDX/server load
        const intervalTime = document.hidden ? 300_000 : 30_000;
        
        pollInterval = setInterval(() => {
          fetchExtraData();
        }, intervalTime);
      }
    };

    const handleVisibilityChange = () => {
      startPolling();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    startPolling();

    return () => {
      if (pollInterval) clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [hasSearched, originStationId, destStationId, transportType]);

  // Handle Online Reconnection
  useEffect(() => {
    const handleReconnect = () => {
      if (hasSearched) {
        fetchExtraData();
      }
    };
    window.addEventListener('network-reconnected', handleReconnect);
    return () => window.removeEventListener('network-reconnected', handleReconnect);
  }, [hasSearched, originStationId, destStationId, transportType]);

  useEffect(() => {
    // Clear everything from the previous transport type BEFORE loading new stations.
    setOriginStationId('');
    setDestStationId('');
    setStations([]);
    setTimetables([]);
    setReturnTimetables([]);
    setExpandedTrainId(null);
    setTrainStops({});
    setHasSearched(false); // Reset on transport switch
    userPickedOriginRef.current = false; // 允許定位重新帶入新運具的最近站
    fetchStations();
    setCurrentPage(1);
  }, [transportType]);

  // 進站時直接觸發瀏覽器原生定位權限詢問（不另做自訂彈窗）。
  // 已拒絕/不支援則略過；定位只用於最近車站與之後的 Query log。
  useEffect(() => {
    if (geoInitRef.current) return;
    geoInitRef.current = true;

    if (!isGeoSupported()) {
      setGeoStatus('unsupported');
      return;
    }
    // 使用者先前明確拒絕 → 不再請求（瀏覽器層級通常也會記住）
    if (getGeoPref() === 'denied') {
      setGeoStatus('denied');
      return;
    }

    setGeoStatus('requesting');
    requestGeolocation()
      .then((g) => { setGeoCoords(g); setGeoStatus('granted'); setGeoPref('granted'); })
      .catch((err) => {
        setGeoStatus('denied');
        // 只有「使用者明確拒絕」(code 1) 才記住，逾時/取得失敗下次仍會再問
        if (err && err.code === 1) setGeoPref('denied');
      });
  }, []);

  // 定位成功且車站載入後，自動帶入最近的起始站（不覆蓋深連結或使用者手動選擇）
  useEffect(() => {
    if (!geoCoords || stations.length === 0 || userPickedOriginRef.current) return;
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('fromId') || params.get('toId')) return;
      if (/\/(routes|timetable|stations|station|trains|train)\//i.test(window.location.pathname)) return;
    }
    // 最近站超過 150km（例如人在國外）就不自動帶入
    const nearest = findNearestStation(geoCoords.lat, geoCoords.lon, stations, 150);
    if (nearest && nearest.StationID !== destStationId) {
      setOriginStationId(nearest.StationID);
    }
  }, [geoCoords, stations, destStationId]);

  useEffect(() => {
    setCurrentPage(1);
    setHasSearched(false);
  }, [selectedDate, originStationId, destStationId]);

  // Auto-search if deep link parameters or SEO routes are present
  useEffect(() => {
    if (stations.length === 0 || isLoading || hasSearched || hasAutoFiredRef.current) return;

    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const fromIdParam = params?.get('fromId');
    const toIdParam = params?.get('toId');

    const isS2SRoute = typeof window !== 'undefined' && (
      window.location.pathname.match(/\/(routes|timetable)\/(train|hsr)\/([a-z0-9-]+)-to-([a-z0-9-]+)/i) ||
      window.location.pathname.match(/\/timetable\/([a-z0-9-]+)-to-([a-z0-9-]+)/i)
    );

    if (originStationId && destStationId && (
      (fromIdParam && toIdParam && originStationId === fromIdParam && destStationId === toIdParam) ||
      isS2SRoute
    )) {
      attemptRailSearch('autofire');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stations, transportType, originStationId, destStationId, queryThrottled]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeFilter, activeTab, timeSortDirection]);

  // Removed automatic timetable fetch useEffect to support manual search only

  // Long-press plumbing shared across all train cards. A single active-press ref avoids
  // per-item hooks in the render loop.
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);
  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };
  const makeLongPressHandlers = (onLongPress: () => void) => ({
    onPointerDown: () => {
      longPressFiredRef.current = false;
      cancelLongPress();
      longPressTimerRef.current = window.setTimeout(() => {
        longPressFiredRef.current = true;
        if (window.navigator.vibrate) window.navigator.vibrate(40);
        onLongPress();
      }, 500);
    },
    onPointerUp: cancelLongPress,
    onPointerLeave: cancelLongPress,
    onPointerCancel: cancelLongPress,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      cancelLongPress();
      longPressFiredRef.current = true;
      if (window.navigator.vibrate) window.navigator.vibrate(40);
      onLongPress();
    },
  });

  const handleExpandTrain = async (trainId: string, skipUrlUpdate = false) => {
    if (!trainId || trainId === 'Unknown') {
      showToast(i18n.language === 'zh-TW' ? '無法取得此特殊車次的停靠站資訊' : 'Stop details unavailable for this train');
      return;
    }
    if (expandedTrainId === trainId) {
      setExpandedTrainId(null);
      if (!skipUrlUpdate && typeof window !== 'undefined') {
        try {
          const url = new URL(window.location.href);
          url.searchParams.delete('train');
          window.history.pushState({}, '', url.pathname + url.search);
        } catch (e) {
          // Ignore
        }
      }
      return;
    }
    
    setExpandedTrainId(trainId);
    setShowPassedStops(false);
    if (!skipUrlUpdate && typeof window !== 'undefined') {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('train', trainId);
        window.history.pushState({}, '', url.pathname + url.search);
      } catch (e) {
        // Ignore
      }
    }

    if (!trainStops[trainId]) {
      try {
        setStopsLoading(prev => ({ ...prev, [trainId]: true }));
        const dateObj = dates.find(d => d.id === selectedDate) || dates[0];
        const dateStr = dateObj.value;
        let data;
        if (transportType === 'hsr') {
          data = await getTHSRTrainTimetable(trainId, dateStr);
        } else {
          data = await getTRATrainTimetable(trainId, dateStr);
        }
        if (data && data.length > 0) {
          const first = data[0];
          setTrainStops(prev => ({ 
            ...prev, 
            [trainId]: { 
              stops: first.StopTimes || first.TrainStopTimes || [],
              isMock: (first.TrainInfo as any)?.IsMock === true
            } 
          }));
        } else {
          setTrainStops(prev => ({ ...prev, [trainId]: { stops: [] } })); // No stops found
        }
      } catch (e) {
        console.error("Failed to fetch stops", e);
        setTrainStops(prev => ({ ...prev, [trainId]: { stops: [] } }));
      } finally {
        setStopsLoading(prev => ({ ...prev, [trainId]: false }));
      }
    }
  };

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const trainParam = params.get('train');
      if (trainParam) {
        if (expandedTrainId !== trainParam) {
          handleExpandTrain(trainParam, true);
        }
      } else {
        setExpandedTrainId(null);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [expandedTrainId, i18n.language, trainStops, selectedDate, dates, transportType]);

  const getPrice = (train: DailyTimetableOD) => {
    if (transportType === 'hsr') return fares['standard'] ? `NT$ ${fares['standard']}` : '--';
    
    const typeId = train.DailyTrainInfo?.TrainTypeID || '';
    let mappedType = '6'; // default local
    if (typeId === '1101') mappedType = '1'; // Taroko
    else if (typeId === '1102') mappedType = '2'; // Puyuma
    else if (['1100', '1103', '1104', '1105', '1106', '1107', '1108'].includes(typeId)) mappedType = '3'; // Tze-Chiang
    else if (['1110', '1111', '1114', '1115'].includes(typeId)) mappedType = '4'; // Chu-Kuang
    else if (['1120'].includes(typeId)) mappedType = '5'; // Fuxing
    else if (['1131', '1132', '1133'].includes(typeId)) mappedType = '6'; // Local
    
    // Taroko/Puyuma/Tze-chiang are often priced the same, fallback if missing
    const price = fares[`${mappedType}_standard`] || fares[mappedType] || (['1', '2', '3'].includes(mappedType) ? fares['3'] : undefined);
    return price ? `NT$ ${price}` : '--';
  };

  const calculateDuration = (dep: string, arr: string) => {
    if (!dep || !arr || dep.includes('--') || arr.includes('--')) return '0:0';
    const diffM = getDurationMinutes(dep, arr);
    const h = Math.floor(diffM / 60);
    const m = diffM % 60;
    return `${isNaN(h) ? 0 : h}:${isNaN(m) ? 0 : m}`;
  };

  const getDurationMinutes = (dep: string, arr: string) => {
    const [depH, depM] = dep.split(':').map(Number);
    const [arrH, arrM] = arr.split(':').map(Number);
    let diffM = (arrH * 60 + arrM) - (depH * 60 + depM);
    if (diffM < 0) diffM += 24 * 60;
    return diffM;
  };

  // Get current TW time for real-time position
  const nowMinutes = getTwMinutes();
  const isToday = selectedDate === 'today';

  const filteredTimetables = useMemo(() => {
    const base = activeTab === 'outbound' ? timetables : returnTimetables;
    
    // Threshold calculation for 'today'
    // Keep trains whose scheduled departure is within the last hour so the list focuses on
    // what's actually still catchable (previously: 3 hours, which buried upcoming trains).
    const thresholdMinutes = selectedDate === 'today' ? Math.max(0, nowMinutes - 60) : -1;

    // Single pass filter (improves algorithmic efficiency O(N * number_of_filters) -> O(N))
    let filtered = base.filter(t => {
      // 1. Time threshold filter
      if (thresholdMinutes !== -1) {
        const depTime = t.OriginStopTime?.DepartureTime;
        if (!depTime) return false;
        const trainMinutes = parseTimeForSort(depTime);
        if (!(trainMinutes >= thresholdMinutes || (trainMinutes + 1440 >= thresholdMinutes && trainMinutes < 240))) {
          return false;
        }
      }

      // 2. Favorites / Watchlist check
      const trainNo = t.DailyTrainInfo.TrainNo;
      if (showFavoritesOnly && !favorites.includes(trainNo)) return false;
      if (showWatchlistOnly && !watchlist.includes(trainNo)) return false;

      // 3. Category filters
      if (activeFilter === 'reserved') {
        const typeId = t.DailyTrainInfo?.TrainTypeID || '';
        const name = t.DailyTrainInfo?.TrainTypeName?.Zh_tw || '';
        if (!(['1', '2', '3', '1100', '1101', '1102', '1107', '1108', '1110'].includes(typeId) || 
               name.includes('自強') || name.includes('普悠瑪') || name.includes('太魯閣') || name.includes('高鐵'))) {
          return false;
        }
      } else if (activeFilter === 'accessible') {
        // V3 API or V2 API fallback standardization: check the unified flag, otherwise fallback to specific accessible train types mapping
        const isAccessible = t.DailyTrainInfo?.WheelchairFlag === 1 || (t.DailyTrainInfo as any)?.WheelChairFlag === 1 || (t as any).ExtraInfo?.IsWheelchairUser;
        if (!isAccessible) {
           const typeId = t.DailyTrainInfo?.TrainTypeID || '';
           const name = t.DailyTrainInfo?.TrainTypeName?.Zh_tw || '';
           if (!(transportType === 'hsr' || name.includes('3000') || name.includes('普悠瑪') || name.includes('太魯閣') || ['1100', '1101', '1102', '1107'].includes(typeId))) {
             return false;
           }
        }
      }

      return true;
    });

    // Sort optimization using Schwartzian Transform (Map -> Sort -> Map) avoids O(N log N) re-calculations
    if (['time', 'fastest', 'cheapest'].includes(activeFilter)) {
      filtered = filtered.map(t => {
        let sortKey = 0;
        if (activeFilter === 'time') {
          sortKey = parseTimeForSort(t.OriginStopTime?.DepartureTime);
        } else if (activeFilter === 'fastest') {
          sortKey = getDurationMinutes(t.OriginStopTime?.DepartureTime, t.DestinationStopTime?.ArrivalTime);
        } else if (activeFilter === 'cheapest') {
           sortKey = parseInt(getPrice(t).replace(/[^\d]/g, '')) || 99999;
        }
        return { item: t, sortKey };
      })
      .sort((a, b) => {
        const direction = activeFilter === 'time' && timeSortDirection === 'desc' ? -1 : 1;
        return (a.sortKey - b.sortKey) * direction;
      })
      .map(entry => entry.item);
    }
    
    return filtered;
  }, [timetables, returnTimetables, activeTab, selectedDate, nowMinutes, showFavoritesOnly, showWatchlistOnly, activeFilter, timeSortDirection, transportType, favorites, watchlist]); // Add dependencies

  const pagedTimetables = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredTimetables.slice(start, start + pageSize);
  }, [filteredTimetables, currentPage, pageSize]);

  // Pre-compute reliability scores for the visible page so each card render stays cheap.
  const reliabilityByTrain = useMemo(() => {
    const map: Record<string, ReturnType<typeof getReliability>> = {};
    for (const train of pagedTimetables) {
      const trainNo = train.DailyTrainInfo?.TrainNo;
      if (!trainNo) continue;
      map[trainNo] = getReliability({
        trainNo,
        trainTypeId: train.DailyTrainInfo?.TrainTypeID,
        trainTypeName: train.DailyTrainInfo?.TrainTypeName?.Zh_tw,
        tripLine: train.DailyTrainInfo?.TripLine,
        direction: train.DailyTrainInfo?.Direction,
        transportType,
        departureMinutes: parseTimeForSort(train.OriginStopTime?.DepartureTime),
        originStationId: train.OriginStationID || originStationId,
        destinationStationId: train.DestinationStationID || destStationId,
      });
    }
    return map;
  }, [pagedTimetables, transportType, originStationId, destStationId, lastLiveUpdate]);

  // Offline-mode countdown: which train should we be telling the user is "next" without the network?
  const offlineCountdown = useMemo(() => {
    if (!activeSnapshot) return null;
    const todayDateStr = dates[0]?.value || '';
    void offlineTick;
    return nextDepartureFromSnapshot(
      activeTab === 'outbound' ? activeSnapshot.timetables : activeSnapshot.returnTimetables,
      todayDateStr,
      activeTab === 'outbound' ? activeSnapshot.date : (activeSnapshot.returnDate || '')
    );
  }, [activeSnapshot, activeTab, dates, offlineTick]);

  const approachingInfo = useMemo(() => {
    if (!hasSearched || !isToday || !originStationId || !filteredTimetables.length) return null;

    const upcoming = [];
    for (const train of filteredTimetables) {
        const trainId = (train as any).TrainInfo?.TrainNo || train.DailyTrainInfo?.TrainNo;
        if (!trainId || dismissedTrains.has(trainId)) continue;
        
        // If it is cancelled, skip
        if (cancelledTrains.has(trainId)) continue;

        const depStr = (train as any).StopTimes?.[0]?.DepartureTime || train.OriginStopTime?.DepartureTime || '23:59';
        const baseDepMins = timeToMinutes(depStr);
        const delay = liveBoard[trainId] || 0;
        const actDepMins = baseDepMins + delay;
        const diff = actDepMins - nowMinutes;

        // Is within next 30 mins, and diff >= -1 (not significantly departed)
        if (diff >= -1 && diff <= 30) {
            upcoming.push({ train, trainId, diff, actDepMins, delay });
        }
    }

    if (upcoming.length === 0) return null;

    upcoming.sort((a, b) => a.actDepMins - b.actDepMins);
    const first = upcoming[0];
    const stationName = stations.find(s => s.StationID === originStationId)?.StationName?.Zh_tw || '...';
    
    // Desktop Notification check
    if (first.diff <= 5 && lastNotifiedRef.current !== first.trainId && first.diff >= 0) {
        notifyUser(
          i18n.language === 'zh-TW' ? '🚆 火車即時提醒' : 'Train Approach Alert',
          i18n.language === 'zh-TW' 
            ? `${first.trainId} 次車即將於 ${first.diff} 分鐘內抵達 ${stationName}`
            : `Train ${first.trainId} is arriving at ${stationName} in ${first.diff} min.`
        );
        if ('vibrate' in navigator) navigator.vibrate([200, 100, 200, 100, 200]);
        lastNotifiedRef.current = first.trainId;
    }

    let pform = liveBoardDetails[first.trainId]?.Platform;
    if (!pform && transportType === 'hsr') {
       pform = '--';
    }

    return {
        trainNo: first.trainId,
        station: stationName,
        minutes: Math.max(0, first.diff),
        platform: pform || '--'
    };
  }, [hasSearched, isToday, filteredTimetables, nowMinutes, liveBoard, liveBoardDetails, originStationId, stations, dismissedTrains, cancelledTrains, transportType, i18n.language]);

  const isPastTrain = useCallback((time: string | undefined, delay: number = 0) => {
    if (!time || selectedDate !== 'today') return false;
    const [h, m] = time.split(':').map(Number);
    const timeMinutes = (h < 4 ? h + 24 : h) * 60 + m + delay;
    return timeMinutes < nowMinutes;
  }, [selectedDate, nowMinutes]);

  const getTrainColor = (type: string) => {
    if (type.includes('普悠瑪') || type.includes('太魯閣') || type.includes('高鐵')) return 'red';
    if (type.includes('自強') || type.includes('莒光')) return 'orange';
    return 'blue';
  };

  const getTHSRTrainTypeBadge = (trainNo: string) => {
    if (!trainNo) return null;
    // 四碼通常是加班車
    const baseNo = trainNo.length === 4 ? trainNo.substring(1) : trainNo; 
    
    if (baseNo.startsWith('1') || baseNo.startsWith('2')) {
      return <span className="bg-purple-100 text-purple-700 px-2 py-1 rounded text-[0.625rem] font-black uppercase tracking-widest">⚡ 直達最快</span>;
    }
    if (baseNo.startsWith('8') || baseNo.startsWith('9')) {
      return <span className="bg-slate-100 text-slate-500 px-2 py-1 rounded text-[0.625rem] font-black uppercase tracking-widest">站站停</span>;
    }
    if (trainNo.length === 4) {
       return <span className="bg-orange-100 text-orange-600 px-2 py-1 rounded text-[0.625rem] font-black uppercase tracking-widest">加班車</span>;
    }
    return null;
  };

  const getEnvironment = (stationName: string) => {
    if (!stationName) return { weather: 'sunny', timeOfDay: 'afternoon' };
    const h = stationName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const hour = new Date().getHours();
    
    // Determine weather (sunny, cloudy, rainy) based on station hash
    const weather = h % 4 === 0 ? 'rainy' : h % 4 === 1 ? 'cloudy' : 'sunny';
    
    // Determine time of day
    let timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
    if (hour >= 5 && hour < 10) timeOfDay = 'morning';
    else if (hour >= 10 && hour < 17) timeOfDay = 'afternoon';
    else if (hour >= 17 && hour < 20) timeOfDay = 'evening';
    else timeOfDay = 'night';
    
    return { weather, timeOfDay };
  };

  const RainEffect = () => {
    const drops = useMemo(() => Array.from({ length: 30 }, (_, i) => ({
      id: i,
      left: `${(i * 3.3) % 100}%`,
      delay: `${Math.random() * 2}s`,
      duration: `${0.7 + Math.random() * 0.5}s`
    })), []);

    return (
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0 opacity-20">
        <div className="absolute inset-0 bg-slate-400/5 backdrop-blur-[1px]"></div>
        {drops.map(drop => (
          <div 
            key={drop.id} 
            className="rain-drop" 
            style={{ 
              left: drop.left, 
              animationDelay: drop.delay,
              animationDuration: drop.duration
            }} 
          />
        ))}
      </div>
    );
  };

  const StationHaptics = ({ active }: { active: boolean }) => {
    useEffect(() => {
      if (active && window.navigator.vibrate) {
        window.navigator.vibrate([10, 40]);
      }
    }, [active]);
    return null;
  };
  const getDynamicMeta = () => {
    const originStationObj = stations.find(s => s.StationID === originStationId);
    const destStationObj = stations.find(s => s.StationID === destStationId);
    
    const siteTitle = i18n.language === 'en' ? 'Taiwanrail' : '鐵道查詢';
    const transportName = i18n.language === 'en' 
      ? (transportType === 'hsr' ? 'THSR' : 'TRA')
      : (transportType === 'hsr' ? '台灣高鐵' : '台灣鐵路');
      
    let docTitle = siteTitle;
    let docDesc = i18n.language === 'en'
      ? 'Taiwanrail is a free Taiwan train timetable search tool combining the Taiwan Railways Administration (TRA) and Taiwan High Speed Rail (THSR) systems.'
      : '鐵道查詢是一個免費的台灣鐵路時刻表查詢工具，整合台鐵(TRA)與高鐵(THSR)兩大系統。';

    if (originStationObj && destStationObj) {
      const fromName = i18n.language === 'en' ? originStationObj.StationName.En : originStationObj.StationName.Zh_tw;
      const toName = i18n.language === 'en' ? destStationObj.StationName.En : destStationObj.StationName.Zh_tw;
      docTitle = i18n.language === 'en'
        ? `${fromName} to ${toName} | ${transportName} Timetable | ${siteTitle}`
        : `${fromName} 到 ${toName} | ${transportName}時刻表 | ${siteTitle}`;
      if (i18n.language === 'en') {
        docDesc = `Check ${transportName} timetables, live delays, and fares from ${fromName} to ${toName}.`;
      } else {
        docDesc = `查詢${transportName}從${fromName}到${toName}的最新時刻表、即時誤點與票價資訊。`;
      }
    } else {
      docTitle = i18n.language === 'en'
        ? `${transportName} Timetable | ${siteTitle}`
        : `${transportName}時刻表 | ${siteTitle}`;
    }

    const fallbackPath = i18n.language === 'en' ? '/en/' : '/';
    const currentPath = typeof window !== 'undefined' ? window.location.pathname : fallbackPath;
    const currentSearch = typeof window !== 'undefined' ? window.location.search : '';
    const canonicalRoutePath = originStationObj && destStationObj
      ? getIndexableRoutePath(transportType, originStationObj.StationID, destStationObj.StationID)
      : null;
    const canonicalPath = canonicalRoutePath
      ? (i18n.language === 'en' ? `/en${canonicalRoutePath}` : canonicalRoutePath)
      : normalizeSeoPath(currentPath);
    const canonicalSearch = canonicalRoutePath ? '' : currentSearch;
    const { normalizedPath, zhPath, enPath } = getAlternateLocalePaths(canonicalPath);
    const currentUrl = `${PUBLIC_SITE_URL}${normalizedPath}${canonicalSearch}`;
    const alternateZhUrl = `${PUBLIC_SITE_URL}${zhPath}${canonicalSearch}`;
    const alternateEnUrl = `${PUBLIC_SITE_URL}${enPath}${canonicalSearch}`;
    const ogImageUrl = `${PUBLIC_SITE_URL}/pwa-512x512.png`;
    const locale = i18n.language === 'en' ? 'en_US' : 'zh_TW';
    const alternateLocale = i18n.language === 'en' ? 'zh_TW' : 'en_US';
    const siteName = i18n.language === 'en' ? 'Taiwanrail' : '鐵道查詢 Taiwanrail';

    return {
      docTitle,
      docDesc,
      currentUrl,
      alternateZhUrl,
      alternateEnUrl,
      ogImageUrl,
      locale,
      alternateLocale,
      siteName,
    };
  };

  const {
    docTitle,
    docDesc,
    currentUrl,
    alternateZhUrl,
    alternateEnUrl,
    ogImageUrl,
    locale,
    alternateLocale,
    siteName,
  } = getDynamicMeta();

  return (
    <div className={`min-h-dvh font-sans text-slate-900 dark:text-slate-100 selection:bg-slate-200 dark:selection:bg-slate-700 soft-scrollbar transition-colors duration-700 ${
      mainTab === 'metro' ? 'bg-cyan-50/50 dark:bg-[#08171e]' : transportType === 'hsr' ? 'bg-orange-50/50 dark:bg-[#1a1205]' : 'bg-blue-50/50 dark:bg-[#050f1a]'
    }`}>
      <Helmet>
        <html lang={i18n.language === 'en' ? 'en' : 'zh-Hant-TW'} />
        <title>{docTitle}</title>
        <meta name="title" content={docTitle} />
        <meta name="description" content={docDesc} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={siteName} />
        <meta property="og:title" content={docTitle} />
        <meta property="og:description" content={docDesc} />
        <meta property="og:url" content={currentUrl} />
        <meta property="og:image" content={ogImageUrl} />
        <meta property="og:locale" content={locale} />
        <meta property="og:locale:alternate" content={alternateLocale} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={docTitle} />
        <meta name="twitter:description" content={docDesc} />
        <meta name="twitter:image" content={ogImageUrl} />
        <link rel="canonical" href={currentUrl} />
        <link rel="alternate" hrefLang="zh-Hant" href={alternateZhUrl} />
        <link rel="alternate" hrefLang="en" href={alternateEnUrl} />
        <link rel="alternate" hrefLang="x-default" href={alternateZhUrl} />
      </Helmet>
      {/* Navbar - Glassmorphism */}
      <header className={`fixed top-0 w-full z-50 backdrop-blur-2xl border-b shadow-none transition-colors duration-700 pt-[env(safe-area-inset-top)] ${
        mainTab === 'metro' ? 'bg-cyan-50/30 dark:bg-slate-900/60 border-cyan-100/20 dark:border-cyan-400/10' : transportType === 'hsr' ? 'bg-orange-50/30 dark:bg-slate-900/60 border-orange-100/20 dark:border-orange-400/10' : 'bg-blue-50/30 dark:bg-slate-900/60 border-blue-100/20 dark:border-blue-400/10'
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10 h-16 sm:h-20 flex items-center justify-between gap-2">
          {/* Brand Logo Design — also serves as the page H1 for SEO */}
          <h1
            className="text-balance flex items-center gap-2 sm:gap-3 cursor-pointer group transition-all duration-300 hover:scale-[1.02] m-0 min-w-0 shrink"
            onClick={() => {
              setIsSearchCollapsed(false);
              setHasSearched(false);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          >
            <img
              src="/logo.svg"
              alt=""
              aria-hidden="true"
              width="40"
              height="40"
              className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl shadow-[0_4px_14px_-4px_rgba(15,23,42,0.35)] shrink-0 select-none"
              draggable={false}
            />
            <span className="flex flex-col items-start gap-0 min-w-0">
              <span className="text-xl sm:text-2xl font-black text-black dark:text-white tracking-tighter leading-none mb-1 truncate">
                鐵道查詢
              </span>
              <span className="relative w-full h-[2px] sm:h-[3px] my-1 rounded-full overflow-visible block">
                {/* Gradient Line */}
                <span className="absolute inset-0 bg-gradient-to-r from-orange-500 via-slate-300 to-blue-600 rounded-full"></span>
                {/* Decorative Dots */}
                <span className="absolute -left-1 top-1/2 -translate-y-1/2 w-1.5 sm:h-2 sm:w-2 h-1.5 bg-orange-600 rounded-full border border-white dark:border-slate-800 shadow-sm shadow-orange-500/50"></span>
                <span className="absolute -right-1 top-1/2 -translate-y-1/2 w-1.5 sm:h-2 sm:w-2 h-1.5 bg-blue-700 rounded-full border border-white dark:border-slate-800 shadow-sm shadow-blue-500/50"></span>
              </span>
              <span className="text-[0.4375rem] sm:text-[0.5625rem] font-black text-black dark:text-white/80 tracking-[0.2em] uppercase whitespace-nowrap leading-none mt-0.5 sm:mt-1 flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                TAIWAN <span className="text-slate-400 text-[0.375rem]">•</span> RAIL <span className="text-slate-400 text-[0.375rem]">•</span> TRACKER
              </span>
            </span>
          </h1>
          <div className={`flex items-center gap-1 sm:gap-6 shrink-0 transition-colors duration-500 ${transportType === 'hsr' ? 'text-orange-600 dark:text-orange-400 hover:text-orange-700' : 'text-blue-600 dark:text-blue-400 hover:text-blue-700'}`}>
            <div className="relative shrink-0">
              <button
                ref={feedbackButtonRef}
                type="button"
                onClick={() => setIsFeedbackOpen((v) => !v)}
                aria-label={t('app.feedback.label', i18n.language === 'zh-TW' ? '意見回饋' : 'Feedback')}
                aria-expanded={isFeedbackOpen}
                className={`transition-colors flex items-center justify-center px-2 sm:px-3 py-1.5 rounded-full hover:bg-slate-100/50 dark:hover:bg-slate-800/50 ${isFeedbackOpen ? 'bg-emerald-50 text-emerald-600 font-bold' : ''}`}
              >
                <MessageCircle className={`w-4 h-4 sm:w-5 sm:h-5 ${isFeedbackOpen ? 'stroke-[2.5]' : 'stroke-[1.5]'}`} />
              </button>
              {isFeedbackOpen && (
                <div
                  ref={feedbackPopoverRef}
                  role="dialog"
                  aria-label={i18n.language === 'zh-TW' ? '意見回饋' : 'Feedback'}
                  className="fixed sm:absolute left-1/2 -translate-x-1/2 sm:left-0 sm:translate-x-0 top-[calc(env(safe-area-inset-top)+4rem)] sm:top-full sm:mt-2 z-50 w-[calc(100vw-1.5rem)] sm:w-96 max-w-sm sm:max-w-none bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 p-4 animate-in fade-in slide-in-from-top-2 duration-200"
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                      {i18n.language === 'zh-TW' ? '意見回饋' : 'Feedback'}
                    </h3>
                    <button
                      onClick={() => setIsFeedbackOpen(false)}
                      aria-label={i18n.language === 'zh-TW' ? '關閉' : 'Close'}
                      className="text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                    {i18n.language === 'zh-TW'
                      ? '歡迎留下您的建議或問題回報，您的意見對我們非常重要。'
                      : 'Share your suggestions or report issues — your feedback helps us improve.'}
                  </p>
                  <textarea
                    value={feedbackMessage}
                    onChange={(e) => setFeedbackMessage(e.target.value)}
                    rows={4}
                    maxLength={5000}
                    placeholder={i18n.language === 'zh-TW' ? '請輸入您的意見…' : 'Type your feedback...'}
                    className="w-full text-sm px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-y min-h-[96px]"
                  />
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-[0.625rem] text-slate-400">
                      {feedbackMessage.length}/5000
                    </span>
                    <button
                      onClick={submitFeedback}
                      disabled={!feedbackMessage.trim() || feedbackSubmitting}
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {feedbackSubmitting
                        ? (i18n.language === 'zh-TW' ? '送出中…' : 'Sending...')
                        : (i18n.language === 'zh-TW' ? '送出' : 'Submit')}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={() => {
                setShowFavoritesOnly(!showFavoritesOnly);
                setShowWatchlistOnly(false);
              }}
              aria-label={t('app.showFavorites', 'Show favorites')}
              className={`transition-colors flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 rounded-full hover:bg-slate-100/50 dark:hover:bg-slate-800/50 ${showFavoritesOnly ? 'bg-red-50 text-red-600 font-bold' : ''}`}
            >
              <Heart className={`w-4 h-4 sm:w-5 sm:h-5 ${showFavoritesOnly ? 'stroke-[2.5]' : 'stroke-[1.5]'}`} />
              {favorites.length > 0 && <span className="text-[0.625rem] sm:text-xs">{favorites.length}</span>}
            </button>
            <button 
              onClick={() => {
                setShowWatchlistOnly(!showWatchlistOnly);
                setShowFavoritesOnly(false);
              }} 
              aria-label={t('app.showWatchlist', 'Show watchlist')}
              className={`transition-colors flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 rounded-full hover:bg-slate-100/50 dark:hover:bg-slate-800/50 ${showWatchlistOnly ? 'bg-blue-50 text-blue-600 font-bold' : ''}`}
            >
              <Bell className={`w-4 h-4 sm:w-5 sm:h-5 ${showWatchlistOnly ? 'stroke-[2.5]' : 'stroke-[1.5]'}`} />
              {watchlist.length > 0 && <span className="text-[0.625rem] sm:text-xs">{watchlist.length}</span>}
            </button>
            <button 
              onClick={() => {
                const newLang = i18n.language === 'zh-TW' ? 'en' : 'zh-TW';
                i18n.changeLanguage(newLang);
                // Remember the manual choice so it survives a reload of the root path
                // (auto-detection only kicks in when no choice is stored).
                try { localStorage.setItem('tw-lang', newLang); } catch { /* ignore */ }

                // Update URL for SEO and sharing without hard reloading the SPA
              try {
                const currentSearch = window.location.search;
                const newPath = newLang === 'en' ? `/en/${currentSearch}` : `/${currentSearch}`;
                window.history.pushState({}, '', newPath);
              } catch (e) {
                // Ignore
              }
                
                showToast(t('app.toasts.langChanged', { lang: newLang === 'zh-TW' ? '中文' : 'English' }));
              }} 
              className="transition-colors flex items-center gap-1 bg-slate-100/50 hover:bg-slate-200/50 dark:bg-slate-800/50 dark:hover:bg-slate-700/50 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full"
            >
              <Globe className="w-4 h-4 sm:w-5 sm:h-5 stroke-[1.5]" />
              <span className="text-[0.625rem] sm:text-xs font-bold uppercase">{i18n.language === 'zh-TW' ? 'EN' : '中文'}</span>
            </button>

            {/* Settings Gear Button — visible on all sizes */}
            <div className="relative">
              <button
                ref={settingsButtonRef}
                type="button"
                onClick={() => setIsSettingsOpen(v => !v)}
                aria-label={i18n.language === 'zh-TW' ? '顯示設定' : 'Settings'}
                aria-expanded={isSettingsOpen}
                className={`flex items-center justify-center w-9 h-9 rounded-full transition-colors text-slate-600 dark:text-slate-300 ${isSettingsOpen ? 'bg-slate-100/70 dark:bg-slate-700/70' : 'hover:bg-slate-100/50 dark:hover:bg-slate-800/50'}`}
              >
                <Settings className="w-5 h-5" />
              </button>

              {isSettingsOpen && (
                <div
                  ref={settingsRef}
                  role="dialog"
                  aria-label={i18n.language === 'zh-TW' ? '顯示設定' : 'Display Settings'}
                  className="fixed sm:absolute right-4 sm:right-0 top-[calc(env(safe-area-inset-top)+4.25rem)] sm:top-full sm:mt-2 z-50 w-80 bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 p-6 animate-in fade-in slide-in-from-top-2 duration-200"
                >
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <Settings className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                      {i18n.language === 'zh-TW' ? '顯示設定' : 'Display Settings'}
                    </h3>
                    <button
                      onClick={() => setIsSettingsOpen(false)}
                      aria-label={i18n.language === 'zh-TW' ? '關閉' : 'Close'}
                      className="p-1.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600 hover:text-slate-900 dark:hover:text-white transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="space-y-6">
                    {/* Preferred Transport Setting */}
                    <div>
                      <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3">
                        {i18n.language === 'zh-TW' ? '首選交通工具' : 'Default Transport'}
                      </p>
                      <div className="flex items-center bg-slate-100 dark:bg-slate-700/50 rounded-xl p-1 shadow-inner">
                        <button onClick={() => handleSetPreferredTransport('train')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${preferredTransport === 'train' ? 'bg-white dark:bg-slate-600 shadow-sm text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>台鐵</button>
                        <button onClick={() => handleSetPreferredTransport('hsr')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${preferredTransport === 'hsr' ? 'bg-white dark:bg-slate-600 shadow-sm text-orange-600 dark:text-orange-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>高鐵</button>
                        <button onClick={() => handleSetPreferredTransport('metro')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${preferredTransport === 'metro' ? 'bg-white dark:bg-slate-600 shadow-sm text-cyan-600 dark:text-cyan-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>捷運</button>
                      </div>
                    </div>

                    {/* Dark/Light Mode Setting */}
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-slate-700 dark:text-slate-300">
                        {i18n.language === 'zh-TW' ? '深色模式' : 'Dark Mode'}
                      </span>
                      <AnimatedThemeToggler />
                    </div>

                    {/* Train alert notification permission is always initiated by this user action. */}
                    <div className="border-t border-slate-100 dark:border-slate-700 pt-5">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                            {i18n.language === 'zh-TW' ? '列車提醒通知' : 'Train Alert Notifications'}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                            {notificationPermission === 'granted'
                              ? (i18n.language === 'zh-TW' ? '已允許瀏覽器顯示提醒。' : 'Browser notifications are allowed.')
                              : notificationPermission === 'denied'
                                ? (i18n.language === 'zh-TW' ? '已被瀏覽器封鎖，請在網站設定中解除。' : 'Blocked by the browser. Update it in site settings.')
                                : notificationPermission === 'unsupported'
                                  ? (i18n.language === 'zh-TW' ? '此瀏覽器不支援系統通知。' : 'System notifications are not supported by this browser.')
                                  : (i18n.language === 'zh-TW' ? '啟用後可接收即將到站提醒。' : 'Enable to receive approaching-train alerts.')}
                          </p>
                        </div>
                        {notificationPermission === 'default' ? (
                          <button
                            type="button"
                            onClick={requestNotificationPermission}
                            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800"
                          >
                            <Bell className="h-3.5 w-3.5" />
                            {i18n.language === 'zh-TW' ? '開啟通知' : 'Enable'}
                          </button>
                        ) : notificationPermission === 'granted' ? (
                          <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" aria-label={i18n.language === 'zh-TW' ? '通知已開啟' : 'Notifications enabled'} />
                        ) : null}
                      </div>
                    </div>

                    {/* Text Size */}
                    <div>
                      <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3">
                        {i18n.language === 'zh-TW' ? '文字大小' : 'Text Size'}
                      </p>
                      <div className="flex items-center bg-slate-100 dark:bg-slate-700/50 rounded-xl p-1 shadow-inner">
                        {(['small', 'medium', 'large'] as const).map((size) => (
                          <button
                            key={size}
                            onClick={() => setTextSize(size)}
                            className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                              textSize === size 
                                ? (transportType === 'hsr' ? 'bg-white dark:bg-slate-600 shadow-sm text-orange-600 dark:text-orange-400' : 'bg-white dark:bg-slate-600 shadow-sm text-blue-600 dark:text-blue-400')
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                            }`}
                          >
                            {size === 'small' ? '小' : size === 'medium' ? '中' : '大'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {globalAlert && (
        <AnimatePresence mode="popLayout">
          {isAlertCollapsed ? (
            <motion.div
              key="collapsed-alert"
              layoutId="global-alert-card"
              transition={{ type: 'spring', stiffness: 350, damping: 22 }}
              className="fixed top-20 sm:top-24 right-4 md:right-8 z-40 mt-2"
            >
              <button
                type="button"
                onClick={() => setIsAlertCollapsed(false)}
                className={`flex items-center gap-2.5 px-4 py-2.5 rounded-full shadow-2xl border text-xs font-bold text-white transition-all cursor-pointer hover:scale-105 active:scale-95 group relative overflow-hidden backdrop-blur-xl bg-slate-950/45 ${
                  globalAlert.type === 'error'
                    ? 'border-red-500/30 shadow-[0_0_25px_rgba(239,68,68,0.25)]'
                    : globalAlert.type === 'warning'
                    ? 'border-amber-500/30 text-amber-200 shadow-[0_0_25px_rgba(245,158,11,0.2)]'
                    : 'border-emerald-500/30 shadow-[0_0_25px_rgba(16,185,129,0.25)]'
                }`}
              >
                <div className="absolute inset-0 overflow-hidden rounded-full pointer-events-none">
                  <motion.div 
                    animate={{ x: ['-100%', '200%'] }}
                    transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
                    className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/10 to-transparent skew-x-12"
                  />
                </div>

                <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-full">
                  <motion.div
                    animate={{
                      x: [0, 10, -10, 0],
                      y: [0, -5, 5, 0],
                    }}
                    transition={{
                      duration: 6,
                      repeat: Infinity,
                      ease: "easeInOut"
                    }}
                    className={`absolute -top-4 -left-4 w-12 h-12 rounded-full filter blur-[10px] opacity-30 mix-blend-screen ${
                      globalAlert.type === 'error' ? 'bg-red-500' : globalAlert.type === 'warning' ? 'bg-amber-400' : 'bg-emerald-500'
                    }`}
                  />
                </div>
                
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                </span>

                {globalAlert.type === 'error' ? (
                  <AlertTriangle className="w-4 h-4 text-white shrink-0 animate-bounce relative z-10" />
                ) : globalAlert.type === 'warning' ? (
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 animate-bounce relative z-10" />
                ) : (
                  <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 animate-bounce relative z-10" />
                )}

                <span className="max-w-0 overflow-hidden group-hover:max-w-xs transition-all duration-500 ease-out whitespace-nowrap opacity-0 group-hover:opacity-100 text-[10px] font-medium pl-0 group-hover:pl-1.5 relative z-10">
                  {globalAlert.message}
                </span>
              </button>
            </motion.div>
          ) : (
            <div className="fixed top-20 sm:top-24 left-0 w-full z-40 px-4 md:px-8 mt-2">
              <motion.div
                layoutId="global-alert-card"
                transition={{ type: 'spring', stiffness: 350, damping: 22 }}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (globalAlert.url) {
                    window.open(globalAlert.url, '_blank', 'noopener,noreferrer');
                  } else if (globalAlert.description && globalAlert.description !== globalAlert.message) {
                    showToast(globalAlert.description);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    if (globalAlert.url) window.open(globalAlert.url, '_blank', 'noopener,noreferrer');
                    else if (globalAlert.description && globalAlert.description !== globalAlert.message) showToast(globalAlert.description);
                  }
                }}
                aria-label={globalAlert.url ? '查閱事件詳情（開新分頁）' : '查閱事件詳情'}
                className={`max-w-5xl mx-auto relative overflow-hidden rounded-[2rem] p-5 flex items-center gap-4 group shadow-2xl border backdrop-blur-2xl bg-slate-950/45 ${
                  globalAlert.url || (globalAlert.description && globalAlert.description !== globalAlert.message)
                    ? 'cursor-pointer'
                    : 'cursor-default'
                } ${
                  globalAlert.type === 'error'
                    ? 'border-red-500/30 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15),0_0_50px_rgba(239,68,68,0.15)]'
                    : globalAlert.type === 'warning'
                    ? 'border-amber-500/30 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15),0_0_50px_rgba(245,158,11,0.15)]'
                    : 'border-emerald-500/30 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15),0_0_50px_rgba(16,185,129,0.15)]'
                }`}
              >
                <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-[2rem] z-0">
                  <motion.div
                    animate={{
                      x: [0, 40, -20, 0],
                      y: [0, -30, 20, 0],
                      scale: [1, 1.25, 0.85, 1],
                    }}
                    transition={{
                      duration: 12,
                      repeat: Infinity,
                      ease: "easeInOut"
                    }}
                    className={`absolute -top-12 -left-12 w-48 h-48 rounded-full filter blur-[50px] opacity-30 mix-blend-screen ${
                      globalAlert.type === 'error' ? 'bg-red-500' : globalAlert.type === 'warning' ? 'bg-amber-400' : 'bg-emerald-500'
                    }`}
                  />
                  <motion.div
                    animate={{
                      x: [0, -30, 30, 0],
                      y: [0, 20, -40, 0],
                      scale: [1, 0.85, 1.2, 1],
                    }}
                    transition={{
                      duration: 15,
                      repeat: Infinity,
                      ease: "easeInOut"
                    }}
                    className={`absolute -bottom-16 -right-16 w-56 h-56 rounded-full filter blur-[60px] opacity-25 mix-blend-screen ${
                      globalAlert.type === 'error' ? 'bg-rose-600' : globalAlert.type === 'warning' ? 'bg-orange-500' : 'bg-teal-500'
                    }`}
                  />
                  <div className="absolute inset-0 bg-gradient-to-tr from-white/5 via-transparent to-white/10 z-10" />
                </div>
                
                <div className="relative z-10 flex shrink-0 items-center justify-center w-12 h-12 bg-white/10 rounded-2xl border border-white/10 backdrop-blur-md">
                  {globalAlert.type === 'error' ? (
                    <AlertTriangle className="w-7 h-7 animate-pulse text-red-400" />
                  ) : globalAlert.type === 'warning' ? (
                    <AlertTriangle className="w-7 h-7 animate-pulse text-amber-400" />
                  ) : (
                    <CheckCircle className="w-7 h-7 animate-pulse text-emerald-400" />
                  )}
                </div>
                
                <div className="relative z-10 flex-1 font-bold text-lg leading-tight tracking-tight text-white">
                  <div>{globalAlert.message}</div>
                  {globalAlert.description && globalAlert.description !== globalAlert.message && (
                    <div className="text-xs mt-1 font-medium text-slate-300 opacity-85 leading-relaxed">
                      {globalAlert.description}
                    </div>
                  )}
                </div>
                
                <div className="relative z-10 flex shrink-0 items-center gap-3">
                  {(globalAlert.url || (globalAlert.description && globalAlert.description !== globalAlert.message)) && (
                    <div className="flex items-center gap-1 text-sm font-black uppercase tracking-widest text-white/80 hover:text-white transition-colors">
                      {globalAlert.url
                        ? (i18n.language === 'zh-TW' ? '查閱詳情' : 'Details')
                        : (globalAlert.description && globalAlert.description !== globalAlert.message
                            ? (i18n.language === 'zh-TW' ? '顯示說明' : 'More Info')
                            : null
                          )
                      }
                      <Search className="w-4 h-4 ml-1 transition-transform group-hover:translate-x-1" />
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsAlertCollapsed(true);
                    }}
                    className="p-2 rounded-xl bg-white/10 hover:bg-white/20 active:scale-90 transition-all border border-white/10 cursor-pointer text-white"
                    title={i18n.language === 'zh-TW' ? '收起公告' : 'Collapse alert'}
                  >
                    <X className="w-4 h-4 font-black" />
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      )}

      {/* Hero Section */}
      <section className={`relative px-0 sm:px-4 md:px-8 flex flex-col items-center justify-center transition-all duration-[700ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
        isSearchCollapsed
          ? 'pt-24 sm:pt-28 pb-4 sm:pb-6 min-h-0'
          : mainTab === 'plan'
            ? 'pt-20 sm:pt-28 pb-6 sm:pb-8 min-h-0'
            : isMetroResultsActive
            ? 'pt-20 sm:pt-28 pb-6 sm:pb-8 min-h-0'
            : 'pt-20 sm:pt-40 pb-6 sm:pb-32 min-h-[75vh] sm:min-h-[85vh]'
      }`}>
        {/* Background Image with Soft Blur */}
        <div className={`absolute top-0 left-0 w-full z-0 overflow-hidden transition-[height] duration-[700ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isSearchCollapsed
            ? 'h-[220px] sm:h-[260px]'
            : mainTab === 'plan'
              ? 'h-full'
              : 'h-[75vh] sm:h-[85vh]'
        }`}>
          <div className="absolute inset-0 w-full h-[120%] -top-[10%]">
            <img
              src="https://images.unsplash.com/photo-1474487056207-5d7d762f234b?auto=format&fit=crop&q=80&w=2000"
              alt=""
              aria-hidden="true"
              className={`w-full h-full object-cover object-center blur-[12px] transition-all duration-[1200ms] ease-out ${
                mainTab === 'plan' ? 'brightness-110 saturate-[0.55]' : 'brightness-[0.9] dark:brightness-[0.4]'
              } ${
                isSearchCollapsed ? 'scale-[1.18]' : 'scale-110'
              }`}
              style={{ transform: `translateY(${scrollY * 0.4}px) ${isSearchCollapsed ? 'scale(1.18)' : 'scale(1.1)'}` }}
              referrerPolicy="no-referrer"
            />
          </div>
          {/* Gradient fade to tinted bottom. 規劃 uses a fixed light emerald wash
              (independent of OS dark) so the plan tab reads as a bright, airy
              "light island" with the dark planner card floating on top. */}
          <div className={`absolute inset-0 bg-gradient-to-b transition-colors duration-700 ${
            mainTab === 'plan'
              ? 'from-emerald-50/70 via-emerald-50/90 to-emerald-50 dark:from-emerald-50/70 dark:via-emerald-50/90 dark:to-emerald-50'
              : 'from-transparent'
          } ${
            mainTab === 'plan'
              ? ''
              : transportType === 'hsr'
              ? 'via-orange-50/40 to-orange-50/50 dark:via-[#1a1205]/40 dark:to-[#1a1205]'
              : 'via-blue-50/40 to-blue-50/50 dark:via-[#050f1a]/40 dark:to-[#050f1a]'
          }`}></div>
        </div>

        {/* Compact Summary Bar – shown when search is collapsed (rail tabs only) */}
        {isRailTab && isSearchCollapsed && (
          <div
            onClick={() => setIsSearchCollapsed(false)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsSearchCollapsed(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            className={`mx-4 sm:mx-0 relative z-10 w-[calc(100%-2rem)] sm:w-full max-w-5xl cursor-pointer group animate-in fade-in slide-in-from-top-6 duration-500 bg-white/90 dark:bg-slate-900/70 backdrop-blur-2xl rounded-full border border-white/60 dark:border-white/10 flex items-center gap-2 sm:gap-4 md:gap-6 p-2 sm:p-3 pr-2 sm:pr-4 md:pr-5 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.25)] hover:shadow-[0_24px_60px_-20px_rgba(0,0,0,0.35)] hover:-translate-y-[2px] transition-all`}
          >
            <div className={`flex items-center gap-1 sm:gap-2 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-[0.625rem] sm:text-[0.6875rem] md:text-xs font-black uppercase tracking-widest text-white shrink-0 ${
              transportType === 'hsr' ? 'bg-orange-600' : 'bg-blue-600'
            }`}>
              <Train className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">{transportType === 'hsr' ? t('app.hsr') : t('app.tra')}</span>
            </div>

            <div className="flex-1 min-w-0 flex items-center gap-1 sm:gap-2 md:gap-4 text-slate-800 dark:text-slate-100">
              <MapPin className="w-4 h-4 text-slate-400 shrink-0 hidden sm:block" />
              <span className="truncate text-sm sm:text-base md:text-lg font-bold tracking-tight">
                {i18n.language === 'zh-TW'
                  ? (stations.find(s => s.StationID === originStationId)?.StationName?.Zh_tw || '...')
                  : (stations.find(s => s.StationID === originStationId)?.StationName?.En || '...')}
              </span>
              <span className="text-slate-400 font-black shrink-0 px-1 text-xs sm:text-sm sm:text-base">➔</span>
              <span className="truncate text-sm sm:text-base md:text-lg font-bold tracking-tight">
                {i18n.language === 'zh-TW'
                  ? (stations.find(s => s.StationID === destStationId)?.StationName?.Zh_tw || '...')
                  : (stations.find(s => s.StationID === destStationId)?.StationName?.En || '...')}
              </span>
              <span className="hidden md:inline-block text-slate-300">•</span>
              <span className="hidden md:flex items-center gap-1.5 text-sm font-semibold text-slate-500 shrink-0">
                <Calendar className="w-4 h-4" />
                {(dates.find(d => d.id === selectedDate)?.label || '') + ' ' + (dates.find(d => d.id === selectedDate)?.date || '')}
              </span>
            </div>

            <button
              onClick={(e) => { e.stopPropagation(); setIsSearchCollapsed(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              className={`shrink-0 inline-flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 sm:px-4 md:px-5 sm:py-2.5 rounded-full text-xs sm:text-sm font-bold transition-all group-hover:scale-[1.02] ${
                transportType === 'hsr'
                  ? 'bg-orange-50 text-orange-700 hover:bg-orange-100 border border-orange-100'
                  : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-100'
              }`}
            >
              <Pencil className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">{t('app.editSearch')}</span>
            </button>
          </div>
        )}

        {/* Compact reopen bar — metro & plan tabs when search is collapsed */}
        {(mainTab === 'metro' || mainTab === 'plan') && isSearchCollapsed && (
          <div
            onClick={() => { setIsSearchCollapsed(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setIsSearchCollapsed(false); window.scrollTo({ top: 0, behavior: 'smooth' }); } }}
            className="mx-4 sm:mx-0 relative z-10 w-[calc(100%-2rem)] sm:w-full max-w-5xl cursor-pointer group animate-in fade-in slide-in-from-top-6 duration-500 bg-white/90 dark:bg-slate-900/70 backdrop-blur-2xl rounded-full border border-white/60 dark:border-white/10 flex items-center gap-2 sm:gap-4 p-2 sm:p-3 pr-2 sm:pr-4 md:pr-5 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.25)] hover:shadow-[0_24px_60px_-20px_rgba(0,0,0,0.35)] hover:-translate-y-[2px] transition-all"
          >
            <div className={`flex items-center gap-1 sm:gap-2 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-[0.625rem] sm:text-[0.6875rem] md:text-xs font-black uppercase tracking-widest text-white shrink-0 ${
              mainTab === 'metro' ? 'bg-cyan-600' : 'bg-emerald-600'
            }`}>
              {mainTab === 'metro' ? <TramFront className="w-3 h-3 sm:w-4 sm:h-4" /> : <Compass className="w-3 h-3 sm:w-4 sm:h-4" />}
              <span className="hidden sm:inline">{mainTab === 'metro' ? (i18n.language === 'zh-TW' ? '捷運' : 'Metro') : (i18n.language === 'zh-TW' ? '規劃' : 'Plan')}</span>
            </div>

            <span className="flex-1 min-w-0 truncate text-sm sm:text-base md:text-lg font-bold tracking-tight text-slate-800 dark:text-slate-100">
              {i18n.language === 'zh-TW' ? '查詢結果' : 'Results'}
            </span>

            <button
              onClick={(e) => { e.stopPropagation(); setIsSearchCollapsed(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              className={`shrink-0 inline-flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 sm:px-4 md:px-5 sm:py-2.5 rounded-full text-xs sm:text-sm font-bold transition-all group-hover:scale-[1.02] ${
                mainTab === 'metro'
                  ? 'bg-cyan-50 text-cyan-700 hover:bg-cyan-100 border border-cyan-100 dark:bg-cyan-500/10 dark:text-cyan-300 dark:border-cyan-500/20'
                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20'
              }`}
            >
              <Pencil className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">{t('app.editSearch')}</span>
            </button>
          </div>
        )}

        {/* Search Card - Floating, Soft Shadow, White, Rounded */}
        <div className={`relative z-10 w-full max-w-5xl bg-white/95 dark:bg-slate-900/85 backdrop-blur-xl sm:rounded-[2.5rem] md:rounded-[2.5rem] rounded-t-[2.5rem] sm:border border-white/60 dark:border-white/10 border-t transition-all duration-[700ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isSearchCollapsed
            ? 'max-h-0 opacity-0 p-0 overflow-hidden pointer-events-none translate-y-[-8px]'
            : 'max-h-[2400px] opacity-100 p-5 sm:p-12 md:p-14 overflow-hidden translate-y-0'
        } ${
          transportType === 'hsr' ? 'shadow-[0_-15px_40px_-15px_rgba(234,88,12,0.15)] sm:shadow-[0_20px_60px_-15px_rgba(234,88,12,0.1)]' : 'shadow-[0_-15px_40px_-15px_rgba(37,99,235,0.15)] sm:shadow-[0_20px_60px_-15px_rgba(37,99,235,0.1)]'
        }`}>
          
          {/* Top Controls: Transport Type & Trip Type */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6 mb-6 sm:mb-12">
            {/* Transport Type Toggle */}
            <div className={`flex p-1.5 rounded-full w-fit transition-all duration-700 border shadow-sm ${
              mainTab === 'plan'
                ? 'bg-emerald-50 dark:bg-slate-800 border-emerald-100 dark:border-slate-700 shadow-emerald-100/50'
                : mainTab === 'metro'
                  ? 'bg-cyan-50 dark:bg-slate-800 border-cyan-100 dark:border-slate-700 shadow-cyan-100/50'
                  : transportType === 'hsr'
                    ? 'bg-orange-50 dark:bg-slate-800 border-orange-100 dark:border-slate-700 shadow-orange-100/50'
                    : 'bg-blue-50 dark:bg-slate-800 border-blue-100 dark:border-slate-700 shadow-blue-100/50'
            }`}>
              <button
                onClick={() => {
                  setMainTab('train');
                  setTransportType('train');
                  setOriginStationId('');
                  setDestStationId('');
                  setExpandedTrainId(null);
                  setTrainStops({});
                  setTimetables([]);
                  setReturnTimetables([]);
                  setHasSearched(false);
                  setIsSearchCollapsed(false);
                }}
                className={`px-3 sm:px-6 py-2.5 sm:py-3 rounded-full text-sm font-bold transition-all duration-300 flex items-center gap-1.5 ${
                  mainTab === 'train'
                    ? 'bg-white text-blue-600 shadow-[0_4px_15px_rgba(37,99,235,0.12)] scale-105'
                    : 'text-slate-500 dark:text-slate-300 hover:text-slate-700 dark:hover:text-white'
                }`}
              >
                {mainTab === 'train' && <Train className="w-3.5 h-3.5 stroke-[2.5]" />}
                {t('app.tra')}
              </button>
              <button
                onClick={() => {
                  setMainTab('hsr');
                  setTransportType('hsr');
                  setOriginStationId('');
                  setDestStationId('');
                  setExpandedTrainId(null);
                  setTrainStops({});
                  setTimetables([]);
                  setReturnTimetables([]);
                  setHasSearched(false);
                  setIsSearchCollapsed(false);
                }}
                className={`px-3 sm:px-6 py-2.5 sm:py-3 rounded-full text-sm font-bold transition-all duration-300 flex items-center gap-1.5 ${
                  mainTab === 'hsr'
                    ? 'bg-white text-orange-600 shadow-[0_4px_15px_rgba(234,88,12,0.12)] scale-105'
                    : 'text-slate-500 dark:text-slate-300 hover:text-slate-700 dark:hover:text-white'
                }`}
              >
                {mainTab === 'hsr' && <Zap className="w-3.5 h-3.5 stroke-[2.5]" />}
                {t('app.hsr')}
              </button>
                <button
                  onClick={() => { setMainTab('metro'); setIsSearchCollapsed(false); }}
                  className={`px-3 sm:px-6 py-2.5 sm:py-3 rounded-full text-sm font-bold transition-all duration-300 flex items-center gap-1.5 ${
                    mainTab === 'metro'
                      ? 'bg-white text-cyan-600 shadow-[0_4px_15px_rgba(8,145,178,0.12)] scale-105'
                      : 'text-slate-500 dark:text-slate-300 hover:text-slate-700 dark:hover:text-white'
                  }`}
                >
                  {mainTab === 'metro' && <TramFront className="w-3.5 h-3.5 stroke-[2.5]" />}
                  {i18n.language === 'zh-TW' ? '捷運' : 'Metro'}
                </button>
              <button
                onClick={() => { setMainTab('plan'); setIsSearchCollapsed(false); }}
                className={`px-3 sm:px-6 py-2.5 sm:py-3 rounded-full text-sm font-bold transition-all duration-300 flex items-center gap-1.5 ${
                  mainTab === 'plan'
                    ? 'bg-white text-emerald-600 shadow-[0_4px_15px_rgba(16,185,129,0.12)] scale-105'
                    : 'text-slate-500 dark:text-slate-300 hover:text-slate-700 dark:hover:text-white'
                }`}
              >
                {mainTab === 'plan' && <Compass className="w-3.5 h-3.5 stroke-[2.5]" />}
                {i18n.language === 'zh-TW' ? '規劃' : 'Plan'}
              </button>
            </div>

            {/* Trip Type — rail tabs only */}
            {isRailTab && (
            <div className="flex items-center gap-6 sm:gap-8 text-sm font-medium text-slate-500 dark:text-slate-300">
              <label className="flex items-center gap-3 cursor-pointer group">
                <input type="radio" name="tripType" className="peer sr-only" checked={tripType === 'one-way'} onChange={() => setTripType('one-way')} />
                <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-slate-500 dark:peer-focus-visible:ring-offset-slate-900 ${tripType === 'one-way' ? 'border-slate-800 dark:border-slate-100' : 'border-slate-300 group-hover:border-slate-400'}`}>
                  {tripType === 'one-way' && <div className="w-2 h-2 bg-slate-800 dark:bg-slate-100 rounded-full" />}
                </div>
                <span className={`transition-colors ${tripType === 'one-way' ? 'text-slate-800 dark:text-slate-100' : 'group-hover:text-slate-600 dark:group-hover:text-white'}`}>{t('app.oneWay')}</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer group">
                <input type="radio" name="tripType" className="peer sr-only" checked={tripType === 'round-trip'} onChange={() => { setTripType('round-trip'); }} />
                <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-slate-500 dark:peer-focus-visible:ring-offset-slate-900 ${tripType === 'round-trip' ? 'border-slate-800 dark:border-slate-100' : 'border-slate-300 group-hover:border-slate-400'}`}>
                  {tripType === 'round-trip' && <div className="w-2 h-2 bg-slate-800 dark:bg-slate-100 rounded-full" />}
                </div>
                <span className={`transition-colors ${tripType === 'round-trip' ? 'text-slate-800 dark:text-slate-100' : 'group-hover:text-slate-600 dark:group-hover:text-white'}`}>{t('app.roundTrip')}</span>
              </label>
            </div>
            )}
          </div>

          {/* 規劃 tab: trip planner renders inline in place of the timetable form */}
          {mainTab === 'plan' && (
            <React.Suspense fallback={<div className="py-12 text-center text-sm text-slate-500">{i18n.language === 'zh-TW' ? '載入行程規劃…' : 'Loading journey planner…'}</div>}>
              <JourneyPlanner inline isOpen onClose={() => {}} onSearch={() => setIsSearchCollapsed(true)} />
            </React.Suspense>
          )}

          {/* 捷運 tab: metro search renders inline (self-contained, TRA-style) */}
          {mainTab === 'metro' && (
            <React.Suspense fallback={<div className="py-12 text-center text-sm text-slate-500">{i18n.language === 'zh-TW' ? '載入捷運查詢…' : 'Loading metro search…'}</div>}>
              <MetroSearch language={i18n.language} geoCoords={geoCoords} onResultsActiveChange={setMetroResultsActive} onSearch={() => setIsSearchCollapsed(true)} />
            </React.Suspense>
          )}

          {isRailTab && (<>
          {/* Station Selector & Swap */}
          <div className={`relative z-50 flex flex-row items-center justify-between mt-4 sm:mt-6 mb-6 sm:mb-8 backdrop-blur-xl border border-white/40 dark:border-white/10 rounded-[2.5rem] p-3 sm:p-6 transition-all duration-700 ${
            transportType === 'hsr' ? 'bg-orange-50/60 dark:bg-orange-900/20 shadow-[inset_0_2px_20px_rgba(254,215,170,0.25),0_8px_32px_-8px_rgba(234,88,12,0.08)]' : 'bg-blue-50/60 dark:bg-blue-900/20 shadow-[inset_0_2px_20px_rgba(191,219,254,0.25),0_8px_32px_-8px_rgba(37,99,235,0.08)]'
          }`}>
            {/* Origin */}
            <div className="flex-1 min-w-0 text-center relative w-1/2 pr-5 sm:pr-6">
              <div className={`text-[0.625rem] sm:text-xs font-semibold uppercase tracking-widest mb-1 sm:mb-2 transition-colors flex items-center justify-center gap-1 ${transportType === 'hsr' ? 'text-orange-500/70' : 'text-blue-500/70'}`}>
                <MapPin className="w-3 h-3" />
                {t('app.origin')}
              </div>
              <button
                onClick={() => { setIsOriginDropdownOpen(!isOriginDropdownOpen); setIsDestDropdownOpen(false); }}
                className={`text-2xl sm:text-4xl font-black tracking-tighter truncate w-full transition-all group ${
                  !originStationId
                    ? (transportType === 'hsr' ? 'text-orange-300 dark:text-orange-700' : 'text-blue-300 dark:text-blue-700')
                    : (transportType === 'hsr' ? 'text-orange-600 dark:text-orange-400' : 'text-blue-600 dark:text-blue-400')
                }`}
              >
                {!originStationId ? (
                  <span className="flex items-center justify-center gap-2">
                    <span>{i18n.language === 'zh-TW' ? '選擇車站' : 'Select'}</span>
                    <ChevronDown className="w-5 h-5 sm:w-7 sm:h-7 opacity-50" />
                  </span>
                ) : (
                  i18n.language === 'zh-TW'
                    ? (stations.find(s => s.StationID === originStationId)?.StationName?.Zh_tw || '…')
                    : (stations.find(s => s.StationID === originStationId)?.StationName?.En || '…')
                )}
              </button>
              {originStationId && (
                <div className="font-medium mt-1.5 text-sm sm:text-base transition-colors text-slate-500 dark:text-slate-400">
                  {i18n.language === 'zh-TW'
                    ? (stations.find(s => s.StationID === originStationId)?.StationName?.En || '')
                    : (stations.find(s => s.StationID === originStationId)?.StationName?.Zh_tw || '')}
                </div>
              )}
            </div>

            {/* Swap Button */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
              <motion.button
                onClick={() => {
                  userPickedOriginRef.current = true;
                  const temp = originStationId;
                  setOriginStationId(destStationId);
                  setDestStationId(temp);
                  setSwapRotation(prev => prev + 180);
                }}
                animate={{ rotate: swapRotation }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                aria-label={t('app.swapStations', 'Swap stations')}
                className={`size-10 sm:size-14 bg-white rounded-full shadow-lg flex items-center justify-center hover:scale-110 active:scale-95 transition-all border border-slate-100 hover:shadow-xl ${transportType === 'hsr' ? 'text-orange-600 hover:text-orange-700 hover:border-orange-100' : 'text-blue-600 hover:text-blue-700 hover:border-blue-100'}`}
              >
                <ArrowRightLeft className="size-5 sm:size-6 stroke-[2.5]" />
              </motion.button>
            </div>

            {/* Destination */}
            <div className="flex-1 min-w-0 text-center relative w-1/2 pl-5 sm:pl-6">
              <div className={`text-[0.625rem] sm:text-xs font-semibold uppercase tracking-widest mb-1 sm:mb-2 transition-colors flex items-center justify-center gap-1 ${transportType === 'hsr' ? 'text-orange-500/70' : 'text-blue-500/70'}`}>
                <MapPin className="w-3 h-3" />
                {t('app.destination')}
              </div>
              <button
                onClick={() => { setIsDestDropdownOpen(!isDestDropdownOpen); setIsOriginDropdownOpen(false); }}
                className={`text-2xl sm:text-4xl font-black tracking-tighter truncate w-full transition-all ${
                  !destStationId
                    ? (transportType === 'hsr' ? 'text-orange-300 dark:text-orange-700' : 'text-blue-300 dark:text-blue-700')
                    : (transportType === 'hsr' ? 'text-orange-600 dark:text-orange-400' : 'text-blue-600 dark:text-blue-400')
                }`}
              >
                {!destStationId ? (
                  <span className="flex items-center justify-center gap-2">
                    <span>{i18n.language === 'zh-TW' ? '選擇車站' : 'Select'}</span>
                    <ChevronDown className="w-5 h-5 sm:w-7 sm:h-7 opacity-50" />
                  </span>
                ) : (
                  i18n.language === 'zh-TW'
                    ? (stations.find(s => s.StationID === destStationId)?.StationName?.Zh_tw || '…')
                    : (stations.find(s => s.StationID === destStationId)?.StationName?.En || '…')
                )}
              </button>
              {destStationId && (
                <div className="font-medium mt-1.5 text-sm sm:text-base transition-colors text-slate-500 dark:text-slate-400">
                  {i18n.language === 'zh-TW'
                    ? (stations.find(s => s.StationID === destStationId)?.StationName?.En || '')
                    : (stations.find(s => s.StationID === destStationId)?.StationName?.Zh_tw || '')}
                </div>
              )}
            </div>
          </div>

          {/* Horizontal Date Scroller */}
          <div className={`mb-8 sm:mb-12 grid grid-cols-1 gap-8 sm:gap-12 ${tripType === 'round-trip' ? 'lg:grid-cols-2 lg:gap-20' : ''}`}>
            <div className="min-w-0 relative">
              <div className="text-sm font-semibold text-slate-500 dark:text-slate-300 uppercase tracking-widest mb-4 sm:mb-6 px-1 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  {tripType === 'round-trip'
                    ? t('app.outbound')
                    : (i18n.language === 'zh-TW' ? '出發日期' : 'Departure Date')}
                </span>
                <span className="text-[0.625rem] text-slate-400 dark:text-slate-500 font-mono hidden sm:block">SCROLL →</span>
              </div>
              {/* #10 — right-edge fade hints horizontal scroll on mobile (SCROLL → label is desktop-only) */}
              <div className="relative">
              <div className="pointer-events-none absolute right-0 top-0 bottom-3 w-10 bg-gradient-to-l from-white dark:from-slate-900 to-transparent sm:hidden z-10"></div>
              <div className="flex overflow-x-auto gap-3 sm:gap-4 pb-3 sm:pb-6 px-1 soft-scrollbar scroll-smooth">
                {dates.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setSelectedDate(d.id)}
                    className={`flex flex-col items-center justify-center min-w-[82px] sm:min-w-[100px] py-3 sm:py-4 px-4 sm:px-6 rounded-3xl transition-all duration-300 border ${
                      selectedDate === d.id
                        ? transportType === 'hsr'
                          ? 'bg-orange-600 border-orange-600 text-white shadow-[0_12px_25px_rgba(234,88,12,0.25)] scale-105 z-10'
                          : 'bg-blue-600 border-blue-600 text-white shadow-[0_12px_25px_rgba(37,99,235,0.25)] scale-105 z-10'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-slate-300 shadow-sm'
                    }`}
                  >
                    <span className={`text-[0.6875rem] font-black mb-1.5 uppercase tracking-tighter ${selectedDate === d.id ? 'text-white/90' : 'text-slate-600 dark:text-slate-300'}`}>
                      {d.label}
                    </span>
                    <span className={`text-xl font-black ${selectedDate === d.id ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
                      {d.date}
                    </span>
                  </button>
                ))}
              </div>
              </div>
            </div>

            {tripType === 'round-trip' && (
              <div className="min-w-0 relative pt-8 lg:pt-0 lg:border-l lg:border-slate-200 dark:lg:border-slate-700 lg:pl-16">
                <div className="text-sm font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest mb-4 sm:mb-6 px-1 flex items-center justify-between">
                  <span>{t('app.return')}</span>
                  <span className="text-[0.625rem] text-slate-400 dark:text-slate-500 font-mono hidden sm:block">SCROLL →</span>
                </div>
                <div className="relative">
                <div className="pointer-events-none absolute right-0 top-0 bottom-3 w-10 bg-gradient-to-l from-white dark:from-slate-900 to-transparent sm:hidden z-10"></div>
                <div className="flex overflow-x-auto gap-3 sm:gap-4 pb-3 sm:pb-6 px-1 soft-scrollbar scroll-smooth">
                  {dates.map((d) => {
                    const outboundIdx = dates.findIndex(dt => dt.id === selectedDate);
                    const returnIdx = dates.findIndex(dt => dt.id === d.id);
                    const isDisabled = returnIdx < outboundIdx;
                    return (
                      <button
                        key={d.id}
                        disabled={isDisabled}
                        onClick={() => setReturnDate(d.id)}
                        className={`flex flex-col items-center justify-center min-w-[100px] sm:min-w-[110px] py-4 px-6 rounded-3xl transition-all duration-300 border ${
                          isDisabled ? 'opacity-20 cursor-not-allowed grayscale scale-95' : ''
                        } ${
                          returnDate === d.id
                            ? transportType === 'hsr'
                              ? 'bg-orange-600 border-orange-600 text-white shadow-[0_12px_25px_rgba(234,88,12,0.25)] scale-105 z-10'
                              : 'bg-blue-600 border-blue-600 text-white shadow-[0_12px_25px_rgba(37,99,235,0.25)] scale-105 z-10'
                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-slate-300 shadow-sm'
                        }`}
                      >
                        <span className={`text-[0.6875rem] font-black mb-1.5 uppercase tracking-tighter ${returnDate === d.id ? 'text-white/90' : 'text-slate-600 dark:text-slate-300'}`}>
                          {d.label}
                        </span>
                        <span className={`text-xl font-black ${returnDate === d.id ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
                          {d.date}
                        </span>
                      </button>
                    );
                  })}
                </div>
                </div>
              </div>
            )}
          </div>

          {/* High Contrast Search Button */}
          <button
            onClick={() => {
              // 1. 防呆檢查
              if (originStationId === destStationId) {
                showToast(i18n.language === 'zh-TW' ? '起點與終點不可相同' : 'Origin and Destination cannot be the same');
                return;
              }

              // 2. Shared rail start (throttle + parallel timetable/extras)
              attemptRailSearch('manual');
            }}
            disabled={!originStationId || !destStationId || queryThrottled || isLoading}
            className={`group relative overflow-hidden w-full text-white py-4 sm:py-6 rounded-full text-base sm:text-xl font-black flex flex-col items-center justify-center gap-0.5 transition-all duration-500 hover:-translate-y-1.5 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 ${
              transportType === 'hsr'
                ? 'bg-gradient-to-r from-orange-600 to-orange-500 shadow-[0_8px_25px_-8px_rgba(234,88,12,0.6)] hover:shadow-[0_20px_45px_-5px_rgba(234,88,12,0.75)] hover:from-orange-500 hover:to-orange-400'
                : 'bg-gradient-to-r from-blue-600 to-blue-500 shadow-[0_8px_25px_-8px_rgba(37,99,235,0.6)] hover:shadow-[0_20px_45px_-5px_rgba(37,99,235,0.75)] hover:from-blue-500 hover:to-blue-400'
            }`}
          >
            {/* Shimmer Effect */}
            <div className="absolute inset-0 -translate-x-full group-hover:animate-shimmer bg-gradient-to-r from-transparent via-white/30 to-transparent z-20 pointer-events-none"></div>

            <span className="z-10 relative flex items-center gap-3">
              <Search className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.5]" />
              <span>{t('app.search')}</span>
            </span>
            {originStationId && destStationId && (
              <span className="z-10 relative text-[0.625rem] sm:text-xs font-semibold opacity-70 tracking-wide">
                {i18n.language === 'zh-TW'
                  ? `查詢 ${stations.find(s => s.StationID === originStationId)?.StationName?.Zh_tw || ''} → ${stations.find(s => s.StationID === destStationId)?.StationName?.Zh_tw || ''}`
                  : `${stations.find(s => s.StationID === originStationId)?.StationName?.En || ''} → ${stations.find(s => s.StationID === destStationId)?.StationName?.En || ''}`}
              </span>
            )}
          </button>
          </>)}

        </div>
      </section>

      {/* Recent searches — click to re-run a previous query */}
      {isRailTab && !isSearchCollapsed && (
        <RecentSearches
          entries={recentSearches}
          language={i18n.language}
          onSelect={handleSelectRecentSearch}
          onRemove={handleRemoveRecentSearch}
          onClearAll={handleClearRecentSearches}
        />
      )}

      {/* Metro results portal mount — MetroSearch renders its results here so they
          sit in the same position as the rail #results-section. */}
      {mainTab === 'metro' && <div id="metro-results-mount" />}

      {/* Plan results mount below the search panel, aligned with other result lists.
          Light emerald wash (fixed, OS-independent) continues the plan tab's light
          island, fading back into the page below. */}
      {mainTab === 'plan' && <div id="plan-results-mount" className="bg-gradient-to-b from-emerald-50 via-emerald-50 to-transparent" />}

      {/* Search Results Section — rail tabs only (metro & plan render into mounts above) */}
      {isRailTab && (
      <section id="results-section" className="max-w-5xl mx-auto px-0 md:px-8 pb-32 -mt-8 relative z-20 scroll-mt-24">

        {/* Quick Filters – sticky on scroll */}
        <div className="sticky top-[64px] sm:top-[72px] z-30 pt-4 pb-2 px-4 md:px-0 bg-transparent border-transparent pointer-events-none">
          {/* Use pointer-events-none for the wrapper to let clicks pass through transparent area, and re-enable pointer-events-auto for children */}
          <div className="flex overflow-x-auto gap-3 pb-1 soft-scrollbar pointer-events-auto">
            {[
              { id: 'time', label: t('app.filters.time') },
              { id: 'cheapest', label: t('app.filters.cheapest') },
              { id: 'reserved', label: t('app.filters.reserved') },
              { id: 'accessible', label: i18n.language === 'zh-TW' ? '無障礙' : 'Accessible' },
            ].map(f => (
              <button
                key={f.id}
                onClick={() => {
                  if (f.id === 'time') {
                    if (activeFilter === 'time') {
                      setTimeSortDirection(direction => direction === 'asc' ? 'desc' : 'asc');
                    } else {
                      setActiveFilter('time');
                      setTimeSortDirection('asc');
                    }
                  } else {
                    setActiveFilter(activeFilter === f.id ? 'time' : f.id);
                  }
                }}
                className={`whitespace-nowrap px-4 py-2 sm:px-6 sm:py-2.5 rounded-full text-xs sm:text-sm font-medium transition-all border ${
                  activeFilter === f.id
                    ? transportType === 'hsr'
                      ? 'bg-orange-600 border-orange-600 text-white shadow-[0_4px_14px_rgba(234,88,12,0.3)]'
                      : 'bg-blue-600 border-blue-600 text-white shadow-[0_4px_14px_rgba(37,99,235,0.3)]'
                    : 'bg-white/95 dark:bg-slate-800/90 backdrop-blur-md border-slate-300 dark:border-slate-600 text-slate-900 dark:text-slate-100 hover:bg-white dark:hover:bg-slate-700 hover:border-slate-400 shadow-md transition-all active:scale-95'
                }`}
              >
                {f.id === 'time' ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span>{f.label}</span>
                    {timeSortDirection === 'asc' ? (
                      <ArrowUp className="size-3.5" aria-hidden="true" />
                    ) : (
                      <ArrowDown className="size-3.5" aria-hidden="true" />
                    )}
                  </span>
                ) : f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Selector for Round Trip */}
        {tripType === 'round-trip' && (
          <div className="flex mb-8 mt-4 mx-4 md:mx-0 bg-slate-200/50 p-1.5 rounded-2xl w-fit backdrop-blur-sm border border-white/20">
            <button 
              onClick={() => setActiveTab('outbound')}
              className={`px-8 py-3 rounded-xl text-sm font-black transition-all ${activeTab === 'outbound' ? 'bg-white text-slate-950 shadow-md transform scale-105' : 'text-slate-700 hover:text-slate-950'}`}
            >
              {t('app.outbound')}
            </button>
            <button 
              onClick={() => setActiveTab('return')}
              className={`px-8 py-3 rounded-xl text-sm font-black transition-all ${activeTab === 'return' ? 'bg-blue-600 text-white shadow-md transform scale-105' : 'text-slate-700 hover:text-slate-950'}`}
            >
              {t('app.return')}
            </button>
          </div>
        )}

        {/* Results List Container */}
        <div className="bg-[#F8F9FA]/30 md:bg-transparent rounded-none md:rounded-3xl min-h-[400px]">
          {!hasSearched ? (
              <div className="flex flex-col items-center justify-center py-24 sm:py-32 px-6 text-center animate-in fade-in duration-700">
                <div className={`relative w-24 h-24 rounded-3xl flex items-center justify-center mb-6 shadow-2xl ${transportType === 'hsr' ? 'bg-gradient-to-br from-orange-100 to-orange-50 text-orange-500' : 'bg-gradient-to-br from-blue-100 to-blue-50 text-blue-500'}`}>
                  <Train className="w-12 h-12" />
                  <div className={`absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full flex items-center justify-center text-white text-[0.5rem] font-black ${transportType === 'hsr' ? 'bg-orange-500' : 'bg-blue-500'}`}>GO</div>
                </div>
                <h3 className="text-balance text-2xl sm:text-3xl font-black text-slate-900 dark:text-white mb-3 tracking-tight">
                  {i18n.language === 'zh-TW' ? '準備好出發了嗎？' : 'Ready to go?'}
                </h3>
                <p className="text-slate-500 dark:text-slate-400 max-w-xs sm:max-w-sm font-medium leading-relaxed text-sm sm:text-base">
                  {i18n.language === 'zh-TW'
                    ? '選擇起訖站與日期，點擊「搜尋班次」即可查詢最新時刻表與票價。'
                    : 'Pick your stations and departure date, then tap Search to find the latest schedules.'}
                </p>
                {(!originStationId || !destStationId) && (
                  <div className={`mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold border ${
                    transportType === 'hsr'
                      ? 'bg-orange-50 text-orange-600 border-orange-200'
                      : 'bg-blue-50 text-blue-600 border-blue-200'
                  }`}>
                    <span>↑</span>
                    {i18n.language === 'zh-TW' ? '請先在上方選擇起訖站' : 'Select origin & destination above'}
                  </div>
                )}
              </div>
          ) : (
            <>
              {/* Results Header */}
              <div className="mb-6 px-4 sm:px-2 flex items-center justify-between">
                  <h2 className="text-balance text-xs sm:text-sm font-black text-slate-950 dark:text-white tracking-widest uppercase">
                    {activeTab === 'outbound' ? (
                      <>
                        <span className="text-blue-700 dark:text-blue-400">
                          {i18n.language === 'zh-TW' 
                            ? (stations.find(s => s.StationID === originStationId)?.StationName?.Zh_tw || '...')
                            : (stations.find(s => s.StationID === originStationId)?.StationName?.En || '...')
                          }
                        </span>
                        <span className="mx-2 text-slate-600">→</span>
                        <span>
                          {i18n.language === 'zh-TW' 
                            ? (stations.find(s => s.StationID === destStationId)?.StationName?.Zh_tw || '...')
                            : (stations.find(s => s.StationID === destStationId)?.StationName?.En || '...')
                          }
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-blue-700 dark:text-blue-400">
                          {i18n.language === 'zh-TW' 
                            ? (stations.find(s => s.StationID === destStationId)?.StationName?.Zh_tw || '...')
                            : (stations.find(s => s.StationID === destStationId)?.StationName?.En || '...')
                          }
                        </span>
                        <span className="mx-2 text-slate-600">→</span>
                        <span>
                          {i18n.language === 'zh-TW' 
                            ? (stations.find(s => s.StationID === originStationId)?.StationName?.Zh_tw || '...')
                            : (stations.find(s => s.StationID === originStationId)?.StationName?.En || '...')
                          }
                        </span>
                      </>
                    )} <span className="mx-3 opacity-40">|</span> 
                    <span className="text-slate-800 dark:text-slate-300 font-black lowercase">
                      {t('app.results.found', { count: filteredTimetables.length })}
                    </span>
                    {showFavoritesOnly && <span className="ml-2 text-red-500 bg-red-100/80 dark:bg-red-900/40 px-2 py-0.5 rounded-full text-[0.625rem] uppercase font-bold border border-red-200/50">{t('app.favorites')}</span>}
                    {showWatchlistOnly && <span className="ml-2 text-blue-500 bg-blue-100/80 dark:bg-blue-900/40 px-2 py-0.5 rounded-full text-[0.625rem] uppercase font-bold border border-blue-200/50">{t('app.watchlist')}</span>}
                  </h2>
                {error && <div className="text-sm text-red-500 font-bold">{error}</div>}
              </div>

              {/* Hotel Promo Link */}
              <a 
                href={`https://www.kkday.com/zh-tw/search?keyword=${encodeURIComponent((i18n.language === 'zh-TW' ? stations.find(s => s.StationID === destStationId)?.StationName?.Zh_tw : stations.find(s => s.StationID === destStationId)?.StationName?.En) + (i18n.language === 'zh-TW' ? ' 住宿' : ' Hotel'))}`}
                target="_blank" 
                rel="noopener noreferrer" 
                className="group flex flex-col sm:flex-row items-start sm:items-center justify-between bg-gradient-to-br from-indigo-50 via-white to-blue-50 dark:from-slate-800 dark:via-slate-900 dark:to-slate-800 border border-indigo-100/50 dark:border-slate-700 p-4 sm:p-5 rounded-3xl shadow-sm hover:shadow-md transition-all duration-300 mb-6 relative overflow-hidden"
              >
                {/* Decorative element */}
                <div className="absolute right-0 top-0 w-32 h-32 bg-blue-400/10 dark:bg-blue-500/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2 group-hover:scale-150 transition-transform duration-700"></div>
                
                <div className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-0 relative z-10 w-full sm:w-auto">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white dark:bg-slate-800 shadow-sm flex items-center justify-center shrink-0 border border-slate-100 dark:border-slate-700">
                    <span className="text-xl sm:text-2xl" role="img" aria-label="hotel">🏨</span>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-balance text-sm sm:text-base font-black text-slate-900 dark:text-slate-100 tracking-tight group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {i18n.language === 'zh-TW' ? '這段行程還需要飯店嗎？' : 'Need a hotel for this trip?'}
                    </h3>
                    <p className="text-xs text-slate-700 dark:text-slate-400 mt-1 font-bold">
                      {i18n.language === 'zh-TW' ? '透過 KKday 預訂，享受專屬住宿優惠' : 'Book with KKday for exclusive hotel deals'}
                    </p>
                  </div>
                </div>
                
                <div className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-full text-xs sm:text-sm font-bold transition-transform group-hover:scale-105 shrink-0 relative z-10 shadow-[0_4px_14px_rgba(37,99,235,0.3)]">
                  {i18n.language === 'zh-TW' ? '尋找住宿優惠' : 'Find Hotel Deals'}
                  <span className="text-lg leading-none pb-[2px] transition-transform group-hover:translate-x-1">→</span>
                </div>
              </a>

              {/* Offline snapshot mode banner — staged fade-in when the network drops */}
              {(offlineTransition === 'weak' || offlineTransition === 'switching' || (activeSnapshot && !offlineBannerDismissed)) && (
                <OfflineModeBanner
                  language={i18n.language}
                  savedAt={activeSnapshot?.savedAt ?? Date.now()}
                  countdown={offlineCountdown}
                  stage={offlineTransition ?? 'active'}
                  onDismiss={() => setOfflineBannerDismissed(true)}
                />
              )}

              {/* Results List */}
              <div className="flex flex-col gap-3 sm:gap-5 pb-6">
                {(() => {
                  const filtered = filteredTimetables;
                  const paged = pagedTimetables;
                  
                  if (isLoading) {
                return (
                  <div className="space-y-5 animate-in fade-in duration-500">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={`skeleton-${i}`} className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md rounded-3xl md:rounded-[2.75rem] p-6 md:p-8 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.08)] border border-slate-100 dark:border-slate-700/50 relative overflow-hidden transition-all duration-300">
                        {/* Smooth Shimmer Overlay */}
                        <div className="absolute inset-0 z-20 pointer-events-none before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_2s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/60 dark:before:via-white/10 before:to-transparent"></div>
                        
                        <div className="flex flex-col md:flex-row justify-between gap-8 opacity-60">
                          {/* Left: Enhanced Timeline Skeleton */}
                          <div className="flex items-stretch gap-6 md:gap-8">
                            <div className="flex flex-col items-center justify-between py-2.5">
                              <div className="w-4 h-4 rounded-full bg-slate-200 dark:bg-slate-600 border-[3px] border-white dark:border-slate-800 shadow-sm"></div>
                              <div className="w-[3px] h-full bg-slate-100 dark:bg-slate-700 my-1 rounded-full"></div>
                              <div className="w-4 h-4 rounded-full bg-slate-200 dark:bg-slate-600 border-[3px] border-white dark:border-slate-800 shadow-sm"></div>
                            </div>
                            <div className="flex flex-col justify-between py-1 w-28 md:w-32">
                              <div className="w-full h-11 bg-slate-200 dark:bg-slate-700 rounded-xl"></div>
                              <div className="w-16 h-5 bg-slate-100 dark:bg-slate-700/50 rounded-md my-4"></div>
                              <div className="w-full h-11 bg-slate-200 dark:bg-slate-700 rounded-xl"></div>
                            </div>
                          </div>
                          {/* Right: Info Box Skeleton */}
                          <div className="flex flex-col items-start md:items-end justify-between gap-6 w-full md:w-auto">
                            <div className="flex flex-col items-start md:items-end gap-3 w-full">
                              <div className="w-24 h-7 bg-slate-200 dark:bg-slate-700 rounded-full"></div>
                              <div className="flex gap-2">
                                <div className="w-16 h-6 bg-slate-100 dark:bg-slate-800 rounded-lg"></div>
                                <div className="w-20 h-6 bg-slate-100 dark:bg-slate-800 rounded-lg"></div>
                              </div>
                            </div>
                            <div className="flex gap-3 w-full justify-end mt-2">
                              <div className="w-full md:w-28 h-10 bg-slate-200 dark:bg-slate-700 rounded-xl md:rounded-full"></div>
                              <div className="w-12 h-10 bg-slate-100 dark:bg-slate-800 rounded-xl md:rounded-full hidden md:block"></div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              }

              if (paged.length === 0) {
                return (
                  <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-12 text-center border border-slate-100/50 dark:border-slate-800 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="w-16 h-16 bg-slate-50/80 dark:bg-slate-800/80 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-100 dark:border-slate-700">
                      <Search className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                    </div>
                    <h3 className="text-balance text-lg font-black text-slate-800 dark:text-slate-100 mb-2 tracking-tight">
                      {error ? (i18n.language === 'zh-TW' ? '查詢時發生錯誤' : 'Search error') : t('app.results.noResults')}
                    </h3>
                    <p className="text-pretty text-slate-500 dark:text-slate-400 text-sm mb-6 max-w-xs mx-auto font-medium">
                      {error
                        ? (i18n.language === 'zh-TW' ? '無法從伺服器取得資料。請檢查連線或稍後再試。' : 'Unable to retrieve data. Please check your connection or try again later.')
                        : t('app.results.noResultsDesc') || (i18n.language === 'zh-TW' ? '換個日期或地點試試看吧！' : 'Try a different date or another route.')}
                    </p>
                    {error && (
                      <div className="p-5 bg-red-50/50 dark:bg-red-950/40 text-red-600 dark:text-red-300 rounded-3xl text-[0.625rem] font-mono text-left overflow-auto max-h-40 border border-red-100/50 dark:border-red-900/50 backdrop-blur-sm">
                        <div className="font-black uppercase tracking-widest mb-2 opacity-50 flex items-center gap-2">
                           <AlertCircle className="w-3 h-3" />
                           Error Details
                        </div>
                        <div className="leading-relaxed">{error}</div>
                      </div>
                    )}
                  </div>
                );
              }

              return paged.map((train, idx) => {
                const trainId = train.DailyTrainInfo?.TrainNo || `Unknown-${idx}`;
                const dep = train.OriginStopTime?.DepartureTime?.substring(0, 5) || '--:--';
                const arr = train.DestinationStopTime?.ArrivalTime?.substring(0, 5) || '--:--';
                const past = isPastTrain(dep);
                const duration = calculateDuration(dep, arr);
                const typeName = transportType === 'hsr' ? '高鐵' : (train.DailyTrainInfo?.TrainTypeName?.Zh_tw || '火車');
                const color = getTrainColor(typeName);
                
                const delay = liveBoard[trainId === `Unknown-${idx}` ? '' : trainId];
                const status = delay === undefined ? 'unknown' : delay === 0 ? 'on-time' : 'delayed';
                const price = getPrice(train);

                // 19. Cancelled Train Logic (Using real alert data)
                const isCancelled = cancelledTrains.has(trainId);

                // Time Urgency Logic
                const nowMin = getTwMinutes();
                const depMin = timeToMinutes(dep) + (delay || 0);
                const minutesLeft = depMin - nowMin;
                const showUrgency = isToday && !isCancelled && minutesLeft > 0 && minutesLeft <= 30;
                
                const longPressHandlers = makeLongPressHandlers(() => {
                  if (isCancelled) return;
                  setPlatformModeTrainId(trainId);
                });

                return (
                  <motion.div
                    key={`${trainId}-${idx}`}
                    id={`train-card-${trainId}`}
                    onClick={() => {
                      if (longPressFiredRef.current) { longPressFiredRef.current = false; return; }
                      if (!isCancelled) handleExpandTrain(trainId);
                    }}
                    {...longPressHandlers}
                    initial={{ opacity: 0, y: 24 }}
                    whileInView={{ opacity: past ? 0.6 : 1, y: 0 }}
                    viewport={{ once: true, margin: '0px 0px -60px 0px' }}
                    transition={{ duration: 0.45, ease: [0.22, 0.61, 0.36, 1], delay: Math.min(idx, 8) * 0.04 }}
                    whileHover={!isCancelled && expandedTrainId !== trainId ? { y: -2 } : undefined}
                    className={`group rounded-3xl mx-3 sm:mx-0 sm:rounded-[2rem] md:rounded-[2.75rem] border sm:border-slate-200/60 transition-[background-color,border-color,box-shadow,transform] duration-500 relative overflow-hidden will-change-transform ${
                      past ? 'grayscale-[50%]' : ''
                    } ${
                      isCancelled
                        ? 'bg-slate-50 border-slate-200 cursor-not-allowed text-slate-400'
                        : expandedTrainId === trainId
                          ? 'bg-white shadow-[0_20px_50px_-20px_rgba(37,99,235,0.15)] z-20 scale-[1.01] sm:scale-[1.02] ring-2 sm:ring-4 ring-blue-600/5 border-blue-400 sm:border-blue-600'
                          : 'bg-white border-slate-200/80 hover:border-blue-400/50 hover:bg-[#F8F9FA] sm:hover:bg-white shadow-[0_6px_24px_-14px_rgba(15,23,42,0.14)] hover:shadow-[0_20px_50px_-15px_rgba(0,0,0,0.08)] cursor-pointer sm:border-slate-100'
                    }`}
                  >
                    {/* 19. Stamp Effect Badge */}
                    {isCancelled && (
                      <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none opacity-50">
                         <div className="border-[8px] sm:border-[12px] border-red-500/30 px-8 sm:px-12 py-2 sm:py-4 rounded-[2rem] sm:rounded-[2.5rem] rotate-[-12deg] flex items-center justify-center">
                            <span className="text-5xl sm:text-7xl font-black text-red-600 uppercase tracking-[0.2em] italic mix-blend-multiply drop-shadow-sm">停駛</span>
                         </div>
                      </div>
                    )}

                    {/* Time-Urgency UI Banner */}
                    {showUrgency && (
                      <div className={`w-full overflow-hidden relative h-7 sm:h-9 flex items-center z-30 transition-colors duration-500 ${
                        minutesLeft < 5 ? 'bg-red-600 animate-pulse' : 
                        minutesLeft <= 15 ? 'bg-amber-400' : 
                        'bg-emerald-500'
                      }`}>
                        <div className="flex whitespace-nowrap animate-marquee items-center w-full px-4">
                          <div className="flex items-center gap-4 text-white font-black text-[0.625rem] sm:text-xs uppercase tracking-[0.2em]">
                            <span className="flex items-center gap-1.5 h-full">
                              <Zap className={`w-3 h-3 sm:w-4 sm:h-4 ${minutesLeft < 5 ? 'animate-bounce' : ''}`} />
                              {i18n.language === 'zh-TW' ? '即將發車' : 'Departing Soon'}
                            </span>
                            <span className="opacity-50">•</span>
                            <span className="text-sm sm:text-lg">
                              {i18n.language === 'zh-TW' ? `剩餘 ${minutesLeft} 分鐘` : `Remaining ${minutesLeft} mins`}
                            </span>
                            <span className="opacity-50">•</span>
                            <span className="italic">
                              {minutesLeft < 5 ? (i18n.language === 'zh-TW' ? '請儘速前往月台！' : 'Please run to the platform!') :
                               minutesLeft <= 15 ? (i18n.language === 'zh-TW' ? '請加快腳步' : 'Please speed up') :
                               (i18n.language === 'zh-TW' ? '請從容登車' : 'Walk normally')}
                            </span>
                          </div>
                        </div>
                        {/* Static Overlay for visibility */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                           <div className="bg-black/10 backdrop-blur-[1px] px-3 py-1 rounded-full border border-white/20 shadow-lg">
                             <span className="text-white text-[0.625rem] sm:text-xs font-black uppercase tracking-widest">
                               {minutesLeft}m
                             </span>
                           </div>
                        </div>
                      </div>
                    )}

                    {/* Mobile Compact Layout (md:hidden) */}
                    <div className={`md:hidden p-3 sm:p-4 relative transition-colors duration-500 ${
                      expandedTrainId === trainId ? 'bg-gradient-to-br from-white to-blue-50/30' : ''
                    }`}>
                      {/* Top row: type + train id + live status | heart/bell */}
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                          <span className={`px-2 py-1 rounded-md text-[0.625rem] font-bold tracking-widest whitespace-nowrap flex items-center gap-1 ${
                            isCancelled ? 'bg-slate-200 text-slate-400 line-through' :
                            color === 'red' ? 'bg-[#ffebeb] text-[#cb171d]' :
                            color === 'orange' ? 'bg-[#feebd6] text-[#d85e01]' :
                            'bg-[#e0efff] text-[#1b5cb7]'
                          }`}>
                            {typeName} <span className="font-black text-xs tracking-tight">{trainId}</span> {i18n.language === 'zh-TW' ? '次' : ''}
                          </span>
                          {train.DailyTrainInfo?.StartingStationName?.Zh_tw && train.DailyTrainInfo?.EndingStationName?.Zh_tw && (
                            <span className="text-slate-600 text-[0.625rem] font-black tracking-tight whitespace-nowrap shrink-0">
                              {train.DailyTrainInfo.StartingStationName.Zh_tw}➔{train.DailyTrainInfo.EndingStationName.Zh_tw}
                            </span>
                          )}
                          {train.DailyTrainInfo?.Direction !== undefined && (
                            <span className="font-black px-1.5 py-[1px] bg-slate-200/80 rounded-md text-slate-900 text-[0.625rem] tracking-widest border border-slate-300 whitespace-nowrap shrink-0">
                              {train.DailyTrainInfo.Direction === 0 ? '南下' : '北上'}
                            </span>
                          )}
                          {!isCancelled && status === 'on-time' && (
                            <span className="flex items-center gap-1 text-emerald-600 bg-emerald-50/80 px-1.5 py-0.5 rounded-full text-[0.625rem] font-bold border border-emerald-100">
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                              </span>
                              {t('app.train.onTime')}
                            </span>
                          )}
                          {!isCancelled && status === 'delayed' && (
                            <span className="flex items-center gap-1 text-red-600 bg-red-50/80 px-1.5 py-0.5 rounded-full text-[0.625rem] font-bold border border-red-100">
                              {t('app.train.delay', { minutes: delay })}
                            </span>
                          )}
                          {isCancelled && (
                            <span className="flex items-center gap-1 text-slate-400 bg-slate-200/50 px-1.5 py-0.5 rounded-full text-[0.625rem] font-bold border border-slate-300">
                              <XCircle className="w-3 h-3" /> CANCELLED
                            </span>
                          )}
                          {!isCancelled && reliabilityByTrain[trainId] && (
                            <ReliabilityBadge
                              reliability={reliabilityByTrain[trainId]!}
                              language={i18n.language}
                              compact
                            />
                          )}
                        </div>
                        <div className="flex items-center bg-slate-100 rounded-full p-0.5 shadow-inner shrink-0">
                          <button
                            onClick={(e) => toggleFavorite(trainId, e)}
                            disabled={isCancelled}
                            aria-label={favorites.includes(trainId) ? t('app.removeFavorite', 'Remove favorite') : t('app.addFavorite', 'Add favorite')}
                            className={`p-1.5 rounded-full transition-all ${favorites.includes(trainId) ? 'text-red-600 bg-white shadow-sm ring-1 ring-red-200' : 'text-slate-400 hover:text-slate-600'}`}
                          >
                            <Heart className={`w-3.5 h-3.5 ${favorites.includes(trainId) ? 'stroke-[2.5]' : 'stroke-2'}`} />
                          </button>
                          <button
                            onClick={(e) => toggleWatchlist(trainId, e)}
                            disabled={isCancelled}
                            aria-label={watchlist.includes(trainId) ? t('app.removeWatchlist', 'Remove from watchlist') : t('app.addWatchlist', 'Add to watchlist')}
                            className={`p-1.5 rounded-full transition-all ${watchlist.includes(trainId) ? 'text-blue-600 bg-white shadow-sm ring-1 ring-blue-200' : 'text-slate-400 hover:text-slate-600'}`}
                          >
                            <Bell className={`w-3.5 h-3.5 ${watchlist.includes(trainId) ? 'stroke-[2.5]' : 'stroke-2'}`} />
                          </button>
                          <button
                            onClick={(e) => handleAddToCalendar(e, train, dep, arr)}
                            disabled={isCancelled}
                            aria-label={i18n.language === 'zh-TW' ? '加入行事曆' : 'Add to Calendar'}
                            title={i18n.language === 'zh-TW' ? '加入行事曆' : 'Add to Calendar'}
                            className="p-1.5 rounded-full transition-all text-amber-500 hover:text-amber-600 hover:bg-white hover:shadow-[0_0_10px_rgba(245,158,11,0.4)] shadow-[0_0_6px_rgba(245,158,11,0.2)] bg-amber-50/50 relative overflow-hidden"
                          >
                            <div className="absolute inset-0 bg-amber-400/20 animate-pulse rounded-full blur-sm"></div>
                            <CalendarPlus className="w-3.5 h-3.5 stroke-2 relative z-10 drop-shadow-[0_0_2px_rgba(245,158,11,0.8)]" />
                          </button>
                        </div>
                      </div>

                      {/* Horizontal times + duration */}
                      <div className="flex items-center gap-2 mb-3">
                        <div className={`text-3xl font-black tracking-tighter tabular-nums ${isCancelled ? 'text-slate-300 line-through' : expandedTrainId === trainId ? 'text-blue-600' : 'text-slate-900'}`}>{dep}</div>
                        <div className="flex-1 flex items-center gap-1 px-1">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${isCancelled ? 'bg-slate-300' : 'bg-slate-800'}`}></div>
                          <div className={`h-[2px] flex-1 rounded-full ${isCancelled ? 'bg-slate-200' : 'bg-slate-200'}`}></div>
                          <div className={`text-[0.625rem] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap flex items-center gap-1.5 shadow-sm ${
                            isCancelled ? 'bg-slate-50 border-slate-100 text-slate-300 shadow-none' :
                            expandedTrainId === trainId ? 'bg-blue-50/80 border-blue-200/60 shadow-blue-500/10' :
                            'bg-white border-slate-200/60'
                          }`}>
                            <span className="text-[0.6875rem] leading-none mb-[1px] grayscale-[0.1] opacity-90 drop-shadow-sm">🗓️</span>
                            {(() => {
                              const [h, m] = duration.split(':').map(Number);
                              const translatedText = h > 0 ? t('app.train.duration', { hours: h, minutes: m }) : t('app.train.durationShort', { minutes: m });
                              return (
                                <span className={`tracking-wide tabular-nums ${isCancelled ? '' : 'text-blue-600 dark:text-blue-400'}`}>
                                  {translatedText}
                                </span>
                              );
                            })()}
                          </div>
                          <div className={`h-[2px] flex-1 rounded-full ${isCancelled ? 'bg-slate-200' : 'bg-slate-200'}`}></div>
                          <div className={`w-2 h-2 rounded-full shrink-0 ${isCancelled ? 'bg-slate-300' : 'bg-slate-800'}`}></div>
                        </div>
                        <div className={`text-3xl font-black tracking-tighter tabular-nums ${isCancelled ? 'text-slate-300 line-through' : 'text-slate-900'}`}>{arr}</div>
                      </div>

                      {!isCancelled && (
                        <div className="mb-3">
                          <JourneyProgressBar
                            departureTime={dep}
                            arrivalTime={arr}
                            zh={i18n.language === 'zh-TW'}
                            tripLine={transportType === 'train' ? train.DailyTrainInfo?.TripLine : undefined}
                            statusTags={
                              <>
                                {train.DailyTrainInfo?.OverNightStationID && (
                                  <span className="font-bold px-1.5 py-[1px] bg-[#e0e4ff] text-[#2b388f] rounded-md text-[0.625rem] tracking-widest">
                                    跨夜
                                  </span>
                                )}
                                {train.DailyTrainInfo?.WheelchairFlag === 1 && <span title="無障礙座位">♿️</span>}
                                {train.DailyTrainInfo?.BikeFlag === 1 && <span title="自行車車廂">🚲</span>}
                                {train.DailyTrainInfo?.BreastFeedingFlag === 1 && <span title="哺乳室">🍼</span>}
                                {train.DailyTrainInfo?.ParenthoodFlag === 1 && <span title="親子車廂">🎈</span>}
                              </>
                            }
                            originName={i18n.language === 'zh-TW' ? (stations.find(s => s.StationID === originStationId)?.StationName?.Zh_tw || originStationId) : (stations.find(s => s.StationID === originStationId)?.StationName?.En || originStationId)}
                            destName={i18n.language === 'zh-TW' ? (stations.find(s => s.StationID === destStationId)?.StationName?.Zh_tw || destStationId) : (stations.find(s => s.StationID === destStationId)?.StationName?.En || destStationId)}
                          />
                        </div>
                      )}

                      <div className="flex flex-col gap-3 mt-3">
                        {/* Action Buttons */}
                        {!isCancelled && (
                          <div className="flex items-center justify-between gap-2 w-full">
                            <button
                              onClick={(e) => void handleBooking(e, trainId, dep)}
                              className="flex-none min-w-[96px] px-5 bg-slate-900 text-white font-bold text-xs py-2.5 rounded-xl active:scale-95 transition-transform shadow-lg shadow-slate-900/10"
                            >
                              {i18n.language === 'zh-TW' ? '馬上訂票' : 'Book Ticket'}
                            </button>
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                const shareData = {
                                  title: i18n.language === 'zh-TW' ? `${typeName} ${trainId}次` : `Train ${trainId}`,
                                  text: i18n.language === 'zh-TW' 
                                    ? `我預計搭乘 ${dep} 的 ${typeName} ${trainId}次 前往 ${stations.find(s => s.StationID === destStationId)?.StationName?.Zh_tw}`
                                    : `Taking the ${dep} train ${trainId} to ${stations.find(s => s.StationID === destStationId)?.StationName?.En}`,
                                  url: window.location.href
                                };
                                if (navigator.share) {
                                  try {
                                    await navigator.share(shareData);
                                  } catch (err) {
                                    console.error('Error sharing:', err);
                                  }
                                } else {
                                  showToast(i18n.language === 'zh-TW' ? '無法使用分享功能' : 'Sharing not supported');
                                }
                              }}
                              className="px-4 bg-slate-100 text-slate-700 font-bold text-xs py-2.5 rounded-xl active:scale-95 transition-transform border border-slate-200"
                            >
                              {i18n.language === 'zh-TW' ? '分享' : 'Share'}
                            </button>
                          </div>
                        )}
                        {!isCancelled && (
                          <div className="absolute right-3 bottom-3 md:hidden">
                            <span className="text-xl animate-pulse inline-block opacity-80" role="img" aria-label="View Details">👇</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Desktop Layout — FlightCard 3-column grid */}
                    <div
                      className={`hidden md:block px-8 py-5 cursor-pointer transition-colors duration-500 ${
                        expandedTrainId === trainId ? 'bg-gradient-to-br from-white to-blue-50/30' : ''
                      }`}
                      onClick={() => setExpandedTrainId(expandedTrainId === trainId ? null : trainId)}
                    >
                      {/* Top strip: route meta + status badges */}
                      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                        {/* Route meta: start→end + direction + line type */}
                        <div className="flex items-center gap-2 text-xs text-slate-500 font-medium flex-wrap">
                          {train.DailyTrainInfo?.StartingStationName?.Zh_tw && train.DailyTrainInfo?.EndingStationName?.Zh_tw && (
                            <span>
                              {train.DailyTrainInfo.StartingStationName.Zh_tw}
                              <span className="mx-1 text-[0.6rem]">➔</span>
                              {train.DailyTrainInfo.EndingStationName.Zh_tw}
                            </span>
                          )}
                          <div className="flex gap-1">
                            {train.DailyTrainInfo?.Direction !== undefined && (
                              <span className="font-bold px-1.5 py-[1px] bg-slate-100 rounded text-slate-500 text-[0.625rem] tracking-widest">
                                {train.DailyTrainInfo.Direction === 0 ? '南下' : '北上'}
                              </span>
                            )}
                            {transportType === 'train' && train.DailyTrainInfo?.TripLine !== undefined && train.DailyTrainInfo.TripLine !== 0 && (
                              <span className={`font-bold px-1.5 py-[1px] rounded text-[0.625rem] tracking-widest outline outline-1 ${
                                train.DailyTrainInfo.TripLine === 1 ? 'bg-[#fef4cc] text-[#af7001] outline-[#fef4cc]/50' :
                                train.DailyTrainInfo.TripLine === 2 ? 'bg-[#e5ffff] text-[#017a86] outline-[#e5ffff]/50' :
                                'bg-[#eee5ff] text-[#6126a8] outline-transparent'
                              }`}>
                                {train.DailyTrainInfo.TripLine === 1 ? '山線' : train.DailyTrainInfo.TripLine === 2 ? '海線' : '成追'}
                              </span>
                            )}
                            {train.DailyTrainInfo?.OverNightStationID && (
                              <span className="font-bold px-1.5 py-[1px] bg-[#e0e4ff] text-[#2b388f] rounded text-[0.625rem] tracking-widest">跨夜</span>
                            )}
                          </div>
                          {train.DailyTrainInfo?.Note?.Zh_tw && (
                            <span className="text-slate-400/70 truncate max-w-[180px]" title={train.DailyTrainInfo.Note.Zh_tw}>
                              {train.DailyTrainInfo.Note.Zh_tw}
                            </span>
                          )}
                        </div>
                        {/* Status badges */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {!isCancelled && status === 'on-time' && (
                            <div className="flex items-center gap-1.5 text-emerald-600 bg-emerald-50/80 px-2.5 py-1 rounded-full text-xs font-bold border border-emerald-100">
                              <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                              </span>
                              {t('app.train.onTime')}
                            </div>
                          )}
                          {!isCancelled && status === 'delayed' && (
                            <div className="flex items-center gap-1.5 text-red-600 bg-red-50/80 px-2.5 py-1 rounded-full text-xs font-bold border border-red-100">
                              <span className="w-2 h-2 rounded-full bg-red-500 inline-block"></span>
                              {t('app.train.delay', { minutes: delay })}
                            </div>
                          )}
                          {isCancelled && (
                            <div className="flex items-center gap-1.5 text-slate-400 bg-slate-200/50 px-2.5 py-1 rounded-full text-xs font-bold border border-slate-300">
                              <XCircle className="w-3.5 h-3.5" /> CANCELLED
                            </div>
                          )}
                          {!isCancelled && reliabilityByTrain[trainId] && (
                            <ReliabilityBadge reliability={reliabilityByTrain[trainId]!} language={i18n.language} />
                          )}
                        </div>
                      </div>

                      {/* 3-column main grid — mirrors FlightCard */}
                      <div className="grid grid-cols-12 gap-x-6 items-center">

                        {/* ── Col 1–3: Train identity ── */}
                        <div className="col-span-3 flex flex-col gap-2.5">
                          {/* Type badge + train number */}
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <span className={`px-2 py-1 rounded-md text-sm font-bold tracking-widest shrink-0 ${
                              isCancelled ? 'bg-slate-200 text-slate-400 line-through' :
                              color === 'red' ? 'bg-[#ffebeb] text-[#cb171d]' :
                              color === 'orange' ? 'bg-[#feebd6] text-[#d85e01]' :
                              'bg-[#e0efff] text-[#1b5cb7]'
                            }`}>
                              {typeName}
                            </span>
                            <span className={`font-black text-2xl tracking-tight tabular-nums ${isCancelled ? 'text-slate-300 line-through' : 'text-slate-900'}`}>
                              {trainId}{i18n.language === 'zh-TW' ? <span className="text-base font-semibold text-slate-400 ml-0.5">次</span> : ''}
                            </span>
                          </div>

                          {/* Accessibility icons */}
                          <div className="flex items-center gap-1 opacity-90">
                            {train.DailyTrainInfo?.WheelchairFlag === 1 && (
                              <span className="w-5 h-5 flex items-center justify-center bg-slate-100/80 border border-slate-200/60 rounded-md text-[0.6875rem] leading-none grayscale-[0.2]" title="無障礙座位">♿️</span>
                            )}
                            {train.DailyTrainInfo?.BreastFeedingFlag === 1 && (
                              <span className="w-5 h-5 flex items-center justify-center bg-slate-100/80 border border-slate-200/60 rounded-md text-[0.6875rem] leading-none grayscale-[0.2]" title="哺集乳室">🍼</span>
                            )}
                            {train.DailyTrainInfo?.BikeFlag === 1 && (
                              <span className="w-5 h-5 flex items-center justify-center bg-slate-100/80 border border-slate-200/60 rounded-md text-[0.6875rem] leading-none grayscale-[0.2]" title="自行車車廂">🚲</span>
                            )}
                            {train.DailyTrainInfo?.ParenthoodFlag === 1 && (
                              <span className="w-5 h-5 flex items-center justify-center bg-slate-100/80 border border-slate-200/60 rounded-md text-[0.6875rem] leading-none grayscale-[0.2]" title="親子車廂">🎈</span>
                            )}
                          </div>

                          {/* Favorites / watchlist + details link */}
                          <div className="flex items-center gap-2">
                            <div className="flex items-center bg-slate-50 border border-slate-100 rounded-full p-1 shadow-inner">
                              <button
                                onClick={(e) => toggleFavorite(trainId, e)}
                                aria-label={favorites.includes(trainId) ? t('app.removeFavorite', 'Remove favorite') : t('app.addFavorite', 'Add favorite')}
                                className={`p-1.5 rounded-full transition-all ${favorites.includes(trainId) ? 'text-red-600 bg-white shadow-sm ring-1 ring-red-200' : 'text-slate-400 hover:text-slate-600 hover:bg-white hover:shadow-sm'}`}
                                disabled={isCancelled}
                              >
                                <Heart className={`w-3.5 h-3.5 ${favorites.includes(trainId) ? 'stroke-[2.5]' : 'stroke-2'}`} />
                              </button>
                              <button
                                onClick={(e) => toggleWatchlist(trainId, e)}
                                aria-label={watchlist.includes(trainId) ? t('app.removeWatchlist', 'Remove from watchlist') : t('app.addWatchlist', 'Add to watchlist')}
                                className={`p-1.5 rounded-full transition-all ${watchlist.includes(trainId) ? 'text-blue-600 bg-white shadow-sm ring-1 ring-blue-200' : 'text-slate-400 hover:text-slate-600 hover:bg-white hover:shadow-sm'}`}
                                disabled={isCancelled}
                              >
                                <Bell className={`w-3.5 h-3.5 ${watchlist.includes(trainId) ? 'stroke-[2.5]' : 'stroke-2'}`} />
                              </button>
                              <button
                                onClick={(e) => handleAddToCalendar(e, train, dep, arr)}
                                disabled={isCancelled}
                                aria-label={i18n.language === 'zh-TW' ? '加入行事曆' : 'Add to Calendar'}
                                title={i18n.language === 'zh-TW' ? '加入行事曆' : 'Add to Calendar'}
                                className="p-1.5 rounded-full transition-all text-amber-500 hover:text-amber-600 hover:bg-white hover:shadow-[0_0_10px_rgba(245,158,11,0.4)] shadow-[0_0_6px_rgba(245,158,11,0.2)] bg-amber-50/50 relative overflow-hidden"
                              >
                                <div className="absolute inset-0 bg-amber-400/20 animate-pulse rounded-full blur-sm"></div>
                                <CalendarPlus className="w-3.5 h-3.5 stroke-2 relative z-10 drop-shadow-[0_0_2px_rgba(245,158,11,0.8)]" />
                              </button>
                            </div>
                            {!isCancelled && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setExpandedTrainId(expandedTrainId === trainId ? null : trainId); }}
                                className="text-xs text-slate-500 hover:text-blue-600 transition-colors underline-offset-2 hover:underline"
                              >
                                {i18n.language === 'zh-TW' ? (expandedTrainId === trainId ? '收起詳情' : '查看詳情') : (expandedTrainId === trainId ? 'Collapse' : 'Details')}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* ── Col 4–8: Horizontal timeline ── */}
                        <div className="col-span-5 flex items-center gap-4">
                          {/* Departure */}
                          <div className="text-center shrink-0">
                            <p className={`font-black text-5xl tracking-tighter tabular-nums leading-none transition-colors duration-300 ${
                              isCancelled ? 'text-slate-300 line-through' : expandedTrainId === trainId ? 'text-blue-600' : 'text-slate-900'
                            }`}>{dep}</p>
                          </div>

                          {/* Duration bar */}
                          <div className="flex-grow text-center min-w-0">
                            <div className={`text-xs font-semibold mb-1.5 flex items-center justify-center gap-1.5 ${isCancelled ? 'text-slate-300' : 'text-blue-600'}`}>
                              <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                              {(() => {
                                const [h, m] = duration.split(':').map(Number);
                                return h > 0 ? t('app.train.duration', { hours: h, minutes: m }) : t('app.train.durationShort', { minutes: m });
                              })()}
                            </div>
                            <div className="relative w-full h-px my-1">
                              <div className={`absolute inset-0 rounded-full ${isCancelled ? 'bg-slate-200' : 'bg-slate-200'}`}></div>
                              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white border-2 border-slate-400 z-10"></div>
                              <div className={`absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white z-10 transition-colors duration-300 ${
                                isCancelled ? 'bg-slate-300' : expandedTrainId === trainId ? 'bg-blue-600' : 'bg-slate-700'
                              }`}></div>
                            </div>
                            <p className="text-[0.65rem] font-medium text-slate-500 tracking-wide mt-1.5">
                              {i18n.language === 'zh-TW' ? '直達' : 'Direct'}
                            </p>
                          </div>

                          {/* Arrival */}
                          <div className="text-center shrink-0">
                            <p className={`font-black text-5xl tracking-tighter tabular-nums leading-none ${isCancelled ? 'text-slate-300 line-through' : 'text-slate-900'}`}>{arr}</p>
                          </div>
                        </div>

                        {/* ── Col 9–12: Pricing & booking ── */}
                        <div className="col-span-4 flex flex-col items-end gap-2">
                          {/* Action buttons */}
                          {!isCancelled && (
                            <div className="flex items-center gap-2 mt-1">
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  const shareData = {
                                    title: i18n.language === 'zh-TW' ? `${typeName} ${trainId}次` : `Train ${trainId}`,
                                    text: i18n.language === 'zh-TW'
                                      ? `我預計搭乘 ${dep} 的 ${typeName} ${trainId}次 前往 ${stations.find(s => s.StationID === destStationId)?.StationName?.Zh_tw}`
                                      : `Taking the ${dep} train ${trainId} to ${stations.find(s => s.StationID === destStationId)?.StationName?.En}`,
                                    url: window.location.href
                                  };
                                  if (navigator.share) {
                                    try { await navigator.share(shareData); } catch { /* ignored */ }
                                  } else {
                                    showToast(i18n.language === 'zh-TW' ? '無法使用分享功能' : 'Sharing not supported');
                                  }
                                }}
                                className="px-4 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs py-2 rounded-xl transition-colors border border-slate-200"
                              >
                                {i18n.language === 'zh-TW' ? '分享' : 'Share'}
                              </button>
                              <button
                                onClick={(e) => void handleBooking(e, trainId, dep)}
                                className="px-5 bg-slate-900 hover:bg-blue-600 text-white font-bold text-xs py-2 rounded-xl transition-colors flex items-center gap-1.5 shadow-lg shadow-slate-900/10"
                              >
                                {i18n.language === 'zh-TW' ? '馬上訂票' : 'Book Ticket'}
                                <ArrowRight className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Expand hint */}
                      {!isCancelled && (
                        <div className="flex justify-center mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className={`text-slate-300 text-xs transition-transform duration-300 ${expandedTrainId === trainId ? 'rotate-180 inline-block' : 'inline-block'}`}>▾</span>
                        </div>
                      )}
                    </div>

                    {/* Extract stops content to a function so it can be reused in Portal */}
                    {(() => {
                      const isHsr = transportType === 'hsr';
                      const thm = isHsr ? {
                        textHighlight: 'text-orange-400',
                        bgHighlight: 'bg-orange-500/20',
                        borderHighlight: 'border-orange-500/20',
                        pulseRing: 'ring-orange-400/20',
                        bgSolid: 'bg-orange-400',
                        bgTimeline: 'bg-orange-500/30',
                        bgBetween: 'from-orange-500',
                        lineBase: 'bg-[#4E342E]/50',
                        linePassed: 'bg-[#4E342E]',
                        circleUnreached: 'bg-[#4E342E]',
                        circleBorder: 'border-[#2D1A11]',
                        textMuted: 'text-[#BCAAA4]',
                        textNormal: 'text-[#EFEBE9]',
                        btnBg: 'bg-[#4E342E]',
                        btnHover: 'hover:bg-[#3E2723]',
                        borderSoft: 'border-[#4E342E]/50',
                        textHighlightLight: 'text-orange-300',
                      } : {
                        textHighlight: 'text-blue-400',
                        bgHighlight: 'bg-blue-500/20',
                        borderHighlight: 'border-blue-500/20',
                        pulseRing: 'ring-blue-400/20',
                        bgSolid: 'bg-blue-400',
                        bgTimeline: 'bg-blue-500/30',
                        bgBetween: 'from-blue-500',
                        lineBase: 'bg-slate-800/50',
                        linePassed: 'bg-slate-800',
                        circleUnreached: 'bg-slate-700',
                        circleBorder: 'border-slate-900',
                        textMuted: 'text-slate-400',
                        textNormal: 'text-slate-200',
                        btnBg: 'bg-slate-800',
                        btnHover: 'hover:bg-slate-700',
                        borderSoft: 'border-slate-800/50',
                        textHighlightLight: 'text-blue-300',
                      };
                      const trainStopsContent = (
                        <>
                          {/* Environmental Overlays */}
                          {(() => {
                             const destName = stations.find(s => s.StationID === destStationId)?.StationName?.Zh_tw || '';
                             const env = getEnvironment(destName);
                           if (env.weather === 'rainy') return <RainEffect />;
                           if (env.timeOfDay === 'morning') return <div className="absolute inset-0 bg-gradient-to-tr from-orange-500/10 via-amber-100/5 to-transparent pointer-events-none z-0"></div>;
                           if (env.timeOfDay === 'evening') return <div className="absolute inset-0 bg-gradient-to-tr from-red-500/5 via-transparent to-purple-500/5 pointer-events-none z-0"></div>;
                           if (env.timeOfDay === 'night') return <div className="absolute inset-0 bg-gradient-to-b from-blue-900/10 to-transparent pointer-events-none z-0"></div>;
                           return null;
                        })()}
                        
                        <div className="relative z-10">
                          {/* Tab Switcher */}
                          <div className="flex border-b border-white/10 mb-6 gap-2">
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setActiveDetailTab(prev => ({ ...prev, [trainId]: 'stops' }));
                              }}
                              className={`px-4 py-2 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
                                (activeDetailTab[trainId] || 'stops') === 'stops'
                                  ? `border-current ${thm.textHighlight}`
                                  : `border-transparent ${thm.textMuted} hover:${thm.textNormal}`
                              }`}
                            >
                              <Clock className="w-4 h-4" />
                              <span>{i18n.language === 'zh-TW' ? '停靠資訊' : 'Stop Information'}</span>
                            </button>
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setActiveDetailTab(prev => ({ ...prev, [trainId]: 'station' }));
                                if (!activeBusStationId[trainId]) {
                                  const originId = originStationId;
                                  const originName = stations.find(s => s.StationID === originId)?.StationName?.Zh_tw || '';
                                  setActiveBusStationId(prev => ({ ...prev, [trainId]: originId }));
                                  fetchNearbyBuses(originId, originName);
                                }
                              }}
                              className={`px-4 py-2 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
                                activeDetailTab[trainId] === 'station'
                                  ? `border-current ${thm.textHighlight}`
                                  : `border-transparent ${thm.textMuted} hover:${thm.textNormal}`
                              }`}
                            >
                              <MapPin className="w-4 h-4" />
                              <span>{i18n.language === 'zh-TW' ? '轉乘公車' : 'Nearby Bus Info'}</span>
                            </button>
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setActiveDetailTab(prev => ({ ...prev, [trainId]: 'youbike' }));
                              }}
                              className={`px-4 py-2 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
                                activeDetailTab[trainId] === 'youbike'
                                  ? 'border-amber-500 text-amber-400'
                                  : `border-transparent ${thm.textMuted} hover:${thm.textNormal}`
                              }`}
                            >
                              <Bike className="w-4 h-4" />
                              <span>{i18n.language === 'zh-TW' ? 'YouBike' : 'Nearby YouBike'}</span>
                            </button>
                          </div>

                          {(activeDetailTab[trainId] || 'stops') === 'stops' ? (
                            <>
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8">
                            <div className="flex flex-col gap-1">
                                      <div className="flex items-center gap-2">
                                        <h4 className="text-balance text-slate-400 text-xs sm:text-sm font-semibold uppercase tracking-widest">{t('app.train.stops')}</h4>
                                        {(() => {
                                  const destName = stations.find(s => s.StationID === destStationId)?.StationName?.Zh_tw || '';
                                  const env = getEnvironment(destName);
                                  return (
                                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] text-slate-400 font-bold uppercase tracking-tight">
                                      {env.weather === 'rainy' ? <CloudRain className="w-3 h-3 text-blue-400" /> : <Sun className="w-3 h-3 text-amber-400" />}
                                      <span>{env.weather === 'rainy' ? (i18n.language === 'zh-TW' ? '多雨' : 'Rainy') : (i18n.language === 'zh-TW' ? '晴朗' : 'Sunny')}</span>
                                      <span className="opacity-30 border-l border-white/20 h-2 mx-1"></span>
                                      <span>{env.timeOfDay === 'morning' ? (i18n.language === 'zh-TW' ? '早晨' : 'Morning') : env.timeOfDay === 'night' ? (i18n.language === 'zh-TW' ? '深夜' : 'Night') : (i18n.language === 'zh-TW' ? '當前' : 'Current')}</span>
                                            </div>
                                          );
                                        })()}
                                        {transportType === 'train' && (
                                          <div className="flex items-baseline gap-1.5 px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-400/20 text-[10px] font-bold whitespace-nowrap">
                                            <span className="text-slate-400">票價</span>
                                            <span className="text-blue-200 tabular-nums">{price}</span>
                                          </div>
                                        )}
                                      </div>
                              {trainStops[trainId]?.isMock && (
                              <div className="flex items-center gap-1.5 text-[10px] text-orange-400 font-bold uppercase tracking-tight">
                                <AlertTriangle className="w-3 h-3" />
                                <span>{i18n.language === 'zh-TW' ? '目前顯示系統預排資訊 (Simulation Mode)' : 'Simulation Mode'}</span>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap self-start sm:self-auto">
                            {transportType === 'hsr' && (
                              <>
                                <div className="flex items-baseline gap-1 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] font-bold whitespace-nowrap">
                                  <span className="text-slate-400">標準</span>
                                  <span className="text-slate-200 tabular-nums">NT${fares['standard'] || '--'}</span>
                                </div>
                                <div className="flex items-baseline gap-1 px-2 py-0.5 rounded-full bg-orange-500/10 border border-orange-400/20 text-[10px] font-bold whitespace-nowrap">
                                  <span className="text-orange-300">商務</span>
                                  <span className="text-orange-200 tabular-nums">NT${fares['business'] || '--'}</span>
                                </div>
                                <div className="flex items-baseline gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-400/20 text-[10px] font-bold whitespace-nowrap">
                                  <span className="text-emerald-300">自由</span>
                                  <span className="text-emerald-200 tabular-nums">NT${fares['unreserved'] || '--'}</span>
                                </div>
                              </>
                            )}
                            {isToday && !trainStops[trainId]?.isMock && (
                              <div className={`flex items-center gap-2 text-[10px] font-bold ${thm.textHighlight} border ${thm.borderHighlight} px-2 py-1 rounded-md uppercase tracking-tighter`}>
                                <span className={`flex h-1.5 w-1.5 rounded-full ${thm.bgSolid} animate-pulse`}></span>
                                {i18n.language === 'zh-TW' ? '即時位置' : 'Live Position'}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col gap-0.5 mt-2 sm:mt-4">
                          {stopsLoading[trainId] ? (
                            <div className="py-12 sm:py-20 flex flex-col items-center justify-center gap-4 sm:gap-6 text-slate-500">
                               <div className="w-8 h-8 sm:w-10 sm:h-10 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
                               <div className="flex flex-col items-center gap-1">
                                 <span className="text-xs sm:text-sm font-black text-slate-300 uppercase tracking-widest text-center">{i18n.language === 'zh-TW' ? '載入時刻表中...' : 'Initialising Schedule'}</span>
                                 <span className="text-[10px] text-slate-500 font-medium">{i18n.language === 'zh-TW' ? '抓取即時月台資料...' : 'Fetching real-time platform data...'}</span>
                               </div>
                            </div>
                          ) : trainStops[trainId] === undefined ? (
                            <div className="flex flex-col gap-1 py-4">
                              {[1, 2, 3, 4].map((i) => (
                                <div key={i} className="flex items-center gap-4 sm:gap-8 py-4 sm:py-6 border-b border-slate-800/30 opacity-20">
                                  <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-2xl bg-slate-800 animate-pulse"></div>
                                  <div className="flex flex-col gap-2 sm:gap-3 w-full">
                                    <div className="h-5 sm:h-6 w-24 sm:w-32 bg-slate-800 rounded-md animate-pulse"></div>
                                    <div className="h-3 sm:h-4 w-16 sm:w-20 bg-slate-800/50 rounded-md animate-pulse"></div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : trainStops[trainId]?.stops?.length > 0 ?
                            (() => {
                              const stops = trainStops[trainId].stops;
                              const originIdx = stops.findIndex(s => s.StationID === originStationId);
                              const destIdx = stops.findIndex(s => s.StationID === destStationId);
                              
                              const stopDataList = stops.map((stop, idx) => {
                                const stopDep = timeToMinutes(stop.DepartureTime) + (delay || 0);
                                const stopArr = timeToMinutes(stop.ArrivalTime || stop.DepartureTime) + (delay || 0);

                                const isOrigin = stop.StationID === originStationId;
                                const isDest = stop.StationID === destStationId;
                                const isSpecifiedRoute = originIdx !== -1 && destIdx !== -1 && (
                                  (originIdx <= idx && destIdx >= idx) || (originIdx >= idx && destIdx <= idx)
                                );

                                const isAtStop = isToday && nowMinutes >= stopArr && nowMinutes <= stopDep;
                                const isPassed = isToday && nowMinutes > stopDep;
                                
                                // Better leg detection
                                let isBetweenLeg = false;
                                if (isToday && idx < stops.length - 1) {
                                  const nextStop = stops[idx + 1];
                                  const nextArr = timeToMinutes(nextStop.ArrivalTime || nextStop.DepartureTime) + (delay || 0);
                                  if (nowMinutes > stopDep && nowMinutes < nextArr) isBetweenLeg = true;
                                }

                                return { stop, idx, stopDep, stopArr, isOrigin, isDest, isSpecifiedRoute, isAtStop, isPassed, isBetweenLeg };
                              }).filter(data => {
                                if (originIdx !== -1 && destIdx !== -1 && !data.isSpecifiedRoute && !data.isOrigin && !data.isDest) return false;
                                return true;
                              });

                              const firstNotPassedIdx = stopDataList.findIndex(d => !d.isPassed);
                              const passedCount = firstNotPassedIdx === -1 ? stopDataList.length : firstNotPassedIdx;
                              const hasHiddenStops = !showPassedStops && passedCount > 0 && passedCount < stopDataList.length; // Don't hide if ALL are passed (e.g. trip ended)

                              return (
                                <>
                                  {hasHiddenStops && (
                                    <div className="flex relative justify-center my-4 sm:my-6 group/passed z-20">
                                      <div className={`absolute left-3 w-[2px] h-full ${thm.lineBase} sm:left-4 z-0`}></div>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setShowPassedStops(true); }}
                                        className={`relative z-10 flex items-center gap-2 px-5 py-2 sm:py-2.5 ${thm.btnBg} ${thm.btnHover} ${thm.textMuted} hover:text-white text-xs sm:text-sm font-semibold rounded-full transition-all border ${thm.borderSoft} shadow-lg hover:shadow-xl hover:scale-105 active:scale-95`}
                                      >
                                        <ChevronDown className={`w-4 h-4 sm:w-5 sm:h-5 ${thm.textMuted}`} />
                                        {i18n.language === 'zh-TW' ? `展開 ${passedCount} 個已過站時刻` : `View ${passedCount} passed stops`}
                                      </button>
                                    </div>
                                  )}
                                  {stopDataList.map((data) => {
                                    if (hasHiddenStops && data.isPassed) return null;
                                    const { stop, idx, stopDep, stopArr, isOrigin, isDest, isSpecifiedRoute, isAtStop, isPassed, isBetweenLeg } = data;
                                    const serviceDateId = activeTab === 'return' ? returnDate : selectedDate;
                                    const serviceDate = (dates.find(d => d.id === serviceDateId) || dates[0]).value;
                                    const stationTime = (stop.ArrivalTime || stop.DepartureTime || '').substring(0, 5);
                                    const footfallDate = serviceDateForStationTime(serviceDate, dep, stationTime);

                                    return (
                                      <div key={`stop-editorial-${stop.StationID || idx}`} className={`flex items-stretch gap-4 sm:gap-8 relative group/stop transition-all duration-500 ${isPassed ? 'opacity-30' : 'opacity-100'}`}>
                                    {/* Timeline Column */}
                                    <div className="flex flex-col items-center w-6 sm:w-8 shrink-0 relative">
                                      <div className={`w-[2px] h-full absolute top-0 bottom-0 ${
                                        isPassed ? thm.linePassed :
                                        isSpecifiedRoute ? thm.bgTimeline : thm.lineBase
                                      }`}>
                                        {isBetweenLeg && (
                                          <div className={`absolute top-0 bottom-0 left-0 right-0 bg-gradient-to-b ${thm.bgBetween} to-transparent animate-shimmer-y`}></div>
                                        )}
                                      </div>
                                      
                                      <div className={`w-3 h-3 rounded-full mt-7 z-10 border-2 ${thm.circleBorder} transition-all duration-500 ${
                                        isAtStop ? `${thm.bgSolid} ring-4 ${thm.pulseRing} scale-125 animate-pulse` :
                                        isOrigin || isDest ? 'bg-amber-400' :
                                        isSpecifiedRoute ? thm.bgTimeline : thm.circleUnreached
                                      }`}>
                                        {isAtStop && <StationHaptics active={isAtStop} />}
                                      </div>
                                    </div>

                                    {/* Content Column */}
                                    <div className={`flex flex-1 items-center justify-between py-4 sm:py-6 border-b ${thm.borderSoft} min-w-0 ${isAtStop ? `${thm.bgHighlight} -mx-2 sm:-mx-4 px-2 sm:px-4 rounded-2xl border-none` : ''}`}>
                                      <div className="flex flex-col gap-1 min-w-0 flex-1 pr-2 sm:pr-4">
                                        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                                          <span className={`text-lg sm:text-2xl font-black tracking-tight truncate ${
                                            isAtStop ? thm.textHighlightLight : (isOrigin || isDest) ? 'text-amber-400' : thm.textNormal
                                          }`}>
                                            {i18n.language === 'zh-TW' ? (stop?.StationName?.Zh_tw || '車站') : (stop?.StationName?.En || 'Station')}
                                          </span>
                                          
                                          {/* Mobile time display - inline, horizontal, and elegant */}
                                          <div className={`flex sm:hidden items-center gap-1.5 px-2 py-0.5 rounded-full ${thm.btnBg} border ${thm.borderSoft} text-[11px] font-mono font-black shrink-0 shadow-inner`}>
                                            {(stop.ArrivalTime && stop.ArrivalTime !== stop.DepartureTime) ? (
                                              <>
                                                <span className={thm.textMuted}>{stop.ArrivalTime?.substring(0, 5)}</span>
                                                <span className="text-slate-600 text-[10px] font-extrabold">➔</span>
                                                <span className={isAtStop ? `${thm.textHighlight} font-black` : `${thm.textNormal} font-extrabold`}>
                                                  {stop.DepartureTime?.substring(0, 5)}
                                                </span>
                                              </>
                                            ) : (
                                              <span className={isAtStop ? `${thm.textHighlight} font-black` : `${thm.textNormal} font-extrabold`}>
                                                {stop.DepartureTime?.substring(0, 5) ?? '--:--'}
                                              </span>
                                            )}
                                          </div>

                                          {isAtStop && (
                                            <span className={`flex items-center gap-1.5 px-1.5 sm:px-2 py-0.5 rounded ${thm.bgHighlight} ${thm.textHighlight} text-[9px] sm:text-[10px] font-black uppercase tracking-widest animate-pulse border ${thm.borderHighlight} shrink-0`}>
                                              {i18n.language === 'zh-TW' ? '目前位置' : 'Current'}
                                            </span>
                                          )}
                                          {(isOrigin || isDest) && (
                                            <span className="px-1.5 sm:px-2 py-0.5 rounded bg-amber-400/10 text-amber-400 text-[9px] sm:text-[10px] font-black uppercase tracking-widest border border-amber-400/10 shrink-0">
                                              {isOrigin ? (i18n.language === 'zh-TW' ? '起點' : 'Origin') : (i18n.language === 'zh-TW' ? '終點' : 'Dest')}
                                            </span>
                                          )}
                                          {(() => {
                                            const stationName = transportType === 'hsr'
                                              ? `高鐵${stop?.StationName?.Zh_tw || ''}`.replace('高鐵高鐵', '高鐵')
                                              : (stop?.StationName?.Zh_tw || '');
                                            const fallbackName = stop?.StationName?.Zh_tw || '';
                                            const transfers = getTransfers(stationName).length
                                              ? getTransfers(stationName)
                                              : getTransfers(fallbackName);
                                            if (!transfers.length) return null;
                                            return (
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setTransferStationName(fallbackName);
                                                  setTransferStationId(stop.StationID);
                                                  setTransferTransportType(transportType);
                                                  setTransferTrainDirection(train.DailyTrainInfo?.Direction);
                                                  setTransferModalOpen(true);
                                                }}
                                                title={i18n.language === 'zh-TW' ? '點擊查看轉乘最速攻略資訊' : 'Click to view high-speed transfer details'}
                                                className="relative inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black tracking-wide bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-[0_0_12px_rgba(59,130,246,0.5)] hover:shadow-[0_0_16px_rgba(59,130,246,0.7)] hover:scale-[1.05] active:scale-[0.95] transition-all duration-300 border border-blue-400/30 whitespace-nowrap cursor-pointer z-10"
                                              >
                                                <span className="relative flex h-2 w-2">
                                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-100 opacity-75"></span>
                                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-200"></span>
                                                </span>
                                                <span>{i18n.language === 'zh-TW' ? '轉乘資訊' : 'Transfer Info'}</span>
                                              </button>
                                            );
                                          })()}
                                        </div>
                                        {transportType === 'train' && (
                                          <StationFootfallBadge
                                            mode="tra"
                                            stationId={stop.StationID}
                                            date={footfallDate}
                                            time={stationTime}
                                            language={i18n.language}
                                            className="mt-0.5"
                                          />
                                        )}
                                        <div className="flex items-center gap-2 sm:gap-3 text-[10px] font-bold text-slate-500 uppercase tracking-tighter flex-wrap">
                                          <span className="shrink-0">{i18n.language === 'zh-TW' ? '第' : 'Sequence '} {stop.StopSequence} {i18n.language === 'zh-TW' ? '站' : ''}</span>
                                        </div>
                                      </div>

                                      <div className="hidden sm:flex flex-col sm:flex-row items-end gap-0.5 sm:gap-8 shrink-0">
                                        {(stop.ArrivalTime && stop.ArrivalTime !== stop.DepartureTime) && (
                                          <div className="flex sm:flex-col items-center sm:items-end gap-2 sm:gap-0 opacity-40">
                                            <div className="text-[9px] sm:hidden font-bold text-slate-500 uppercase tracking-widest">{i18n.language === 'zh-TW' ? '抵達' : 'Arr'}</div>
                                            <div className={`text-sm font-black font-mono ${thm.textMuted}`}>
                                              {stop.ArrivalTime?.substring(0, 5) ?? '--:--'}
                                            </div>
                                            <div className="hidden sm:block text-[9px] font-bold text-slate-600 uppercase tracking-widest text-right">{i18n.language === 'zh-TW' ? '抵達時間' : 'Arrival'}</div>
                                          </div>
                                        )}
                                        <div className="flex sm:flex-col items-center sm:items-end gap-2 sm:gap-0">
                                          <div className="text-[9px] sm:hidden font-bold text-slate-500 uppercase tracking-widest">{i18n.language === 'zh-TW' ? '出發' : 'Dep'}</div>
                                          <div className={`text-lg sm:text-2xl font-black font-mono transition-colors ${isAtStop ? thm.textHighlightLight : thm.textMuted}`}>
                                            {stop.DepartureTime?.substring(0, 5) ?? '--:--'}
                                          </div>
                                          <div className="hidden sm:block text-[9px] sm:text-[10px] font-bold text-slate-600 uppercase tracking-widest">{i18n.language === 'zh-TW' ? '出發時間' : 'Departure'}</div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                              </>
                            );
                            })()
                          : (
                              <div className="py-20 text-center bg-slate-800/30 rounded-[2.5rem] border border-dashed border-slate-800">
                                 <p className="text-slate-500 font-bold tracking-widest uppercase text-xs">No Sequence Data Available</p>
                              </div>
                            )}
                          </div>
                        </>
                      ) : activeDetailTab[trainId] === 'youbike' ? (
                        /* YOUBIKE TAB CONTENT — 起點站與終點站各自最近的 YouBike */
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-in fade-in duration-300 pb-4">
                          {renderYouBikeCard(originStationId, i18n.language === 'zh-TW' ? '起點站' : 'Origin')}
                          {renderYouBikeCard(destStationId, i18n.language === 'zh-TW' ? '終點站' : 'Destination')}
                        </div>
                      ) : (
                        /* STATION/BUS TAB CONTENT */
                        <div className="flex flex-col gap-6 animate-in fade-in duration-300">
                          {/* Selector for Origin or Destination station */}
                          <div className="flex gap-4">
                            {(() => {
                              const originName = stations.find(s => s.StationID === originStationId)?.StationName?.Zh_tw || '';
                              const destName = stations.find(s => s.StationID === destStationId)?.StationName?.Zh_tw || '';
                              const currentStationId = activeBusStationId[trainId] || originStationId;

                              return (
                                <>
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setActiveBusStationId(prev => ({ ...prev, [trainId]: originStationId }));
                                      fetchNearbyBuses(originStationId, originName);
                                    }}
                                    className={`flex-1 py-3 px-4 rounded-xl border font-bold text-sm transition-all flex flex-col items-center gap-1 ${
                                      currentStationId === originStationId
                                        ? `${thm.bgHighlight} border-current ${thm.textHighlight} shadow-md`
                                        : `${thm.btnBg} border-transparent ${thm.textMuted} hover:${thm.btnHover} hover:${thm.textNormal}`
                                    }`}
                                  >
                                    <span className="text-[10px] uppercase tracking-wider opacity-60">
                                      {i18n.language === 'zh-TW' ? '起點站' : 'Origin'}
                                    </span>
                                    <span className="text-sm sm:text-base flex items-center gap-1.5 font-black">
                                      <MapPin className="w-3.5 h-3.5 shrink-0" />
                                      {originName}
                                    </span>
                                  </button>
                                  
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setActiveBusStationId(prev => ({ ...prev, [trainId]: destStationId }));
                                      fetchNearbyBuses(destStationId, destName);
                                    }}
                                    className={`flex-1 py-3 px-4 rounded-xl border font-bold text-sm transition-all flex flex-col items-center gap-1 ${
                                      currentStationId === destStationId
                                        ? `${thm.bgHighlight} border-current ${thm.textHighlight} shadow-md`
                                        : `${thm.btnBg} border-transparent ${thm.textMuted} hover:${thm.btnHover} hover:${thm.textNormal}`
                                    }`}
                                  >
                                    <span className="text-[10px] uppercase tracking-wider opacity-60">
                                      {i18n.language === 'zh-TW' ? '終點站' : 'Destination'}
                                    </span>
                                    <span className="text-sm sm:text-base flex items-center gap-1.5 font-black">
                                      <MapPin className="w-3.5 h-3.5 shrink-0" />
                                      {destName}
                                    </span>
                                  </button>
                                </>
                              );
                            })()}
                          </div>

                          {/* Bus Stops Content */}
                          {(() => {
                            const currentStationId = activeBusStationId[trainId] || originStationId;
                            const busInfo = nearbyBuses[currentStationId];

                            if (!busInfo || busInfo.loading) {
                              return (
                                <div className="py-12 min-h-[400px] flex flex-col items-center justify-center gap-4 text-slate-500">
                                  <div className="w-8 h-8 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
                                  <span className="text-xs font-black uppercase tracking-widest text-slate-300">
                                    {i18n.language === 'zh-TW' ? '正在搜尋周邊公車站...' : 'Searching Nearby Bus Stops...'}
                                  </span>
                                </div>
                              );
                            }

                            if (busInfo.error) {
                              return (
                                <div className="py-12 min-h-[400px] flex items-center justify-center">
                                  <div className="text-center bg-red-500/10 rounded-3xl border border-red-500/20 text-red-400 px-6 py-4 w-full">
                                    <p className="font-bold text-sm">{i18n.language === 'zh-TW' ? '無法載入公車資訊' : 'Unable to load bus info'}</p>
                                    <p className="text-xs opacity-80 mt-1">{busInfo.error}</p>
                                  </div>
                                </div>
                              );
                            }

                            const list = busInfo.stations;
                            if (!list || list.length === 0) {
                              return (
                                <div className="py-12 min-h-[400px] flex items-center justify-center">
                                  <div className="text-center bg-slate-800/30 rounded-3xl border border-dashed border-slate-800 px-6 py-4 w-full">
                                    <p className="text-slate-500 font-bold uppercase text-xs tracking-wider">
                                      {i18n.language === 'zh-TW' ? '周邊 500 公尺內無公車站資訊' : 'No Nearby Bus Stops Within 500m'}
                                    </p>
                                  </div>
                                </div>
                              );
                            }

                            const currentSelId = selectedBusStationId[trainId] || list[0].StationID;
                            const station = list.find((s: BusStation) => s.StationID === currentSelId) || list[0];
                            const isDropdownOpen = !!isBusStationDropdownOpen[trainId];

                            return (
                              <div className="flex flex-col gap-6 animate-in fade-in duration-300 pr-2 pb-4">
                                <div className="bg-slate-800/40 border border-slate-700/50 rounded-3xl flex flex-col overflow-hidden shadow-lg">
                                  {/* Header */}
                                  <div className="flex justify-between items-center p-4 border-b border-slate-700/50">
                                    <h3 className="font-bold text-slate-200 text-lg">{i18n.language === 'zh-TW' ? '附近公車站牌' : 'Nearby Bus Stops'}</h3>
                                    <span className="text-slate-400 text-xs font-medium">
                                      {i18n.language === 'zh-TW'
                                        ? `${busCountdown[trainId] !== undefined ? busCountdown[trainId] : 10} 秒後更新`
                                        : `Update in ${busCountdown[trainId] !== undefined ? busCountdown[trainId] : 10}s`}
                                    </span>
                                  </div>
                                  
                                  {/* Station Info with custom Dropdown */}
                                  <div className="flex justify-between items-center p-4 relative">
                                    <div className="relative">
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setIsBusStationDropdownOpen(prev => ({ ...prev, [trainId]: !prev[trainId] }));
                                        }}
                                        className="font-bold text-slate-200 text-xl flex items-center gap-2 hover:text-white transition-colors"
                                      >
                                        <span>{station.StationName.Zh_tw}</span>
                                        <ChevronDown className="w-5 h-5 text-slate-400" />
                                      </button>

                                      {/* Dropdown Menu */}
                                      {isDropdownOpen && (
                                        <div className="absolute left-0 mt-2 w-64 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden py-1 animate-in fade-in slide-in-from-top-1 duration-150">
                                          {list.map((s: BusStation) => (
                                            <button
                                              key={s.StationID}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedBusStationId(prev => ({ ...prev, [trainId]: s.StationID }));
                                                setIsBusStationDropdownOpen(prev => ({ ...prev, [trainId]: false }));
                                              }}
                                              className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-700/50 transition-colors ${
                                                s.StationID === station.StationID ? 'text-blue-400 font-bold bg-blue-500/5' : 'text-slate-300'
                                              }`}
                                            >
                                              <div className="flex justify-between items-center">
                                                <span>{s.StationName.Zh_tw}</span>
                                                {s.Distance !== undefined && (
                                                  <span className="text-xs text-slate-500">{Math.round(s.Distance)}m</span>
                                                )}
                                              </div>
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-3 text-slate-400 text-sm">
                                      <span>{station.Distance !== undefined ? `${Math.round(station.Distance)}m` : ''}</span>
                                    </div>
                                  </div>

                                  {/* Routes List */}
                                  <div className="flex flex-col">
                                    {station.Stops?.map((stop, idx) => {
                                      const seed = busEtaSeed[trainId] || 0;
                                      const rawEta = ((parseInt(stop.RouteID.replace(/\D/g, '') || '0') + idx * 7 + (station.StationName.Zh_tw.length)) % 40) + 5;
                                      let mockEta = rawEta - seed;
                                      if (mockEta < 0) {
                                        mockEta = ((rawEta - seed) % 45 + 45) % 45;
                                      }
                                      const etaText = mockEta === 0 ? (i18n.language === 'zh-TW' ? '進站中' : 'Arr') : `${mockEta}${i18n.language === 'zh-TW' ? '分' : 'm'}`;
                                      const isApproaching = mockEta <= 3;
                                      
                                      return (
                                        <div key={`${stop.RouteID}-${idx}`} className="flex items-center justify-between p-4 border-t border-slate-700/50 hover:bg-slate-800/50 transition-colors">
                                          <div className="flex items-center gap-4">
                                            {/* ETA Box */}
                                            <div className={`w-[72px] h-[44px] flex items-center justify-center rounded-lg border shadow-sm ${isApproaching ? 'border-red-500/50 bg-red-500/10 text-red-400' : 'border-slate-600 bg-slate-800/80 text-slate-300'} font-bold text-base`}>
                                              {etaText}
                                            </div>
                                            
                                            {/* Route Info */}
                                            <div className="flex flex-col gap-1">
                                              <span className="font-bold text-xl text-slate-200 leading-none">{stop.RouteName.Zh_tw}</span>
                                              <span className="text-slate-400 text-sm leading-none mt-1">{i18n.language === 'zh-TW' ? '往' : 'To'} {station.StationName.Zh_tw}</span>
                                            </div>
                                          </div>
                                          
                                          {/* Heart Icon */}
                                          <button className="p-2 text-slate-500 hover:text-red-400 transition-colors rounded-full hover:bg-red-500/10">
                                            <Heart className="w-6 h-6" />
                                          </button>
                                        </div>
                                      );
                                    })}
                                    {(!station.Stops || station.Stops.length === 0) && (
                                      <div className="p-6 text-center text-slate-500 text-sm border-t border-slate-700/50">
                                        {i18n.language === 'zh-TW' ? '此站牌目前無路線資訊' : 'No routes data'}
                                      </div>
                                    )}
                                  </div>
                                  
                                  {/* Footer Link */}
                                  <div className="p-4 border-t border-slate-700/50 text-center">
                                    <button className="text-blue-400 font-bold hover:text-blue-300 transition-colors text-sm">
                                      {i18n.language === 'zh-TW' ? '更多公車路線' : 'More Bus Routes'}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                      </>
                    );

                      const getBgClass = () => {
                         const destName = stations.find(s => s.StationID === destStationId)?.StationName?.Zh_tw || '';
                         const env = getEnvironment(destName);
                         if (transportType === 'hsr') {
                           if (env.weather === 'rainy') return 'bg-[#3E2723] border-[#4E342E]';
                           if (env.timeOfDay === 'morning') return 'bg-[#4E342E] border-[#5D4037]';
                           if (env.timeOfDay === 'night') return 'bg-[#2D1A11] border-[#3E2723]';
                           return 'bg-[#3E2723] border-[#4E342E]';
                         }
                         if (env.weather === 'rainy') return 'bg-slate-900 border-slate-800';
                         if (env.timeOfDay === 'morning') return 'bg-[#1a0f05] border-[#2a1a0a]';
                         if (env.timeOfDay === 'night') return 'bg-[#0a0d1a] border-[#1a1d2a]';
                         return 'bg-slate-900 border-slate-800';
                      };

                      return (
                        <>
                          {/* Desktop Inline */}
                          {expandedTrainId === trainId && (
                            <div 
                              onClick={(e) => e.stopPropagation()}
                              className={`hidden md:block relative overflow-hidden p-8 md:p-10 border-t transition-all duration-700 animate-in slide-in-from-top-4 fade-in ${getBgClass()}`}
                            >
                              {trainStopsContent}
                            </div>
                          )}

                          {/* Mobile Bottom Sheet (Portal) */}
                          {typeof document !== 'undefined' && createPortal(
                            <AnimatePresence>
                              {expandedTrainId === trainId && (
                                <>
                                  <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); setExpandedTrainId(null); }}
                                    className="md:hidden fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
                                  />
                                  <motion.div
                                    initial={{ y: "100%" }}
                                    animate={{ y: 0 }}
                                    exit={{ y: "100%" }}
                                    onClick={(e) => e.stopPropagation()}
                                    transition={{ type: "spring", damping: 25, stiffness: 200 }}
                                    className={`md:hidden fixed inset-x-0 bottom-0 z-[100] w-full h-[88vh] rounded-t-[2rem] shadow-[0_-20px_60px_-15px_rgba(0,0,0,0.5)] border-t border-white/10 flex flex-col overflow-hidden ${getBgClass()}`}
                                  >
                                    <div className="absolute top-0 inset-x-0 h-10 flex items-center justify-center z-50 pointer-events-none">
                                      <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                                    </div>
                                    <button 
                                      onClick={(e: React.MouseEvent) => { e.stopPropagation(); setExpandedTrainId(null); }}
                                      className="absolute top-4 right-4 z-50 p-2 bg-white/10 hover:bg-white/20 rounded-full backdrop-blur-md transition-colors"
                                    >
                                      <X className="w-5 h-5 text-white" />
                                    </button>
                                    <div className="flex-1 overflow-y-auto px-5 pt-12 pb-10 relative soft-scrollbar">
                                      {trainStopsContent}
                                    </div>
                                  </motion.div>
                                </>
                              )}
                            </AnimatePresence>,
                            document.body
                          )}
                        </>
                      );
                    })()}
                  </motion.div>
                );
              });
            })()}

      {/* Pagination Controls */}
            {filteredTimetables.length > pageSize && (
              <div className="flex items-center justify-between mt-8 mb-12 px-2">
                <button 
                  disabled={currentPage === 1}
                  onClick={() => {
                    setCurrentPage(prev => Math.max(1, prev - 1));
                    document.getElementById('results-section')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="px-6 py-3 rounded-full bg-white border border-slate-200 text-slate-700 font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                >
                  {t('app.results.prev')}
                </button>
                <div className="text-sm font-semibold text-slate-500 bg-white px-5 py-2 rounded-full border border-slate-100 shadow-sm">
                  {t('app.results.page', { current: currentPage, total: Math.ceil(filteredTimetables.length / pageSize) })}
                </div>
                <button 
                  disabled={currentPage === Math.ceil(filteredTimetables.length / pageSize)}
                  onClick={() => {
                    setCurrentPage(prev => Math.min(Math.ceil(filteredTimetables.length / pageSize), prev + 1));
                    document.getElementById('results-section')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="px-6 py-3 rounded-full bg-white border border-slate-200 text-slate-700 font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                >
                  {t('app.results.next')}
                </button>
              </div>
            )}
            {/* 推廣版位（docs/affiliate-integration-spec.md）：
                內容版位帶目的地站名當 `{crop}` 與 crops 比對值；跑馬燈不帶脈絡。
                兩者的資料都來自 /api/affiliates，沒有啟用資料時各自不顯示。 */}
            {filteredTimetables.length > 0 && (
              <>
                <AffiliateSlot
                  category={transportType}
                  keyword={
                    stations.find(s => s.StationID === destStationId)?.StationName?.[
                      i18n.language === 'zh-TW' ? 'Zh_tw' : 'En'
                    ] || null
                  }
                  language={i18n.language}
                />
                <AffiliateMarquee language={i18n.language} />
              </>
            )}
          </div>
          </>
          )}
        </div>
      </section>
      )}

      {/* SEO: Intro + FAQ — keeps crawlable content on the homepage.
          #8: collapsed once the user has run a search so results aren't buried under marketing.
          Initial / SSR render (hasSearched=false) still emits full content for crawlers. */}
      <section className={`max-w-4xl mx-auto px-6 md:px-10 py-16 prose prose-slate dark:prose-invert ${hasSearched ? 'hidden' : ''}`}>
        <h2 className="text-balance text-2xl md:text-3xl font-bold tracking-tight text-slate-800 dark:text-slate-100 mb-4">
          {i18n.language === 'zh-TW' ? '關於鐵道查詢' : 'About Taiwanrail'}
        </h2>
        <p className="text-slate-600 dark:text-slate-400 leading-relaxed text-[15px] mb-8">
          {i18n.language === 'zh-TW'
            ? '鐵道查詢是一個免費的台灣鐵路時刻表查詢工具，整合 台鐵 (TRA) 與 高鐵 (THSR) 兩大系統，提供即時班次、票價、停靠站資訊以及誤點狀態。不需註冊即可搜尋任意兩站之間的所有班次，並可轉乘台北捷運、高雄捷運、桃園機場捷運、台中捷運與 BRT。'
            : 'Taiwanrail is a free Taiwan train timetable search tool combining the Taiwan Railways Administration (TRA) and Taiwan High Speed Rail (THSR) systems. Check live schedules, fares, stops and delays, plus metro transfer hints (Taipei MRT, Kaohsiung MRT, Taoyuan Airport MRT, Taichung MRT) — no sign-up required.'}
        </p>
        <p className="text-slate-500 dark:text-slate-400 leading-relaxed text-sm mb-8">
          {i18n.language === 'zh-TW' ? '班次、票價與即時狀態資料來源：' : 'Schedules, fares and live status data: '}
          <a
            href="https://tdx.transportdata.tw/"
            rel="external noopener noreferrer"
            target="_blank"
            className="font-semibold underline underline-offset-4"
          >
            {i18n.language === 'zh-TW' ? '交通部 TDX 運輸資料流通服務平臺' : 'Taiwan MOTC TDX'}
          </a>
        </p>

        <h2 className="text-balance text-2xl md:text-3xl font-bold tracking-tight text-slate-800 dark:text-slate-100 mb-4">
          {i18n.language === 'zh-TW' ? '熱門路線' : 'Popular Routes'}
        </h2>
        {(() => {
          const isZh = i18n.language === 'zh-TW';
          const popularRoutes: { href: string; type: 'train' | 'hsr'; zh: [string, string]; en: [string, string] }[] = [
            { href: '/routes/train/taipei-to-kaohsiung/',   type: 'train', zh: ['臺北', '高雄'], en: ['Taipei', 'Kaohsiung'] },
            { href: '/routes/train/taipei-to-tainan/',      type: 'train', zh: ['臺北', '臺南'], en: ['Taipei', 'Tainan'] },
            { href: '/routes/train/taipei-to-taichung/',    type: 'train', zh: ['臺北', '臺中'], en: ['Taipei', 'Taichung'] },
            { href: '/routes/train/taipei-to-hsinchu/',     type: 'train', zh: ['臺北', '新竹'], en: ['Taipei', 'Hsinchu'] },
            { href: '/routes/train/taipei-to-hualien/',     type: 'train', zh: ['臺北', '花蓮'], en: ['Taipei', 'Hualien'] },
            { href: '/routes/train/taipei-to-yilan/',       type: 'train', zh: ['臺北', '宜蘭'], en: ['Taipei', 'Yilan'] },
            { href: '/routes/train/taichung-to-kaohsiung/', type: 'train', zh: ['臺中', '高雄'], en: ['Taichung', 'Kaohsiung'] },
            { href: '/routes/train/banqiao-to-kaohsiung/',  type: 'train', zh: ['板橋', '高雄'], en: ['Banqiao', 'Kaohsiung'] },
            { href: '/routes/train/hualien-to-taitung/',    type: 'train', zh: ['花蓮', '臺東'], en: ['Hualien', 'Taitung'] },
            { href: '/routes/hsr/taipei-to-zuoying/',       type: 'hsr',   zh: ['臺北', '左營'], en: ['Taipei', 'Zuoying'] },
            { href: '/routes/hsr/taipei-to-taichung/',      type: 'hsr',   zh: ['臺北', '臺中'], en: ['Taipei', 'Taichung'] },
            { href: '/routes/hsr/taipei-to-tainan/',        type: 'hsr',   zh: ['臺北', '臺南'], en: ['Taipei', 'Tainan'] },
            { href: '/routes/hsr/taipei-to-hsinchu/',       type: 'hsr',   zh: ['臺北', '新竹'], en: ['Taipei', 'Hsinchu'] },
            { href: '/routes/hsr/nangang-to-zuoying/',      type: 'hsr',   zh: ['南港', '左營'], en: ['Nangang', 'Zuoying'] },
            { href: '/routes/hsr/taichung-to-zuoying/',     type: 'hsr',   zh: ['臺中', '左營'], en: ['Taichung', 'Zuoying'] },
            { href: '/routes/hsr/banqiao-to-taichung/',     type: 'hsr',   zh: ['板橋', '臺中'], en: ['Banqiao', 'Taichung'] },
            { href: '/routes/hsr/taoyuan-to-taichung/',     type: 'hsr',   zh: ['桃園', '臺中'], en: ['Taoyuan', 'Taichung'] },
          ];
          const rowA = popularRoutes.filter((_, i) => i % 2 === 0);
          const rowB = popularRoutes.filter((_, i) => i % 2 === 1);

          const Card = (r: typeof popularRoutes[number], dup: boolean) => {
            const isHsr = r.type === 'hsr';
            const [from, to] = isZh ? r.zh : r.en;
            const badge = isHsr ? (isZh ? '高鐵' : 'THSR') : (isZh ? '台鐵' : 'TRA');
            const fullLabel = isZh ? `${from}到${to}${badge}時刻表` : `${from} to ${to} ${badge} timetable`;
            return (
              <a
                key={`${r.href}-${dup ? 'd' : 'o'}`}
                href={isZh ? r.href : `/en${r.href}`}
                aria-label={fullLabel}
                title={fullLabel}
                aria-hidden={dup || undefined}
                tabIndex={dup ? -1 : undefined}
                className="group/route shrink-0 flex items-center gap-2.5 rounded-3xl border border-slate-200/80 dark:border-white/10 bg-white/80 dark:bg-slate-800/60 backdrop-blur px-4 py-2.5 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-blue-300/70 dark:hover:border-blue-500/40 transition-all duration-300"
              >
                <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md ${isHsr ? 'bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300' : 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300'}`}>{badge}</span>
                <span className="text-sm font-bold text-slate-700 dark:text-slate-200 whitespace-nowrap">{from}</span>
                <ArrowRight className={`size-3.5 shrink-0 ${isHsr ? 'text-orange-400' : 'text-blue-400'}`} />
                <span className="text-sm font-bold text-slate-700 dark:text-slate-200 whitespace-nowrap">{to}</span>
                <span className="sr-only">{fullLabel}</span>
              </a>
            );
          };

          return (
            <div
              className="routes-marquee mb-10 -mx-4 sm:mx-0"
              style={{
                WebkitMaskImage: 'linear-gradient(to right, transparent, #000 5%, #000 95%, transparent)',
                maskImage: 'linear-gradient(to right, transparent, #000 5%, #000 95%, transparent)',
              }}
            >
              <div className="routes-marquee-viewport">
                {[rowA, rowB].map((row, rowIdx) => (
                  <div key={rowIdx} className={`routes-marquee-track ${rowIdx === 0 ? 'rtl' : 'ltr'}`}>
                    {[false, true].map((dup) => (
                      <div key={String(dup)} className="routes-marquee-group" aria-hidden={dup || undefined}>
                        {row.map((r) => Card(r, dup))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        <h2 className="text-balance text-2xl md:text-3xl font-bold tracking-tight text-slate-800 dark:text-slate-100 mb-6">
          {i18n.language === 'zh-TW' ? '常見問題 FAQ' : 'Frequently Asked Questions'}
        </h2>
        <div className="space-y-4">
          {(i18n.language === 'zh-TW'
            ? [
                { q: '這個網站是免費的嗎？', a: '完全免費。資料來源為交通部 TDX 運輸資料流通服務平臺公開 API，搜尋與瀏覽都不需要註冊。' },
                { q: '可以查到當日列車誤點嗎？', a: '可以。系統會從 TDX LiveBoard 即時取得台鐵列車誤點分鐘數，並以綠色「準點」或紅色「誤點 X 分」徽章顯示。' },
                { q: '高鐵票價資料是從哪裡來的？', a: '高鐵票價直接來自 TDX 高鐵 ODFare API，涵蓋標準座、商務座、自由座全票價格。' },
                { q: '可以離線使用嗎？', a: '可以部分離線。本網站是 PWA，已快取時刻表、車站資料，網路斷線時仍可瀏覽先前查過的班次。' },
                { q: '支援轉乘捷運嗎？', a: '支援。展開列車停靠站時，台北 / 桃園 / 台中 / 高雄的捷運、機場捷運、輕軌、BRT 轉乘站會顯示徽章提示。' },
                { q: '停駛與班次取消資訊可信嗎？', a: '系統會從 TDX TRA Alert API 擷取即時公告，若該班次編號出現在停駛公告中，會在卡片上蓋上紅色「停駛」章。' },
              ]
            : [
                { q: 'Is this service free?', a: 'Yes. It is 100% free and uses the official TDX (Transport Data eXchange) open API. No sign-up is required.' },
                { q: 'Does it show live delays?', a: 'Yes. TRA delay minutes are fetched live from the TDX LiveBoard API and shown as a green "On Time" or red "Delayed X min" badge.' },
                { q: 'Where do HSR fares come from?', a: 'Directly from the TDX THSR ODFare endpoint, covering standard, business and non-reserved seat prices.' },
                { q: 'Does it work offline?', a: 'Partially. As a PWA it caches the timetable and station data, so previously searched results can be viewed offline.' },
                { q: 'Are metro transfers shown?', a: 'Yes. Expanding a train reveals transfer badges for Taipei MRT, Taoyuan Airport MRT, Taichung MRT, Kaohsiung MRT, the Light Rail and BRT.' },
                { q: 'Is cancellation info reliable?', a: 'Cancellations are matched against the TDX TRA Alert feed. A red "Cancelled" stamp is placed over any train number that appears in an active alert.' },
              ]
          ).map(({ q, a }, i) => (
            <details key={i} className="group bg-white/70 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-3xl px-5 py-4">
              <summary className="cursor-pointer font-semibold text-slate-800 dark:text-slate-100 flex items-center justify-between gap-4 list-none">
                <span>{q}</span>
                <ChevronDown className="w-4 h-4 shrink-0 transition-transform duration-300 group-open:rotate-180" />
              </summary>
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Portfolio Projects Section — also hidden post-search (#8) */}
      <section className={`max-w-4xl mx-auto px-4 sm:px-6 md:px-10 pb-12 sm:pb-16 ${hasSearched ? 'hidden' : ''}`}>
        <div className="border-t border-slate-200/50 dark:border-white/5 pt-8 sm:pt-12">
          <div className="flex flex-col gap-1 sm:gap-1.5 mb-6 sm:mb-8 text-center sm:text-left">
            <h2 className="text-balance text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-slate-800 dark:text-slate-100 flex items-center justify-center sm:justify-start gap-2">

              {i18n.language === 'zh-TW' ? '精選作品推薦' : 'Featured Projects'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed max-w-lg mx-auto sm:mx-0">
              {i18n.language === 'zh-TW'
                ? '精心打造的高質感生活與智慧分析工具，歡迎點擊前往體驗：'
                : 'Handcrafted premium utilities and smart analytics solvers. Tap below to launch:'}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6">
            {[
              {
                title: i18n.language === 'zh-TW' ? '蔬果價格查詢' : 'Veggie Price Query',
                url: 'https://tw-veggieprice.vercel.app/',
                icon: <Leaf className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />,
                badgeBg: 'bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
                desc: i18n.language === 'zh-TW' 
                  ? [
                      '整合每日最新市場交易行情，提供直觀清晰的歷史與即時圖表分析。',
                      '支援快速搜尋與波動趨勢預警，是您採購與家庭記帳的超強得力助手。'
                    ]
                  : [
                      'Integrates daily market exchange pricing with rich interactive price charts.',
                      'Provides powerful trend alerts and instant lookups for smart grocery plans.'
                    ]
              },
              {
                title: i18n.language === 'zh-TW' ? 'AI 股票分析' : 'AI Stock Analysis',
                url: 'https://stock-analyze-ai-connect.vercel.app/',
                icon: <TrendingUp className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />,
                badgeBg: 'bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400',
                desc: i18n.language === 'zh-TW' 
                  ? [
                      '運用先進人工智慧模型深度剖析個股技術指標與即時公司財報數據。',
                      '快速生成全方位分析診斷評估，為您的每筆理財決策增添智慧指引。'
                    ]
                  : [
                      'Leverages top-tier AI models to review key charts and financial files.',
                      'Rapidly compiles diagnostic reports to empower your modern investment plans.'
                    ]
              },
              {
                title: i18n.language === 'zh-TW' ? 'AI 旅遊行程規劃' : 'AI Itinerary Planner',
                url: 'https://roam-jelly-web.vercel.app/',
                icon: <Compass className="w-5 h-5 text-amber-600 dark:text-amber-400" />,
                badgeBg: 'bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400',
                desc: i18n.language === 'zh-TW' 
                  ? [
                      '依個人預算與景點喜好，一鍵產出專屬規劃與最佳交通動線安排。',
                      '流暢貼心的地圖整合，讓每次說走就走的自助小旅行都無比輕鬆。'
                    ]
                  : [
                      'Creates dynamic multi-stop travel routes customized for your calendar/budget.',
                      'Tailored mapping, coordinates and options keep you organized on any trip.'
                    ]
              }
            ].map((proj, idx) => (
              <motion.a 
                key={idx}
                href={proj.url}
                target="_blank"
                rel="noopener noreferrer"
                whileHover={{ y: -5, scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                className="group bg-white/70 dark:bg-slate-900/40 border border-slate-200/80 dark:border-slate-800/80 hover:border-indigo-400/50 dark:hover:border-indigo-500/50 hover:bg-white dark:hover:bg-slate-950/60 rounded-3xl p-6 transition-all duration-300 shadow-sm hover:shadow-md flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className={`p-2.5 rounded-2xl ${proj.badgeBg}`}>
                      {proj.icon}
                    </div>
                    <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-indigo-500 transition-colors" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors mb-2">
                    {proj.title}
                  </h3>
                  <div className="space-y-1.5">
                    {proj.desc.map((line, lIdx) => (
                      <p key={lIdx} className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-normal">
                        {line}
                      </p>
                    ))}
                  </div>
                </div>
                <div className="mt-5 pt-3 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-end text-xs font-bold text-slate-400 group-hover:text-indigo-500 transition-colors">
                  <span className="flex items-center gap-1">
                    {i18n.language === 'zh-TW' ? '立即前往' : 'Explore'}
                    <span className="group-hover:translate-x-1 duration-200 transition-transform">→</span>
                  </span>
                </div>
              </motion.a>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full py-12 border-t border-slate-200/50 dark:border-white/5 bg-transparent text-center">
        <div className="max-w-7xl mx-auto px-6">
          {/* Primary section links — a stable internal-navigation cluster that
              lets search engines surface these four functions as sitelinks. */}
          <nav aria-label={i18n.language === 'zh-TW' ? '主要功能' : 'Main features'} className="mb-6">
            <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm font-semibold">
              {(i18n.language === 'zh-TW'
                ? [
                    { href: '/tra/', label: '台鐵時刻查詢' },
                    { href: '/thsr/', label: '高鐵時刻查詢' },
                    { href: '/metro/', label: '捷運即時查詢' },
                    { href: '/journey/', label: '行程路線查詢' },
                  ]
                : [
                    { href: '/en/tra/', label: 'TRA Timetable' },
                    { href: '/en/thsr/', label: 'THSR Timetable' },
                    { href: '/en/metro/', label: 'Metro Live Search' },
                    { href: '/en/journey/', label: 'Journey Planner' },
                  ]
              ).map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <p className="text-sm text-slate-500 dark:text-slate-400 font-medium tracking-wide">
            © 2026 Taiwan Rail Explorer. <span className="mx-2 opacity-30">|</span>
            {i18n.language === 'zh-TW' ? '旅程，從這裡開始' : 'The journey starts here.'}
          </p>
        </div>
      </footer>
      {/* 20. Approaching Station Toast (Floating Bottom) */}
      {approachingInfo && (
        <AnimatePresence mode="wait">
          {isApproachingCollapsed ? (
            <motion.div
              key="collapsed-approaching"
              layoutId="approaching-toast-card"
              initial={{ scale: 0, y: 50, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0, y: 20, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className="fixed bottom-6 right-6 z-[90]"
            >
              <button
                type="button"
                onClick={() => setIsApproachingCollapsed(false)}
                className={`flex items-center gap-2.5 px-4 py-3 rounded-full shadow-2xl border text-xs font-bold text-white transition-all cursor-pointer hover:scale-105 active:scale-95 group relative overflow-hidden backdrop-blur-xl bg-slate-950/45 ${
                  transportType === 'hsr'
                    ? 'border-orange-500/30 shadow-[0_0_25px_rgba(249,115,22,0.25)] text-orange-100'
                    : 'border-blue-500/30 shadow-[0_0_25px_rgba(59,130,246,0.25)] text-blue-100'
                }`}
              >
                <div className="absolute inset-0 overflow-hidden rounded-full pointer-events-none">
                  <motion.div 
                    animate={{ x: ['-100%', '200%'] }}
                    transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                    className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-12"
                  />
                </div>

                <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-full z-0">
                  <motion.div
                    animate={{
                      x: [0, 10, -10, 0],
                      y: [0, -5, 5, 0],
                    }}
                    transition={{
                      duration: 5,
                      repeat: Infinity,
                      ease: "easeInOut"
                    }}
                    className={`absolute -top-4 -left-4 w-12 h-12 rounded-full filter blur-[12px] opacity-40 mix-blend-screen ${
                      transportType === 'hsr' ? 'bg-orange-500' : 'bg-blue-500'
                    }`}
                  />
                </div>
                
                <span className="relative flex h-2.5 w-2.5 mr-1 z-10">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00df83] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#00df83]"></span>
                </span>

                <Train className={`w-4 h-4 shrink-0 animate-bounce relative z-10 ${transportType === 'hsr' ? 'text-orange-400' : 'text-blue-400'}`} />

                <span className="whitespace-nowrap transition-all duration-300 relative z-10 flex items-center gap-1.5">
                  <span className="font-black text-[14px]">{approachingInfo.minutes}</span>
                  <span className="text-[10px] opacity-80 uppercase tracking-widest">{i18n.language === 'zh-TW' ? '分內抵達' : 'min'}</span>
                </span>
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="expanded-approaching"
              layoutId="approaching-toast-card"
              initial={{ scale: 0.8, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.8, y: 20, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 350, damping: 25 }}
              className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[90] w-[95%] max-w-[420px]"
            >
              <div 
                onClick={() => scrollToTrain(approachingInfo.trainNo)}
                className={`relative overflow-hidden rounded-[2rem] p-4 pr-16 flex items-center justify-start gap-4 cursor-pointer group shadow-2xl border backdrop-blur-2xl bg-slate-950/50 ${
                  transportType === 'hsr'
                    ? 'border-orange-500/30 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15),0_0_50px_rgba(249,115,22,0.2)]'
                    : 'border-blue-500/30 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15),0_0_50px_rgba(59,130,246,0.2)]'
                }`}
              >
                {/* Liquid Glass Background Effects */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-[2rem] z-0">
                  <motion.div
                    animate={{
                      x: [0, 30, -15, 0],
                      y: [0, -25, 15, 0],
                      scale: [1, 1.2, 0.9, 1],
                    }}
                    transition={{
                      duration: 10,
                      repeat: Infinity,
                      ease: "easeInOut"
                    }}
                    className={`absolute -top-10 -left-10 w-40 h-40 rounded-full filter blur-[40px] opacity-30 mix-blend-screen ${
                      transportType === 'hsr' ? 'bg-orange-500' : 'bg-blue-500'
                    }`}
                  />
                  <motion.div
                    animate={{
                      x: [0, -20, 25, 0],
                      y: [0, 15, -30, 0],
                      scale: [1, 0.9, 1.15, 1],
                    }}
                    transition={{
                      duration: 12,
                      repeat: Infinity,
                      ease: "easeInOut"
                    }}
                    className={`absolute -bottom-12 -right-12 w-48 h-48 rounded-full filter blur-[50px] opacity-20 mix-blend-screen ${
                      transportType === 'hsr' ? 'bg-red-500' : 'bg-indigo-500'
                    }`}
                  />
                  <div className="absolute inset-0 bg-gradient-to-tr from-white/5 via-transparent to-white/10 z-10" />
                </div>

                <div className={`relative z-10 shrink-0 w-14 h-14 rounded-[1.25rem] flex items-center justify-center border border-white/10 shadow-[inset_0_4px_10px_rgba(255,255,255,0.15)] backdrop-blur-md ${
                  transportType === 'hsr' ? 'bg-gradient-to-br from-orange-500/80 to-red-600/80 shadow-orange-500/30' : 'bg-gradient-to-br from-blue-500/80 to-indigo-600/80 shadow-blue-500/30'
                }`}>
                  <Train className="w-8 h-8 text-white filter drop-shadow-md" aria-hidden="true" />
                </div>
                
                <div className="relative z-10 flex-col flex gap-0.5 justify-center flex-1 py-1">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#00df83] animate-pulse"></span>
                    <p className="text-[#00df83] text-[11px] font-bold tracking-widest whitespace-nowrap drop-shadow-[0_0_8px_rgba(0,223,131,0.5)]">
                      {i18n.language === 'zh-TW' ? `${approachingInfo.trainNo} 次車 · 即時進站` : `Train ${approachingInfo.trainNo} · Live Arrival`}
                    </p>
                  </div>
                  <div className="flex items-baseline gap-2 overflow-hidden">
                    <h3 className="text-balance text-white text-lg font-black tracking-tight whitespace-nowrap">
                      {i18n.language === 'zh-TW' ? '即將抵達：' : 'Approaching: '}
                      <span className={`drop-shadow-md ${transportType === 'hsr' ? 'text-orange-400' : 'text-blue-400'}`}>{approachingInfo.station}</span>
                    </h3>
                  </div>
                  <p className="text-slate-200 text-[13px] font-medium tracking-wide whitespace-nowrap pt-0.5">
                    {i18n.language === 'zh-TW' ? '還有 ' : 'In '}
                    <strong className="text-white font-bold text-[15px]">{approachingInfo.minutes}</strong> 
                    {i18n.language === 'zh-TW' ? ' 分鐘 · 預計停靠第 ' : ' mins · Plt '}
                    <strong className="text-white font-bold text-[15px]">{approachingInfo.platform}</strong> 
                    {i18n.language === 'zh-TW' ? ' 月台' : ''}
                  </p>
                </div>

                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-2 z-10">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsApproachingCollapsed(true);
                    }}
                    aria-label={i18n.language === 'zh-TW' ? '收起進站提示' : 'Collapse arrival alert'}
                    className="w-10 h-10 flex flex-col justify-center items-center bg-white/10 hover:bg-white/20 active:scale-90 border border-white/10 rounded-full text-white transition-all shadow-[0_4px_10px_rgba(0,0,0,0.2)]"
                  >
                    <ChevronDown className="w-5 h-5 font-black" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-10 fade-in duration-300">
          <div className="bg-slate-900/95 backdrop-blur-xl border border-slate-700 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-blue-400" />
            <span className="text-sm font-medium tracking-wide">{toastMessage}</span>
          </div>
        </div>
      )}

      {/* Fullscreen platform countdown — opened by long-pressing a train card */}
      {platformModeTrainId && (() => {
        const base = activeTab === 'outbound' ? timetables : returnTimetables;
        const train = base.find(t => (t.DailyTrainInfo?.TrainNo || '') === platformModeTrainId);
        if (!train) return null;
        const reliability = reliabilityByTrain[platformModeTrainId] || null;
        const originName = stations.find(s => s.StationID === originStationId)?.StationName?.Zh_tw || '';
        const destName = stations.find(s => s.StationID === destStationId)?.StationName?.Zh_tw || '';
        return (
          <PlatformMode
            train={train}
            delayMinutes={liveBoard[platformModeTrainId]}
            platform={liveBoardDetails[platformModeTrainId]?.Platform}
            reliability={reliability}
            transportType={transportType}
            language={i18n.language}
            originName={activeTab === 'outbound' ? originName : destName}
            destinationName={activeTab === 'outbound' ? destName : originName}
            onClose={() => setPlatformModeTrainId(null)}
          />
        );
      })()}

      {/* Offline Status */}
      <NetworkStatus />

      {/* External Booking Modal */}
      {bookingModalState.isOpen && (
        <React.Suspense fallback={null}>
          <ExternalLinkModal
            isOpen
            onClose={() => setBookingModalState(prev => ({ ...prev, isOpen: false }))}
            trainNo={bookingModalState.trainNo}
            transportType={transportType}
            origin={bookingModalState.origin}
            destination={bookingModalState.destination}
            depTime={bookingModalState.depTime}
            date={bookingModalState.date}
            url={bookingModalState.url}
            popupBlocked={bookingModalState.popupBlocked}
            usedFallback={bookingModalState.usedFallback}
          />
        </React.Suspense>
      )}

      {/* Station Picker Modals */}
      {isOriginDropdownOpen && (
        <React.Suspense fallback={null}>
          <StationPickerModal
            isOpen
            isOrigin={true}
            transportType={transportType}
            stations={stations}
            selectedId={originStationId}
            stationsLoading={stationsLoading}
            stationsError={stationsError}
            onSelect={(id) => { userPickedOriginRef.current = true; setOriginStationId(id); setIsOriginDropdownOpen(false); }}
            onClose={() => setIsOriginDropdownOpen(false)}
            onRetry={() => fetchStations()}
          />
        </React.Suspense>
      )}
      {isDestDropdownOpen && (
        <React.Suspense fallback={null}>
          <StationPickerModal
            isOpen
            isOrigin={false}
            transportType={transportType}
            stations={stations}
            selectedId={destStationId}
            stationsLoading={stationsLoading}
            stationsError={stationsError}
            onSelect={(id) => { setDestStationId(id); setIsDestDropdownOpen(false); }}
            onClose={() => setIsDestDropdownOpen(false)}
            onRetry={() => fetchStations()}
          />
        </React.Suspense>
      )}

      <TransferMapModal
        isOpen={transferModalOpen}
        onClose={() => setTransferModalOpen(false)}
        stationName={transferStationName}
        stationId={transferStationId}
        transportType={transferTransportType}
        trainDirection={transferTrainDirection}
      />

    </div>
  );
}
