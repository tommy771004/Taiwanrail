import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, MapPin, ArrowRightLeft, TramFront, Clock, Navigation, AlertCircle, X, ChevronDown } from 'lucide-react';
import { getMetroStations, getMetroODFare, getMetroS2STravelTime, computeSameLineJourney, METRO_SYSTEMS, MetroStation, MetroFare, SameLineJourney, getMetroLiveBoard, MetroLiveBoard, MetroDeparture, buildMetroDepartures, metroTrainTypeLabel, MetroRoute, getMetroLineTransfer, computeMetroRoute, getMetroLivePosition, MetroLivePosition, addMinutesToHHMM } from '../lib/metro';
import { getCurrentGeo, requestGeolocation, getGeoPref, haversineKm } from '../lib/geo';
import { createPortal } from 'react-dom';

interface MetroSearchProps {
  language: string;
  geoCoords?: { lat: number; lon: number } | null;
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

export default function MetroSearch({ language, geoCoords }: MetroSearchProps) {
  const zh = language === 'zh-TW';
  const L = (z: string, e: string) => (zh ? z : e);

  const [system, setSystem] = useState(METRO_SYSTEMS[0].code);
  const [stations, setStations] = useState<MetroStation[]>([]);
  const [originId, setOriginId] = useState('');
  const [destId, setDestId] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [fares, setFares] = useState<MetroFare[] | null>(null);
  const [journey, setJourney] = useState<SameLineJourney | null>(null);
  const [departures, setDepartures] = useState<MetroDeparture[]>([]);
  const [route, setRoute] = useState<MetroRoute | null>(null);
  const [visibleCount, setVisibleCount] = useState(10);
  const [resultsMount, setResultsMount] = useState<HTMLElement | null>(null);
  const [liveBoard, setLiveBoard] = useState<MetroLiveBoard[]>([]);
  const [expandedDeparture, setExpandedDeparture] = useState<string | null>(null);
  const [loadingLiveBoard, setLoadingLiveBoard] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [livePositions, setLivePositions] = useState<MetroLivePosition[]>([]);
  const [interchangeIds, setInterchangeIds] = useState<Set<string>>(new Set());

  // Modals
  const [pickerType, setPickerType] = useState<'origin' | 'dest' | null>(null);
  const [modalSystem, setModalSystem] = useState(system);
  const [modalStations, setModalStations] = useState<MetroStation[]>([]);
  const hasInitialized = useRef(false);
  const userPickedOriginRef = useRef(false);

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

  const handleSearch = async () => {
    if (!originId || !destId) {
      setError(L('請選擇起點與終點', 'Please select origin and destination.'));
      return;
    }
    if (originId === destId) {
      setError(L('起點與終點不可相同', 'Origin and destination cannot be the same.'));
      return;
    }
    setError(null);
    setLoading(true);
    setHasSearched(true);
    
    try {
      const [f, s2s] = await Promise.all([
        getMetroODFare(system, originId, destId),
        getMetroS2STravelTime(system),
      ]);
      setFares(f);
      setVisibleCount(10);
      setExpandedDeparture(null);
      setLivePositions([]);

      // Interchange ids power the stop-timeline "轉乘" badges. getMetroLineTransfer
      // is static-first + module-cached, so this is effectively free per search.
      const transferEdges = await getMetroLineTransfer(system).catch(() => []);
      const ids = new Set<string>();
      for (const e of transferEdges) { ids.add(e.fromId); ids.add(e.toId); }
      setInterchangeIds(ids);

      const j = computeSameLineJourney(s2s, originId, destId, zh);
      setJourney(j);

      if (j) {
        // Same line: load static timetable for the origin station and shape into departures.
        setRoute(null);
        try {
          const res = await fetch(`/data/metro_${system}/${originId}.json`);
          if (res.ok) {
            const data = await res.json();
            const now = new Date();
            const nowHHMM = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
            setDepartures(buildMetroDepartures(data, j, zh, nowHHMM));
          } else {
            setDepartures([]);
          }
        } catch {
          setDepartures([]);
        }
      } else {
        // Cross-line: compute an in-system transfer route (reuse the edges fetched above).
        setDepartures([]);
        try {
          const originName = getStationName(stations.find(s => s.StationID === originId));
          const destName = getStationName(stations.find(s => s.StationID === destId));
          setRoute(computeMetroRoute(s2s, transferEdges, originName, destName, zh));
        } catch (e) {
          console.error(e);
          setRoute(null);
        }
      }
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

  const originStation = stations.find(s => s.StationID === originId);
  const destStation = stations.find(s => s.StationID === destId);

  const getStationName = (s?: MetroStation) => {
    if (!s) return '';
    return (zh ? s.StationName.Zh_tw : s.StationName.En) || s.StationName.Zh_tw || '';
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col items-center">
      
      {/* Station Selector & Swap (Similar to App.tsx Rail Search) */}
      <div className="relative z-50 flex flex-row items-center justify-between mb-8 w-full max-w-3xl backdrop-blur-xl border border-cyan-100/50 dark:border-cyan-900/30 rounded-[2.5rem] p-3 sm:p-6 bg-cyan-50/60 dark:bg-cyan-900/20 shadow-[inset_0_2px_20px_rgba(6,182,212,0.15),0_8px_32px_-8px_rgba(8,145,178,0.08)]">
        
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
          onClick={handleSearch}
          disabled={loading || !originId || !destId}
          className="w-full flex items-center justify-center gap-2 sm:gap-3 py-3.5 sm:py-4 rounded-2xl sm:rounded-3xl bg-cyan-600 text-white text-base sm:text-lg font-bold shadow-[0_8px_30px_rgba(8,145,178,0.3)] hover:bg-cyan-500 hover:shadow-[0_8px_40px_rgba(8,145,178,0.4)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all disabled:opacity-50 disabled:hover:translate-y-0 disabled:active:scale-100 disabled:cursor-not-allowed"
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

          {/* Summary header (出發站 / 抵達站 / 票價) */}
          <div className="mb-6 rounded-3xl p-6 bg-gradient-to-br from-cyan-500 to-cyan-600 text-white shadow-[0_8px_30px_rgba(8,145,178,0.3)] flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <h2 className="text-lg sm:text-2xl font-black tracking-tight flex items-center gap-2">
                <TramFront className="w-6 h-6 shrink-0" />
                <span>{getStationName(originStation) || '—'}</span>
                <span className="opacity-70">→</span>
                <span>{getStationName(destStation) || '—'}</span>
              </h2>
              <div className="flex items-baseline gap-2 bg-white/15 rounded-2xl px-4 py-2">
                {fares && fares.length > 0 ? (
                  <>
                    <span className="text-2xl sm:text-3xl font-black tabular-nums">NT${Math.min(...fares.map(f => f.price))}</span>
                    <span className="text-sm font-semibold opacity-90">{fares[0].label || L('單程票', 'Single')}</span>
                  </>
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
                        className={`w-full rounded-2xl border bg-white dark:bg-slate-900 shadow-sm hover:shadow-md transition-all overflow-hidden ${
                          isExpanded ? 'border-cyan-200 dark:border-cyan-800 bg-gradient-to-br from-white to-cyan-50/40 dark:from-slate-900 dark:to-cyan-950/20' : 'border-slate-100 dark:border-slate-800'
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
                            </div>

                            {/* Departure — duration — arrival */}
                            <div className="col-span-8 sm:col-span-7 flex items-center gap-2 sm:gap-3">
                              <div className="text-center shrink-0">
                                <p className={`font-black text-2xl sm:text-4xl tracking-tighter tabular-nums leading-none ${isExpanded ? 'text-cyan-600' : 'text-slate-900 dark:text-white'}`}>
                                  {d.departureTime}
                                </p>
                              </div>
                              <div className="flex-grow text-center min-w-0">
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
                              <div className="text-center shrink-0">
                                <p className="font-black text-2xl sm:text-4xl tracking-tighter tabular-nums leading-none text-slate-900 dark:text-white">
                                  {d.arrivalTime}
                                </p>
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

                              {/* Stop sequence — vertical timeline (mirrors the rail detail), with
                                  per-stop clock times, live train position highlight, and interchange tags. */}
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
                                    const isInterchange = interchangeIds.has(sid) && !isOrigin && !isDest;
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
                                            {isInterchange && (
                                              <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-slate-700/70 text-slate-600 dark:text-slate-300 text-[9px] font-black uppercase tracking-widest">
                                                <ArrowRightLeft className="w-2.5 h-2.5" />{L('轉乘', 'Transfer')}
                                              </span>
                                            )}
                                          </div>
                                          <span className="font-mono font-bold tabular-nums text-xs sm:text-sm text-slate-500 dark:text-slate-400 shrink-0">{clock}</span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
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
              <div className="flex flex-col items-center justify-center p-8 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-2xl text-center gap-2">
                <AlertCircle className="w-8 h-8 text-slate-400" />
                <p className="text-sm text-slate-500 max-w-sm">
                  {L('此區間目前無班次時刻資料，僅顯示票價與乘車資訊。', 'No timetable data for this segment; fare and travel info only.')}
                </p>
              </div>
            )
          ) : route ? (
            <>
              <h3 className="mb-4 px-2 text-xs sm:text-sm font-black text-slate-950 dark:text-white tracking-widest uppercase">
                {L(`建議路線 · 轉乘 ${route.transferCount} 次`, `Suggested Route · ${route.transferCount} transfer${route.transferCount === 1 ? '' : 's'}`)}
              </h3>
              <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4 sm:p-6 flex flex-col">
                {route.legs.map((leg, i) => (
                  <React.Fragment key={i}>
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 self-start px-2 py-1 rounded-md text-xs font-bold tracking-widest bg-[#e0f7fa] text-[#0e7490] whitespace-nowrap">
                        {leg.lineId}
                      </span>
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="font-bold text-slate-800 dark:text-slate-100">{leg.fromName} → {leg.toName}</span>
                        <span className="text-xs text-slate-500">
                          {L(`經 ${Math.max(0, leg.stopNames.length - 1)} 站`, `${Math.max(0, leg.stopNames.length - 1)} stops`)}
                          {' · '}
                          {Math.ceil(leg.rideTimeSec / 60)} {L('分鐘', 'min')}
                        </span>
                      </div>
                    </div>
                    {i < route.legs.length - 1 && (
                      <div className="flex items-center gap-2 my-3 pl-1 text-xs font-semibold text-cyan-700 dark:text-cyan-400">
                        <ArrowRightLeft className="w-4 h-4 shrink-0" />
                        {L(`在 ${route.transfers[i]?.stationName ?? ''} 轉乘 · 約 ${Math.ceil((route.transfers[i]?.transferTimeSec ?? 0) / 60)} 分`,
                           `Transfer at ${route.transfers[i]?.stationName ?? ''} · ~${Math.ceil((route.transfers[i]?.transferTimeSec ?? 0) / 60)} min`)}
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </>
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
            
            <div className="p-4 border-b border-slate-100 dark:border-slate-800">
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
                    onClick={() => setModalSystem(sys.code)}
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
              
              {/* Right Content - Stations */}
              <div className="w-full sm:w-2/3 md:w-3/4 flex-1 overflow-y-auto soft-scrollbar p-2 sm:p-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {modalStations.map(s => {
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
                        className={`
                          p-3 rounded-2xl text-sm font-medium transition-all border text-left flex flex-col gap-1
                          ${isOtherEndpoint && modalSystem === system ? 'opacity-30 cursor-not-allowed bg-slate-50 dark:bg-slate-800/50 border-transparent' : 
                            isSelected 
                              ? 'bg-cyan-50 dark:bg-cyan-900/20 border-cyan-200 dark:border-cyan-800 text-cyan-700 dark:text-cyan-400 shadow-sm' 
                              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-cyan-300 hover:bg-cyan-50/30'
                          }
                        `}
                      >
                        <span className="truncate w-full">{name}</span>
                        <span className="text-[10px] text-slate-400 opacity-60 font-mono">{s.StationID}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
