import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, MapPin, ArrowRightLeft, TramFront, DollarSign, Clock, Navigation, AlertCircle, X, ChevronDown, CheckCircle } from 'lucide-react';
import { getMetroStations, getMetroODFare, getMetroS2STravelTime, computeSameLineJourney, METRO_SYSTEMS, MetroStation, MetroFare, SameLineJourney, getMetroLiveBoard, MetroLiveBoard } from '../lib/metro';
import { getCurrentGeo, requestGeolocation, getGeoPref, haversineKm } from '../lib/geo';
import { createPortal } from 'react-dom';

interface MetroSearchProps {
  language: string;
  geoCoords?: { lat: number; lon: number } | null;
}

function findNearestMetro(lat: number, lon: number, stations: MetroStation[], maxKm = 10): MetroStation | null {
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
  const [timetables, setTimetables] = useState<any[]>([]);
  const [liveBoard, setLiveBoard] = useState<MetroLiveBoard[]>([]);
  const [expandedDeparture, setExpandedDeparture] = useState<string | null>(null);
  const [loadingLiveBoard, setLoadingLiveBoard] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modals
  const [pickerType, setPickerType] = useState<'origin' | 'dest' | null>(null);
  const [modalSystem, setModalSystem] = useState(system);
  const [modalStations, setModalStations] = useState<MetroStation[]>([]);
  const hasInitialized = useRef(false);
  const userPickedOriginRef = useRef(false);

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
      const j = computeSameLineJourney(s2s, originId, destId, zh);
      setJourney(j);
      
      // Load static timetables for Origin Station
      if (j) {
        try {
          const res = await fetch(`/data/metro_${system}/${originId}.json`);
          if (res.ok) {
            const data = await res.json();
            // In TDX Metro, StationTimeTable has `Timetables` array.
            const directionTimetables = data.filter((t: any) => {
               // Must match a destination that is AFTER the origin in the stop sequence
               const dest = t.DestinationStationID;
               const idx = j.stopNames.findIndex(n => n === (zh ? t.DestinationStationName.Zh_tw : t.DestinationStationName.En) || n === t.DestinationStationName.Zh_tw);
               return idx > 0; // The destination is further down the journey
            });
            
            const departures: any[] = [];
            for (const t of directionTimetables) {
              if (t.Timetables) {
                for (const d of t.Timetables) {
                   departures.push({
                      time: d.DepartureTime,
                      destName: (zh ? t.DestinationStationName.Zh_tw : t.DestinationStationName.En) || t.DestinationStationName.Zh_tw,
                      destId: t.DestinationStationID,
                      seq: d.Sequence
                   });
                }
              }
            }
            departures.sort((a, b) => a.time.localeCompare(b.time));
            
            // Filter to upcoming
            const now = new Date();
            const nowTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
            setTimetables(departures.filter(d => d.time >= nowTime).slice(0, 5)); // Next 5
          } else {
            setTimetables([]);
          }
        } catch {
          setTimetables([]);
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

      {/* Results */}
      {hasSearched && !loading && !error && (
        <div className="w-full max-w-3xl mt-8 flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-4">
          
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm flex flex-col gap-6">
            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <TramFront className="w-6 h-6 text-cyan-500" />
              {getStationName(originStation)} → {getStationName(destStation)}
            </h3>

            {/* Fares */}
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-4 flex flex-col sm:flex-row gap-4 items-start sm:items-center">
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 shrink-0">
                <DollarSign className="w-5 h-5" />
                <span className="font-bold text-sm">{L('票價', 'Fare')}</span>
              </div>
              <div className="flex flex-wrap gap-2 flex-1">
                {fares && fares.length > 0 ? fares.map((f, i) => (
                  <div key={i} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-xl flex items-center gap-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400">{f.label || L('單程票', 'Single')}</span>
                    <span className="font-bold text-slate-800 dark:text-slate-100">NT$ {f.price}</span>
                  </div>
                )) : (
                  <span className="text-sm text-slate-500">{L('尚無票價資訊', 'No fare data')}</span>
                )}
              </div>
            </div>

            {/* Journey Info */}
            {journey ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                  <Clock className="w-5 h-5 text-cyan-500" />
                  <span className="font-bold text-sm">{L('乘車時間', 'Travel Time')}</span>
                  <span className="ml-2 font-black text-lg text-slate-800 dark:text-slate-100">
                    {Math.ceil(journey.travelTimeSec / 60)} {L('分', 'min')}
                  </span>
                  <span className="text-sm text-slate-400">
                    ({L(`經 ${journey.stopNames.length - 1} 站`, `${journey.stopNames.length - 1} stops`)})
                  </span>
                </div>

                <div className="relative mt-2 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl overflow-x-auto soft-scrollbar">
                  <div className="flex items-center min-w-max pb-2">
                    {journey.stopNames.map((name, i) => (
                      <React.Fragment key={i}>
                        <div className="flex flex-col items-center gap-2 relative z-10">
                          <div className={`w-3 h-3 rounded-full ${
                            i === 0 ? 'bg-cyan-500 ring-4 ring-cyan-500/20' : 
                            i === journey.stopNames.length - 1 ? 'bg-rose-500 ring-4 ring-rose-500/20' : 
                            'bg-white border-2 border-slate-300 dark:border-slate-600'
                          }`} />
                          <span className={`text-[11px] font-bold ${
                            i === 0 || i === journey.stopNames.length - 1 ? 'text-slate-800 dark:text-slate-200' : 'text-slate-500'
                          }`}>{name}</span>
                        </div>
                        {i < journey.stopNames.length - 1 && (
                          <div className="w-12 h-1 bg-slate-200 dark:bg-slate-700 -mt-6 rounded-full" />
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>

                {timetables.length > 0 && (
                  <div className="mt-4">
                    <h4 className="font-bold text-slate-800 dark:text-slate-100 mb-3 text-sm flex items-center gap-2">
                      <Clock className="w-4 h-4 text-cyan-500" />
                      {L('近期班次', 'Upcoming Departures')}
                    </h4>
                    <div className="flex flex-col gap-3">
                      {timetables.map((t, idx) => (
                        <div key={idx} className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden">
                          <button
                            onClick={async () => {
                              const isExpanding = expandedDeparture !== `${t.time}-${t.seq}`;
                              if (isExpanding) {
                                setExpandedDeparture(`${t.time}-${t.seq}`);
                                setLoadingLiveBoard(true);
                                try {
                                  const board = await getMetroLiveBoard(system, originId);
                                  setLiveBoard(board.filter(b => b.DestinationStationID === t.destId));
                                } catch (e) {
                                  console.error(e);
                                } finally {
                                  setLoadingLiveBoard(false);
                                }
                              } else {
                                setExpandedDeparture(null);
                              }
                            }}
                            className="w-full text-left p-4 flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          >
                            <div className="flex items-center gap-4">
                              <span className="text-xl font-black text-slate-800 dark:text-slate-100 tracking-tight">
                                {t.time}
                              </span>
                              <div className="flex flex-col">
                                <span className="text-xs text-slate-500 font-bold uppercase tracking-widest">{L('往', 'TO')}</span>
                                <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{t.destName}</span>
                              </div>
                            </div>
                            <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${expandedDeparture === `${t.time}-${t.seq}` ? 'rotate-180' : ''}`} />
                          </button>
                          
                          {expandedDeparture === `${t.time}-${t.seq}` && (
                            <div className="px-4 pb-4 animate-in slide-in-from-top-2 fade-in duration-200">
                              <div className="pt-3 border-t border-slate-200 dark:border-slate-700">
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
                                        <div className="ml-auto flex items-center gap-1">
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
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-6 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-2xl text-center gap-3">
                <AlertCircle className="w-8 h-8 text-amber-500" />
                <div>
                  <h4 className="font-bold text-amber-700 dark:text-amber-500 mb-1">
                    {L('需轉乘', 'Transfer Required')}
                  </h4>
                  <p className="text-sm text-amber-600/80 dark:text-amber-400/80 max-w-sm">
                    {L('此路線需跨線轉乘，詳細乘車時間與轉乘站請使用「規劃」功能進行查詢。', 'This route requires a transfer. Use the "Plan" tab for detailed routing and times.')}
                  </p>
                </div>
              </div>
            )}

          </div>
        </div>
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
                          if (pickerType === 'origin') userPickedOriginRef.current = true;
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
