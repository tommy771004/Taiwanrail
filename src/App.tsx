/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Heart, Bell, Globe, ArrowRightLeft, Calendar, User, Search, CheckCircle, AlertCircle, XCircle, X, ChevronDown, AlertTriangle, Train, Sun, CloudRain, Pencil, MapPin, Zap, Compass, MessageCircle, Send } from 'lucide-react';
import { motion } from 'motion/react';
import { io, Socket } from 'socket.io-client';
import { getTRATimetableOD, getTHSRTimetableOD, DailyTimetableOD, getTRAStations, getTHSRStations, Station, getTRAODFare, getTHSRODFare, getTRATrainTimetable, getTHSRTrainTimetable, getTRALiveBoard, StopTime, getTRAAlerts, getTHSRAlerts, getTHSRLiveBoard, RailLiveBoard, preloadStaticData } from './lib/api';
import { getTransfers, TRANSFER_COLOR } from './lib/transfers';
import { getStrategyForStation } from './lib/platformStrategy';
import AdSlot from './components/AdSlot';
import NetworkStatus from './components/NetworkStatus';
import ExternalLinkModal from './components/ExternalLinkModal';
import OfflineModeBanner from './components/OfflineModeBanner';
import ReliabilityBadge from './components/ReliabilityBadge';
import PlatformMode from './components/PlatformMode';
import RecentSearches from './components/RecentSearches';
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

