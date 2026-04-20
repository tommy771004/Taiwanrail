/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Heart, Bell, Globe, ArrowRightLeft, Calendar, User, Search, CheckCircle, AlertCircle, XCircle, ChevronDown, AlertTriangle, Train, Sun, CloudRain, Pencil, MapPin } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { getTRATimetableOD, getTHSRTimetableOD, DailyTimetableOD, getTRAStations, getTHSRStations, Station, getTRAODFare, getTHSRODFare, getTRATrainTimetable, getTHSRTrainTimetable, getTRALiveBoard, StopTime, getTRAAlerts, getTHSRAlerts, getTHSRLiveBoard, RailLiveBoard } from './lib/api';
import { logQuery } from './lib/logger';

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
  const [isOriginDropdownOpen, setIsOriginDropdownOpen] = useState(false);
  const [isDestDropdownOpen, setIsDestDropdownOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const [fares, setFares] = useState<Record<string, number>>({});
  const [liveBoard, setLiveBoard] = useState<Record<string, number>>({});
  const [trainStops, setTrainStops] = useState<Record<string, StopTime[]>>({});
  const [returnTimetables, setReturnTimetables] = useState<DailyTimetableOD[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // New states for disruption alerts and approaching station
  const [globalAlert, setGlobalAlert] = useState<{message: string, type: 'warning' | 'error'} | null>(null);
  const [cancelledTrains, setCancelledTrains] = useState<Set<string>>(new Set());
  const [approachingInfo, setApproachingInfo] = useState<{station: string, minutes: number, platform: string, trainNo: string} | null>(null);

  // Collapsible search panel – defaults to expanded. Collapses after a successful search.
  const [isSearchCollapsed, setIsSearchCollapsed] = useState(false);

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
          } else {
             setApproachingInfo(null);
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
        const allAlerts = [...(Array.isArray(traAlerts) ? traAlerts : []), ...(Array.isArray(thsrAlerts) ? thsrAlerts : [])];
        
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
    const filtered = getFilteredTimetables();
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
    });

    return () => {
      socket.off('connect');
      socket.off('delay-update');
    };
  }, []);

  useEffect(() => {
    if (!socket || !socket.connected) return;
    socket.emit('subscribe-station', { stationId: originStationId, type: transportType });
    socket.emit('subscribe-station', { stationId: destStationId, type: transportType });
  }, [transportType, originStationId, destStationId]);

  useEffect(() => {
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
    return d.toISOString().split('T')[0];
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
    const _logStart = Date.now();
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
        const timeA = a.OriginStopTime?.DepartureTime || '23:59';
        const timeB = b.OriginStopTime?.DepartureTime || '23:59';
        return timeA.localeCompare(timeB);
      };

      data.sort(sortFn);
      returnData.sort(sortFn);
      
      setTimetables(data);
      setReturnTimetables(returnData);

      // 使用者查詢 log（fire-and-forget，不影響 UX）
      const originStation = stations.find(s => s.StationID === originStationId);
      const destStation   = stations.find(s => s.StationID === destStationId);
      const returnDateStr = tripType === 'round-trip'
        ? (dates.find(d => d.id === returnDate) || dates[1])?.value
        : undefined;
      logQuery({
        transport_type: transportType,
        origin_id:      originStationId,
        dest_id:        destStationId,
        origin_name:    originStation?.StationName?.Zh_tw,
        dest_name:      destStation?.StationName?.Zh_tw,
        trip_type:      tripType,
        travel_date:    dateStr,
        return_date:    returnDateStr,
        language:       i18n.language,
        active_filter:  activeFilter,
        result_count:   data.length,
        latency_ms:     Date.now() - _logStart,
      });
    } catch (err: any) {
      console.error(err);
      setError(err.message || '發生錯誤');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStations = async () => {
    try {
      let data: Station[] = [];
      if (transportType === 'hsr') {
        data = await getTHSRStations();
        // Match by name so it works for both mock IDs (090) and real IDs (0990)
        const origin = data.find(s => ['南港', '台北', '臺北'].includes(s?.StationName?.Zh_tw))?.StationID ?? data[0]?.StationID;
        const dest   = data.find(s => ['左營', '高雄', '台南'].includes(s?.StationName?.Zh_tw) && s.StationID !== origin)?.StationID ?? data[data.length - 1]?.StationID;
        if (origin) setOriginStationId(origin);
        if (dest)   setDestStationId(dest);
      } else {
        data = await getTRAStations();
        const origin = data.find(s => ['臺北', '台北'].includes(s?.StationName?.Zh_tw))?.StationID ?? data[0]?.StationID;
        const dest   = data.find(s => s?.StationName?.Zh_tw === '高雄')?.StationID ?? data[data.length - 1]?.StationID;
        if (origin) setOriginStationId(origin);
        if (dest)   setDestStationId(dest);
      }
      setStations(data);
    } catch (err) {
      console.error('Failed to fetch stations', err);
    }
  };

  const fetchExtraData = async () => {
    if (!originStationId || !destStationId) return;
    try {
      if (transportType === 'hsr') {
        const fareData = await getTHSRODFare(originStationId, destStationId);
        const fareArr = Array.isArray(fareData) ? fareData : [];
        const f0 = fareArr[0]?.Fares?.[0] as any;
        const standardFare = fareArr[0]?.Fares?.find((f: any) => f.TicketType === '標準座')?.Price || f0?.Price || f0?.Fare;
        if (standardFare) setFares({ 'all': standardFare });

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
            const price = f.Fares?.[0]?.Price ?? f.Fares?.[0]?.Fare;
            if (price !== undefined) fareMap[f.TrainType.toString()] = price;
          }
        });
        setFares(fareMap);

        const boardData = await getTRALiveBoard(originStationId);
        const delayMap: Record<string, number> = {};
        (Array.isArray(boardData) ? boardData : []).forEach(b => {
          if (b?.TrainNo !== undefined) delayMap[b.TrainNo] = b.DelayTime || 0;
        });
        setLiveBoard(delayMap);
      }
    } catch (e) {
      console.error('Failed to fetch extra data', e);
    }
  };

  useEffect(() => {
    // Clear everything from the previous transport type BEFORE loading new stations.
    // Without this, the timetable useEffect fires immediately with the old station IDs
    // (which belong to the previous type) and the new transportType, causing a
    // cross-type fetch (e.g. getTHSRTimetableOD with TRA station IDs).
    setOriginStationId('');
    setDestStationId('');
    setStations([]);
    setTimetables([]);
    setReturnTimetables([]);
    setExpandedTrainId(null);
    setTrainStops({});
    fetchStations();
    setCurrentPage(1);
  }, [transportType]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeFilter, selectedDate, originStationId, destStationId]);

  useEffect(() => {
    // Prevent firing while station list is still being fetched for a different transport type.
    // We check that both origin and destination exist in the current stations array.
    const isValid =
      stations.length > 0 &&
      stations.some(s => s.StationID === originStationId) &&
      stations.some(s => s.StationID === destStationId);

    if (isValid) {
      fetchTimetable();
      fetchExtraData();
    }
  }, [transportType, selectedDate, returnDate, tripType, originStationId, destStationId, stations]);

  const handleExpandTrain = async (trainId: string) => {
    if (expandedTrainId === trainId) {
      setExpandedTrainId(null);
      return;
    }
    setExpandedTrainId(trainId);
    if (!trainStops[trainId]) {
      try {
        const dateObj = dates.find(d => d.id === selectedDate) || dates[0];
        const dateStr = dateObj.value;
        let data;
        if (transportType === 'hsr') {
          data = await getTHSRTrainTimetable(trainId, dateStr);
        } else {
          data = await getTRATrainTimetable(trainId, dateStr);
        }
        if (data && data.length > 0) {
          setTrainStops(prev => ({ ...prev, [trainId]: data[0].StopTimes }));
        }
      } catch (e) {
        console.error("Failed to fetch stops", e);
      }
    }
  };

  const getPrice = (train: DailyTimetableOD) => {
    if (transportType === 'hsr') return fares['all'] ? `NT$ ${fares['all']}` : '--';
    
    const typeId = train.DailyTrainInfo.TrainTypeID;
    let mappedType = '6'; // default local
    if (['1100', '1101', '1102', '1103', '1104', '1105', '1106', '1107', '1108'].includes(typeId)) mappedType = '3'; // Tze-Chiang
    else if (['1110', '1111', '1114', '1115'].includes(typeId)) mappedType = '4'; // Chu-Kuang
    else if (['1120'].includes(typeId)) mappedType = '5'; // Fuxing
    else if (['1131', '1132', '1133'].includes(typeId)) mappedType = '6'; // Local
    
    return fares[mappedType] ? `NT$ ${fares[mappedType]}` : '--';
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

  const getFilteredTimetables = () => {
    let base = activeTab === 'outbound' ? timetables : returnTimetables;
    let filtered = [...base];
    
    if (showFavoritesOnly) {
      filtered = filtered.filter(t => favorites.includes(t.DailyTrainInfo.TrainNo));
    }
    if (showWatchlistOnly) {
      filtered = filtered.filter(t => watchlist.includes(t.DailyTrainInfo.TrainNo));
    }

    if (activeFilter === 'time') {
      filtered.sort((a, b) => {
        const timeA = a.OriginStopTime?.DepartureTime || '23:59';
        const timeB = b.OriginStopTime?.DepartureTime || '23:59';
        return timeA.localeCompare(timeB);
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
        // High Speed Rail is always accessible. For TRA, assume newer trains like EMU3000 (part of Tze-Chiang)
        return transportType === 'hsr' || name.includes('3000') || name.includes('普悠瑪') || name.includes('太魯閣');
      });
    }
    
    return filtered;
  };

  const getPagedTimetables = () => {
    const filtered = getFilteredTimetables();
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  };

  const isPastTrain = (time: string | undefined) => {
    if (!time || selectedDate !== 'today') return false;
    
    // Get current time in Taiwan (UTC+8)
    const now = new Date();
    const twTime = new Intl.DateTimeFormat('zh-TW', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Taipei'
    }).format(now);
    
    return time < twTime;
  };

  const getTrainColor = (type: string) => {
    if (type.includes('普悠瑪') || type.includes('太魯閣') || type.includes('高鐵')) return 'red';
    if (type.includes('自強') || type.includes('莒光')) return 'orange';
    return 'blue';
  };

  // Get current TW time for real-time position

  const nowMinutes = getTwMinutes();
  const isToday = selectedDate === 'today';

  return (
    <div className={`min-h-screen font-sans text-slate-900 dark:text-slate-100 selection:bg-slate-200 dark:selection:bg-slate-700 soft-scrollbar transition-colors duration-700 ${
      transportType === 'hsr' ? 'bg-orange-50/50 dark:bg-[#1a1205]' : 'bg-blue-50/50 dark:bg-[#050f1a]'
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
                onClick={() => setTransportType('hsr')}
                className={`px-5 sm:px-8 py-2.5 sm:py-3 rounded-full text-sm font-bold transition-all duration-300 ${
                  transportType === 'hsr'
                    ? 'bg-white text-orange-600 shadow-[0_4px_15px_rgba(234,88,12,0.1)] scale-105'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {t('app.hsr')}
              </button>
              <button
                onClick={() => setTransportType('train')}
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
          <div className="relative flex flex-col md:flex-row items-center justify-between mt-4 sm:mt-6 mb-6 sm:mb-10 gap-4 sm:gap-8 md:gap-0">
            {/* Origin */}
            <div className="flex-1 min-w-0 text-center relative w-full">
              <div className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-3">{t('app.origin')}</div>
              <button 
                onClick={() => { setIsOriginDropdownOpen(!isOriginDropdownOpen); setIsDestDropdownOpen(false); }}
                className="text-3xl sm:text-5xl md:text-7xl font-black text-slate-800 tracking-tighter hover:opacity-80 transition-opacity truncate w-full px-2 leading-tight"
              >
                {i18n.language === 'zh-TW' 
                  ? (stations.find(s => s.StationID === originStationId)?.StationName?.Zh_tw || '...')
                  : (stations.find(s => s.StationID === originStationId)?.StationName?.En || '...')
                }
              </button>
              <div className="text-slate-400 font-medium mt-2 text-sm sm:text-base md:text-lg">
                {i18n.language === 'zh-TW' 
                  ? (stations.find(s => s.StationID === originStationId)?.StationName?.En || '...')
                  : (stations.find(s => s.StationID === originStationId)?.StationName?.Zh_tw || '...')
                }
              </div>
              
              {/* Dropdown */}
              {isOriginDropdownOpen && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-4 w-64 max-h-80 overflow-y-auto bg-white rounded-2xl shadow-2xl border border-slate-100 z-50 p-2">
                  <div className="sticky top-0 bg-white p-2 border-b border-slate-50 mb-2">
                    <input 
                      type="text" 
                      placeholder={t('app.station.searchPlaceholder')}
                      className="w-full px-3 py-2 bg-slate-50 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                  {stations.map(s => (
                    <button
                      key={s.StationID}
                      onClick={() => { setOriginStationId(s.StationID); setIsOriginDropdownOpen(false); }}
                      className={`w-full text-left px-4 py-3 rounded-xl transition-colors ${s.StationID === originStationId ? 'bg-blue-50 text-blue-700 font-bold' : 'hover:bg-slate-50 text-slate-700'}`}
                    >
                      {i18n.language === 'zh-TW' ? s.StationName.Zh_tw : s.StationName.En}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Swap Button */}
            <div className="relative md:absolute md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 z-10 py-4 md:py-0">
              <button 
                onClick={() => {
                  const temp = originStationId;
                  setOriginStationId(destStationId);
                  setDestStationId(temp);
                }}
                className="w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 bg-white rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.12)] flex items-center justify-center hover:scale-105 hover:shadow-[0_12px_40px_rgba(0,0,0,0.15)] transition-all text-slate-700"
              >
                <ArrowRightLeft className="w-6 h-6 md:w-7 md:h-7 stroke-[2] rotate-90 md:rotate-0" />
              </button>
            </div>

            {/* Destination */}
            <div className="flex-1 min-w-0 text-center relative w-full">
              <div className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-3">{t('app.destination')}</div>
              <button 
                onClick={() => { setIsDestDropdownOpen(!isDestDropdownOpen); setIsOriginDropdownOpen(false); }}
                className="text-3xl sm:text-5xl md:text-7xl font-black text-slate-800 tracking-tighter hover:opacity-80 transition-opacity truncate w-full px-2 leading-tight"
              >
                {i18n.language === 'zh-TW' 
                  ? (stations.find(s => s.StationID === destStationId)?.StationName?.Zh_tw || '...')
                  : (stations.find(s => s.StationID === destStationId)?.StationName?.En || '...')
                }
              </button>
              <div className="text-slate-400 font-medium mt-2 text-sm sm:text-base md:text-lg">
                {i18n.language === 'zh-TW' 
                  ? (stations.find(s => s.StationID === destStationId)?.StationName?.En || '...')
                  : (stations.find(s => s.StationID === destStationId)?.StationName?.Zh_tw || '...')
                }
              </div>
              
              {/* Dropdown */}
              {isDestDropdownOpen && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-4 w-64 max-h-80 overflow-y-auto bg-white rounded-2xl shadow-2xl border border-slate-100 z-50 p-2">
                  <div className="sticky top-0 bg-white p-2 border-b border-slate-50 mb-2">
                    <input 
                      type="text" 
                      placeholder={t('app.station.searchPlaceholder')}
                      className="w-full px-3 py-2 bg-slate-50 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                  {stations.map(s => (
                    <button
                      key={s.StationID}
                      onClick={() => { setDestStationId(s.StationID); setIsDestDropdownOpen(false); }}
                      className={`w-full text-left px-4 py-3 rounded-xl transition-colors ${s.StationID === destStationId ? 'bg-blue-50 text-blue-700 font-bold' : 'hover:bg-slate-50 text-slate-700'}`}
                    >
                      {i18n.language === 'zh-TW' ? s.StationName.Zh_tw : s.StationName.En}
                    </button>
                  ))}
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
              fetchTimetable();
              setCurrentPage(1);
              setIsSearchCollapsed(true);
              setTimeout(() => {
                document.getElementById('results-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }, 350);
            }}
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
      <section id="results-section" className="max-w-5xl mx-auto px-4 md:px-8 pb-32 -mt-8 relative z-20">

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
        <div className="bg-[#F8F9FA] rounded-3xl">
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
                )} <span className="mx-2 opacity-50">•</span> {t('app.results.found', { count: getFilteredTimetables().length })}
                {showFavoritesOnly && <span className="ml-2 text-red-500 bg-red-50 px-2 py-0.5 rounded-full text-[10px] uppercase font-bold">{t('app.favorites')}</span>}
                {showWatchlistOnly && <span className="ml-2 text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full text-[10px] uppercase font-bold">{t('app.watchlist')}</span>}
              </h2>
            {error && <div className="text-sm text-red-500">{error}</div>}
          </div>

          {/* Results List */}
          <div className="flex flex-col gap-5">
            {(() => {
              const filtered = getFilteredTimetables();
              const paged = getPagedTimetables();
              
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
                  <div className="bg-white rounded-[2rem] p-12 text-center border border-slate-100">
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Search className="w-8 h-8 text-slate-300" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 mb-2">{t('app.results.noResults')}</h3>
                    <p className="text-slate-500 text-sm">{t('app.results.noResultsDesc')}</p>
                    {error && <div className="mt-4 p-3 bg-red-50 text-red-600 rounded-xl text-xs font-mono">{error}</div>}
                  </div>
                );
              }

              return paged.map((train, idx) => {
                const trainId = train.DailyTrainInfo?.TrainNo || 'Unknown';
                const dep = train.OriginStopTime?.DepartureTime?.substring(0, 5) || '--:--';
                const arr = train.DestinationStopTime?.ArrivalTime?.substring(0, 5) || '--:--';
                const past = isPastTrain(dep);
                const duration = calculateDuration(dep, arr);
                const typeName = train.DailyTrainInfo?.TrainTypeName?.Zh_tw || '火車';
                const color = getTrainColor(typeName);
                
                const delay = liveBoard[trainId];
                const status = delay === undefined ? 'unknown' : delay === 0 ? 'on-time' : 'delayed';
                const price = getPrice(train);

                // 19. Cancelled Train Logic (Using real alert data)
                const isCancelled = cancelledTrains.has(trainId);
                
                return (
                  <div 
                    key={trainId} 
                    id={`train-card-${trainId}`}
                    onClick={() => !isCancelled && handleExpandTrain(trainId)}
                    className={`group rounded-[2rem] train-card-hover shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] transition-all border overflow-hidden relative ${
                      past ? 'opacity-50 grayscale' : ''
                    } ${
                      isCancelled
                        ? 'bg-slate-50 border-slate-200 cursor-not-allowed text-slate-400'
                        : expandedTrainId === trainId 
                          ? 'bg-white border-blue-200 cursor-pointer' 
                          : 'bg-white border-slate-100/50 hover:border-blue-200 hover:shadow-[0_12px_40px_-12px_rgba(0,0,0,0.15)] cursor-pointer'
                    }`}
                  >
                    {/* 19. Stamp Effect Badge */}
                    {isCancelled && (
                      <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none opacity-40">
                         <div className="border-[12px] border-red-500/30 px-12 py-4 rounded-[2rem] rotate-[-12deg] flex items-center justify-center">
                            <span className="text-7xl font-black text-red-600 uppercase tracking-[0.2em] italic mix-blend-multiply drop-shadow-sm">停駛</span>
                         </div>
                      </div>
                    )}

                    {/* Main Card Content */}
                    <div className="p-4 sm:p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-8 relative">
                      
                      {/* Left: Vertical Timeline */}
                      <div className="flex items-stretch gap-8">
                        {/* Timeline Graphic */}
                        <div className="flex flex-col items-center justify-between py-2.5">
                          <div className={`w-3.5 h-3.5 rounded-full border-[3px] z-10 bg-white ${isCancelled ? 'border-slate-300' : 'border-slate-800'}`}></div>
                          <div className={`w-[2px] h-full my-1 rounded-full ${isCancelled ? 'bg-slate-200' : 'bg-slate-200'}`}></div>
                          <div className={`w-3.5 h-3.5 rounded-full z-10 ${isCancelled ? 'bg-slate-300' : 'bg-slate-800'}`}></div>
                        </div>
                        
                        {/* Times & Duration */}
                        <div className="flex flex-col justify-between py-1">
                          <div className={`text-3xl sm:text-4xl font-bold tracking-tighter ${isCancelled ? 'text-slate-300 line-through' : 'text-slate-800'}`}>{dep}</div>
                          <div className={`text-sm font-semibold my-5 w-fit px-3 py-1 rounded-lg ${isCancelled ? 'bg-slate-100 text-slate-300' : 'text-slate-400 bg-slate-50'}`}>
                            {(() => {
                              const [h, m] = duration.split(':').map(Number);
                              return h > 0 ? t('app.train.duration', { hours: h, minutes: m }) : t('app.train.durationShort', { minutes: m });
                            })()}
                          </div>
                          <div className={`text-3xl sm:text-4xl font-bold tracking-tighter ${isCancelled ? 'text-slate-300 line-through' : 'text-slate-800'}`}>{arr}</div>
                        </div>
                      </div>

                      {/* Right: Train Info */}
                      <div className="flex flex-col items-start md:items-end justify-between gap-6 mt-6 md:mt-0 w-full md:w-auto md:pr-10">
                        
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

                          <div className={`flex items-center gap-3 text-right`}>
                            <span className={`px-3 py-1.5 rounded-lg text-xs font-bold tracking-widest ${
                              isCancelled ? 'bg-slate-200 text-slate-400 line-through' :
                              color === 'red' ? 'bg-red-100 text-red-700' :
                              color === 'orange' ? 'bg-orange-100 text-orange-700' :
                              'bg-blue-100 text-blue-700'
                            }`}>
                              {typeName}
                            </span>
                            <span className={`text-xl font-bold tracking-tight ${isCancelled ? 'text-slate-300 line-through' : 'text-slate-700'}`}>
                              {typeName} {trainId} {i18n.language === 'zh-TW' ? '次' : ''}
                            </span>
                          </div>
                        </div>
                        
                        <div className={`flex items-center justify-between md:justify-end w-full md:w-auto gap-5 mt-2 bg-slate-50 md:bg-transparent p-4 md:p-0 rounded-2xl md:rounded-none`}>
                          <span className={`text-2xl sm:text-3xl font-light tracking-tight ${isCancelled ? 'text-slate-300 line-through' : 'text-slate-800'}`}>
                            {price.includes('NT$') 
                              ? price.replace('NT$', t('app.train.fare', { price: '' }).replace('NT$', '')) 
                              : price}
                          </span>
                        </div>
                      </div>

                      <div className="absolute right-6 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity hidden md:flex">
                        {!isCancelled && <ChevronDown className={`w-6 h-6 text-blue-500 transition-transform duration-300 ${expandedTrainId === trainId ? 'rotate-180' : ''}`} />}
                      </div>
                    </div>

                    {expandedTrainId === trainId && (
                      <div className="bg-slate-900 p-8 md:p-10 border-t border-slate-800 animate-in slide-in-from-top-4 fade-in duration-300">
                        <div className="flex items-center justify-between mb-8">
                          <h4 className="text-slate-400 text-sm font-semibold uppercase tracking-widest">{t('app.train.stops')}</h4>
                          {isToday && (
                            <div className="flex items-center gap-2 text-[10px] font-bold text-blue-400 border border-blue-400/30 px-2 py-1 rounded-md uppercase tracking-tighter">
                              <span className="flex h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse"></span>
                              Live Position
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col">
                          {trainStops[trainId] ? (
                            trainStops[trainId].map((stop, idx) => {
                              const stops = trainStops[trainId];
                              const originIdx = stops.findIndex(s => s.StationID === originStationId);
                              const destIdx = stops.findIndex(s => s.StationID === destStationId);
                              
                              const stopDep = timeToMinutes(stop.DepartureTime) + (delay || 0);
                              const stopArr = timeToMinutes(stop.ArrivalTime || stop.DepartureTime) + (delay || 0);

                              const isAtStop = isToday && nowMinutes >= stopArr && nowMinutes <= stopDep;
                              const isPassed = isToday && nowMinutes > stopDep;
                              
                              // Check if between this and next
                              let isBetweenLeg = false;
                              if (isToday && idx < stops.length - 1) {
                                const nextStop = stops[idx + 1];
                                const nextArr = timeToMinutes(nextStop.ArrivalTime || nextStop.DepartureTime) + (delay || 0);
                                if (nowMinutes > stopDep && nowMinutes < nextArr) {
                                  isBetweenLeg = true;
                                }
                              }

                              if (originIdx === -1 || destIdx === -1) {
                                return (
                                  <div key={idx} className="flex items-center gap-6 relative group/stop">
                                    {(idx !== stops.length - 1) && (
                                      <div className={`absolute left-[11px] top-6 bottom-[-24px] w-[2px] ${isBetweenLeg ? 'bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.5)]' : 'bg-slate-700'}`}></div>
                                    )}
                                    <div className={`w-6 h-6 rounded-full border-4 border-slate-900 flex items-center justify-center z-10 transition-colors ${isAtStop ? 'bg-blue-400 shadow-[0_0_15px_rgba(96,165,250,0.6)] animate-pulse' : 'bg-slate-700'}`}>
                                      {isAtStop && <div className="w-1.5 h-1.5 bg-white rounded-full"></div>}
                                    </div>
                                    <div className={`flex items-center gap-5 py-4 transition-opacity w-full ${isAtStop ? 'opacity-100 scale-105 origin-left duration-300' : isPassed ? 'opacity-40 grayscale' : 'opacity-100'}`}>
                                      <span className={`text-xl font-bold tracking-tight ${isAtStop ? 'text-blue-300' : 'text-white'}`}>
                                        {i18n.language === 'zh-TW' ? (stop?.StationName?.Zh_tw || '火車站') : (stop?.StationName?.En || 'Station')}
                                      </span>
                                      <div className="flex flex-col">
                                        <span className="text-slate-400 font-mono text-lg">{stop.DepartureTime.substring(0, 5)}</span>
                                        {isAtStop && <span className="text-[10px] text-blue-400 font-bold uppercase tracking-wider">Arrived</span>}
                                      </div>
                                    </div>
                                    {isBetweenLeg && (
                                      <div className="absolute left-[8px] top-[48px] z-20">
                                        <div className="w-2 h-4 bg-blue-400 rounded-full animate-bounce shadow-[0_0_8px_rgba(96,165,250,0.8)]"></div>
                                      </div>
                                    )}
                                  </div>
                                );
                              }

                              const isOrigin = stop.StationID === originStationId;
                              const isDest = stop.StationID === destStationId;
                              const isSpecifiedRoute = (originIdx <= idx && destIdx >= idx) || (originIdx >= idx && destIdx <= idx);
                              
                              if (!isSpecifiedRoute && !isOrigin && !isDest) return null;

                              return (
                                <div key={idx} className="flex items-center gap-6 relative group/stop">
                                  {idx !== stops.length - 1 && (
                                    <div className={`absolute left-[11px] top-6 bottom-[-24px] w-[2px] ${isBetweenLeg ? 'bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.5)]' : isSpecifiedRoute ? 'bg-blue-500/50' : 'bg-slate-700'}`}></div>
                                  )}
                                  <div className={`w-6 h-6 rounded-full border-4 border-slate-900 flex items-center justify-center z-10 transition-colors ${
                                    isAtStop ? 'bg-blue-400 shadow-[0_0_20px_rgba(96,165,250,0.8)] animate-pulse' :
                                    isOrigin || isDest ? 'bg-blue-400 shadow-[0_0_15px_rgba(96,165,250,0.4)]' : 
                                    isSpecifiedRoute ? 'bg-blue-500/50' : 'bg-slate-700'
                                  }`}>
                                    {isAtStop && <div className="w-1.5 h-1.5 bg-white rounded-full"></div>}
                                  </div>
                                  <div className={`flex items-center gap-5 py-4 transition-opacity w-full ${isSpecifiedRoute || isAtStop ? 'opacity-100' : 'opacity-40'} ${isAtStop ? 'scale-105 origin-left duration-300' : ''} ${isPassed ? 'opacity-40 grayscale' : ''}`}>
                                    <span className={`text-xl font-bold tracking-tight ${(isOrigin || isDest || isAtStop) ? 'text-blue-300' : 'text-white'}`}>
                                      {i18n.language === 'zh-TW' ? (stop?.StationName?.Zh_tw || '火車站') : (stop?.StationName?.En || 'Station')}
                                    </span>
                                    <div className="flex flex-col">
                                      <span className="text-slate-400 font-mono text-lg">{stop.DepartureTime.substring(0, 5)}</span>
                                      {isAtStop && <span className="text-[10px] text-blue-400 font-bold uppercase tracking-wider">Arrived</span>}
                                    </div>
                                  </div>
                                  {isBetweenLeg && (
                                      <div className="absolute left-[8px] top-[48px] z-20">
                                        <div className="w-2 h-4 bg-blue-400 rounded-full animate-bounce shadow-[0_0_8px_rgba(96,165,250,0.8)]"></div>
                                      </div>
                                    )}
                                </div>
                              );
                            })
                          ) : (
                            <div className="text-slate-400 text-sm">Loading...</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              });
            })()}

            {/* Pagination Controls */}
            {getFilteredTimetables().length > pageSize && (
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
                  {t('app.results.page', { current: currentPage, total: Math.ceil(getFilteredTimetables().length / pageSize) })}
                </div>
                <button 
                  disabled={currentPage === Math.ceil(getFilteredTimetables().length / pageSize)}
                  onClick={() => {
                    setCurrentPage(prev => Math.min(Math.ceil(getFilteredTimetables().length / pageSize), prev + 1));
                    document.getElementById('results-section')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="px-6 py-3 rounded-full bg-white border border-slate-200 text-slate-700 font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                >
                  {t('app.results.next')}
                </button>
              </div>
            )}
          </div>
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
