/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Heart, Bell, Globe, ArrowRightLeft, Calendar, User, Search, CheckCircle, AlertCircle, XCircle, ChevronDown, AlertTriangle, Train, Sun, CloudRain, Pencil, MapPin } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { getTRATimetableOD, getTHSRTimetableOD, DailyTimetableOD, getTRAStations, getTHSRStations, Station, getTRAODFare, getTHSRODFare, getTRATrainTimetable, getTHSRTrainTimetable, getTRALiveBoard, StopTime, getTRAAlerts, getTHSRAlerts, getTHSRLiveBoard, RailLiveBoard, preloadStaticData } from './lib/api';
import { getTransfers, TRANSFER_COLOR } from './lib/transfers';

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
  const [transportType, setTransportType] = useState<'hsr' | 'train'>('hsr');
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
  const [lastLiveUpdate, setLastLiveUpdate] = useState<Date | null>(null);
  const [trainStops, setTrainStops] = useState<Record<string, { stops: StopTime[], isMock?: boolean }>>({});
  const [stopsLoading, setStopsLoading] = useState<Record<string, boolean>>({});
  const [returnTimetables, setReturnTimetables] = useState<DailyTimetableOD[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // New states for disruption alerts and approaching station
  const [globalAlert, setGlobalAlert] = useState<{message: string, type: 'warning' | 'error'} | null>(null);
  const [cancelledTrains, setCancelledTrains] = useState<Set<string>>(new Set());
  const [approachingInfo, setApproachingInfo] = useState<{station: string, minutes: number, platform: string, trainNo: string} | null>(null);

  // Collapsible search panel – defaults to expanded. Collapses after a successful search.
  const [isSearchCollapsed, setIsSearchCollapsed] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const lastNotifiedRef = useRef<string | null>(null);

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
    return h * 60 + m;
  };

  const timeToMinutes = (t: string | undefined) => {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };

  useEffect(() => {
    const fetchApproaching = async () => {
      if (!originStationId || !destStationId) return;
      
      try {
        let board: RailLiveBoard[] = [];
        if (transportType === 'hsr') {
          board = await getTHSRLiveBoard(originStationId);
        } else {
          board = await getTRALiveBoard(originStationId);
        }
        
        if (board && board.length > 0) {
          // Find the first train that is expected in the next 15 minutes
          const now = new Date();
          const currentH = now.getHours();
          const currentM = now.getMinutes();
          const currentTotal = currentH * 60 + currentM;

          const upcoming = board.filter(b => {
             const timeStr = b.ScheduledArrivalTime || b.ScheduledDepartureTime;
             if (!timeStr) return false;
             const [h, m] = timeStr.split(':').map(Number);
             const trainTotal = h * 60 + m;
             // Must be in the future (or 1 min past) and within 30 min
             return trainTotal >= currentTotal - 1 && trainTotal <= currentTotal + 30;
          }).sort((a, b) => {
             const tA = timeToMinutes(a.ScheduledArrivalTime || a.ScheduledDepartureTime);
             const tB = timeToMinutes(b.ScheduledArrivalTime || b.ScheduledDepartureTime);
             return tA - tB;
          });

          if (upcoming.length > 0) {
            const train = upcoming[0];
            const trainTime = timeToMinutes(train.ScheduledArrivalTime || train.ScheduledDepartureTime);
            const diff = Math.max(0, trainTime - currentTotal);
            const stationName = stations.find(s => s.StationID === originStationId)?.StationName?.Zh_tw || '...';
            
            setApproachingInfo({
              trainNo: train.TrainNo,
              station: stationName,
              minutes: diff + (train.DelayTime || 0),
              platform: train.Platform || (transportType === 'hsr' ? '...' : '--')
            });

            // 📢 桌面提醒：如果剩不到 5 分鐘且還沒提醒過
            const arrivalMinutes = diff + (train.DelayTime || 0);
            if (arrivalMinutes <= 5 && lastNotifiedRef.current !== train.TrainNo) {
              notifyUser(
                i18n.language === 'zh-TW' ? '🚆 火車即時提醒' : 'Train Approach Alert',
                i18n.language === 'zh-TW' 
                  ? `${train.TrainNo} 車次即將於 ${arrivalMinutes} 分鐘內抵達 ${stationName}`
                  : `Train ${train.TrainNo} is arriving at ${stationName} in ${arrivalMinutes} min.`
              );
              lastNotifiedRef.current = train.TrainNo;
            }
          } else {
             setApproachingInfo(null);
             lastNotifiedRef.current = null;
          }
        }
      } catch (err) {
        console.error('Failed to detect real approaching train', err);
      }
    };

    fetchApproaching();
    const interval = setInterval(fetchApproaching, 120_000); // Check every 2 min
    return () => clearInterval(interval);
  }, [originStationId, transportType, stations]);

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
            type: latest.Level > 2 ? 'error' : 'warning'
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
    try {
      const dateObj = dates.find(d => d.id === selectedDate) || dates[0];
      const dateStr = dateObj.value;
      
      let data: DailyTimetableOD[] = [];
      let returnData: DailyTimetableOD[] = [];
      
      if (transportType === 'hsr') {
        data = await getTHSRTimetableOD(originStationId, destStationId, dateStr);
        if (tripType === 'round-trip') {
          const returnDateObj = dates.find(d => d.id === returnDate) || dates[1];
          returnData = await getTHSRTimetableOD(destStationId, originStationId, returnDateObj.value);
        }
      } else {
        data = await getTRATimetableOD(originStationId, destStationId, dateStr);
        if (tripType === 'round-trip') {
          const returnDateObj = dates.find(d => d.id === returnDate) || dates[1];
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
    } catch (err: any) {
      console.error(err);
      setError(err.message || '發生錯誤');
    } finally {
      setIsLoading(false);
    }
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

      if (transportType === 'hsr') {
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
        (Array.isArray(boardData) ? boardData : []).forEach(b => {
          if (b?.TrainNo !== undefined) delayMap[b.TrainNo] = b.DelayTime || 0;
        });
        setLiveBoard(delayMap);
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
        (Array.isArray(boardData) ? boardData : []).forEach(b => {
          if (b?.TrainNo !== undefined) delayMap[b.TrainNo] = b.DelayTime || 0;
        });
        setLiveBoard(delayMap);
        setLastLiveUpdate(new Date());
      }
    } catch (e) {
      console.error('Failed to fetch extra data', e);
    }
  };

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
    const diffM = getDurationMinutes(dep, arr);
    const h = Math.floor(diffM / 60);
    const m = diffM % 60;
    return `${h}h ${m}m`;
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
    let base = activeTab === 'outbound' ? timetables : returnTimetables;
    let filtered = [...base];
    
    // --- 從現在時間的前 3 小時開始顯示 ---
    if (selectedDate === 'today') {
      // 設定門檻為 3 小時前 (180 分鐘)
      const thresholdMinutes = Math.max(0, nowMinutes - 180);

      filtered = filtered.filter(t => {
        const depTime = t.OriginStopTime?.DepartureTime;
        if (!depTime) return false;
        const [h, m] = depTime.split(':').map(Number);
        const trainMinutes = h * 60 + m;
        // 如果跨日(凌晨)，可能要額外處理，但這裡先依據原邏輯
        return trainMinutes >= thresholdMinutes || (trainMinutes + 1440 >= thresholdMinutes && trainMinutes < 240); 
      });
    }

    if (showFavoritesOnly) {
      filtered = filtered.filter(t => favorites.includes(t.DailyTrainInfo.TrainNo));
    }
    if (showWatchlistOnly) {
      filtered = filtered.filter(t => watchlist.includes(t.DailyTrainInfo.TrainNo));
    }

    if (activeFilter === 'time') {
      filtered.sort((a, b) => {
        const timeA = a.OriginStopTime?.DepartureTime;
        const timeB = b.OriginStopTime?.DepartureTime;
        return parseTimeForSort(timeA) - parseTimeForSort(timeB);
      });
    } else if (activeFilter === 'fastest') {
      filtered.sort((a, b) => {
        const durA = getDurationMinutes(a.OriginStopTime.DepartureTime, a.DestinationStopTime.ArrivalTime);
        const durB = getDurationMinutes(b.OriginStopTime.DepartureTime, b.DestinationStopTime.ArrivalTime);
        return durA - durB;
      });
    } else if (activeFilter === 'cheapest') {
      filtered.sort((a, b) => {
        const priceAString = getPrice(a).replace(/[^\d]/g, '');
        const priceBString = getPrice(b).replace(/[^\d]/g, '');
        const priceA = parseInt(priceAString) || 99999;
        const priceB = parseInt(priceBString) || 99999;
        return priceA - priceB;
      });
    } else if (activeFilter === 'reserved') {
      filtered = filtered.filter(t => {
        const typeId = t.DailyTrainInfo?.TrainTypeID || '';
        const name = t.DailyTrainInfo?.TrainTypeName?.Zh_tw || '';
        return ['1', '2', '3', '1100', '1101', '1102', '1107', '1108', '1110'].includes(typeId) || 
               name.includes('自強') || name.includes('普悠瑪') || name.includes('太魯閣') || name.includes('高鐵');
      });
    } else if (activeFilter === 'accessible') {
      filtered = filtered.filter(t => {
        const typeId = t.DailyTrainInfo?.TrainTypeID || '';
        const name = t.DailyTrainInfo?.TrainTypeName?.Zh_tw || '';
        return transportType === 'hsr' || name.includes('3000') || name.includes('普悠瑪') || name.includes('太魯閣');
      });
    }
    
    return filtered;
  }, [timetables, returnTimetables, activeTab, selectedDate, nowMinutes, showFavoritesOnly, showWatchlistOnly, activeFilter, transportType, favorites, watchlist]); // Add dependencies

  const pagedTimetables = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredTimetables.slice(start, start + pageSize);
  }, [filteredTimetables, currentPage, pageSize]);

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
    return <span className="bg-purple-100 text-purple-700 px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest">⚡ 直達最快</span>;
  }
  if (baseNo.startsWith('8') || baseNo.startsWith('9')) {
    return <span className="bg-slate-100 text-slate-500 px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest">站站停</span>;
  }
  if (trainNo.length === 4) {
     return <span className="bg-orange-100 text-orange-600 px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest">加班車</span>;
  }
  return null;
};
  return (
    <div className={`min-h-screen font-sans text-slate-900 dark:text-slate-100 selection:bg-slate-200 dark:selection:bg-slate-700 soft-scrollbar transition-colors duration-700 bg-gradient-to-b ${
      transportType === 'hsr' ? 'from-transparent via-orange-50/40 to-orange-50/50 dark:from-[#1a1205]/10 dark:via-[#1a1205]/40 dark:to-[#1a1205]/50' : 'from-transparent via-blue-50/40 to-blue-50/50 dark:from-[#050f1a]/10 dark:via-[#050f1a]/40 dark:to-[#050f1a]/50'
    }`}>
      {/* Navbar - Glassmorphism */}
      <header className={`fixed top-0 w-full z-50 backdrop-blur-2xl border-b shadow-none transition-colors duration-700 ${
        transportType === 'hsr' ? 'bg-orange-50/30 border-orange-100/20' : 'bg-blue-50/30 border-blue-100/20'
      }`}>
        <div className="max-w-7xl mx-auto px-6 md:px-10 h-20 flex items-center justify-between">
          <div className="text-xl font-semibold tracking-tight text-slate-800 dark:text-slate-200">
            {t('app.title')}
          </div>
          <div className="flex items-center gap-6 text-slate-600 dark:text-slate-400">
            <button 
              onClick={() => {
                setShowFavoritesOnly(!showFavoritesOnly);
                setShowWatchlistOnly(false);
              }} 
              className={`transition-colors flex items-center gap-2 px-3 py-1.5 rounded-full ${showFavoritesOnly ? 'bg-red-50 text-red-600 font-bold' : 'hover:text-slate-900 dark:hover:text-white'}`}
            >
              <Heart className={`w-5 h-5 stroke-[1.5] ${showFavoritesOnly ? 'fill-current' : ''}`} />
              {favorites.length > 0 && <span className="text-xs">{favorites.length}</span>}
            </button>
            <button 
              onClick={() => {
                setShowWatchlistOnly(!showWatchlistOnly);
                setShowFavoritesOnly(false);
              }} 
              className={`transition-colors flex items-center gap-2 px-3 py-1.5 rounded-full ${showWatchlistOnly ? 'bg-blue-50 text-blue-600 font-bold' : 'hover:text-slate-900 dark:hover:text-white'}`}
            >
              <Bell className={`w-5 h-5 stroke-[1.5] ${showWatchlistOnly ? 'fill-current' : ''}`} />
              {watchlist.length > 0 && <span className="text-xs">{watchlist.length}</span>}
            </button>
            <button 
              onClick={() => {
                const newLang = i18n.language === 'zh-TW' ? 'en' : 'zh-TW';
                i18n.changeLanguage(newLang);
                showToast(t('app.toasts.langChanged', { lang: newLang === 'zh-TW' ? '中文' : 'English' }));
              }} 
              className="hover:text-slate-900 dark:hover:text-white transition-colors flex items-center gap-1 bg-slate-100/50 px-3 py-1.5 rounded-full"
            >
              <Globe className="w-5 h-5 stroke-[1.5]" />
              <span className="text-xs font-bold uppercase">{i18n.language === 'zh-TW' ? 'EN' : '中文'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* 18. Global Disruption Banner */}
      {globalAlert && (
          <div className="fixed top-24 left-0 w-full z-40 px-4 md:px-8 mt-2 animate-in slide-in-from-top-10 fade-in duration-500">
            <div className={`max-w-5xl mx-auto relative overflow-hidden rounded-3xl p-5 flex items-center gap-4 cursor-pointer group shadow-2xl border-2 ${
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
                {i18n.language === 'zh-TW' ? '查閱詳情' : 'Details'}
                <Search className="w-4 h-4 ml-1 transition-transform group-hover:translate-x-1" />
              </div>
            </div>
          </div>
        )}

      {/* Hero Section */}
      <section className={`relative px-4 md:px-8 flex flex-col items-center justify-center transition-all duration-[700ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
        isSearchCollapsed ? 'pt-28 pb-6 min-h-0' : 'pt-40 pb-32 min-h-[85vh]'
      }`}>
        {/* Background Image with Soft Blur */}
        <div className={`absolute top-0 left-0 w-full z-0 overflow-hidden transition-[height] duration-[700ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isSearchCollapsed ? 'h-[260px]' : 'h-[85vh]'
        }`}>
          <img
            src="https://images.unsplash.com/photo-1474487056207-5d7d762f234b?auto=format&fit=crop&q=80&w=2000"
            alt="Modern Train Landscape"
            className={`w-full h-full object-cover object-center blur-[12px] brightness-[0.9] dark:brightness-[0.4] transition-transform duration-[1200ms] ease-out ${
              isSearchCollapsed ? 'scale-[1.18]' : 'scale-110'
            }`}
            referrerPolicy="no-referrer"
          />
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
            className={`relative z-10 w-full max-w-4xl cursor-pointer group animate-in fade-in slide-in-from-top-6 duration-500 bg-white/90 dark:bg-slate-900/70 backdrop-blur-2xl rounded-full border border-white/60 dark:border-white/10 flex items-center gap-4 md:gap-6 p-3 pr-4 md:pr-5 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.25)] hover:shadow-[0_24px_60px_-20px_rgba(0,0,0,0.35)] hover:-translate-y-[2px] transition-all`}
          >
            <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-[11px] md:text-xs font-black uppercase tracking-widest text-white shrink-0 ${
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
              <ArrowRightLeft className="w-4 h-4 text-slate-400 shrink-0" />
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
        <div className={`relative z-10 w-full max-w-6xl bg-white/95 backdrop-blur-sm rounded-[2.5rem] border-none transition-all duration-[700ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isSearchCollapsed
            ? 'max-h-0 opacity-0 p-0 overflow-hidden pointer-events-none translate-y-[-8px]'
            : 'max-h-[2400px] opacity-100 p-8 sm:p-12 md:p-14 overflow-hidden translate-y-0'
        } ${
          transportType === 'hsr' ? 'shadow-[0_20px_60px_-15px_rgba(234,88,12,0.1)]' : 'shadow-[0_20px_60px_-15px_rgba(37,99,235,0.1)]'
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
              <div className={`text-[10px] sm:text-xs font-semibold uppercase tracking-widest mb-1 sm:mb-2 transition-colors ${transportType === 'hsr' ? 'text-orange-600/60' : 'text-blue-600/60'}`}>{t('app.origin')}</div>
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
                  <div className="py-8 text-center text-slate-400 animate-pulse text-sm">Loading stations...</div>
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
                className={`w-10 h-10 sm:w-14 sm:h-14 bg-white rounded-full shadow-[0_8px_20px_rgb(0,0,0,0.15)] flex items-center justify-center hover:scale-105 transition-all border border-white/50 ${transportType === 'hsr' ? 'text-orange-600 hover:text-orange-700 hover:shadow-[0_8px_20px_rgba(234,88,12,0.15)]' : 'text-blue-600 hover:text-blue-700 hover:shadow-[0_8px_20px_rgba(37,99,235,0.15)]'}`}
    >
                <ArrowRightLeft className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.5]" />
              </button>
            </div>

            {/* Destination */}
            <div className="flex-1 min-w-0 text-center relative w-1/2 pl-6">
              <div className={`text-[10px] sm:text-xs font-semibold uppercase tracking-widest mb-1 sm:mb-2 transition-colors ${transportType === 'hsr' ? 'text-orange-600/60' : 'text-blue-600/60'}`}>{t('app.destination')}</div>
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
                  <div className="py-8 text-center text-slate-400 animate-pulse text-sm">Loading stations...</div>
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
                <span className="text-[10px] text-slate-300 font-mono hidden sm:block">SCROLL →</span>
              </div>
              <div className="flex overflow-x-auto gap-4 pb-6 px-1 soft-scrollbar scroll-smooth">
                {dates.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setSelectedDate(d.id)}
                    className={`flex flex-col items-center justify-center min-w-[82px] sm:min-w-[100px] py-3 sm:py-4 px-4 sm:px-6 rounded-3xl transition-all duration-300 border ${
                      selectedDate === d.id
                        ? 'bg-slate-900 border-slate-900 text-white shadow-[0_12px_25px_rgba(0,0,0,0.15)] scale-105 z-10'
                        : 'bg-slate-50 border-slate-100 text-slate-500 hover:bg-slate-100 hover:border-slate-200'
                    }`}
                  >
                    <span className={`text-[11px] font-bold mb-1.5 uppercase tracking-tighter ${selectedDate === d.id ? 'text-slate-400' : 'text-slate-400'}`}>
                      {d.label}
                    </span>
                    <span className={`text-xl font-black ${selectedDate === d.id ? 'text-white' : 'text-slate-700'}`}>
                      {d.date}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {tripType === 'round-trip' && (
              <div className="min-w-0 relative pt-8 lg:pt-0 lg:border-l lg:border-slate-100/80 lg:pl-16">
                <div className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-6 px-1 flex items-center justify-between">
                  <span>{t('app.return')}</span>
                  <span className="text-[10px] text-slate-300 font-mono hidden sm:block">SCROLL →</span>
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
                            ? 'bg-blue-600 border-blue-600 text-white shadow-[0_12px_25px_rgba(37,99,235,0.25)] scale-105 z-10'
                            : 'bg-slate-50 border-slate-100 text-slate-500 hover:bg-slate-100 hover:border-slate-200'
                        }`}
                      >
                        <span className={`text-[11px] font-bold mb-1.5 uppercase tracking-tighter ${returnDate === d.id ? 'text-blue-200' : 'text-slate-400'}`}>
                          {d.label}
                        </span>
                        <span className={`text-xl font-black ${returnDate === d.id ? 'text-white' : 'text-slate-700'}`}>
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
            // 新增 disabled 狀態樣式
            className={`w-full text-white py-4 sm:py-6 rounded-full text-base sm:text-xl font-medium flex items-center justify-center gap-3 transition-all duration-300 hover:-translate-y-1 active:scale-[0.98] ${
              transportType === 'hsr'
                ? 'bg-orange-600 shadow-[0_8px_25px_-8px_rgba(234,88,12,0.5)] hover:shadow-[0_20px_40px_-10px_rgba(234,88,12,0.6)]'
                : 'bg-blue-600 shadow-[0_8px_25px_-8px_rgba(37,99,235,0.5)] hover:shadow-[0_20px_40px_-10px_rgba(37,99,235,0.6)]'
            }`}
          >
            <Search className="w-6 h-6 stroke-[2]" />
            {t('app.search')}
          </button>

        </div>
      </section>

      {/* Search Results Section */}
      <section id="results-section" className="max-w-5xl mx-auto px-4 md:px-8 pb-32 -mt-8 relative z-20 scroll-mt-24">

        {/* Quick Filters – sticky on scroll */}
        <div className={`sticky top-[72px] z-30 py-3 -mx-4 md:-mx-8 px-4 md:px-8 transition-colors duration-500 ${
          transportType === 'hsr' ? 'bg-orange-50/80 dark:bg-[#1a1205]/80' : 'bg-blue-50/80 dark:bg-[#050f1a]/80'
        } backdrop-blur-lg`}>
          <div className="flex overflow-x-auto gap-3 pb-1 soft-scrollbar">
            {[
              { id: 'time', label: t('app.filters.time') },
              { id: 'fastest', label: t('app.filters.fastest') },
              { id: 'cheapest', label: t('app.filters.cheapest') },
              { id: 'reserved', label: t('app.filters.reserved') },
              { id: 'accessible', label: i18n.language === 'zh-TW' ? '無障礙' : 'Accessible' },
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setActiveFilter(f.id)}
                className={`whitespace-nowrap px-6 py-2.5 rounded-full text-sm font-medium transition-all border ${
                  activeFilter === f.id
                    ? transportType === 'hsr'
                      ? 'bg-orange-600 border-orange-600 text-white shadow-[0_4px_14px_rgba(234,88,12,0.3)]'
                      : 'bg-blue-600 border-blue-600 text-white shadow-[0_4px_14px_rgba(37,99,235,0.3)]'
                    : 'bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/60 hover:border-slate-300'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Selector for Round Trip */}
        {tripType === 'round-trip' && (
          <div className="flex mb-8 bg-slate-100 p-1.5 rounded-2xl w-fit">
            <button 
              onClick={() => setActiveTab('outbound')}
              className={`px-8 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'outbound' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}
            >
              {t('app.outbound')}
            </button>
            <button 
              onClick={() => setActiveTab('return')}
              className={`px-8 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'return' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400'}`}
            >
              {t('app.return')}
            </button>
          </div>
        )}

        {/* Results List Container */}
        <div className="bg-[#F8F9FA] rounded-3xl min-h-[400px]">
          {!hasSearched ? (
              <div className="flex flex-col items-center justify-center py-32 px-6 text-center animate-in fade-in duration-700">
                <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-6 shadow-inner ${transportType === 'hsr' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'}`}>
                  <Search className="w-10 h-10" />
                </div>
                <h3 className="text-2xl font-black text-slate-800 mb-3 tracking-tight">
                  {i18n.language === 'zh-TW' ? '準備好開始旅程了嗎？' : 'Ready to start your journey?'}
                </h3>
                <p className="text-slate-500 max-w-sm font-medium leading-relaxed">
                  {i18n.language === 'zh-TW' 
                    ? '請先選擇起訖站與日期，按下方的「搜尋班次」按鈕即可獲取最新时刻表。' 
                    : 'Select your stations and date, then tap Search to get the most accurate timetables.'}
                </p>
              </div>
          ) : (
            <>
              {/* Results Header */}
              <div className="mb-6 px-2 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-500 tracking-wide">
                    {activeTab === 'outbound' ? (
                      <>
                        {i18n.language === 'zh-TW' 
                          ? (stations.find(s => s.StationID === originStationId)?.StationName?.Zh_tw || '...')
                          : (stations.find(s => s.StationID === originStationId)?.StationName?.En || '...')
                        } 往 {i18n.language === 'zh-TW' 
                          ? (stations.find(s => s.StationID === destStationId)?.StationName?.Zh_tw || '...')
                          : (stations.find(s => s.StationID === destStationId)?.StationName?.En || '...')
                        }
                      </>
                    ) : (
                      <>
                        {i18n.language === 'zh-TW' 
                          ? (stations.find(s => s.StationID === destStationId)?.StationName?.Zh_tw || '...')
                          : (stations.find(s => s.StationID === destStationId)?.StationName?.En || '...')
                        } 往 {i18n.language === 'zh-TW' 
                          ? (stations.find(s => s.StationID === originStationId)?.StationName?.Zh_tw || '...')
                          : (stations.find(s => s.StationID === originStationId)?.StationName?.En || '...')
                        }
                      </>
                    )} <span className="mx-2 opacity-50">•</span> {t('app.results.found', { count: filteredTimetables.length })}
                    {showFavoritesOnly && <span className="ml-2 text-red-500 bg-red-50 px-2 py-0.5 rounded-full text-[10px] uppercase font-bold">{t('app.favorites')}</span>}
                    {showWatchlistOnly && <span className="ml-2 text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full text-[10px] uppercase font-bold">{t('app.watchlist')}</span>}
                  </h2>
                {error && <div className="text-sm text-red-500">{error}</div>}
              </div>

              {/* Results List */}
              <div className="flex flex-col gap-5">
                {(() => {
                  const filtered = filteredTimetables;
                  const paged = pagedTimetables;
                  
                  if (isLoading) {
                return Array.from({ length: 3 }).map((_, i) => (
                  <div key={`skeleton-${i}`} className="bg-white rounded-[2rem] p-6 md:p-8 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] border border-slate-100/50 relative overflow-hidden">
                    {/* Shimmer Effect */}
                    <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent z-20"></div>
                    
                    <div className="flex flex-col md:flex-row justify-between gap-8 opacity-40">
                      {/* Left: Vertical Timeline Skeleton */}
                      <div className="flex items-stretch gap-8">
                        <div className="flex flex-col items-center justify-between py-2.5">
                          <div className="w-3.5 h-3.5 rounded-full bg-slate-300"></div>
                          <div className="w-[2px] h-full bg-slate-200 my-1"></div>
                          <div className="w-3.5 h-3.5 rounded-full bg-slate-300"></div>
                        </div>
                        <div className="flex flex-col justify-between py-1">
                          <div className="w-24 h-10 bg-slate-200 rounded-lg"></div>
                          <div className="w-16 h-6 bg-slate-200 rounded-md my-5"></div>
                          <div className="w-24 h-10 bg-slate-200 rounded-lg"></div>
                        </div>
                      </div>
                      {/* Right: Info Skeleton */}
                      <div className="flex flex-col items-start md:items-end justify-between gap-6 w-full md:w-auto">
                        <div className="flex flex-col items-start md:items-end gap-3 w-full">
                          <div className="w-20 h-6 bg-slate-200 rounded-full"></div>
                          <div className="flex gap-3">
                            <div className="w-16 h-6 bg-slate-200 rounded-md"></div>
                            <div className="w-24 h-6 bg-slate-200 rounded-md"></div>
                          </div>
                        </div>
                        <div className="flex gap-4 mt-2">
                          <div className="w-24 h-8 bg-slate-200 rounded-md"></div>
                          <div className="w-20 h-6 bg-slate-200 rounded-full mt-1"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                ));
              }

              if (paged.length === 0) {
                return (
                  <div className="bg-white rounded-[2rem] p-12 text-center border border-slate-100/50 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="w-16 h-16 bg-slate-50/80 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-100">
                      <Search className="w-8 h-8 text-slate-300" />
                    </div>
                    <h3 className="text-lg font-black text-slate-800 mb-2 tracking-tight">
                      {error ? (i18n.language === 'zh-TW' ? '查詢時發生錯誤' : 'Search error') : t('app.results.noResults')}
                    </h3>
                    <p className="text-slate-500 text-sm mb-6 max-w-xs mx-auto font-medium">
                      {error 
                        ? (i18n.language === 'zh-TW' ? '無法從伺服器取得資料。請檢查連線或稍後再試。' : 'Unable to retrieve data. Please check your connection or try again later.')
                        : t('app.results.noResultsDesc') || (i18n.language === 'zh-TW' ? '換個日期或地點試試看吧！' : 'Try a different date or another route.')}
                    </p>
                    {error && (
                      <div className="p-5 bg-red-50/50 text-red-600 rounded-3xl text-[10px] font-mono text-left overflow-auto max-h-40 border border-red-100/50 backdrop-blur-sm">
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
                
                return (
                  <div 
                    key={`${trainId}-${idx}`} 
                    id={`train-card-${trainId}`}
                    onClick={() => !isCancelled && handleExpandTrain(trainId)}
                    className={`group rounded-2xl md:rounded-[2.5rem] border transition-all duration-500 relative overflow-hidden ${
                      past ? 'opacity-60 grayscale-[50%]' : ''
                    } ${
                      isCancelled
                        ? 'bg-slate-50 border-slate-200 cursor-not-allowed text-slate-400'
                        : expandedTrainId === trainId
                          ? 'bg-white border-blue-600 shadow-[0_30px_70px_-20px_rgba(37,99,235,0.15)] z-20 scale-[1.02] ring-4 ring-blue-600/5'
                          : 'bg-white border-slate-100 hover:border-blue-400/50 hover:shadow-[0_20px_50px_-15px_rgba(0,0,0,0.08)] cursor-pointer'
                    }`}
                  >
                    {/* 19. Stamp Effect Badge */}
                    {isCancelled && (
                      <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none opacity-50">
                         <div className="border-[12px] border-red-500/30 px-12 py-4 rounded-[2.5rem] rotate-[-12deg] flex items-center justify-center">
                            <span className="text-7xl font-black text-red-600 uppercase tracking-[0.2em] italic mix-blend-multiply drop-shadow-sm">停駛</span>
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
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-widest whitespace-nowrap ${
                            isCancelled ? 'bg-slate-200 text-slate-400 line-through' :
                            color === 'red' ? 'bg-red-100 text-red-700' :
                            color === 'orange' ? 'bg-orange-100 text-orange-700' :
                            'bg-blue-100 text-blue-700'
                          }`}>{typeName}</span>
                          <span className={`text-sm font-bold tracking-tight ${isCancelled ? 'text-slate-300 line-through' : 'text-slate-700'}`}>
                            {trainId}{i18n.language === 'zh-TW' ? '次' : ''}
                          </span>
                          {!isCancelled && status === 'on-time' && (
                            <span className="flex items-center gap-1 text-emerald-600 bg-emerald-50/80 px-1.5 py-0.5 rounded-full text-[10px] font-bold border border-emerald-100">
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                              </span>
                              {t('app.train.onTime')}
                            </span>
                          )}
                          {!isCancelled && status === 'delayed' && (
                            <span className="flex items-center gap-1 text-red-600 bg-red-50/80 px-1.5 py-0.5 rounded-full text-[10px] font-bold border border-red-100">
                              {t('app.train.delay', { minutes: delay })}
                            </span>
                          )}
                          {isCancelled && (
                            <span className="flex items-center gap-1 text-slate-400 bg-slate-200/50 px-1.5 py-0.5 rounded-full text-[10px] font-bold border border-slate-300">
                              <XCircle className="w-3 h-3" /> CANCELLED
                            </span>
                          )}
                        </div>
                        <div className="flex items-center bg-slate-100 rounded-full p-0.5 shadow-inner shrink-0">
                          <button
                            onClick={(e) => toggleFavorite(trainId, e)}
                            disabled={isCancelled}
                            className={`p-1.5 rounded-full transition-all ${favorites.includes(trainId) ? 'text-red-500 bg-white shadow-sm' : 'text-slate-400'}`}
                          >
                            <Heart className={`w-3.5 h-3.5 ${favorites.includes(trainId) ? 'fill-current' : ''}`} />
                          </button>
                          <button
                            onClick={(e) => toggleWatchlist(trainId, e)}
                            disabled={isCancelled}
                            className={`p-1.5 rounded-full transition-all ${watchlist.includes(trainId) ? 'text-blue-500 bg-white shadow-sm' : 'text-slate-400'}`}
                          >
                            <Bell className={`w-3.5 h-3.5 ${watchlist.includes(trainId) ? 'fill-current' : ''}`} />
                          </button>
                        </div>
                      </div>

                      {/* Horizontal times + duration */}
                      <div className="flex items-center gap-2 mb-3">
                        <div className={`text-3xl font-black tracking-tighter ${isCancelled ? 'text-slate-300 line-through' : expandedTrainId === trainId ? 'text-blue-600' : 'text-slate-900'}`}>{dep}</div>
                        <div className="flex-1 flex items-center gap-1 px-1">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${isCancelled ? 'bg-slate-300' : 'bg-slate-800'}`}></div>
                          <div className={`h-[2px] flex-1 rounded-full ${isCancelled ? 'bg-slate-200' : 'bg-slate-200'}`}></div>
                          <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap flex items-center gap-1 ${
                            isCancelled ? 'bg-slate-50 border-slate-100 text-slate-300' :
                            expandedTrainId === trainId ? 'bg-blue-600 text-white border-blue-600' :
                            'text-slate-500 bg-white border-slate-100 shadow-sm'
                          }`}>
                            <Calendar className="w-3 h-3" />
                            {(() => {
                              const [h, m] = duration.split(':').map(Number);
                              return h > 0 ? t('app.train.duration', { hours: h, minutes: m }) : t('app.train.durationShort', { minutes: m });
                            })()}
                          </div>
                          <div className={`h-[2px] flex-1 rounded-full ${isCancelled ? 'bg-slate-200' : 'bg-slate-200'}`}></div>
                          <div className={`w-2 h-2 rounded-full shrink-0 ${isCancelled ? 'bg-slate-300' : 'bg-slate-800'}`}></div>
                        </div>
                        <div className={`text-3xl font-black tracking-tighter ${isCancelled ? 'text-slate-300 line-through' : 'text-slate-900'}`}>{arr}</div>
                      </div>

                      {/* Meta row: route + direction + flags */}
                      {(train.DailyTrainInfo?.StartingStationName?.Zh_tw
                        || train.DailyTrainInfo?.Direction !== undefined
                        || train.DailyTrainInfo?.WheelchairFlag === 1
                        || train.DailyTrainInfo?.BikeFlag === 1) && (
                        <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-slate-500 mb-2">
                          {train.DailyTrainInfo?.StartingStationName?.Zh_tw && train.DailyTrainInfo?.EndingStationName?.Zh_tw && (
                            <span className="text-slate-400 truncate max-w-[55%]">
                              {train.DailyTrainInfo.StartingStationName.Zh_tw}➔{train.DailyTrainInfo.EndingStationName.Zh_tw}
                            </span>
                          )}
                          {train.DailyTrainInfo?.Direction !== undefined && (
                            <span className="font-bold px-1.5 py-[1px] bg-slate-100 rounded text-slate-500 text-[10px] tracking-widest">
                              {train.DailyTrainInfo.Direction === 0 ? '南下' : '北上'}
                            </span>
                          )}
                          {transportType === 'train' && train.DailyTrainInfo?.TripLine !== undefined && train.DailyTrainInfo.TripLine !== 0 && (
                            <span className={`font-bold px-1.5 py-[1px] rounded text-[10px] tracking-widest ${
                              train.DailyTrainInfo.TripLine === 1 ? 'bg-amber-50 text-amber-700 border border-amber-100' :
                              train.DailyTrainInfo.TripLine === 2 ? 'bg-cyan-50 text-cyan-700 border border-cyan-100' :
                              'bg-purple-50 text-purple-700 border border-purple-100'
                            }`}>
                              {train.DailyTrainInfo.TripLine === 1 ? '山線' : train.DailyTrainInfo.TripLine === 2 ? '海線' : '成追'}
                            </span>
                          )}
                          {train.DailyTrainInfo?.WheelchairFlag === 1 && <span title="無障礙座位">♿️</span>}
                          {train.DailyTrainInfo?.BikeFlag === 1 && <span title="自行車車廂">🚲</span>}
                          {train.DailyTrainInfo?.BreastFeedingFlag === 1 && <span title="哺乳室">🍼</span>}
                          {train.DailyTrainInfo?.ParenthoodFlag === 1 && <span title="親子車廂">🎈</span>}
                        </div>
                      )}

                      {/* Fare row */}
                      <div className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2">
                        {transportType === 'hsr' ? (
                          <>
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-[10px] font-semibold text-slate-400 uppercase">標準</span>
                              <span className={`text-xl font-light tracking-tight ${isCancelled ? 'text-slate-300 line-through' : 'text-slate-800'}`}>
                                NT${fares['standard'] || '--'}
                              </span>
                            </div>
                            <div className="flex gap-1 text-[10px] font-semibold">
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
                          <div className={`text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter transition-colors duration-500 ${isCancelled ? 'text-slate-300 line-through' : expandedTrainId === trainId ? 'text-blue-600' : 'text-slate-900'}`}>{dep}</div>
                          <div className={`text-[11px] sm:text-xs font-bold my-2 md:my-5 w-fit px-3 py-1 md:px-4 md:py-1.5 rounded-full transition-all duration-500 border ${
                            isCancelled ? 'bg-slate-50 border-slate-100 text-slate-300' :
                            expandedTrainId === trainId ? 'bg-blue-600 text-white border-blue-600 shadow-[0_4px_12px_rgba(37,99,235,0.3)]' :
                            'text-slate-500 bg-white border-slate-100 shadow-sm'
                          }`}>
                            {(() => {
                              const [h, m] = duration.split(':').map(Number);
                              const text = h > 0 ? t('app.train.duration', { hours: h, minutes: m }) : t('app.train.durationShort', { minutes: m });
                              return <span className="flex items-center gap-1.5 md:gap-2"><Calendar className="w-3 h-3 md:w-3.5 md:h-3.5" /> {text}</span>;
                            })()}
                          </div>
                          <div className={`text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter transition-colors duration-500 ${isCancelled ? 'text-slate-300 line-through' : 'text-slate-900'}`}>{arr}</div>
                        </div>
                      </div>

                      {/* Right: Train Info */}
                      <div className="flex flex-col items-start md:items-end justify-between gap-3 md:gap-6 mt-2 md:mt-0 w-full md:w-auto md:pr-10">
                        
                        {/* Top Right: Live Status & Train Info */}
                        <div className="flex flex-col items-start md:items-end gap-3 w-full">
                          {/* Live Status and Action Buttons */}
                          <div className="flex w-full md:w-auto justify-end items-center gap-3">
                            <div className="flex items-center bg-slate-100 rounded-full p-1 shadow-inner">
                              <button 
                                onClick={(e) => toggleFavorite(trainId, e)}
                                className={`p-2 rounded-full transition-all ${favorites.includes(trainId) ? 'text-red-500 bg-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                                disabled={isCancelled}
                              >
                                <Heart className={`w-4 h-4 ${favorites.includes(trainId) ? 'fill-current' : ''}`} />
                              </button>
                              <button 
                                onClick={(e) => toggleWatchlist(trainId, e)}
                                className={`p-2 rounded-full transition-all ${watchlist.includes(trainId) ? 'text-blue-500 bg-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                                disabled={isCancelled}
                              >
                                <Bell className={`w-4 h-4 ${watchlist.includes(trainId) ? 'fill-current' : ''}`} />
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
                          </div>

                          <div className={`flex flex-col items-end gap-1 text-right`}>
                            {train.DailyTrainInfo?.StartingStationName?.Zh_tw && train.DailyTrainInfo?.EndingStationName?.Zh_tw && (
                              <div className="text-xs text-slate-400 font-medium mb-1 flex items-center justify-end gap-2 flex-wrap">
                                <span>{train.DailyTrainInfo?.StartingStationName?.Zh_tw} ➔ {train.DailyTrainInfo?.EndingStationName?.Zh_tw}</span>
                                <div className="flex gap-1">
                                  {train.DailyTrainInfo?.Direction !== undefined && (
                                    <span className="font-bold px-1.5 py-[1px] bg-slate-100 rounded text-slate-500 text-[10px] tracking-widest">
                                      {train.DailyTrainInfo.Direction === 0 ? '南下' : '北上'}
                                    </span>
                                  )}
                                  {transportType === 'train' && train.DailyTrainInfo?.TripLine !== undefined && train.DailyTrainInfo.TripLine !== 0 && (
                                    <span className={`font-bold px-1.5 py-[1px] rounded text-[10px] tracking-widest ${
                                      train.DailyTrainInfo.TripLine === 1 ? 'bg-amber-50 text-amber-700 border border-amber-100' : 
                                      train.DailyTrainInfo.TripLine === 2 ? 'bg-cyan-50 text-cyan-700 border border-cyan-100' :
                                      'bg-purple-50 text-purple-700 border border-purple-100'
                                    }`}>
                                      {train.DailyTrainInfo.TripLine === 1 ? '山線' : train.DailyTrainInfo.TripLine === 2 ? '海線' : '成追'}
                                    </span>
                                  )}
                                  {train.DailyTrainInfo?.OverNightStationID && (
                                    <span className="font-bold px-1.5 py-[1px] bg-indigo-50 text-indigo-700 border border-indigo-100 rounded text-[10px] tracking-widest">
                                      跨夜
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                            {train.DailyTrainInfo?.Note?.Zh_tw && (
                              <div className="text-[10px] text-slate-400/80 mb-1 max-w-[200px] truncate" title={train.DailyTrainInfo?.Note?.Zh_tw}>
                                {train.DailyTrainInfo?.Note?.Zh_tw}
                              </div>
                            )}
                            <div className="flex items-center gap-2 flex-wrap justify-end">
                              {train.DailyTrainInfo?.WheelchairFlag === 1 && (
                                <span className="text-slate-400 bg-slate-100 px-1.5 py-1 rounded text-xs" title="無障礙座位">♿️</span>
                              )}
                              {train.DailyTrainInfo?.BreastFeedingFlag === 1 && (
                                <span className="text-slate-400 bg-slate-100 px-1.5 py-1 rounded text-xs" title="哺(集)乳室">🍼</span>
                              )}
                              {train.DailyTrainInfo?.BikeFlag === 1 && (
                                <span className="text-slate-400 bg-slate-100 px-1.5 py-1 rounded text-xs" title="自行車車廂">🚲</span>
                              )}
                              {train.DailyTrainInfo?.ParenthoodFlag === 1 && (
                                <span className="text-slate-400 bg-slate-100 px-1.5 py-1 rounded text-xs" title="親子車廂">🎈</span>
                              )}
                              <span className={`px-2 py-1 rounded-md text-xs font-bold tracking-widest ${
                                isCancelled ? 'bg-slate-200 text-slate-400 line-through' :
                                color === 'red' ? 'bg-red-100 text-red-700' :
                                color === 'orange' ? 'bg-orange-100 text-orange-700' :
                                'bg-blue-100 text-blue-700'
                              }`}>
                                {typeName}
                              </span>
                              <span className={`text-base md:text-xl font-bold tracking-tight ${isCancelled ? 'text-slate-300 line-through' : 'text-slate-700'}`}>
                                {typeName} {trainId} {i18n.language === 'zh-TW' ? '次' : ''}
                              </span>
                            </div>
                          </div>
                        </div>
                        
                        <div className={`flex flex-col items-start md:items-end w-full md:w-auto gap-2 mt-1 md:mt-2 bg-slate-50 md:bg-transparent p-2.5 md:p-0 rounded-xl md:rounded-none`}>
                          {transportType === 'hsr' ? (
                            <div className="flex flex-col items-start md:items-end gap-1.5 w-full">
                              <div className="flex items-center gap-3 w-full justify-between md:justify-end">
                                <span className="text-xs font-semibold text-slate-400 uppercase">標準</span>
                                <span className={`text-2xl sm:text-3xl font-light tracking-tight ${isCancelled ? 'text-slate-300 line-through' : 'text-slate-800'}`}>
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
                                <span className={`text-2xl sm:text-3xl font-light tracking-tight ${isCancelled ? 'text-slate-300 line-through' : 'text-slate-800'}`}>
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
                        </div>
                      </div>

                      <div className="absolute right-6 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity hidden md:flex">
                        {!isCancelled && <ChevronDown className={`w-6 h-6 text-blue-500 transition-transform duration-300 ${expandedTrainId === trainId ? 'rotate-180' : ''}`} />}
                      </div>
                    </div>

                    {expandedTrainId === trainId && (
                      <div className="bg-slate-900 p-8 md:p-10 border-t border-slate-800 animate-in slide-in-from-top-4 fade-in duration-300">
                        <div className="flex items-center justify-between mb-8">
                          <div className="flex flex-col gap-1">
                            <h4 className="text-slate-400 text-sm font-semibold uppercase tracking-widest">{t('app.train.stops')}</h4>
                            {trainStops[trainId]?.isMock && (
                              <div className="flex items-center gap-1.5 text-[10px] text-orange-400 font-bold uppercase tracking-tight">
                                <AlertTriangle className="w-3 h-3" />
                                <span>目前顯示系統預排資訊 (Simulation Mode)</span>
                              </div>
                            )}
                          </div>
                          {isToday && !trainStops[trainId]?.isMock && (
                            <div className="flex items-center gap-2 text-[10px] font-bold text-blue-400 border border-blue-400/30 px-2 py-1 rounded-md uppercase tracking-tighter">
                              <span className="flex h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse"></span>
                              Live Position
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-0.5 mt-4">
                          {stopsLoading[trainId] ? (
                            <div className="py-20 flex flex-col items-center justify-center gap-6 text-slate-500">
                               <div className="w-10 h-10 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
                               <div className="flex flex-col items-center gap-1">
                                 <span className="text-sm font-black text-slate-300 uppercase tracking-widest">Initialising Schedule</span>
                                 <span className="text-[10px] text-slate-500 font-medium">Fetching real-time platform data...</span>
                               </div>
                            </div>
                          ) : trainStops[trainId] === undefined ? (
                            <div className="flex flex-col gap-1 py-4">
                              {[1, 2, 3, 4].map((i) => (
                                <div key={i} className="flex items-center gap-8 py-6 border-b border-slate-800/30 opacity-20">
                                  <div className="w-12 h-12 rounded-2xl bg-slate-800 animate-pulse"></div>
                                  <div className="flex flex-col gap-3 w-full">
                                    <div className="h-6 w-32 bg-slate-800 rounded-md animate-pulse"></div>
                                    <div className="h-4 w-20 bg-slate-800/50 rounded-md animate-pulse"></div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : trainStops[trainId]?.stops?.length > 0 ? (
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
                                  <div key={`stop-editorial-${stop.StationID || idx}`} className={`flex items-stretch gap-8 relative group/stop transition-all duration-500 ${isPassed ? 'opacity-30' : 'opacity-100'}`}>
                                    {/* Timeline Column */}
                                    <div className="flex flex-col items-center w-8 shrink-0 relative">
                                      <div className={`w-[2px] h-full absolute top-0 bottom-0 ${
                                        isPassed ? 'bg-slate-800' :
                                        isSpecifiedRoute ? 'bg-blue-500/30' : 'bg-slate-800/50'
                                      }`}>
                                        {isBetweenLeg && (
                                          <div className="absolute top-0 bottom-0 left-0 right-0 bg-gradient-to-b from-blue-500 to-transparent animate-shimmer-y"></div>
                                        )}
                                      </div>
                                      
                                      <div className={`w-3 h-3 rounded-full mt-7 z-10 border-2 border-slate-900 transition-all duration-500 ${
                                        isAtStop ? 'bg-blue-400 ring-4 ring-blue-400/20 scale-125' :
                                        isOrigin || isDest ? 'bg-amber-400' :
                                        isSpecifiedRoute ? 'bg-blue-500/50' : 'bg-slate-700'
                                      }`}></div>
                                    </div>

                                    {/* Content Column */}
                                    <div className={`flex flex-1 items-center justify-between py-6 border-b border-slate-800/50 ${isAtStop ? 'bg-blue-400/5 -mx-4 px-4 rounded-2xl border-none' : ''}`}>
                                      <div className="flex flex-col gap-1">
                                        <div className="flex items-center gap-3">
                                          <span className={`text-2xl font-black tracking-tight ${
                                            isAtStop ? 'text-blue-300' : (isOrigin || isDest) ? 'text-amber-400' : 'text-slate-200'
                                          }`}>
                                            {i18n.language === 'zh-TW' ? (stop?.StationName?.Zh_tw || '車站') : (stop?.StationName?.En || 'Station')}
                                          </span>
                                          {isAtStop && (
                                            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 text-[10px] font-black uppercase tracking-widest animate-pulse border border-blue-500/20">
                                              Current
                                            </span>
                                          )}
                                          {(isOrigin || isDest) && (
                                            <span className="px-2 py-0.5 rounded bg-amber-400/10 text-amber-400 text-[10px] font-black uppercase tracking-widest border border-amber-400/10">
                                              {isOrigin ? 'Origin' : 'Dest'}
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
                                                className={`px-2 py-0.5 rounded text-[10px] font-black tracking-widest border ${TRANSFER_COLOR[tr.color]} shadow-sm`}
                                              >
                                                🚇 {tr.label}
                                              </span>
                                            ));
                                          })()}
                                        </div>
                                        <div className="flex items-center gap-3 text-[10px] font-bold text-slate-500 uppercase tracking-tighter">
                                          <span>Sequence {stop.StopSequence}</span>
                                          <span className="opacity-30">|</span>
                                          <span className="text-slate-600">ID: {stop.StationID}</span>
                                          {(() => {
                                            const stationName = transportType === 'hsr'
                                              ? `高鐵${stop?.StationName?.Zh_tw || ''}`.replace('高鐵高鐵', '高鐵')
                                              : (stop?.StationName?.Zh_tw || '');
                                            const transfers = getTransfers(stationName).length
                                              ? getTransfers(stationName)
                                              : getTransfers(stop?.StationName?.Zh_tw || '');
                                            if (!transfers.length) return null;
                                            return (
                                              <span className="text-slate-400 normal-case tracking-normal truncate max-w-[260px]">
                                                {transfers.map(tr => tr.detail).join(' · ')}
                                              </span>
                                            );
                                          })()}
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-8">
                                        <div className="flex flex-col items-end">
                                          <div className={`text-2xl font-black font-mono transition-colors ${isAtStop ? 'text-blue-200' : 'text-slate-400'}`}>
                                            {stop.DepartureTime.substring(0, 5)}
                                          </div>
                                          <div className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Departure</div>
                                        </div>
                                        {(stop.ArrivalTime && stop.ArrivalTime !== stop.DepartureTime) && (
                                          <div className="hidden sm:flex flex-col items-end opacity-40">
                                            <div className="text-sm font-black font-mono text-slate-400">
                                              {stop.ArrivalTime.substring(0, 5)}
                                            </div>
                                            <div className="text-[9px] font-bold text-slate-600 uppercase tracking-widest text-right">Arrival</div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              });
                            })()
                          ) : (
                            <div className="py-20 text-center bg-slate-800/30 rounded-[2.5rem] border border-dashed border-slate-800">
                               <p className="text-slate-500 font-bold tracking-widest uppercase text-xs">No Sequence Data Available</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
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
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[90] w-full max-w-lg px-6 animate-in slide-in-from-bottom-20 fade-in duration-700 delay-500">
          <div 
            onClick={() => scrollToTrain(approachingInfo.trainNo)}
            className="bg-slate-900/95 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] p-6 shadow-[0_35px_80px_-15px_rgba(0,0,0,0.5)] flex items-center gap-6 overflow-hidden relative group cursor-pointer"
          >
            {/* Animated Glow Backlight */}
            <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/30 to-emerald-500/30 rounded-[2.5rem] blur-2xl opacity-40 group-hover:opacity-100 transition-opacity duration-1000"></div>

            <div className="relative shrink-0 w-16 h-16 bg-blue-600 rounded-3xl flex items-center justify-center shadow-lg shadow-blue-500/40 animate-float">
              <Train className="w-8 h-8 text-white" />
            </div>
            
            <div className="relative flex-1">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <p className="text-emerald-400 text-[10px] font-black uppercase tracking-[0.2em]">
                  {i18n.language === 'zh-TW' ? `${approachingInfo.trainNo} 次車 • 即時進站` : `Train ${approachingInfo.trainNo} • Live Arrival`}
                </p>
              </div>
              <h3 className="text-white text-xl font-bold tracking-tight">
                {i18n.language === 'zh-TW' ? '即將抵達：' : 'Approaching: '}
                <span className="text-blue-400">{approachingInfo.station}</span>
              </h3>
              <p className="text-slate-400 text-sm font-medium mt-1">
                {i18n.language === 'zh-TW' ? '還有 ' : 'In '}
                <span className="text-white font-bold">{approachingInfo.minutes}</span> 
                {i18n.language === 'zh-TW' ? ' 分鐘 • 預計停靠第 ' : ' mins • Platform '}
                <span className="text-white font-bold">{approachingInfo.platform}</span> 
                {i18n.language === 'zh-TW' ? ' 月台' : ''}
              </p>
            </div>

            <button 
              onClick={(e) => {
                e.stopPropagation();
                setApproachingInfo(null);
              }}
              className="relative shrink-0 p-3 bg-white/5 hover:bg-white/10 rounded-full text-slate-400 transition-colors"
            >
              <AlertCircle className="rotate-45 w-5 h-5" />
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
    </div>
  );
}