export default function App() {
  const { t, i18n } = useTranslation();
  const [transportType, setTransportType] = useState<'hsr' | 'train'>(() => {
    if (typeof window === 'undefined') return 'hsr';
    const t = new URLSearchParams(window.location.search).get('transport');
    return t === 'train' ? 'train' : 'hsr';
  });
  const [tripType, setTripType] = useState<'one-way' | 'round-trip'>('one-way');
  const [selectedDate, setSelectedDate] = useState('today');
  const [activeFilter, setActiveFilter] = useState('time');
  const [expandedTrainId, setExpandedTrainId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [timetables, setTimetables] = useState<DailyTimetableOD[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const [stations, setStations] = useState<Station[]>([]);
  // IDs start empty; fetchStations() fills them from real API data
  const [originStationId, setOriginStationId] = useState<string>('');
  const [destStationId, setDestStationId] = useState<string>('');
  const [returnDate, setReturnDate] = useState<string>('tomorrow');
  const [activeTab, setActiveTab] = useState<'outbound' | 'return'>('outbound');
  
  const [favorites, setFavorites] = useState<string[]>([]);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showWatchlistOnly, setShowWatchlistOnly] = useState(false);
  const [originDropdownSearch, setOriginDropdownSearch] = useState('');
  const [destDropdownSearch, setDestDropdownSearch] = useState('');
  const [isOriginDropdownOpen, setIsOriginDropdownOpen] = useState(false);
  const [isDestDropdownOpen, setIsDestDropdownOpen] = useState(false);
  const [stationsLoading, setStationsLoading] = useState(false);
  const [stationsError, setStationsError] = useState<string | null>(null);

  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const feedbackPopoverRef = useRef<HTMLDivElement | null>(null);
  const feedbackButtonRef = useRef<HTMLButtonElement | null>(null);

  const filterStations = (list: Station[], search: string) => {
    if (!search) return list;
    const s = search.toLowerCase();
    return list.filter(st => 
      st.StationName.Zh_tw.includes(s) || 
      st.StationName.En.toLowerCase().includes(s) ||
      st.StationID.includes(s)
    );
  };
  const [toastMessage, setToastMessage] = useState<string | null>(null);

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
  const [globalAlert, setGlobalAlert] = useState<{message: string, type: 'warning' | 'error', url?: string, description?: string} | null>(null);
  const [cancelledTrains, setCancelledTrains] = useState<Set<string>>(new Set());
  const [dismissedTrains, setDismissedTrains] = useState<Set<string>>(new Set());

  // Collapsible search panel – defaults to expanded. Collapses after a successful search.
  const [isSearchCollapsed, setIsSearchCollapsed] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

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
    originId: string;
    destination: string;
    destId: string;
    depTime: string;
    searchDate: string;
  }>({
    isOpen: false,
    trainNo: '',
    origin: '',
    originId: '',
    destination: '',
    destId: '',
    depTime: '12:00',
    searchDate: ''
  });

  // Parallax Scroll Tracking (Optimized with requestAnimationFrame)
  useEffect(() => {
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
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
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
    return h * 60 + m;
  };

  // Removed approachingInfo from here

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const [traAlerts, thsrAlerts] = await Promise.all([getTRAAlerts(), getTHSRAlerts()]);
        const rawAlerts = [...(Array.isArray(traAlerts) ? traAlerts : []), ...(Array.isArray(thsrAlerts) ? thsrAlerts : [])];

        // Filter out natural-disaster category alerts (天然災變) — user prefers
        // to see operational alerts only (delays, cancellations, route changes).
        const isDisasterAlert = (a: any) => {
          const text = `${a?.Title || ''} ${a?.Description || ''} ${a?.AlertType || ''}`;
          return /天然災變|天然災害|颱風|地震|豪雨|洪水|土石流/.test(text);
        };
        const allAlerts = rawAlerts.filter(a => !isDisasterAlert(a));

        if (allAlerts.length > 0) {
          const latest = allAlerts[0];
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
        }
      } catch (err) {
        console.warn('Could not fetch real alerts, falling back to empty state');
      }
    };

    fetchAlerts();
    
    // Refresh alerts every 5 minutes
    const interval = setInterval(fetchAlerts, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

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
    requestNotificationPermission(); // 啟動時請求通知權限
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
        date: dateStr,
        selectedDateId: selectedDate,
        tripType,
        returnDate: tripType === 'round-trip' ? returnDateObj.value : undefined,
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
    // Map the absolute saved date back onto today's rolling 14-day picker; fall back to 'today'.
    const matched = dates.find(d => d.value === entry.date);
    setSelectedDate(matched ? matched.id : 'today');
    if (entry.tripType === 'round-trip' && entry.returnDate) {
      const rMatched = dates.find(d => d.value === entry.returnDate);
      setReturnDate(rMatched ? rMatched.id : 'tomorrow');
    }
    // Queue a one-shot auto-fetch once React has applied the form state.
    pendingRecentSearchRef.current = entry;
  };

  // Fire fetchTimetable exactly once after a recent-search click, when state has caught up.
  useEffect(() => {
    const pending = pendingRecentSearchRef.current;
    if (!pending) return;
    if (
      transportType === pending.transportType &&
      originStationId === pending.originId &&
      destStationId === pending.destId &&
      tripType === pending.tripType
    ) {
      pendingRecentSearchRef.current = null;
      setHasSearched(true);
      setIsSearchCollapsed(true);
      fetchTimetable();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transportType, originStationId, destStationId, tripType, selectedDate, returnDate]);

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

      // Honor ?fromId=&toId= deep links (from SEO route landing pages) so
      // the search pre-fills when the user lands here from Google / sitemap.
      const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
      const fromIdParam = params?.get('fromId');
      const toIdParam = params?.get('toId');
      const validIds = new Set(data.map(s => s.StationID));
      if (fromIdParam && toIdParam && validIds.has(fromIdParam) && validIds.has(toIdParam)) {
        setOriginStationId(fromIdParam);
        setDestStationId(toIdParam);
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
    fetchStations();
    setCurrentPage(1);
  }, [transportType]);

  useEffect(() => {
    setCurrentPage(1);
    setHasSearched(false);
  }, [selectedDate, originStationId, destStationId]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeFilter, activeTab]);

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

  const handleExpandTrain = async (trainId: string) => {
if (!trainId || trainId === 'Unknown') {
    showToast(i18n.language === 'zh-TW' ? '無法取得此特殊車次的停靠站資訊' : 'Stop details unavailable for this train');
    return;
  }
  if (expandedTrainId === trainId) {
    setExpandedTrainId(null);
    return;
  }
    setExpandedTrainId(trainId);
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
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(entry => entry.item);
    }
    
    return filtered;
  }, [timetables, returnTimetables, activeTab, selectedDate, nowMinutes, showFavoritesOnly, showWatchlistOnly, activeFilter, transportType, favorites, watchlist]); // Add dependencies

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
  return (
    <div className={`min-h-dvh font-sans text-slate-900 dark:text-slate-100 selection:bg-slate-200 dark:selection:bg-slate-700 soft-scrollbar transition-colors duration-700 ${
      transportType === 'hsr' ? 'bg-orange-50/50 dark:bg-[#1a1205]/50' : 'bg-blue-50/50 dark:bg-[#050f1a]/50'
    }`}>
      {/* Navbar - Glassmorphism */}
      <header className={`fixed top-0 w-full z-50 backdrop-blur-2xl border-b shadow-none transition-colors duration-700 pt-[env(safe-area-inset-top)] ${
        transportType === 'hsr' ? 'bg-orange-50/30 border-orange-100/20' : 'bg-blue-50/30 border-blue-100/20'
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
          <div className="flex items-center gap-1 sm:gap-6 text-slate-600 dark:text-slate-400 shrink-0">
            <div className="relative shrink-0">
              <button
                ref={feedbackButtonRef}
                type="button"
                onClick={() => setIsFeedbackOpen((v) => !v)}
                aria-label={t('app.feedback.label', i18n.language === 'zh-TW' ? '意見回饋' : 'Feedback')}
                aria-expanded={isFeedbackOpen}
                className={`transition-colors flex items-center justify-center px-2 sm:px-3 py-1.5 rounded-full ${isFeedbackOpen ? 'bg-emerald-50 text-emerald-600 font-bold' : 'hover:text-slate-900 dark:hover:text-white'}`}
              >
                <MessageCircle className={`w-4 h-4 sm:w-5 sm:h-5 ${isFeedbackOpen ? 'stroke-[2.5]' : 'stroke-[1.5]'}`} />
              </button>
              {isFeedbackOpen && (
                <div
                  ref={feedbackPopoverRef}
                  role="dialog"
                  aria-label={i18n.language === 'zh-TW' ? '意見回饋' : 'Feedback'}
                  className="fixed sm:absolute left-1/2 -translate-x-1/2 sm:left-0 sm:translate-x-0 top-[calc(env(safe-area-inset-top)+4rem)] sm:top-full sm:mt-2 z-50 w-[calc(100vw-1.5rem)] sm:w-96 max-w-sm sm:max-w-none bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 p-4 animate-in fade-in slide-in-from-top-2 duration-200"
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
              className={`transition-colors flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 rounded-full ${showFavoritesOnly ? 'bg-red-50 text-red-600 font-bold' : 'hover:text-slate-900 dark:hover:text-white'}`}
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
              className={`transition-colors flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 rounded-full ${showWatchlistOnly ? 'bg-blue-50 text-blue-600 font-bold' : 'hover:text-slate-900 dark:hover:text-white'}`}
            >
              <Bell className={`w-4 h-4 sm:w-5 sm:h-5 ${showWatchlistOnly ? 'stroke-[2.5]' : 'stroke-[1.5]'}`} />
              {watchlist.length > 0 && <span className="text-[0.625rem] sm:text-xs">{watchlist.length}</span>}
            </button>
            <button 
              onClick={() => {
                const newLang = i18n.language === 'zh-TW' ? 'en' : 'zh-TW';
                i18n.changeLanguage(newLang);
                showToast(t('app.toasts.langChanged', { lang: newLang === 'zh-TW' ? '中文' : 'English' }));
              }} 
              className="hover:text-slate-900 dark:hover:text-white transition-colors flex items-center gap-1 bg-slate-100/50 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full"
            >
              <Globe className="w-4 h-4 sm:w-5 sm:h-5 stroke-[1.5]" />
              <span className="text-[0.625rem] sm:text-xs font-bold uppercase">{i18n.language === 'zh-TW' ? 'EN' : '中文'}</span>
            </button>
            
            {/* Text Size Control */}
            <div className="hidden sm:flex items-center bg-slate-100/50 rounded-full p-0.5 ml-1 sm:ml-2">
               <button onClick={() => setTextSize('small')} className={`px-2 sm:px-3 py-1 rounded-full text-[0.625rem] sm:text-xs font-bold transition-all ${textSize === 'small' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>小</button>
               <button onClick={() => setTextSize('medium')} className={`px-2 sm:px-3 py-1 rounded-full text-[0.625rem] sm:text-xs font-bold transition-all ${textSize === 'medium' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>中</button>
               <button onClick={() => setTextSize('large')} className={`px-2 sm:px-3 py-1 rounded-full text-[0.625rem] sm:text-xs font-bold transition-all ${textSize === 'large' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>大</button>
            </div>
          </div>
        </div>
      </header>

      {/* 18. Global Disruption Banner */}
      {globalAlert && (
          <div className="fixed top-20 sm:top-24 left-0 w-full z-40 px-4 md:px-8 mt-2 animate-in slide-in-from-top-10 fade-in duration-500">
            <div
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
              className={`max-w-5xl mx-auto relative overflow-hidden rounded-3xl p-5 flex items-center gap-4 group shadow-2xl border-2 ${
                globalAlert.url || (globalAlert.description && globalAlert.description !== globalAlert.message)
                  ? 'cursor-pointer'
                  : 'cursor-default'
              } ${
                globalAlert.type === 'error' ? 'bg-red-600 border-red-500' : 'bg-amber-400 border-amber-300'
              }`}>
              {/* Striped Background Pattern */}
              <div className="absolute inset-0 opacity-10 pointer-events-none" style={{
                backgroundImage: 'linear-gradient(45deg, rgba(0,0,0,1) 25%, transparent 25%, transparent 50%, rgba(0,0,0,1) 50%, rgba(0,0,0,1) 75%, transparent 75%, transparent)',
                backgroundSize: '30px 30px'
              }}></div>
              
              <div className="relative z-10 flex shrink-0 items-center justify-center w-12 h-12 bg-white/25 rounded-2xl backdrop-blur-md">
                <AlertTriangle className={`w-7 h-7 animate-pulse ${globalAlert.type === 'error' ? 'text-white' : 'text-slate-900'}`} />
              </div>
              
              <div className={`relative z-10 flex-1 font-bold text-lg leading-tight tracking-tight ${
                globalAlert.type === 'error' ? 'text-white' : 'text-slate-900'
              }`}>
                {globalAlert.message}
              </div>
              
              <div className={`relative z-10 flex shrink-0 items-center gap-1 text-sm font-black uppercase tracking-widest ${
                globalAlert.type === 'error' ? 'text-white/80' : 'text-slate-900/60'
              }`}>
                {globalAlert.url
                  ? (i18n.language === 'zh-TW' ? '查閱詳情' : 'Details')
                  : (globalAlert.description && globalAlert.description !== globalAlert.message
                      ? (i18n.language === 'zh-TW' ? '顯示說明' : 'More Info')
                      : null
                    )
                }
                {(globalAlert.url || (globalAlert.description && globalAlert.description !== globalAlert.message)) && (
                  <Search className="w-4 h-4 ml-1 transition-transform group-hover:translate-x-1" />
                )}
              </div>
            </div>
          </div>
        )}

      {/* Hero Section */}
      <section className={`relative px-0 sm:px-4 md:px-8 flex flex-col items-center justify-center transition-all duration-[700ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
        isSearchCollapsed ? 'pt-28 pb-6 min-h-0' : 'pt-24 sm:pt-40 pb-20 sm:pb-32 min-h-[85vh]'
      }`}>
        {/* Background Image with Soft Blur */}
        <div className={`absolute top-0 left-0 w-full z-0 overflow-hidden transition-[height] duration-[700ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isSearchCollapsed ? 'h-[260px]' : 'h-[85vh]'
        }`}>
          <div className="absolute inset-0 w-full h-[120%] -top-[10%]">
            <img
              src="https://images.unsplash.com/photo-1474487056207-5d7d762f234b?auto=format&fit=crop&q=80&w=2000"
              alt="Modern Train Landscape"
              className={`w-full h-full object-cover object-center blur-[12px] brightness-[0.9] dark:brightness-[0.4] transition-all duration-[1200ms] ease-out ${
                isSearchCollapsed ? 'scale-[1.18]' : 'scale-110'
              }`}
              style={{ transform: `translateY(${scrollY * 0.4}px) ${isSearchCollapsed ? 'scale(1.18)' : 'scale(1.1)'}` }}
              referrerPolicy="no-referrer"
            />
          </div>
          {/* Gradient fade to tinted bottom */}
          <div className={`absolute inset-0 bg-gradient-to-b from-transparent transition-colors duration-700 ${
            transportType === 'hsr'
              ? 'via-orange-50/40 to-orange-50/50 dark:via-[#1a1205]/40 dark:to-[#1a1205]'
              : 'via-blue-50/40 to-blue-50/50 dark:via-[#050f1a]/40 dark:to-[#050f1a]'
          }`}></div>
        </div>

        {/* Compact Summary Bar – shown when search is collapsed */}
        {isSearchCollapsed && (
          <div
            onClick={() => setIsSearchCollapsed(false)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsSearchCollapsed(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            className={`mx-4 sm:mx-0 relative z-10 w-[calc(100%-2rem)] sm:w-full max-w-5xl cursor-pointer group animate-in fade-in slide-in-from-top-6 duration-500 bg-white/90 dark:bg-slate-900/70 backdrop-blur-2xl rounded-full border border-white/60 dark:border-white/10 flex items-center gap-4 md:gap-6 p-3 pr-4 md:pr-5 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.25)] hover:shadow-[0_24px_60px_-20px_rgba(0,0,0,0.35)] hover:-translate-y-[2px] transition-all`}
          >
            <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-[0.6875rem] md:text-xs font-black uppercase tracking-widest text-white shrink-0 ${
              transportType === 'hsr' ? 'bg-orange-600' : 'bg-blue-600'
            }`}>
              <Train className="w-4 h-4" />
              {transportType === 'hsr' ? t('app.hsr') : t('app.tra')}
            </div>

            <div className="flex-1 min-w-0 flex items-center gap-2 md:gap-4 text-slate-800 dark:text-slate-100">
              <MapPin className="w-4 h-4 text-slate-400 shrink-0 hidden sm:block" />
              <span className="truncate text-base md:text-lg font-bold tracking-tight">
                {i18n.language === 'zh-TW'
                  ? (stations.find(s => s.StationID === originStationId)?.StationName?.Zh_tw || '...')
                  : (stations.find(s => s.StationID === originStationId)?.StationName?.En || '...')}
              </span>
              <span className="text-slate-400 font-black shrink-0 px-1 sm:px-2 text-sm sm:text-base">➔</span>
              <span className="truncate text-base md:text-lg font-bold tracking-tight">
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
              className={`shrink-0 inline-flex items-center gap-2 px-4 md:px-5 py-2.5 rounded-full text-sm font-bold transition-all group-hover:scale-[1.02] ${
                transportType === 'hsr'
                  ? 'bg-orange-50 text-orange-700 hover:bg-orange-100 border border-orange-100'
                  : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-100'
              }`}
            >
              <Pencil className="w-4 h-4" />
              <span className="hidden sm:inline">{t('app.editSearch')}</span>
            </button>
          </div>
        )}

        {/* Search Card - Floating, Soft Shadow, White, Rounded */}
        <div className={`relative z-10 w-full max-w-5xl bg-white/95 backdrop-blur-sm sm:rounded-[2.5rem] md:rounded-[2.5rem] rounded-t-[2rem] sm:border-none border-t border-white/20 transition-all duration-[700ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isSearchCollapsed
            ? 'max-h-0 opacity-0 p-0 overflow-hidden pointer-events-none translate-y-[-8px]'
            : 'max-h-[2400px] opacity-100 p-6 sm:p-12 md:p-14 overflow-hidden translate-y-0'
        } ${
          transportType === 'hsr' ? 'shadow-[0_-15px_40px_-15px_rgba(234,88,12,0.15)] sm:shadow-[0_20px_60px_-15px_rgba(234,88,12,0.1)]' : 'shadow-[0_-15px_40px_-15px_rgba(37,99,235,0.15)] sm:shadow-[0_20px_60px_-15px_rgba(37,99,235,0.1)]'
        }`}>
          
          {/* Top Controls: Transport Type & Trip Type */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6 mb-8 sm:mb-12">
            {/* Transport Type Toggle */}
            <div className={`flex p-1.5 rounded-full w-fit transition-colors duration-700 border ${
              transportType === 'hsr' ? 'bg-orange-50 border-orange-100' : 'bg-blue-50 border-blue-100'
            }`}>
              <button
                onClick={() => {
                  setTransportType('hsr');
                  setOriginStationId('');
                  setDestStationId('');
                }}
                className={`px-5 sm:px-8 py-2.5 sm:py-3 rounded-full text-sm font-bold transition-all duration-300 ${
                  transportType === 'hsr'
                    ? 'bg-white text-orange-600 shadow-[0_4px_15px_rgba(234,88,12,0.1)] scale-105'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {t('app.hsr')}
              </button>
              <button
                onClick={() => {
                  setTransportType('train');
                  setOriginStationId('');
                  setDestStationId('');
                }}
                className={`px-5 sm:px-8 py-2.5 sm:py-3 rounded-full text-sm font-bold transition-all duration-300 ${
                  transportType === 'train'
                    ? 'bg-white text-blue-600 shadow-[0_4px_15px_rgba(37,99,235,0.1)] scale-105'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {t('app.tra')}
              </button>
            </div>

            {/* Trip Type */}
            <div className="flex items-center gap-6 sm:gap-8 text-sm font-medium text-slate-400">
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${tripType === 'one-way' ? 'border-slate-800' : 'border-slate-300 group-hover:border-slate-400'}`}>
                  {tripType === 'one-way' && <div className="w-2 h-2 bg-slate-800 rounded-full" />}
                </div>
                <input type="radio" name="tripType" className="hidden" checked={tripType === 'one-way'} onChange={() => setTripType('one-way')} />
                <span className={`transition-colors ${tripType === 'one-way' ? 'text-slate-800' : 'group-hover:text-slate-600'}`}>{t('app.oneWay')}</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${tripType === 'round-trip' ? 'border-slate-800' : 'border-slate-300 group-hover:border-slate-400'}`}>
                  {tripType === 'round-trip' && <div className="w-2 h-2 bg-slate-800 rounded-full" />}
                </div>
                <input type="radio" name="tripType" className="hidden" checked={tripType === 'round-trip'} onChange={() => { setTripType('round-trip'); }} />
                <span className={`transition-colors ${tripType === 'round-trip' ? 'text-slate-800' : 'group-hover:text-slate-600'}`}>{t('app.roundTrip')}</span>
              </label>
            </div>
          </div>

          {/* Station Selector & Swap */}
          <div className={`relative z-50 flex flex-row items-center justify-between mt-4 sm:mt-6 mb-8 backdrop-blur-xl border border-white/40 dark:border-white/10 rounded-[2rem] p-4 sm:p-6 transition-all duration-700 ${
            transportType === 'hsr' ? 'bg-orange-50/40 dark:bg-orange-900/20 shadow-[inset_0_2px_20px_rgba(254,215,170,0.2)]' : 'bg-blue-50/40 dark:bg-blue-900/20 shadow-[inset_0_2px_20px_rgba(191,219,254,0.2)]'
          }`}>  {/* Origin */}
            <div className="flex-1 min-w-0 text-center relative w-1/2 pr-6">
              <div className={`text-[0.625rem] sm:text-xs font-semibold uppercase tracking-widest mb-1 sm:mb-2 transition-colors ${transportType === 'hsr' ? 'text-orange-600/60' : 'text-blue-600/60'}`}>{t('app.origin')}</div>
<button 
      onClick={() => { setIsOriginDropdownOpen(!isOriginDropdownOpen); setIsDestDropdownOpen(false); }}
      className={`text-2xl sm:text-4xl font-black tracking-tighter truncate w-full transition-colors ${transportType === 'hsr' ? 'text-orange-600 dark:text-orange-400' : 'text-blue-600 dark:text-blue-400'}`}
    >
                {i18n.language === 'zh-TW' 
                  ? (stations.find(s => s.StationID === originStationId)?.StationName?.Zh_tw || '...')
                  : (stations.find(s => s.StationID === originStationId)?.StationName?.En || '...')
                }
              </button>
              <div className={`font-medium mt-2 text-sm sm:text-base md:text-lg transition-colors ${transportType === 'hsr' ? 'text-orange-700/60' : 'text-slate-400'}`}>
                {i18n.language === 'zh-TW' 
                  ? (stations.find(s => s.StationID === originStationId)?.StationName?.En || '...')
                  : (stations.find(s => s.StationID === originStationId)?.StationName?.Zh_tw || '...')
                }
              </div>
              
              {/* Dropdown */}
              {isOriginDropdownOpen && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-4 w-72 sm:w-80 max-h-96 overflow-y-auto bg-white/90 dark:bg-slate-900/90 backdrop-blur-2xl rounded-3xl shadow-[0_40px_80px_-15px_rgba(0,0,0,0.35)] border border-white/50 dark:border-white/10 z-50 p-3 soft-scrollbar animate-in fade-in zoom-in duration-300">
                <div className="sticky top-0 bg-white/80 dark:bg-slate-800/80 backdrop-blur-md p-2 border-b border-slate-100/50 dark:border-slate-700/50 mb-2 rounded-t-2xl z-20">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      value={originDropdownSearch}
                      onChange={(e) => setOriginDropdownSearch(e.target.value)}
                      placeholder={t('app.station.searchPlaceholder')}
                      className={`w-full pl-9 pr-3 py-2.5 bg-slate-100/50 dark:bg-slate-900/50 rounded-xl text-sm outline-none focus:ring-2 backdrop-blur-sm transition-all ${transportType === 'hsr' ? 'focus:ring-orange-400' : 'focus:ring-blue-400'}`}
                    />
                  </div>
                </div>
                
                {stationsLoading ? (
                  <div className="py-2 space-y-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-2xl">
                        <div className="h-3.5 flex-1 bg-slate-200/70 dark:bg-slate-700/60 rounded-md animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
                        <div className="h-2 w-8 bg-slate-100 dark:bg-slate-800 rounded-md animate-pulse" style={{ animationDelay: `${i * 80 + 40}ms` }} />
                      </div>
                    ))}
                  </div>
                ) : stationsError ? (
                  <div className="p-4 text-center text-red-500 text-xs">
                    {stationsError}
                    <button onClick={() => fetchStations()} className="block mx-auto mt-2 text-blue-500 underline">Retry</button>
                  </div>
                ) : (
                  filterStations(stations, originDropdownSearch).length > 0 ? (
                    filterStations(stations, originDropdownSearch).map(s => (
                      <button
                        key={s.StationID}
                        onClick={() => { setOriginStationId(s.StationID); setIsOriginDropdownOpen(false); setOriginDropdownSearch(''); }}
                        className={`w-full text-left px-4 py-3.5 rounded-2xl transition-all duration-300 group flex items-center justify-between ${
                          s.StationID === originStationId 
                            ? (transportType === 'hsr' ? 'bg-orange-500/10 text-orange-700 dark:text-orange-400 font-bold shadow-sm' : 'bg-blue-500/10 text-blue-700 dark:text-blue-400 font-bold shadow-sm')
                            : 'hover:bg-slate-50/80 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <span className="truncate">{i18n.language === 'zh-TW' ? (s.StationName?.Zh_tw || '車站') : (s.StationName?.En || 'Station')}</span>
                        {s.StationID === originStationId && <div className={`w-1.5 h-1.5 rounded-full ${transportType === 'hsr' ? 'bg-orange-500' : 'bg-blue-500'}`} />}
                      </button>
                    ))
                  ) : (
                    <div className="py-12 text-center text-slate-400 text-sm">
                      <p>{t('app.noResults') || 'No stations found'}</p>
                    </div>
                  )
                )}
              </div>
              )}
            </div>

            {/* Swap Button */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">  <button 
                onClick={() => {
                  const temp = originStationId;
                  setOriginStationId(destStationId);
                  setDestStationId(temp);
                }}
                aria-label={t('app.swapStations', 'Swap stations')}
                className={`size-10 sm:size-14 bg-white rounded-full shadow-md flex items-center justify-center hover:scale-105 transition-all border border-slate-100 ${transportType === 'hsr' ? 'text-orange-600 hover:text-orange-700' : 'text-blue-600 hover:text-blue-700'}`}
    >
                <ArrowRightLeft className="size-5 sm:size-6 stroke-[2.5]" />
              </button>
            </div>

            {/* Destination */}
            <div className="flex-1 min-w-0 text-center relative w-1/2 pl-6">
              <div className={`text-[0.625rem] sm:text-xs font-semibold uppercase tracking-widest mb-1 sm:mb-2 transition-colors ${transportType === 'hsr' ? 'text-orange-600/60' : 'text-blue-600/60'}`}>{t('app.destination')}</div>
              <button 
                onClick={() => { setIsDestDropdownOpen(!isDestDropdownOpen); setIsOriginDropdownOpen(false); }}
                className={`text-2xl sm:text-4xl font-black tracking-tighter truncate w-full transition-colors ${transportType === 'hsr' ? 'text-orange-600 dark:text-orange-400' : 'text-blue-600 dark:text-blue-400'}`}
    >
                {i18n.language === 'zh-TW' 
                  ? (stations.find(s => s.StationID === destStationId)?.StationName?.Zh_tw || '...')
                  : (stations.find(s => s.StationID === destStationId)?.StationName?.En || '...')
                }
              </button>
              <div className={`font-medium mt-2 text-sm sm:text-base md:text-lg transition-colors ${transportType === 'hsr' ? 'text-orange-700/60' : 'text-slate-400'}`}>
                {i18n.language === 'zh-TW' 
                  ? (stations.find(s => s.StationID === destStationId)?.StationName?.En || '...')
                  : (stations.find(s => s.StationID === destStationId)?.StationName?.Zh_tw || '...')
                }
              </div>
              
              {/* Dropdown */}
              {isDestDropdownOpen && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-4 w-72 sm:w-80 max-h-96 overflow-y-auto bg-white/90 dark:bg-slate-900/90 backdrop-blur-2xl rounded-3xl shadow-[0_40px_80px_-15px_rgba(0,0,0,0.35)] border border-white/50 dark:border-white/10 z-50 p-3 soft-scrollbar animate-in fade-in zoom-in duration-300">
                <div className="sticky top-0 bg-white/80 dark:bg-slate-800/80 backdrop-blur-md p-2 border-b border-slate-100/50 dark:border-slate-700/50 mb-2 rounded-t-2xl z-20">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      value={destDropdownSearch}
                      onChange={(e) => setDestDropdownSearch(e.target.value)}
                      placeholder={t('app.station.searchPlaceholder')}
                      className={`w-full pl-9 pr-3 py-2.5 bg-slate-100/50 dark:bg-slate-900/50 rounded-xl text-sm outline-none focus:ring-2 backdrop-blur-sm transition-all ${transportType === 'hsr' ? 'focus:ring-orange-400' : 'focus:ring-blue-400'}`}
                    />
                  </div>
                </div>
                
                {stationsLoading ? (
                  <div className="py-2 space-y-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-2xl">
                        <div className="h-3.5 flex-1 bg-slate-200/70 dark:bg-slate-700/60 rounded-md animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
                        <div className="h-2 w-8 bg-slate-100 dark:bg-slate-800 rounded-md animate-pulse" style={{ animationDelay: `${i * 80 + 40}ms` }} />
                      </div>
                    ))}
                  </div>
                ) : stationsError ? (
                  <div className="p-4 text-center text-red-500 text-xs">
                    {stationsError}
                    <button onClick={() => fetchStations()} className="block mx-auto mt-2 text-blue-500 underline">Retry</button>
                  </div>
                ) : (
                  filterStations(stations, destDropdownSearch).length > 0 ? (
                    filterStations(stations, destDropdownSearch).map(s => (
                      <button
                        key={s.StationID}
                        onClick={() => { setDestStationId(s.StationID); setIsDestDropdownOpen(false); setDestDropdownSearch(''); }}
                        className={`w-full text-left px-4 py-3.5 rounded-2xl transition-all duration-300 group flex items-center justify-between ${
                          s.StationID === destStationId 
                            ? (transportType === 'hsr' ? 'bg-orange-500/10 text-orange-700 dark:text-orange-400 font-bold shadow-sm' : 'bg-blue-500/10 text-blue-700 dark:text-blue-400 font-bold shadow-sm')
                            : 'hover:bg-slate-50/80 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <span className="truncate">{i18n.language === 'zh-TW' ? (s.StationName?.Zh_tw || '車站') : (s.StationName?.En || 'Station')}</span>
                        {s.StationID === destStationId && <div className={`w-1.5 h-1.5 rounded-full ${transportType === 'hsr' ? 'bg-orange-500' : 'bg-blue-500'}`} />}
                      </button>
                    ))
                  ) : (
                    <div className="py-12 text-center text-slate-400 text-sm">
                      <p>{t('app.noResults') || 'No stations found'}</p>
                    </div>
                  )
                )}
              </div>
              )}
            </div>
          </div>

          {/* Horizontal Date Scroller */}
          <div className={`mb-8 sm:mb-12 grid grid-cols-1 gap-8 sm:gap-12 ${tripType === 'round-trip' ? 'lg:grid-cols-2 lg:gap-20' : ''}`}>
            <div className="min-w-0 relative">
              <div className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-6 px-1 flex items-center justify-between">
                <span>{tripType === 'round-trip' ? t('app.outbound') : t('app.origin')}</span>
                <span className="text-[0.625rem] text-slate-300 font-mono hidden sm:block">SCROLL →</span>
              </div>
              <div className="flex overflow-x-auto gap-4 pb-6 px-1 soft-scrollbar scroll-smooth">
                {dates.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setSelectedDate(d.id)}
                    className={`flex flex-col items-center justify-center min-w-[82px] sm:min-w-[100px] py-3 sm:py-4 px-4 sm:px-6 rounded-3xl transition-all duration-300 border ${
                      selectedDate === d.id
                        ? transportType === 'hsr'
                          ? 'bg-orange-600 border-orange-600 text-white shadow-[0_12px_25px_rgba(234,88,12,0.25)] scale-105 z-10'
                          : 'bg-blue-600 border-blue-600 text-white shadow-[0_12px_25px_rgba(37,99,235,0.25)] scale-105 z-10'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-sm'
                    }`}
                  >
                    <span className={`text-[0.6875rem] font-black mb-1.5 uppercase tracking-tighter ${selectedDate === d.id ? (transportType === 'hsr' ? 'text-orange-200' : 'text-blue-200') : 'text-slate-600'}`}>
                      {d.label}
                    </span>
                    <span className={`text-xl font-black ${selectedDate === d.id ? 'text-white' : 'text-slate-900'}`}>
                      {d.date}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {tripType === 'round-trip' && (
              <div className="min-w-0 relative pt-8 lg:pt-0 lg:border-l lg:border-slate-200 lg:pl-16">
                <div className="text-sm font-black text-slate-600 uppercase tracking-widest mb-6 px-1 flex items-center justify-between">
                  <span>{t('app.return')}</span>
                  <span className="text-[0.625rem] text-slate-500 font-mono hidden sm:block">SCROLL →</span>
                </div>
                <div className="flex overflow-x-auto gap-4 pb-6 px-1 soft-scrollbar scroll-smooth">
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
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-sm'
                        }`}
                      >
                        <span className={`text-[0.6875rem] font-black mb-1.5 uppercase tracking-tighter ${returnDate === d.id ? (transportType === 'hsr' ? 'text-orange-200' : 'text-blue-200') : 'text-slate-600'}`}>
                          {d.label}
                        </span>
                        <span className={`text-xl font-black ${returnDate === d.id ? 'text-white' : 'text-slate-900'}`}>
                          {d.date}
                        </span>
                      </button>
                    );
                  })}
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
              
              // 2. 觸發 API 查詢
              fetchTimetable();
              fetchExtraData();
              setHasSearched(true);
              
              // 3. UI 狀態更新
              setCurrentPage(1);
              setIsSearchCollapsed(true);
              
              // 4. 平滑滾動到結果區
              setTimeout(() => {
                document.getElementById('results-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }, 350);
            }}
            // 新增 shimmer, float, breathing glow
            className={`group relative overflow-hidden w-full text-white py-4 sm:py-6 rounded-full text-base sm:text-xl font-medium flex items-center justify-center gap-3 transition-all duration-500 hover:-translate-y-2 active:scale-[0.98] ${
              transportType === 'hsr'
                ? 'bg-orange-600 shadow-[0_8px_25px_-8px_rgba(234,88,12,0.5)] hover:shadow-[0_20px_40px_-5px_rgba(234,88,12,0.8)]'
                : 'bg-blue-600 shadow-[0_8px_25px_-8px_rgba(37,99,235,0.5)] hover:shadow-[0_20px_40px_-5px_rgba(37,99,235,0.8)]'
            }`}
          >
            {/* Shimmer Effect */}
            <div className="absolute inset-0 -translate-x-full group-hover:animate-shimmer bg-gradient-to-r from-transparent via-white/40 to-transparent z-20 pointer-events-none"></div>
            
            <Search className="w-6 h-6 stroke-[2] z-10 relative group-hover:animate-pulse" />
            <span className="z-10 relative">{t('app.search')}</span>
          </button>

        </div>
      </section>

      {/* Recent searches — click to re-run a previous query */}
      {!isSearchCollapsed && (
        <RecentSearches
          entries={recentSearches}
          language={i18n.language}
          onSelect={handleSelectRecentSearch}
          onRemove={handleRemoveRecentSearch}
          onClearAll={handleClearRecentSearches}
        />
      )}

      {/* Search Results Section */}
      <section id="results-section" className="max-w-5xl mx-auto px-0 md:px-8 pb-32 -mt-8 relative z-20 scroll-mt-24">

        {/* Quick Filters – sticky on scroll */}
        <div className="sticky top-[64px] sm:top-[72px] z-30 pt-4 pb-2 px-4 md:px-0 bg-transparent border-transparent pointer-events-none">
          {/* Use pointer-events-none for the wrapper to let clicks pass through transparent area, and re-enable pointer-events-auto for children */}
          <div className="flex overflow-x-auto gap-3 pb-1 soft-scrollbar pointer-events-auto">
            {[
              { id: 'time', label: t('app.filters.time') },
              { id: 'fastest', label: t('app.filters.fastest') },
              { id: 'cheapest', label: t('app.filters.cheapest') },
              { id: 'reserved', label: t('app.filters.reserved') },
              { id: 'accessible', label: i18n.language === 'zh-TW' ? '無障礙' : 'Accessible' },
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setActiveFilter(activeFilter === f.id ? 'time' : f.id)}
                className={`whitespace-nowrap px-6 py-2.5 rounded-full text-sm font-medium transition-all border ${
                  activeFilter === f.id
                    ? transportType === 'hsr'
                      ? 'bg-orange-600 border-orange-600 text-white shadow-[0_4px_14px_rgba(234,88,12,0.3)]'
                      : 'bg-blue-600 border-blue-600 text-white shadow-[0_4px_14px_rgba(37,99,235,0.3)]'
                    : 'bg-white/95 dark:bg-slate-800/90 backdrop-blur-md border-slate-300 dark:border-slate-600 text-slate-900 dark:text-slate-100 hover:bg-white dark:hover:bg-slate-700 hover:border-slate-400 shadow-md transition-all active:scale-95'
                }`}
              >
                {f.label}
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
              <div className="flex flex-col items-center justify-center py-32 px-6 text-center animate-in fade-in duration-700">
                <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-6 shadow-xl ${transportType === 'hsr' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'}`}>
                  <Search className="w-10 h-10" />
                </div>
                <h3 className="text-balance text-2xl font-black text-slate-900 mb-3 tracking-tight drop-shadow-sm">
                  {i18n.language === 'zh-TW' ? '準備好開始旅程了嗎？' : 'Ready to start your journey?'}
                </h3>
                <p className="text-pretty text-slate-800 dark:text-slate-300 max-w-sm font-black leading-relaxed">
                  {i18n.language === 'zh-TW' 
                    ? '請先選擇起訖站與日期，按下方的「搜尋班次」按鈕即可獲取最新时刻表。' 
                    : 'Select your stations and date, then tap Search to get the most accurate timetables.'}
                </p>
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
                className="group flex flex-col sm:flex-row items-start sm:items-center justify-between bg-gradient-to-br from-indigo-50 via-white to-blue-50 dark:from-slate-800 dark:via-slate-900 dark:to-slate-800 border border-indigo-100/50 dark:border-slate-700 p-4 sm:p-5 rounded-2xl shadow-sm hover:shadow-md transition-all duration-300 mb-6 relative overflow-hidden"
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
              <div className="flex flex-col gap-5">
                {(() => {
                  const filtered = filteredTimetables;
                  const paged = pagedTimetables;
                  
                  if (isLoading) {
                return (
                  <div className="space-y-5 animate-in fade-in duration-500">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={`skeleton-${i}`} className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md rounded-[2rem] p-6 md:p-8 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.08)] border border-slate-100 dark:border-slate-700/50 relative overflow-hidden transition-all duration-300">
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
                  <div className="bg-white rounded-[2rem] p-12 text-center border border-slate-100/50 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="w-16 h-16 bg-slate-50/80 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-100">
                      <Search className="w-8 h-8 text-slate-300" />
                    </div>
                    <h3 className="text-balance text-lg font-black text-slate-800 mb-2 tracking-tight">
                      {error ? (i18n.language === 'zh-TW' ? '查詢時發生錯誤' : 'Search error') : t('app.results.noResults')}
                    </h3>
                    <p className="text-pretty text-slate-500 text-sm mb-6 max-w-xs mx-auto font-medium">
                      {error 
                        ? (i18n.language === 'zh-TW' ? '無法從伺服器取得資料。請檢查連線或稍後再試。' : 'Unable to retrieve data. Please check your connection or try again later.')
                        : t('app.results.noResultsDesc') || (i18n.language === 'zh-TW' ? '換個日期或地點試試看吧！' : 'Try a different date or another route.')}
                    </p>
                    {error && (
                      <div className="p-5 bg-red-50/50 text-red-600 rounded-3xl text-[0.625rem] font-mono text-left overflow-auto max-h-40 border border-red-100/50 backdrop-blur-sm">
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
                    className={`group rounded-none sm:rounded-2xl md:rounded-[2.5rem] border-b sm:border border-slate-200/50 sm:border-slate-200/60 transition-[background-color,border-color,box-shadow] duration-500 relative overflow-hidden will-change-transform ${
                      past ? 'grayscale-[50%]' : ''
                    } ${
                      isCancelled
                        ? 'bg-slate-50 border-slate-200 cursor-not-allowed text-slate-400'
                        : expandedTrainId === trainId
                          ? 'bg-white shadow-[0_30px_70px_-20px_rgba(37,99,235,0.15)] z-20 sm:scale-[1.02] sm:ring-4 ring-blue-600/5 sm:border-blue-600'
                          : 'bg-white sm:hover:border-blue-400/50 hover:bg-[#F8F9FA] sm:hover:bg-white hover:shadow-[0_20px_50px_-15px_rgba(0,0,0,0.08)] cursor-pointer sm:border-slate-100'
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
                    <div className={`md:hidden p-4 relative transition-colors duration-500 ${
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

                      {/* Meta row: route + direction + flags */}
                      {(train.DailyTrainInfo?.StartingStationName?.Zh_tw
                        || train.DailyTrainInfo?.Direction !== undefined
                        || train.DailyTrainInfo?.WheelchairFlag === 1
                        || train.DailyTrainInfo?.BikeFlag === 1) && (
                        <div className="flex items-center gap-1.5 flex-wrap text-[0.6875rem] text-slate-700 mb-2 font-bold">
                          {train.DailyTrainInfo?.StartingStationName?.Zh_tw && train.DailyTrainInfo?.EndingStationName?.Zh_tw && (
                            <span className="text-slate-600 truncate max-w-[55%] font-black uppercase tracking-tight">
                              {train.DailyTrainInfo.StartingStationName.Zh_tw}➔{train.DailyTrainInfo.EndingStationName.Zh_tw}
                            </span>
                          )}
                          {train.DailyTrainInfo?.Direction !== undefined && (
                            <span className="font-black px-1.5 py-[1px] bg-slate-200/80 rounded text-slate-900 text-[0.625rem] tracking-widest border border-slate-300">
                              {train.DailyTrainInfo.Direction === 0 ? '南下' : '北上'}
                            </span>
                          )}
                          {transportType === 'train' && train.DailyTrainInfo?.TripLine !== undefined && train.DailyTrainInfo.TripLine !== 0 && (
                            <span className={`font-bold px-1.5 py-[1px] rounded text-[0.625rem] tracking-widest outline outline-1 ${
                              train.DailyTrainInfo.TripLine === 1 ? 'bg-[#fef4cc] text-[#af7001] outline-[#fef4cc]/50 dark:outline-[#fef4cc]/20' :
                              train.DailyTrainInfo.TripLine === 2 ? 'bg-[#e5ffff] text-[#017a86] outline-[#e5ffff]/50 dark:outline-[#e5ffff]/20' :
                              'bg-[#eee5ff] text-[#6126a8] outline-transparent'
                            }`}>
                              {train.DailyTrainInfo.TripLine === 1 ? '山線' : train.DailyTrainInfo.TripLine === 2 ? '海線' : '成追'}
                            </span>
                          )}
                          {train.DailyTrainInfo?.OverNightStationID && (
                            <span className="font-bold px-1.5 py-[1px] bg-[#e0e4ff] text-[#2b388f] rounded text-[0.625rem] tracking-widest mt-[1px]">
                              跨夜
                            </span>
                          )}
                          {train.DailyTrainInfo?.WheelchairFlag === 1 && <span title="無障礙座位">♿️</span>}
                          {train.DailyTrainInfo?.BikeFlag === 1 && <span title="自行車車廂">🚲</span>}
                          {train.DailyTrainInfo?.BreastFeedingFlag === 1 && <span title="哺乳室">🍼</span>}
                          {train.DailyTrainInfo?.ParenthoodFlag === 1 && <span title="親子車廂">🎈</span>}
                        </div>
                      )}

                        {/* Fare row */}
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2">
                          {transportType === 'hsr' ? (
                            <>
                              <div className="flex items-baseline gap-1.5">
                                <span className="text-[0.625rem] font-semibold text-slate-400 uppercase">標準</span>
                                <span className={`text-xl font-light tracking-tight ${isCancelled ? 'text-slate-300 line-through' : 'text-slate-800'}`}>
                                  NT${fares['standard'] || '--'}
                                </span>
                              </div>
                              <div className="flex gap-1 text-[0.625rem] font-semibold">
                                <span className={`px-1.5 py-0.5 rounded ${isCancelled ? 'bg-slate-100 text-slate-300' : 'bg-orange-50 text-orange-700'}`}>
                                  商 ${fares['business'] || '--'}
                                </span>
                                <span className={`px-1.5 py-0.5 rounded ${isCancelled ? 'bg-slate-100 text-slate-300' : 'bg-emerald-50 text-emerald-700'}`}>
                                  自 ${fares['unreserved'] || '--'}
                                </span>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="flex items-baseline gap-1.5">
                                <span className="text-[10px] font-semibold text-slate-400 uppercase">一般</span>
                                <span className={`text-xl font-light tracking-tight ${isCancelled ? 'text-slate-300 line-through' : 'text-slate-800'}`}>
                                  {price.includes('NT$')
                                    ? price.replace('NT$', t('app.train.fare', { price: '' }).replace('NT$', ''))
                                    : price}
                                </span>
                              </div>
                              {(() => {
                                const typeId = train.DailyTrainInfo?.TrainTypeID || '';
                                let mappedType = '6';
                                if (typeId === '1101') mappedType = '1';
                                else if (typeId === '1102') mappedType = '2';
                                else if (['1100', '1103', '1104', '1105', '1106', '1107', '1108'].includes(typeId)) mappedType = '3';
                                else if (['1110', '1111', '1114', '1115'].includes(typeId)) mappedType = '4';
                                else if (['1120'].includes(typeId)) mappedType = '5';
                                else if (['1131', '1132', '1133'].includes(typeId)) mappedType = '6';
                                const bizPrice = fares[`${mappedType}_business`] || (['1', '2', '3'].includes(mappedType) ? fares['3_business'] : undefined);
                                const isTzeChiang3000 = train.DailyTrainInfo?.TrainTypeName?.Zh_tw?.includes('3000') || typeId === '1100';
                                if (bizPrice) {
                                  return (
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${isCancelled ? 'bg-slate-100 text-slate-300' : 'bg-purple-50 text-purple-700'}`}>
                                      {isTzeChiang3000 ? '騰雲' : '商'} ${bizPrice}
                                    </span>
                                  );
                                }
                                return null;
                              })()}
                            </>
                          )}
                        </div>

                        {/* Action Buttons */}
                        {!isCancelled && (
                          <div className="flex gap-2 w-full mt-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setBookingModalState({
                                  isOpen: true,
                                  trainNo: trainId,
                                  origin: stations.find(s => s.StationID === originStationId)?.StationName?.Zh_tw || '...',
                                  originId: originStationId,
                                  destination: stations.find(s => s.StationID === destStationId)?.StationName?.Zh_tw || '...',
                                  destId: destStationId,
                                  depTime: dep,
                                  // Map 'today'/'tomorrow' to exactly YYYY/MM/DD format
                                  searchDate: selectedDate === 'today' ? 
                                    new Date().toLocaleDateString('en-CA').replace(/-/g, '/') :
                                    new Date(Date.now() + 86400000).toLocaleDateString('en-CA').replace(/-/g, '/')
                                });
                              }}
                              className="flex-1 bg-slate-900 text-white font-bold text-xs py-2.5 rounded-lg active:scale-95 transition-transform"
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
                              className="px-4 bg-slate-100 text-slate-700 font-bold text-xs py-2.5 rounded-lg active:scale-95 transition-transform border border-slate-200"
                            >
                              {i18n.language === 'zh-TW' ? '分享' : 'Share'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Desktop Layout (hidden md:flex) */}
                    <div className={`hidden md:flex p-11 flex-row items-center justify-between gap-6 relative transition-colors duration-500 ${
                       expandedTrainId === trainId ? 'bg-gradient-to-br from-white to-blue-50/30' : ''
                    }`}>

                      {/* Left: Vertical Timeline */}
                      <div className="flex items-stretch gap-5 md:gap-10">
                        {/* Timeline Graphic */}
                        <div className="flex flex-col items-center justify-between py-2.5">
                          <div className={`w-3.5 h-3.5 rounded-full border-[3px] z-10 transition-all duration-500 ${isCancelled ? 'border-slate-300' : expandedTrainId === trainId ? 'border-blue-600 bg-white ring-4 ring-blue-600/10' : 'border-slate-800'}`}></div>
                          <div className={`w-[2px] h-full my-1 rounded-full ${isCancelled ? 'bg-slate-200' : 'bg-slate-100'}`}></div>
                          <div className={`w-3.5 h-3.5 rounded-full z-10 transition-all duration-500 ${isCancelled ? 'bg-slate-300' : expandedTrainId === trainId ? 'bg-blue-600 scale-125' : 'bg-slate-800'}`}></div>
                        </div>

                        {/* Times & Duration */}
                        <div className="flex flex-col justify-between py-1">
                          <div className={`text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter tabular-nums transition-colors duration-500 ${isCancelled ? 'text-slate-300 line-through' : expandedTrainId === trainId ? 'text-blue-600' : 'text-slate-900'}`}>{dep}</div>
                          <div className={`text-[0.6875rem] sm:text-xs font-bold my-2 md:my-5 w-fit px-3 py-1 md:px-4 md:py-1.5 rounded-full transition-all duration-500 border flex items-center gap-1.5 md:gap-2 shadow-sm ${
                            isCancelled ? 'bg-slate-50 border-slate-100 text-slate-300 shadow-none' :
                            expandedTrainId === trainId ? 'bg-blue-50/80 border-blue-200/60 shadow-[0_4px_12px_rgba(37,99,235,0.15)] ring-1 ring-blue-100' :
                            'bg-white border-slate-200/60'
                          }`}>
                            <span className="text-[0.75rem] md:text-sm leading-none mb-[1px] grayscale-[0.1] opacity-90 drop-shadow-sm">🗓️</span>
                            {(() => {
                              const [h, m] = duration.split(':').map(Number);
                              const text = h > 0 ? t('app.train.duration', { hours: h, minutes: m }) : t('app.train.durationShort', { minutes: m });
                              return (
                                <span className={`tracking-wide tabular-nums ${isCancelled ? '' : 'text-blue-600 dark:text-blue-400'}`}>
                                  {text}
                                </span>
                              );
                            })()}
                          </div>
                          <div className={`text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter tabular-nums transition-colors duration-500 ${isCancelled ? 'text-slate-300 line-through' : 'text-slate-900'}`}>{arr}</div>
                        </div>
                      </div>

                      {/* Right: Train Info */}
                      <div className="flex flex-col items-start md:items-end justify-between gap-3 md:gap-6 mt-2 md:mt-0 w-full md:w-auto md:pr-10">
                        
                        {/* Top Right: Live Status & Train Info */}
                        <div className="flex flex-col items-start md:items-end gap-3 w-full">
                          {/* Live Status and Action Buttons */}
                          <div className="flex w-full md:w-auto justify-end items-center gap-3">
                            <div className="flex items-center bg-slate-50 border border-slate-100 rounded-full p-1 shadow-inner relative z-20">
                              <button 
                                onClick={(e) => toggleFavorite(trainId, e)}
                                aria-label={favorites.includes(trainId) ? t('app.removeFavorite', 'Remove favorite') : t('app.addFavorite', 'Add favorite')}
                                className={`p-2 rounded-full transition-all ${favorites.includes(trainId) ? 'text-red-600 bg-white shadow-sm ring-1 ring-red-200' : 'text-slate-400 hover:text-slate-600 hover:bg-white hover:shadow-sm'}`}
                                disabled={isCancelled}
                              >
                                <Heart className={`w-4 h-4 ${favorites.includes(trainId) ? 'stroke-[2.5]' : 'stroke-2'}`} />
                              </button>
                              <button 
                                onClick={(e) => toggleWatchlist(trainId, e)}
                                aria-label={watchlist.includes(trainId) ? t('app.removeWatchlist', 'Remove from watchlist') : t('app.addWatchlist', 'Add to watchlist')}
                                className={`p-2 rounded-full transition-all ${watchlist.includes(trainId) ? 'text-blue-600 bg-white shadow-sm ring-1 ring-blue-200' : 'text-slate-400 hover:text-slate-600 hover:bg-white hover:shadow-sm'}`}
                                disabled={isCancelled}
                              >
                                <Bell className={`w-4 h-4 ${watchlist.includes(trainId) ? 'stroke-[2.5]' : 'stroke-2'}`} />
                              </button>
                            </div>

                            {!isCancelled && (status === 'on-time' ? (
                              <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50/80 px-3 py-1.5 rounded-full text-xs font-bold tracking-wide border border-emerald-100">
                                <span className="relative flex h-2 w-2">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                </span>
                                {status === 'on-time' ? t('app.train.onTime') : t('app.train.delay', { minutes: delay })}
                              </div>
                            ) : status === 'delayed' ? (
                              <div className="flex items-center gap-2 text-red-600 bg-red-50/80 px-3 py-1.5 rounded-full text-xs font-bold tracking-wide border border-red-100">
                                <span className="relative flex h-2 w-2">
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                                </span>
                                {t('app.train.delay', { minutes: delay })}
                              </div>
                            ) : null)}

                            {isCancelled && (
                               <div className="flex items-center gap-2 text-slate-400 bg-slate-200/50 px-3 py-1.5 rounded-full text-xs font-bold tracking-wide border border-slate-300">
                                 <XCircle className="w-4 h-4" />
                                 CANCELLED
                               </div>
                            )}

                            {!isCancelled && reliabilityByTrain[trainId] && (
                              <ReliabilityBadge
                                reliability={reliabilityByTrain[trainId]!}
                                language={i18n.language}
                              />
                            )}
                          </div>

                          <div className={`flex flex-col items-end gap-1 text-right`}>
                            {train.DailyTrainInfo?.StartingStationName?.Zh_tw && train.DailyTrainInfo?.EndingStationName?.Zh_tw && (
                              <div className="text-xs text-slate-400 font-medium mb-1 flex items-center justify-end gap-2 flex-wrap">
                                <span>{train.DailyTrainInfo?.StartingStationName?.Zh_tw} <span className="text-[0.625rem] mx-0.5">➔</span> {train.DailyTrainInfo?.EndingStationName?.Zh_tw}</span>
                                <div className="flex gap-1">
                                  {train.DailyTrainInfo?.Direction !== undefined && (
                                    <span className="font-bold px-1.5 py-[1px] bg-slate-100 rounded text-slate-500 text-[0.625rem] tracking-widest">
                                      {train.DailyTrainInfo.Direction === 0 ? '南下' : '北上'}
                                    </span>
                                  )}
                                  {transportType === 'train' && train.DailyTrainInfo?.TripLine !== undefined && train.DailyTrainInfo.TripLine !== 0 && (
                                    <span className={`font-bold px-1.5 py-[1px] rounded text-[0.625rem] tracking-widest outline outline-1 ${
                                      train.DailyTrainInfo.TripLine === 1 ? 'bg-[#fef4cc] text-[#af7001] outline-[#fef4cc]/50 dark:outline-[#fef4cc]/20' : 
                                      train.DailyTrainInfo.TripLine === 2 ? 'bg-[#e5ffff] text-[#017a86] outline-[#e5ffff]/50 dark:outline-[#e5ffff]/20' :
                                      'bg-[#eee5ff] text-[#6126a8] outline-transparent'
                                    }`}>
                                      {train.DailyTrainInfo.TripLine === 1 ? '山線' : train.DailyTrainInfo.TripLine === 2 ? '海線' : '成追'}
                                    </span>
                                  )}
                                  {train.DailyTrainInfo?.OverNightStationID && (
                                    <span className="font-bold px-1.5 py-[1px] bg-[#e0e4ff] text-[#2b388f] rounded text-[0.625rem] tracking-widest">
                                      跨夜
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                            {train.DailyTrainInfo?.Note?.Zh_tw && (
                              <div className="text-[0.625rem] text-slate-400/80 mb-1 max-w-[200px] truncate" title={train.DailyTrainInfo?.Note?.Zh_tw}>
                                {train.DailyTrainInfo?.Note?.Zh_tw}
                              </div>
                            )}
                            <div className="flex items-center gap-2 flex-wrap justify-end">
                              {/* ACCESSIBILITY GLYPHS — REAL EMOJI, DATA-DRIVEN (TDX FLAGS) */}
                              <div className="flex items-center gap-1 mr-2 opacity-90">
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
                              <span className={`px-2 py-1 rounded-md text-xs sm:text-sm font-bold tracking-widest flex items-center gap-1 ${
                                isCancelled ? 'bg-slate-200 text-slate-400 line-through' :
                                color === 'red' ? 'bg-[#ffebeb] text-[#cb171d]' :
                                color === 'orange' ? 'bg-[#feebd6] text-[#d85e01]' :
                                'bg-[#e0efff] text-[#1b5cb7]'
                              }`}>
                                {typeName} <span className="font-black text-sm sm:text-base tracking-tight">{trainId}</span> {i18n.language === 'zh-TW' ? '次' : ''}
                              </span>
                            </div>
                          </div>
                        </div>
                        
                        <div className={`flex flex-col items-start md:items-end w-full md:w-auto gap-2 mt-1 md:mt-2 bg-slate-50 md:bg-transparent p-2.5 md:p-0 rounded-xl md:rounded-none`}>
                          {transportType === 'hsr' ? (
                            <div className="flex flex-col items-start md:items-end gap-1.5 w-full">
                              <div className="flex items-center gap-3 w-full justify-between md:justify-end">
                                <span className="text-xs font-semibold text-slate-400 uppercase">標準</span>
                                <span className={`tabular-nums text-2xl sm:text-3xl font-light tracking-tight ${isCancelled ? 'text-slate-300 line-through' : 'text-slate-800'}`}>
                                  NT${fares['standard'] || '--'}
                                </span>
                              </div>
                              <div className="flex gap-2 text-[11px] font-semibold text-slate-500 w-full justify-between md:justify-end">
                                <span className={`px-2 py-0.5 rounded flex gap-2 ${isCancelled ? 'bg-slate-100 text-slate-300' : 'bg-orange-50 text-orange-700'}`}>
                                  <span>商務</span> <span>${fares['business'] || '--'}</span>
                                </span>
                                <span className={`px-2 py-0.5 rounded flex gap-2 ${isCancelled ? 'bg-slate-100 text-slate-300' : 'bg-emerald-50 text-emerald-700'}`}>
                                  <span>自由</span> <span>${fares['unreserved'] || '--'}</span>
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col items-start md:items-end gap-1.5 w-full">
                              <div className="flex items-center gap-3 w-full justify-between md:justify-end">
                                <span className="text-xs font-semibold text-slate-400 uppercase">一般</span>
                                <span className={`tabular-nums text-2xl sm:text-3xl font-light tracking-tight ${isCancelled ? 'text-slate-300 line-through' : 'text-slate-800'}`}>
                                  {price.includes('NT$') 
                                    ? price.replace('NT$', t('app.train.fare', { price: '' }).replace('NT$', '')) 
                                    : price}
                                </span>
                              </div>
                              {(() => {
                                const typeId = train.DailyTrainInfo?.TrainTypeID || '';
                                let mappedType = '6';
                                if (typeId === '1101') mappedType = '1';
                                else if (typeId === '1102') mappedType = '2';
                                else if (['1100', '1103', '1104', '1105', '1106', '1107', '1108'].includes(typeId)) mappedType = '3';
                                else if (['1110', '1111', '1114', '1115'].includes(typeId)) mappedType = '4';
                                else if (['1120'].includes(typeId)) mappedType = '5';
                                else if (['1131', '1132', '1133'].includes(typeId)) mappedType = '6';
                                
                                const bizPrice = fares[`${mappedType}_business`] || (['1', '2', '3'].includes(mappedType) ? fares['3_business'] : undefined);
                                const isTzeChiang3000 = train.DailyTrainInfo?.TrainTypeName?.Zh_tw?.includes('3000') || typeId === '1100'; // EMU3000
                                
                                if (bizPrice) {
                                  return (
                                    <div className="flex gap-2 text-[11px] font-semibold text-slate-500 w-full justify-between md:justify-end">
                                      <span className={`px-2 py-0.5 rounded flex gap-2 ${isCancelled ? 'bg-slate-100 text-slate-300' : 'bg-purple-50 text-purple-700'}`}>
                                        <span>{isTzeChiang3000 ? '騰雲座艙' : '商務'}</span> <span>${bizPrice}</span>
                                      </span>
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                            </div>
                          )}

                          {/* Desktop Action Buttons */}
                          {!isCancelled && (
                            <div className="flex items-center gap-2 mt-2">
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
                                className="px-5 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs py-2 rounded-lg transition-colors border border-slate-200"
                              >
                                {i18n.language === 'zh-TW' ? '分享' : 'Share'}
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setBookingModalState({
                                    isOpen: true,
                                    trainNo: trainId,
                                    origin: stations.find(s => s.StationID === originStationId)?.StationName?.Zh_tw || '...',
                                    originId: originStationId,
                                    destination: stations.find(s => s.StationID === destStationId)?.StationName?.Zh_tw || '...',
                                    destId: destStationId,
                                    depTime: dep,
                                    // Map 'today'/'tomorrow' to exactly YYYY/MM/DD format
                                    searchDate: selectedDate === 'today' ? 
                                      new Date().toLocaleDateString('en-CA').replace(/-/g, '/') :
                                      new Date(Date.now() + 86400000).toLocaleDateString('en-CA').replace(/-/g, '/')
                                  });
                                }}
                                className="px-6 bg-slate-900 hover:bg-blue-600 text-white font-bold text-xs py-2 rounded-lg transition-colors"
                              >
                                {i18n.language === 'zh-TW' ? '馬上訂票' : 'Book Ticket'}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="absolute right-6 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity hidden md:flex">
                        {!isCancelled && <ChevronDown className={`w-6 h-6 text-blue-500 transition-transform duration-300 ${expandedTrainId === trainId ? 'rotate-180' : ''}`} />}
                      </div>
                    </div>

                    {expandedTrainId === trainId && (
                      <div className={`relative overflow-hidden p-5 sm:p-8 md:p-10 border-t transition-all duration-700 animate-in slide-in-from-top-4 fade-in ${
                        (() => {
                           const destName = stations.find(s => s.StationID === destStationId)?.StationName?.Zh_tw || '';
                           const env = getEnvironment(destName);
                           if (env.weather === 'rainy') return 'bg-slate-900 border-slate-800';
                           if (env.timeOfDay === 'morning') return 'bg-[#1a0f05] border-[#2a1a0a]';
                           if (env.timeOfDay === 'night') return 'bg-[#0a0d1a] border-[#1a1d2a]';
                           return 'bg-slate-900 border-slate-800';
                        })()
                      }`}>
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
                              </div>
                              {trainStops[trainId]?.isMock && (
                              <div className="flex items-center gap-1.5 text-[10px] text-orange-400 font-bold uppercase tracking-tight">
                                <AlertTriangle className="w-3 h-3" />
                                <span>{i18n.language === 'zh-TW' ? '目前顯示系統預排資訊 (Simulation Mode)' : 'Simulation Mode'}</span>
                              </div>
                            )}
                          </div>
                          {isToday && !trainStops[trainId]?.isMock && (
                            <div className="flex items-center gap-2 text-[10px] font-bold text-blue-400 border border-blue-400/30 px-2 py-1 rounded-md uppercase tracking-tighter self-start sm:self-auto">
                              <span className="flex h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse"></span>
                              {i18n.language === 'zh-TW' ? '即時位置' : 'Live Position'}
                            </div>
                          )}
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
                              
                              return stops.map((stop, idx) => {
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

                                if (originIdx !== -1 && destIdx !== -1 && !isSpecifiedRoute && !isOrigin && !isDest) return null;

                                return (
                                  <div key={`stop-editorial-${stop.StationID || idx}`} className={`flex items-stretch gap-4 sm:gap-8 relative group/stop transition-all duration-500 ${isPassed ? 'opacity-30' : 'opacity-100'}`}>
                                    {/* Timeline Column */}
                                    <div className="flex flex-col items-center w-6 sm:w-8 shrink-0 relative">
                                      <div className={`w-[2px] h-full absolute top-0 bottom-0 ${
                                        isPassed ? 'bg-slate-800' :
                                        isSpecifiedRoute ? 'bg-blue-500/30' : 'bg-slate-800/50'
                                      }`}>
                                        {isBetweenLeg && (
                                          <div className="absolute top-0 bottom-0 left-0 right-0 bg-gradient-to-b from-blue-500 to-transparent animate-shimmer-y"></div>
                                        )}
                                      </div>
                                      
                                      <div className={`w-3 h-3 rounded-full mt-7 z-10 border-2 border-slate-900 transition-all duration-500 ${
                                        isAtStop ? 'bg-blue-400 ring-4 ring-blue-400/20 scale-125 animate-pulse' :
                                        isOrigin || isDest ? 'bg-amber-400' :
                                        isSpecifiedRoute ? 'bg-blue-500/50' : 'bg-slate-700'
                                      }`}>
                                        {isAtStop && <StationHaptics active={isAtStop} />}
                                      </div>
                                    </div>

                                    {/* Content Column */}
                                    <div className={`flex flex-1 items-center justify-between py-4 sm:py-6 border-b border-slate-800/50 min-w-0 ${isAtStop ? 'bg-blue-400/5 -mx-2 sm:-mx-4 px-2 sm:px-4 rounded-2xl border-none' : ''}`}>
                                      <div className="flex flex-col gap-1 min-w-0 flex-1 pr-2 sm:pr-4">
                                        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                                          <span className={`text-lg sm:text-2xl font-black tracking-tight truncate ${
                                            isAtStop ? 'text-blue-300' : (isOrigin || isDest) ? 'text-amber-400' : 'text-slate-200'
                                          }`}>
                                            {i18n.language === 'zh-TW' ? (stop?.StationName?.Zh_tw || '車站') : (stop?.StationName?.En || 'Station')}
                                          </span>
                                          {isAtStop && (
                                            <span className="flex items-center gap-1.5 px-1.5 sm:px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 text-[9px] sm:text-[10px] font-black uppercase tracking-widest animate-pulse border border-blue-500/20 shrink-0">
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
                                            return transfers.map((tr, i) => (
                                              <span
                                                key={`${stop.StationID}-tr-${i}`}
                                                title={tr.detail}
                                                className={`px-1.5 sm:px-2 py-0.5 rounded text-[9px] sm:text-[10px] font-black tracking-widest border ${TRANSFER_COLOR[tr.color]} shadow-sm shrink-0 whitespace-nowrap`}
                                              >
                                                🚇 {tr.label}
                                              </span>
                                            ));
                                          })()}
                                        </div>
                                        <div className="flex items-center gap-2 sm:gap-3 text-[10px] font-bold text-slate-500 uppercase tracking-tighter flex-wrap">
                                          <span className="shrink-0">{i18n.language === 'zh-TW' ? '第' : 'Sequence '} {stop.StopSequence} {i18n.language === 'zh-TW' ? '站' : ''}</span>
                                          {(() => {
                                            const stationName = transportType === 'hsr'
                                              ? `高鐵${stop?.StationName?.Zh_tw || ''}`.replace('高鐵高鐵', '高鐵')
                                              : (stop?.StationName?.Zh_tw || '');
                                            const transfers = getTransfers(stationName).length
                                              ? getTransfers(stationName)
                                              : getTransfers(stop?.StationName?.Zh_tw || '');
                                            if (!transfers.length) return null;
                                            return (
                                              <>
                                                <span className="opacity-30 shrink-0">|</span>
                                                <span className="text-slate-400 normal-case tracking-normal text-wrap block leading-snug">
                                                  {transfers.map(tr => tr.detail).join(' · ')}
                                                </span>
                                              </>
                                            );
                                          })()}
                                        </div>

                                        {/* Platform Strategy Guide */}
                                        {(() => {
                                          const strategy = getStrategyForStation(stop.StationID, transportType);
                                          if (!strategy) return null;
                                          const isZh = i18n.language === 'zh-TW';
                                          return (
                                            <div className="mt-4 space-y-2.5 w-full animate-in fade-in slide-in-from-left-4 duration-1000">
                                              <div className="flex items-center gap-1.5 text-[9px] font-black text-amber-500 uppercase tracking-[0.2em] bg-amber-500/10 px-2 py-1.5 rounded-lg inline-flex border border-amber-500/20 shadow-sm shadow-amber-500/5">
                                                <Compass className="w-3.5 h-3.5 animate-spin-slow" />
                                                {isZh ? '轉乘最速攻略' : 'Fastest Transfer Guide'}
                                              </div>
                                              {strategy.trainTypeNotes && (
                                                <div className="text-[10px] leading-relaxed text-slate-400 bg-slate-500/10 border border-slate-400/20 rounded-2xl px-3 py-2">
                                                  <span className="font-black uppercase tracking-widest text-slate-300 mr-1">
                                                    {isZh ? '編組備註' : 'Consist note'}:
                                                  </span>
                                                  {strategy.trainTypeNotes}
                                                </div>
                                              )}
                                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pr-2">
                                                {strategy.strategies.map((s, si) => (
                                                  <div key={`${stop.StationID}-strat-${si}`} className="flex flex-col bg-slate-400/5 rounded-3xl p-4 border border-slate-100/10 hover:bg-slate-400/10 transition-all group scale-100 hover:scale-[1.02] active:scale-95 duration-500 shadow-lg shadow-black/20">
                                                    <div className="flex items-center justify-between gap-2 mb-2.5 flex-wrap">
                                                      <span className="text-[8px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-black uppercase tracking-widest border border-blue-500/30 whitespace-nowrap">{s.target}</span>
                                                      <span className="text-[10px] font-black text-emerald-400 flex items-center gap-1.5 bg-emerald-400/10 px-2 py-1 rounded-full border border-emerald-400/20">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                                        {isZh ? `推薦：${s.recommendCars} 車廂` : `Recommended: Car ${s.recommendCars}`}
                                                      </span>
                                                    </div>
                                                    <p className="text-[11px] leading-relaxed text-slate-300 font-medium group-hover:text-white transition-colors duration-300">
                                                      {isZh ? s.description : s.descriptionEn}
                                                    </p>
                                                    {s.accessibleCars && (
                                                      <div className="mt-2.5 flex items-center gap-1.5 text-[10px] text-sky-300 bg-sky-500/10 border border-sky-400/20 rounded-full px-2 py-1 self-start">
                                                        <span className="text-sm leading-none">♿️</span>
                                                        <span className="font-bold">
                                                          {isZh ? `無障礙電梯：${s.accessibleCars} 車廂` : `Accessible elevator: Car ${s.accessibleCars}`}
                                                        </span>
                                                      </div>
                                                    )}
                                                    {s.warning && (
                                                      <div className="mt-2.5 flex items-start gap-1.5 text-[10px] leading-relaxed text-amber-200 bg-amber-500/10 border border-amber-400/30 rounded-2xl px-2.5 py-2">
                                                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-[1px] text-amber-300" />
                                                        <span className="font-medium">{s.warning}</span>
                                                      </div>
                                                    )}
                                                  </div>
                                                ))}
                                              </div>
                                            </div>
                                          );
                                        })()}
                                      </div>

                                      <div className="flex flex-col sm:flex-row items-end gap-0.5 sm:gap-8 shrink-0">
                                        {(stop.ArrivalTime && stop.ArrivalTime !== stop.DepartureTime) && (
                                          <div className="flex sm:flex-col items-center sm:items-end gap-2 sm:gap-0 opacity-40">
                                            <div className="text-[9px] sm:hidden font-bold text-slate-500 uppercase tracking-widest">{i18n.language === 'zh-TW' ? '抵達' : 'Arr'}</div>
                                            <div className="text-sm font-black font-mono text-slate-400">
                                              {stop.ArrivalTime.substring(0, 5)}
                                            </div>
                                            <div className="hidden sm:block text-[9px] font-bold text-slate-600 uppercase tracking-widest text-right">{i18n.language === 'zh-TW' ? '抵達時間' : 'Arrival'}</div>
                                          </div>
                                        )}
                                        <div className="flex sm:flex-col items-center sm:items-end gap-2 sm:gap-0">
                                          <div className="text-[9px] sm:hidden font-bold text-slate-500 uppercase tracking-widest">{i18n.language === 'zh-TW' ? '出發' : 'Dep'}</div>
                                          <div className={`text-lg sm:text-2xl font-black font-mono transition-colors ${isAtStop ? 'text-blue-200' : 'text-slate-400'}`}>
                                            {stop.DepartureTime.substring(0, 5)}
                                          </div>
                                          <div className="hidden sm:block text-[9px] sm:text-[10px] font-bold text-slate-600 uppercase tracking-widest">{i18n.language === 'zh-TW' ? '出發時間' : 'Departure'}</div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              });
                            })()
                          : (
                              <div className="py-20 text-center bg-slate-800/30 rounded-[2.5rem] border border-dashed border-slate-800">
                                 <p className="text-slate-500 font-bold tracking-widest uppercase text-xs">No Sequence Data Available</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
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
          </div>
          </>
          )}
        </div>
      </section>

      {/* SEO: Intro + FAQ — keeps crawlable content on the homepage */}
      <section className="max-w-4xl mx-auto px-6 md:px-10 py-16 prose prose-slate dark:prose-invert">
        <h2 className="text-balance text-2xl md:text-3xl font-bold tracking-tight text-slate-800 dark:text-slate-100 mb-4">
          {i18n.language === 'zh-TW' ? '關於鐵道查詢' : 'About Taiwanrail'}
        </h2>
        <p className="text-slate-600 dark:text-slate-400 leading-relaxed text-[15px] mb-8">
          {i18n.language === 'zh-TW'
            ? '鐵道查詢是一個免費的台灣鐵路時刻表查詢工具，整合 台鐵 (TRA) 與 高鐵 (THSR) 兩大系統，提供即時班次、票價、停靠站資訊以及誤點狀態。不需註冊即可搜尋任意兩站之間的所有班次，並可轉乘台北捷運、高雄捷運、桃園機場捷運、台中捷運與 BRT。'
            : 'Taiwanrail is a free Taiwan train timetable search tool combining the Taiwan Railways Administration (TRA) and Taiwan High Speed Rail (THSR) systems. Check live schedules, fares, stops and delays, plus metro transfer hints (Taipei MRT, Kaohsiung MRT, Taoyuan Airport MRT, Taichung MRT) — no sign-up required.'}
        </p>

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
            <details key={i} className="group bg-white/70 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-2xl px-5 py-4">
              <summary className="cursor-pointer font-semibold text-slate-800 dark:text-slate-100 flex items-center justify-between gap-4 list-none">
                <span>{q}</span>
                <ChevronDown className="w-4 h-4 shrink-0 transition-transform duration-300 group-open:rotate-180" />
              </summary>
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full py-12 border-t border-slate-200/50 dark:border-white/5 bg-transparent text-center">
        <div className="max-w-7xl mx-auto px-6">
          <p className="text-sm text-slate-400 font-medium tracking-wide">
            © 2026 Taiwan Rail Explorer. <span className="mx-2 opacity-30">|</span> 
            {i18n.language === 'zh-TW' ? '旅程，從這裡開始' : 'The journey starts here.'}
          </p>
        </div>
      </footer>
      {/* 20. Approaching Station Toast (Floating Bottom) */}
      {approachingInfo && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[90] w-[95%] max-w-[420px] animate-in slide-in-from-bottom-5 fade-in duration-500">
          <div 
            onClick={() => scrollToTrain(approachingInfo.trainNo)}
            className="bg-[#111928] border border-white/5 rounded-3xl p-4 pr-16 shadow-[0_20px_40px_-5px_rgba(0,0,0,0.5)] flex items-center justify-start gap-4 overflow-hidden relative cursor-pointer group"
          >
            {/* Animated Glow Backlight */}
            <div className={`absolute -inset-1 rounded-3xl blur-2xl opacity-0 group-hover:opacity-40 transition-opacity duration-1000 ${transportType === 'hsr' ? 'bg-orange-500/30' : 'bg-blue-500/30'}`}></div>

            <div className={`relative shrink-0 w-14 h-14 rounded-[1.25rem] flex items-center justify-center shadow-[inset_0_4px_10px_rgba(255,255,255,0.1)] ${transportType === 'hsr' ? 'bg-gradient-to-br from-[#ff6c00] to-[#cc5600] shadow-[#ff6c00]/30' : 'bg-gradient-to-br from-[#3b82f6] to-[#1d4ed8] shadow-blue-500/30'}`}>
              <span className="text-3xl filter drop-shadow-md">🚆</span>
            </div>
            
            <div className="relative flex-col flex gap-0.5 justify-center flex-1 py-1">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#00df83] animate-pulse"></span>
                <p className="text-[#00df83] text-[11px] font-bold tracking-widest whitespace-nowrap">
                  {i18n.language === 'zh-TW' ? `${approachingInfo.trainNo} 次車 · 即時進站` : `Train ${approachingInfo.trainNo} · Live Arrival`}
                </p>
              </div>
              <div className="flex items-baseline gap-2 overflow-hidden">
                <h3 className="text-balance text-white text-lg font-black tracking-tight whitespace-nowrap">
                  {i18n.language === 'zh-TW' ? '即將抵達：' : 'Approaching: '}
                  <span className={transportType === 'hsr' ? 'text-orange-400' : 'text-[#3b82f6]'}>{approachingInfo.station}</span>
                </h3>
              </div>
              <p className="text-slate-300/80 text-[13px] font-medium tracking-wide whitespace-nowrap pt-0.5">
                {i18n.language === 'zh-TW' ? '還有 ' : 'In '}
                <strong className="text-white font-bold">{approachingInfo.minutes}</strong> 
                {i18n.language === 'zh-TW' ? ' 分鐘 · 預計停靠第 ' : ' mins · Plt '}
                <strong className="text-white font-bold">{approachingInfo.platform}</strong> 
                {i18n.language === 'zh-TW' ? ' 月台' : ''}
              </p>
            </div>

            <button 
              onClick={(e) => {
                e.stopPropagation();
                // Add to dismissed trains so we don't spam the user again
                setDismissedTrains(prev => {
                  const newSet = new Set(prev);
                  newSet.add(approachingInfo.trainNo);
                  return newSet;
                });
              }}
              className="absolute right-4 top-1/2 -translate-y-1/2 w-8 h-8 flex flex-col justify-center items-center bg-[#1f2937]/80 hover:bg-[#374151] rounded-full text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
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
      <ExternalLinkModal 
        isOpen={bookingModalState.isOpen}
        onClose={() => setBookingModalState(prev => ({ ...prev, isOpen: false }))}
        trainNo={bookingModalState.trainNo}
        transportType={transportType}
        origin={bookingModalState.origin}
        originId={bookingModalState.originId}
        destination={bookingModalState.destination}
        destId={bookingModalState.destId}
        depTime={bookingModalState.depTime}
        searchDate={bookingModalState.searchDate}
        date={selectedDate === 'today' ? new Date().toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' }) : new Date(Date.now() + 86400000).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' })}
      />
    </div>
  );
}
