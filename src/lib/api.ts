import { isReloadRequired, liveGatewayHeaders } from './gateTicketClient';
import { pickShortestRouteFares } from './odFareDirection';
import { taiwanDateString, taiwanWeekdayIndex } from './taiwanDate';
import {
  decodeCompactDaily,
  parseCompactDaily,
  type DailyRail,
  type DecodedDailyTrain,
  type StationNameLookup,
} from './dailyTimetable';
import { mergeSeatResults, missingSeatTrains, seatsFromOD, seatsFromStationBoard, type ThsrSeatResult } from './thsrSeats';

// --- Request cache + in-flight dedup ---
type CacheEntry<T> = { data: T; expiresAt: number };
const requestCache = new Map<string, CacheEntry<any>>();
const inFlight = new Map<string, Promise<any>>();

function getCacheTTL(url: string): number {
  if (url.includes('LiveBoard')) return 1 * 60_000;       // 1 min (< 2 min poll; CDN holds 2.5 min)
  if (url.includes('LiveTrainDelay')) return 1 * 60_000;  // 1 min (< 2 min poll; CDN holds 2.5 min)
  if (url.includes('AvailableSeatStatus')) return 10 * 60_000; // 高鐵剩餘座位：查詢時抓一次，不輪詢
  return 3 * 60_000;                                     // 3 min default
}

// 輔助函式：將日期轉換為 TDX 的曜日格式 (Monday, Tuesday...)
// dateStr 是台北的日曆日，星期必須只由字串本身決定；用 new Date(dateStr).getDay()
// 會拿 UTC 午夜配本地時區，在 UTC+8 以西整整差一天，比對 ServiceDay 就抓錯整份時刻表。
function getDayKey(dateStr: string): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const index = taiwanWeekdayIndex(dateStr);
  if (index !== null) return days[index];
  // 非 YYYY-MM-DD（理論上不會發生）時退回台北的今天，而不是回傳 undefined。
  return days[taiwanWeekdayIndex(taiwanDateString()) ?? 0];
}

// Unwrap TDX envelope objects that may wrap arrays under various keys
function unwrapArray<T>(payload: any): T[] {
  if (Array.isArray(payload)) return payload as T[];
  // Common TDX envelope keys
  for (const key of ['TrainTimetables', 'ODFares', 'LiveBoards', 'Stations', 'Fares']) {
    if (Array.isArray(payload?.[key])) return payload[key] as T[];
  }
  return [] as T[];
}

/**
 * `fresh` skips this tab's response cache so a rider's manual refresh really goes
 * out; the proxy/CDN still answer within their own TTL, which bounds TDX calls.
 */
export async function fetchTDXApi<T>(url: string, options: { fresh?: boolean } = {}): Promise<T> {
  // 等重新整理的分頁不再打 API，也不留舊讀數：畫面上不能把幾小時前的誤點當成現在。
  if (isReloadRequired()) return [] as T;

  const now = Date.now();
  console.log(`[TDX Request] Original: ${url}`);
  
  // Transform full TDX URL to relative proxy URL
  const proxyUrl = url.replace('https://tdx.transportdata.tw/api', '/api/tdx');
  console.log(`[TDX Request] Proxy: ${proxyUrl}`);

  const cached = requestCache.get(proxyUrl);
  if (!options.fresh && cached && cached.expiresAt > now) return cached.data as T;

  const existing = inFlight.get(proxyUrl);
  if (existing) return existing as Promise<T>;

  const task = (async (): Promise<T> => {
    try {
      const headers = await liveGatewayHeaders();
      const response = await fetch(proxyUrl, {
        headers,
        credentials: 'include',
      });

      if (!response.ok) {
        // A 429 or 401 is routine here and the caller simply shows no data.
        const isSoftError = response.status === 429 || response.status === 401;
        
        if (isSoftError) {
          console.info(`[TDX] ${response.status} for ${proxyUrl} - No data`);
        } else {
          console.warn(`[TDX Error] ${response.status} for ${proxyUrl} - No data`);
        }
        
        if (cached) return cached.data as T;
        return [] as T;
      }

      const data = await response.json() as T;
      requestCache.set(proxyUrl, { data, expiresAt: Date.now() + getCacheTTL(url) });
      return data;
    } catch (error) {
      if (cached) return cached.data as T;
      const isNetworkError = error instanceof TypeError && error.message.includes('Failed to fetch');
      if (isNetworkError) {
        console.warn(`[TDX] Network error fetching ${proxyUrl} (server restarted?) - No data`);
      } else {
        console.warn(`[TDX Proxy Fetch Error] ${proxyUrl}:`, error);
      }
      return [] as T;
    }
  })();

  inFlight.set(proxyUrl, task);
  try {
    return await task;
  } finally {
    inFlight.delete(proxyUrl);
  }
}

// --- Interfaces ---
export interface Station {
  StationID: string;
  StationName: { Zh_tw: string; En: string };
  StationPosition?: { PositionLon: number; PositionLat: number; GeoHash?: string };
}

let _traStationsCache: Station[] | null = null;
export async function getTRAStations(): Promise<Station[]> {
  if (_traStationsCache) return _traStationsCache;
  try {
    // 🚚 從本地靜態倉庫拿貨，不用去塞車的 TDX API
    const response = await fetch('/data/tra-stations.json');
    if (!response.ok) throw new Error('Static file missing');
    const raw = await response.json();
    _traStationsCache = raw?.Stations || unwrapArray<Station>(raw);
    return _traStationsCache!;
  } catch (error) {
    console.warn('⚠️ 靜態台鐵車站讀取失敗:', error);
    return [];
  }
}

let _thsrStationsCache: Station[] | null = null;
export async function getTHSRStations(): Promise<Station[]> {
  if (_thsrStationsCache) return _thsrStationsCache;
  try {
    // 🚚 從本地靜態倉庫拿貨
    const response = await fetch('/data/thsr-stations.json');
    if (!response.ok) throw new Error('Static file missing');
    const raw = await response.json();
    _thsrStationsCache = unwrapArray<Station>(raw);
    return _thsrStationsCache!;
  } catch (error) {
    console.warn('⚠️ 靜態高鐵車站讀取失敗:', error);
    return [];
  }
}

export interface DailyTimetableOD {
  OriginStationID: string;
  OriginStationName: { Zh_tw: string };
  DestinationStationID: string;
  DestinationStationName: { Zh_tw: string };
  TrainDate: string;
  DailyTrainInfo: {
    TrainNo: string;
    TrainTypeID: string;
    TrainTypeName: { Zh_tw: string };
    StartingStationName?: { Zh_tw: string };
    EndingStationName?: { Zh_tw: string };
    Note?: { Zh_tw: string };
    WheelchairFlag?: number;
    BreastFeedingFlag?: number;
    BikeFlag?: number;
    DiningFlag?: number;
    ParenthoodFlag?: number;
    Direction?: number;
    TripLine?: number;
    OverNightStationID?: string;
  };
  OriginStopTime: { DepartureTime: string };
  DestinationStopTime: { ArrivalTime: string };
  /** 起訖站之間的中途停靠站數（只有靜態時刻表路徑會算；live proxy 結果沒有）。 */
  StopCount?: number;
}

// v3 TRA shapes
interface V3TrainOD {
  TrainInfo: {
    TrainNo: string;
    TrainTypeID: string;
    TrainTypeName?: { Zh_tw: string; En?: string };
    StartingStationName?: { Zh_tw: string; En?: string };
    EndingStationName?: { Zh_tw: string; En?: string };
    Note?: { Zh_tw: string; En?: string };
    WheelchairFlag?: number;
    BreastFeedingFlag?: number;
    BikeFlag?: number;
    DiningFlag?: number;
    ParenthoodFlag?: number;
    Direction?: number;
    TripLine?: number;
    OverNightStationID?: string;
  };
  OriginStopTime?: { DepartureTime: string };
  DestinationStopTime?: { ArrivalTime: string };
  StopTimes?: StopTime[];
}
interface V3ODEnvelope { TrainTimetables?: V3TrainOD[] }

function mapV3ToOD(payload: any, date: string): DailyTimetableOD[] {
  const list: any[] = Array.isArray(payload) ? payload : (payload?.TrainTimetables ?? []);
  
  return list.map(t => {
    // Handle both V3 (TrainInfo) and V2 (DailyTrainInfo) structures
    const info = t.TrainInfo || t.DailyTrainInfo;
    const stops = t.StopTimes || [];
    
    // In V3 OD search, these might be explicit or need extraction from stops
    const originStop = t.OriginStopTime || (stops.length ? stops[0] : { DepartureTime: '00:00' });
    const destStop = t.DestinationStopTime || (stops.length ? stops[stops.length - 1] : { ArrivalTime: '00:00' });

    return {
      OriginStationID: originStop.StationID || stops[0]?.StationID || t.OriginStationID || '',
      OriginStationName: originStop.StationName || (stops[0]?.StationName ? { Zh_tw: stops[0].StationName.Zh_tw } : { Zh_tw: t.OriginStationName?.Zh_tw || '' }),
      DestinationStationID: destStop.StationID || stops[stops.length - 1]?.StationID || t.DestinationStationID || '',
      DestinationStationName: destStop.StationName || (stops[stops.length - 1]?.StationName ? { Zh_tw: stops[stops.length - 1].StationName.Zh_tw } : { Zh_tw: t.DestinationStationName?.Zh_tw || '' }),
      TrainDate: t.TrainDate || date,
      DailyTrainInfo: {
        TrainNo: info?.TrainNo || '',
        TrainTypeID: info?.TrainTypeID || '',
        TrainTypeName: info?.TrainTypeName || { Zh_tw: '未知' },
        StartingStationName: info?.StartingStationName || { Zh_tw: '' },
        EndingStationName: info?.EndingStationName || { Zh_tw: '' },
        Note: info?.Note || { Zh_tw: '' },
        // Standardize WheelChair accessibility flag from both v2 and v3 structures
        WheelchairFlag: info?.WheelchairFlag || info?.WheelChairFlag || (t.ExtraInfo?.IsWheelchairUser ? 1 : 0) || (t.ExtraInfo?.WheelchairFlag) || 0,
        BreastFeedingFlag: info?.BreastFeedingFlag || 0,
        BikeFlag: info?.BikeFlag || 0,
        DiningFlag: info?.DiningFlag || 0,
        ParenthoodFlag: info?.ParenthoodFlag || 0,
        Direction: info?.Direction,
        TripLine: info?.TripLine,
        OverNightStationID: info?.OverNightStationID,
      },
      OriginStopTime: { DepartureTime: originStop.DepartureTime || '' },
      DestinationStopTime: { ArrivalTime: destStop.ArrivalTime || destStop.DepartureTime || '' },
    } as DailyTimetableOD;
  });
}

let _traTimetableCache: any = null;
let _thsrTimetableCache: any = null;
const _failedStaticFiles = new Set<string>();

// --- 每日時刻表（未來兩週）---
// public/data/{tra,thsr}-daily/{date}.json 是每日快照，含加開／停駛／改點；
// 全週的 GeneralTimetable 只是 fallback（超出兩週視窗或當天檔案缺漏時才用）。
const DAILY_DIRECTORY: Record<DailyRail, string> = { TRA: 'tra-daily', THSR: 'thsr-daily' };
const _dailyTimetableCache = new Map<string, DecodedDailyTrain[] | null>();

async function getStationNameLookup(rail: DailyRail): Promise<StationNameLookup> {
  try {
    const stations = rail === 'TRA' ? await getTRAStations() : await getTHSRStations();
    const byId = new Map(stations.map(s => [s.StationID, s.StationName]));
    return (stationId: string) => byId.get(stationId);
  } catch {
    // 壓縮格式不存站名，查不到就留空字串，時刻與票價仍然可用。
    return () => undefined;
  }
}

async function loadDailyTimetable(rail: DailyRail, date: string): Promise<DecodedDailyTrain[] | null> {
  const cacheKey = `${rail}:${date}`;
  if (_dailyTimetableCache.has(cacheKey)) return _dailyTimetableCache.get(cacheKey)!;

  let decoded: DecodedDailyTrain[] | null = null;
  try {
    const res = await fetch(`/data/${DAILY_DIRECTORY[rail]}/${date}.json`);
    if (res.ok) {
      const compact = parseCompactDaily(await res.json(), { rail, date });
      if (compact) {
        decoded = decodeCompactDaily(compact, await getStationNameLookup(rail));
        console.log(`📅 使用 ${date} 每日時刻表（${decoded.length} 班車）`);
      } else {
        console.warn(`⚠️ ${rail} ${date} 每日時刻表格式不符或班次過少，改用全週時刻表`);
      }
    }
  } catch (error) {
    console.warn(`⚠️ 讀取 ${rail} ${date} 每日時刻表失敗，改用全週時刻表:`, error);
  }

  _dailyTimetableCache.set(cacheKey, decoded);
  // 每個日期解碼後約數 MB，逛過多個日期時只留最近幾天，避免行動裝置記憶體被吃光
  while (_dailyTimetableCache.size > 4) {
    const oldest = _dailyTimetableCache.keys().next().value;
    if (oldest === undefined || oldest === cacheKey) break;
    _dailyTimetableCache.delete(oldest);
  }
  return decoded;
}

/** 把靜態時刻表（每日或全週）的 { TrainInfo, StopTimes } 轉成 OD 查詢結果。 */
function staticTrainsToOD(
  trains: { TrainInfo: any; StopTimes: any[] }[],
  originId: string,
  destId: string,
  date: string,
): DailyTimetableOD[] {
  const results: DailyTimetableOD[] = [];

  for (const train of trains) {
    const stops = train.StopTimes || [];
    const originIdx = stops.findIndex((s: any) => s.StationID === originId);
    if (originIdx === -1) continue;
    const destIdx = stops.findIndex((s: any) => s.StationID === destId);
    if (destIdx === -1 || originIdx >= destIdx) continue;

    results.push({
      OriginStationID: originId,
      DestinationStationID: destId,
      TrainDate: date,
      DailyTrainInfo: train.TrainInfo,
      OriginStopTime: { DepartureTime: stops[originIdx].DepartureTime || '--:--' },
      DestinationStopTime: { ArrivalTime: stops[destIdx].ArrivalTime || '--:--' },
      StopCount: destIdx - originIdx - 1,
    } as DailyTimetableOD);
  }

  return results;
}

export async function getTRATimetableOD(originId: string, destId: string, date: string): Promise<DailyTimetableOD[]> {
  // 兩週內的日期用每日快照，才會反映加開車、臨時停駛與改點
  const daily = await loadDailyTimetable('TRA', date);
  if (daily) {
    const results = staticTrainsToOD(daily, originId, destId, date);
    console.log(`✅ ${date} 每日時刻表搜尋完成，找到 ${results.length} 班車次`);
    return results;
  }

  try {
    if (!_traTimetableCache && !_failedStaticFiles.has('tra-timetable')) {
      console.log('🚚 載入全台台鐵時刻表倉庫 (約 3.5MB)...');
      const res = await fetch('/data/tra-timetable.json');
      if (!res.ok) {
        _failedStaticFiles.add('tra-timetable');
        throw new Error('Static timetable missing');
      }
      _traTimetableCache = await res.json();
    }
    
    // If we have the cache, use it
    if (_traTimetableCache) {
      const dayKey = getDayKey(date);
      const timetables = _traTimetableCache.TrainTimetables || [];

      const runningToday = timetables.filter((t: any) => t.ServiceDay?.[dayKey] === 1);
      const results = staticTrainsToOD(runningToday, originId, destId, date);
      console.log(`✅ 本地搜尋完成，找到 ${results.length} 班車次`);
      return results;
    }
    throw new Error('Using fallback');
  } catch (error) {
    console.warn('⚠️ 嘗試呼叫 Proxy API:', error);
    const url = `https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/DailyTrainTimetable/OD/${originId}/to/${destId}/${date}?$format=JSON`;
    const raw = await fetchTDXApi<any>(url);
    return mapV3ToOD(raw, date);
  }
}

/**
 * 某天每班車的完整停站時刻（車次 → StopTimes），給列表上的「列車在哪」用。
 * 只讀已經下載過的靜態時刻表（OD 查詢剛載入的那份），不會多打任何請求；
 * 結果來自即時 proxy 時這裡是空的，票券就維持原本的細線。
 */
export async function getTrainStopsIndex(rail: DailyRail, date: string): Promise<Map<string, StopTime[]>> {
  const index = new Map<string, StopTime[]>();
  const daily = _dailyTimetableCache.get(`${rail}:${date}`);
  if (daily) {
    for (const t of daily) index.set(t.TrainInfo.TrainNo, t.StopTimes);
    return index;
  }
  const weekly = rail === 'TRA' ? _traTimetableCache : _thsrTimetableCache;
  if (!weekly) return index;
  const dayKey = getDayKey(date);
  const list: any[] = Array.isArray(weekly) ? weekly : (weekly.TrainTimetables || []);
  for (const item of list) {
    const t = item.GeneralTimetable || item;
    const info = t.GeneralTrainInfo || t.TrainInfo;
    if (!info?.TrainNo || t.ServiceDay?.[dayKey] !== 1) continue;
    if (Array.isArray(t.StopTimes)) index.set(info.TrainNo, t.StopTimes);
  }
  return index;
}

export async function getTHSRTimetableOD(originId: string, destId: string, date: string): Promise<DailyTimetableOD[]> {
  const daily = await loadDailyTimetable('THSR', date);
  if (daily) {
    return staticTrainsToOD(daily, originId, destId, date);
  }

  try {
    if (!_thsrTimetableCache && !_failedStaticFiles.has('thsr-timetable')) {
      const res = await fetch('/data/thsr-timetable.json');
      if (!res.ok) {
        _failedStaticFiles.add('thsr-timetable');
        throw new Error('Static HSR missing');
      }
      _thsrTimetableCache = await res.json();
    }
    
    if (_thsrTimetableCache) {
      const dayKey = getDayKey(date);
      // 高鐵 v2 靜態資料是陣列，且資料在 GeneralTimetable 欄位內
      const list = Array.isArray(_thsrTimetableCache) ? _thsrTimetableCache : (_thsrTimetableCache.TrainTimetables || []);

      const runningToday = list
        .map((item: any) => {
          const t = item.GeneralTimetable || item;
          return { ServiceDay: t.ServiceDay, TrainInfo: t.GeneralTrainInfo || t.TrainInfo, StopTimes: t.StopTimes || [] };
        })
        .filter((t: any) => t.ServiceDay?.[dayKey] === 1);

      return staticTrainsToOD(runningToday, originId, destId, date);
    }
    throw new Error('Using fallback');
  } catch (error) {
    const raw = await fetchTDXApi<any>(`https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/DailyTimetable/OD/${originId}/to/${destId}/${date}?$format=JSON`);
    const arr = unwrapArray<DailyTimetableOD>(raw);
    return arr.length ? arr : mapV3ToOD(raw, date);
  }
}

// Preload function to be called on app start
export async function preloadStaticData() {
  console.log('🚀 正在預載入基礎車站資料...');
  await Promise.all([getTRAStations(), getTHSRStations()]);
}

// Fares fallback to static too
export interface Fare { TicketType: string | number; Price?: number; Fare?: number; CabinClass?: number; FareClass?: number; }
/**
 * `Direction` is a Zh_tw label ("順行"/"逆行") in the v3 payload, and each OD carries
 * one record per direction — see `pickShortestRouteFares` for why that matters.
 */
export interface TRAODFare { OriginStationID: string; DestinationStationID: string; Direction: string | number; TrainType: number; TravelDistance?: number; Fares: Fare[] }
export interface THSRODFare { OriginStationID: string; DestinationStationID: string; Direction: number; Fares: Fare[] }

// 按起始站 lazy-load：/data/tra-fares/{originId}.json（每檔 ~2 MB）
const _traFaresCache = new Map<string, TRAODFare[]>();
const _traFaresFailed = new Set<string>();
export async function getTRAODFare(originId: string, destId: string): Promise<TRAODFare[]> {
  try {
    if (!_traFaresCache.has(originId) && !_traFaresFailed.has(originId)) {
      const res = await fetch(`/data/tra-fares/${originId}.json`);
      if (!res.ok) throw new Error(`Static fares missing for ${originId}`);
      const data = await res.json();
      _traFaresCache.set(originId, Array.isArray(data) ? data : (data.ODFares || []));
    }
    const fares = _traFaresCache.get(originId) || [];
    return pickShortestRouteFares(
      fares.filter((f: TRAODFare) => f.DestinationStationID === destId),
    );
  } catch (error) {
    _traFaresFailed.add(originId);
    const url = `https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/ODFare/${originId}/to/${destId}?$format=JSON`;
    const raw = await fetchTDXApi<any>(url);
    // The live payload carries both directions too, so this path needs the same
    // disambiguation — otherwise the bug survives wherever the static file is missing.
    if (raw?.ODFares) return pickShortestRouteFares<TRAODFare>(raw.ODFares);
    return pickShortestRouteFares(unwrapArray<TRAODFare>(raw));
  }
}

let _thsrFaresCache: any[] | null = null;
export async function getTHSRODFare(originId: string, destId: string): Promise<THSRODFare[]> {
  try {
    if (!_thsrFaresCache) {
      const res = await fetch('/data/thsr-fares.json');
      if (!res.ok) throw new Error('Static THSR fares missing');
      const data = await res.json();
      // File is a top-level array; tolerate { ODFares: [...] } wrapper too.
      _thsrFaresCache = Array.isArray(data) ? data : (data.ODFares || []);
    }
    return (_thsrFaresCache || []).filter((f: any) => f.OriginStationID === originId && f.DestinationStationID === destId);
  } catch (error) {
    const raw = await fetchTDXApi<any>(`https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/ODFare/${originId}/to/${destId}?$format=JSON`);
    if (raw?.ODFares) return raw.ODFares;
    return unwrapArray<THSRODFare>(raw);
  }
}

// --- Train Stops ---
export interface StopTime {
  StopSequence: number;
  StationID: string;
  StationName: { Zh_tw: string; En?: string };
  ArrivalTime: string;
  DepartureTime: string;
  SuspendedFlag?: number;
}
export interface TrainTimetable {
  TrainDate: string;
  TrainInfo: { TrainNo: string };
  StopTimes: StopTime[];
}

function mapV3ToTrainTimetable(payload: any, date: string): TrainTimetable[] {
  const list: any[] = Array.isArray(payload) ? payload : (payload?.TrainTimetables ?? []);
  return list.map(t => {
    const info = t.TrainInfo || t.DailyTrainInfo;
    const stops = t.StopTimes || t.TrainStopTimes || [];
    return {
      TrainDate: t.TrainDate || date,
      TrainInfo: { TrainNo: info?.TrainNo || '' },
      StopTimes: stops.map((s: any) => ({
        ...s,
        DepartureTime: s.DepartureTime || s.ArrivalTime || '',
        ArrivalTime: s.ArrivalTime || s.DepartureTime || '',
        SuspendedFlag: s.SuspendedFlag || 0
      })) as StopTime[],
    };
  });
}

export async function getTRATrainTimetable(trainNo: string, date: string): Promise<TrainTimetable[]> {
  if (!trainNo || trainNo === 'Unknown') return [];

  // 當日快照的停靠站才會反映臨時停靠取消
  const daily = await loadDailyTimetable('TRA', date);
  const dailyTrain = daily?.find(t => t.TrainInfo.TrainNo === trainNo);
  if (dailyTrain) {
    return [{ TrainDate: date, TrainInfo: { TrainNo: trainNo }, StopTimes: dailyTrain.StopTimes }];
  }

  try {
    // 🚚 先嘗試從已經下載好的「全台時刻表倉庫」找這班車的停靠站
    if (!_traTimetableCache) {
      const res = await fetch('/data/tra-timetable.json');
      _traTimetableCache = await res.json();
    }

    const train = (_traTimetableCache.TrainTimetables || []).find((t: any) => t.TrainInfo.TrainNo === trainNo);
    
    if (train) {
      console.log(`✅ 從本地倉庫找到車次 ${trainNo} 的停靠站資料`);
      return [{
        TrainDate: date,
        TrainInfo: { TrainNo: trainNo },
        StopTimes: train.StopTimes.map((s: any) => ({
          ...s,
          ArrivalTime: s.ArrivalTime || s.DepartureTime,
          DepartureTime: s.DepartureTime || s.ArrivalTime,
        }))
      }];
    }
  } catch (error) {
    console.warn(`本地尋找車次 ${trainNo} 失敗，嘗試呼叫 API`, error);
  }

  // --- API Fallback ---
  try {
    // 閘道把這個查詢換成當天全線時刻表再篩出這班車（見 tdxGateway.ts），所有車次共用一次 TDX 呼叫。
    const url = `https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/DailyTrainTimetable/TrainNo/${trainNo}?$filter=TrainDate eq '${date}'&$format=JSON`;
    // App 取第一筆當這班車的停靠站，別的車次不能留在結果裡。
    return mapV3ToTrainTimetable(await fetchTDXApi<any>(url), date)
      .filter(t => t.TrainInfo.TrainNo === trainNo);
  } catch (error) {
    console.error("取得台鐵停靠站失敗:", error);
    return [];
  }
}

export async function getTHSRTrainTimetable(trainNo: string, date: string): Promise<TrainTimetable[]> {
  if (!trainNo) return [];

  const daily = await loadDailyTimetable('THSR', date);
  const dailyTrain = daily?.find(t => t.TrainInfo.TrainNo === trainNo);
  if (dailyTrain) {
    return [{ TrainDate: date, TrainInfo: { TrainNo: trainNo }, StopTimes: dailyTrain.StopTimes }];
  }

  try {
    if (!_thsrTimetableCache) {
      const res = await fetch('/data/thsr-timetable.json');
      _thsrTimetableCache = await res.json();
    }

    const list = Array.isArray(_thsrTimetableCache) ? _thsrTimetableCache : (_thsrTimetableCache.TrainTimetables || []);
    const item = list.find((item: any) => {
      const t = item.GeneralTimetable || item;
      const info = t.GeneralTrainInfo || t.TrainInfo;
      return info?.TrainNo === trainNo;
    });

    if (item) {
      const t = item.GeneralTimetable || item;
      return [{
        TrainDate: date,
        TrainInfo: { TrainNo: trainNo },
        StopTimes: t.StopTimes
      }];
    }
  } catch (error) {
    console.warn(`遠端獲取高鐵車次 ${trainNo} ...`);
  }

  const url = `https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/DailyTimetable/TrainDate/${date}?$format=JSON`;
  const raw = await fetchTDXApi<any>(url);
  // v2 uses DailyTrainInfo; fall back to v3 mapper if shape differs.
  const v2list = unwrapArray<any>(raw).filter(t => t.DailyTrainInfo?.TrainNo === trainNo);
  if (v2list.length) {
    return v2list.map(t => ({
      TrainDate: t.TrainDate,
      TrainInfo: { TrainNo: t.DailyTrainInfo?.TrainNo || trainNo },
      StopTimes: (t.StopTimes || []).map((s: any) => ({
        ...s,
        DepartureTime: s.DepartureTime || s.ArrivalTime,
        ArrivalTime: s.ArrivalTime || s.DepartureTime,
      })),
    }));
  }
  return mapV3ToTrainTimetable(raw, date).filter(t => t.TrainInfo?.TrainNo === trainNo);
}
// --- Live Board ---
export interface RailLiveBoard {
  StationID: string;
  StationName?: { Zh_tw: string };
  TrainNo: string;
  Direction: number;
  TrainTypeID?: string;
  TrainTypeName?: { Zh_tw: string };
  ScheduledArrivalTime: string;
  ScheduledDepartureTime: string;
  DelayTime: number;
  Platform?: string;
}

/**
 * 台鐵車站即時到離站看板。直接請求全線單一 URL（`v2/Rail/TRA/LiveBoard`）再於前端依
 * `StationID` 篩選，讓所有車站與不同 Vercel Function 實例共用同一筆 Edge CDN 快取（壓縮後 ~25 KB）。
 */
export async function getTRALiveBoard(stationId: string): Promise<RailLiveBoard[]> {
  const raw = await fetchTDXApi<any>('https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/LiveBoard?$format=JSON');
  const id = String(stationId);
  return unwrapArray<RailLiveBoard>(raw).filter((row) => String(row?.StationID ?? '') === id);
}

/**
 * 台鐵全線列車即時誤點（v2 LiveTrainDelay，TDX 每 2 分鐘更新）。
 * 車站 LiveBoard 只列「即將到站」的車；這份涵蓋全線所有運行中的列車，
 * 已駛離起站或還在遠方的車次也查得到誤點。整份一個 URL，所有查詢共用同一筆 proxy/CDN 快取。
 * 失敗時 fetchTDXApi 回 []，UI 就不顯示誤點。
 */
export interface RailLiveTrainDelay {
  TrainNo: string;
  StationID?: string;
  StationName?: { Zh_tw?: string; En?: string };
  DelayTime: number;
  SrcUpdateTime?: string;
  UpdateTime?: string;
}

export async function getTRALiveTrainDelay(): Promise<RailLiveTrainDelay[]> {
  const raw = await fetchTDXApi<any>('https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/LiveTrainDelay?$format=JSON');
  return unwrapArray<RailLiveTrainDelay>(raw);
}

/**
 * 高鐵對號座剩餘座位。今天先用整份車站看板（AvailableSeatStatusList，一個共用 URL）；
 * 看板只列即將發車的班次，`upcomingTrainNos` 裡若有看板沒有的車次，再打今天的 OD 端點補上。
 * 其他日期直接用 OD 端點。解析見 thsrSeats.ts；失敗時 fetchTDXApi 回 []，即不顯示座位。
 */
export async function getTHSRSeatStatus(
  originId: string,
  destId: string,
  date: string,
  isToday: boolean,
  upcomingTrainNos: readonly string[] = [],
): Promise<ThsrSeatResult> {
  const fromOD = async () => seatsFromOD(
    await fetchTDXApi<any>(`https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/AvailableSeatStatus/Train/OD/${originId}/to/${destId}/TrainDate/${date}?$format=JSON`),
    originId,
    destId,
  );
  if (!isToday) return fromOD();

  const board = seatsFromStationBoard(
    await fetchTDXApi<any>('https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/AvailableSeatStatusList?$format=JSON'),
    originId,
    destId,
  );
  if (missingSeatTrains(board, upcomingTrainNos).length === 0) return board;
  const fill = await fromOD().catch(() => null);
  return mergeSeatResults(board, fill);
}

export async function getTHSRLiveBoard(_stationId: string): Promise<RailLiveBoard[]> {
  // TDX does not publish a THSR LiveBoard endpoint (both v2 and v3 return 404).
  // THSR schedules are fixed; UI falls back to timetable data.
  return [];
}

// --- Nearest YouBike (Taipei YouBike2.0 realtime, via /api/youbike proxy) ---
export interface YouBikeStation {
  name: string;
  nameEn: string;
  lat: number | null;
  lng: number | null;
  bikes: number;   // 可借車輛
  docks: number;   // 可還空位
  total: number;
  distance: number; // 公尺
  updateTime: string | null;
  act: string;
}

/**
 * Nearest dock, or null when there is none within range. A failed lookup throws
 * instead, so the card can say "unavailable" rather than "no dock nearby".
 */
export async function getNearestYouBike(lat: number, lon: number): Promise<YouBikeStation | null> {
  const headers = await liveGatewayHeaders();
  const res = await fetch(`/api/youbike?lat=${lat}&lon=${lon}`, {
    headers,
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`YouBike lookup failed: ${res.status}`);
  const j = await res.json();
  if (j?.error) throw new Error(`YouBike lookup failed: ${j.error}`);
  return (j?.station as YouBikeStation) ?? null;
}

// --- Nearby Bus Stops ---
export interface BusRoute {
  /** City-prefixed id (e.g. TPE10132). */
  RouteUID?: string;
  RouteID: string;
  RouteName: { Zh_tw: string; En?: string };
}

export interface BusStation {
  StationID: string;
  StationUID: string;
  StationName: { Zh_tw: string; En?: string };
  StationAddress?: string;
  Stops?: BusRoute[];
  Distance?: number;
}

export async function getNearbyBusStops(
  lat: number,
  lon: number,
  fresh = false,
): Promise<BusStation[]> {
  try {
    // NearBy 屬於 TDX 的 advanced 服務層，掛在 basic/ 下會 404。
    const url = `https://tdx.transportdata.tw/api/advanced/v2/Bus/Station/NearBy?$spatialFilter=nearby(${lat},${lon},500)&$format=JSON`;
    const data = await fetchTDXApi<any>(url, { fresh });
    const arr = unwrapArray<any>(data);
    
    if (arr && arr.length > 0) {
      const stations: BusStation[] = arr.map((item: any) => {
        // Keyed by RouteUID (city-prefixed): a stop near a city boundary can serve
        // two different routes that share a bare RouteID.
        const stopsMap = new Map<string, { RouteUID?: string; RouteID: string; RouteName: { Zh_tw: string } }>();
        if (Array.isArray(item.Stops)) {
          item.Stops.forEach((stop: any) => {
            const rName = stop.RouteName?.Zh_tw || stop.RouteName?.En || stop.RouteID;
            const key = stop.RouteUID || stop.RouteID;
            if (rName && key) {
              stopsMap.set(key, { RouteUID: stop.RouteUID || undefined, RouteID: stop.RouteID, RouteName: { Zh_tw: rName } });
            }
          });
        }

        const stopsList = Array.from(stopsMap.values());

        return {
          StationID: item.StationID || item.StationUID,
          StationUID: item.StationUID,
          StationName: {
            Zh_tw: item.StationName?.Zh_tw || item.StationName?.En || '公車站',
            En: item.StationName?.En
          },
          StationAddress: item.StationAddress,
          Stops: stopsList,
          Distance: item.Distance
        };
      });
      return stations;
    }
  } catch (error) {
    console.warn('Failed to fetch bus stops:', error);
  }

  return [];
}

// --- MaaS Cross-modal Routing (跨運具旅運規劃, /api/maas/routing) ---
// Coordinate-based door-to-door journey planning. Unlike timetables, this is
// inherently live (no static-data fallback) and rides the existing TDX proxy.

/** TDX transit mode codes. */
export type TransitMode = 3 | 4 | 5 | 6 | 7 | 8 | 9 | 20; // HSR, rail, bus, MRT, LRT, ferry, cable car, air
/** First/last-mile mode codes. */
export type MileMode = 0 | 1 | 2 | 3; // walk, bike, car, shared-bike

export interface LatLon { lat: number; lon: number }

export interface RoutingParams {
  origin: LatLon;
  destination: LatLon;
  /** 0 = cheapest fare … 1 = shortest time (default 1). */
  gc?: number;
  /** Number of routes (1–10, default 5). */
  top?: number;
  /** Modes to include (default rail + HSR + bus + MRT + LRT). */
  transit?: TransitMode[];
  /** Departure time, Taipei TZ: yyyy-mm-ddTHH:mm:ss. Mutually exclusive with arrival. */
  depart?: string;
  /** Arrival time, Taipei TZ: yyyy-mm-ddTHH:mm:ss. */
  arrival?: string;
  firstMileMode?: MileMode;
  firstMileTime?: number;
  lastMileMode?: MileMode;
  lastMileTime?: number;
  /** Acceptable transfer window [min,max] minutes (0–60). */
  transferTime?: [number, number];
}

/**
 * One normalized leg of a journey. The raw TDX `sections` shape is
 * under-documented (the OAS ships it empty), so we map defensively across the
 * likely field aliases and keep `raw` for anything not yet mapped.
 * Reconcile field names against `npm run probe-routing` output.
 */
export interface RouteLeg {
  mode: string;        // raw mode code as returned ('0' walk, '4' rail, …)
  modeLabel?: string;  // human label if present
  lineName?: string;   // line / route / train name (自強號, 板南線, 307…)
  fromName?: string;
  toName?: string;
  departTime?: string;
  arriveTime?: string;
  durationSec?: number;
  fare?: number;
  /** Booking deeplink identifier returned for TRA/THSR routing sections. */
  bookingUuid?: string;
  raw: any;
}

export interface RouteResult {
  travelTimeSec: number;
  startTime: string;
  endTime: string;
  transfers: number;
  legs: RouteLeg[];
  raw: any;
}

function numOrUndef(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** TDX may return `sections` as an array or an index-keyed object. */
function sectionsToArray(sections: any): any[] {
  if (Array.isArray(sections)) return sections;
  if (sections && typeof sections === 'object') return Object.values(sections);
  return [];
}

/**
 * Coerce a value that may be a string, number, or a TDX bilingual/name object
 * (e.g. { Zh_tw, En } or { name }) into a display string. Prevents the
 * "[object Object]" render when a leg field is an object rather than a string.
 */
function toText(v: any): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    return toText(v.Zh_tw ?? v.zh_tw ?? v.Zh ?? v.En ?? v.en ?? v.name ?? v.Name ?? v.title);
  }
  return undefined;
}

/** First candidate that resolves to a non-empty string. */
function pickName(...cands: any[]): string | undefined {
  for (const c of cands) {
    const t = toText(c);
    if (t) return t;
  }
  return undefined;
}

function normalizeLeg(s: any): RouteLeg {
  // TDX MaaS shape: each section has `type` ('transit'|'drive'|'walk'|…), a
  // nested `transport` object, and `departure`/`arrival` { time, place }.
  // Older defensive aliases (s.start, s.line_name, …) are kept as fallbacks.
  const t = s.transport ?? {};
  const dep = s.departure ?? s.start ?? s.from ?? s.origin ?? {};
  const arr = s.arrival ?? s.end ?? s.to ?? s.destination ?? {};
  const depPlace = dep.place ?? dep;
  const arrPlace = arr.place ?? arr;

  // `type` is the coarse kind ('transit'|'drive'|'walk'); `transport.category`
  // / `transport.mode` carries the specific rail mode (TRA/THSR/MRT/BUS/LRT).
  // For transit legs prefer the specific mode; otherwise use the coarse kind so
  // drive/walk legs get a Car/Walk icon instead of a brand code (e.g. "YOXI").
  const kind = pickName(s.type, s.mode, s.section_type);
  const sub = pickName(t.category, t.mode, t.type);
  const mode = (kind === 'transit' ? sub || kind : kind || sub) ?? '';

  const fareN = numOrUndef(t.fareTW ?? t.fare ?? s.fare ?? s.price ?? s.cost);

  return {
    mode,
    modeLabel: pickName(t.name, t.longName),
    lineName: pickName(
      t.shortName, t.name, t.longName, t.headsign, t.number,
      // legacy/defensive aliases
      s.line_name, s.route_name, s.transit_name, s.name, s.line, s.train_no,
    ),
    fromName: pickName(depPlace.name, depPlace.station_name, depPlace.stop_name, s.start_name, s.from_name),
    toName: pickName(arrPlace.name, arrPlace.station_name, arrPlace.stop_name, s.end_name, s.to_name),
    departTime: toText(dep.time ?? dep.departure_time ?? dep.depart_time ?? s.depart_time ?? s.start_time),
    arriveTime: toText(arr.time ?? arr.arrival_time ?? arr.arrive_time ?? s.arrive_time ?? s.end_time),
    durationSec: numOrUndef(s.travelSummary?.duration ?? s.travel_time ?? s.duration),
    // TDX returns fareTW: 0 when a leg isn't priced — treat 0 as "no fare".
    fare: fareN && fareN > 0 ? fareN : undefined,
    bookingUuid: pickName(t.uuid),
    raw: s,
  };
}

function normalizeRoute(r: any): RouteResult {
  return {
    travelTimeSec: numOrUndef(r.travel_time) ?? 0,
    startTime: r.start_time ?? '',
    endTime: r.end_time ?? '',
    transfers: numOrUndef(r.transfers) ?? 0,
    legs: sectionsToArray(r.sections).map(normalizeLeg),
    raw: r,
  };
}

/** Extract `{lat,lon}` from a station's committed position, or null. */
export function stationCoord(s: Station): LatLon | null {
  const p = s.StationPosition;
  if (!p || typeof p.PositionLat !== 'number' || typeof p.PositionLon !== 'number') return null;
  return { lat: p.PositionLat, lon: p.PositionLon };
}

const DEFAULT_TRANSIT: TransitMode[] = [3, 4, 5, 6, 7];

export async function getRouting(params: RoutingParams): Promise<RouteResult[]> {
  const qs = new URLSearchParams();
  qs.set('origin', `${params.origin.lat},${params.origin.lon}`);
  qs.set('destination', `${params.destination.lat},${params.destination.lon}`);
  qs.set('gc', String(params.gc ?? 1));
  qs.set('top', String(params.top ?? 5));
  qs.set('transit', (params.transit ?? DEFAULT_TRANSIT).join(','));
  if (params.depart) qs.set('depart', params.depart);
  if (params.arrival) qs.set('arrival', params.arrival);
  if (params.firstMileMode != null) qs.set('first_mile_mode', String(params.firstMileMode));
  if (params.firstMileTime != null) qs.set('first_mile_time', String(params.firstMileTime));
  if (params.lastMileMode != null) qs.set('last_mile_mode', String(params.lastMileMode));
  if (params.lastMileTime != null) qs.set('last_mile_time', String(params.lastMileTime));
  if (params.transferTime) qs.set('transfer_time', params.transferTime.join(','));

  const url = `https://tdx.transportdata.tw/api/maas/routing?${qs.toString()}`;
  const raw = await fetchTDXApi<any>(url);
  const routes = raw?.data?.routes ?? raw?.routes ?? [];
  return Array.isArray(routes) ? routes.map(normalizeRoute) : [];
}

export interface TRABookingDeepLinkParams {
  startStation: string;
  endStation: string;
  trainDate: string;
  trainNumber: string;
}

export interface HSRBookingDeepLinkParams extends TRABookingDeepLinkParams {
  trainTime: string;
}

function findBookingDeepLink(value: unknown): string | null {
  if (typeof value === 'string') {
    return /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findBookingDeepLink(item);
      if (found) return found;
    }
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      const found = findBookingDeepLink(item);
      if (found) return found;
    }
  }
  return null;
}

/**
 * TDX hosts the two 城際運輸票務整合 modules on their *own* bases — `maas` only
 * serves `/routing`, so booking calls must go to `maas-tra` / `maas-thsr` or TDX
 * 404s (which used to silently degrade every booking tap to the web fallback).
 */
const BOOKING_BASE = { tra: 'maas-tra', hsr: 'maas-thsr' } as const;

/** Official web booking pages — used wherever the app deeplink does not apply. */
export const WEB_BOOKING_URL = {
  tra: 'https://www.railway.gov.tw/tra-tip-web/tip/tip001/tip123/query',
  hsr: 'https://irs.thsrc.com.tw/IMINT/',
} as const;

async function requestBookingDeepLink(
  agency: 'tra' | 'hsr',
  mode: 'url' | 'direct',
  query: URLSearchParams,
): Promise<string> {
  const headers = await liveGatewayHeaders();
  const path = `${BOOKING_BASE[agency]}/booking/deeplink/${mode}/${agency}`;
  const response = await fetch(`/api/tdx/${path}?${query.toString()}`, {
    headers,
    credentials: 'include',
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => null);
  const url = findBookingDeepLink(payload);

  if (!response.ok || !url) {
    // Keep the status: 404 = wrong path, 401 = key not approved for the module,
    // 200-without-url = unexpected payload shape. They need different fixes.
    throw new Error(
      typeof payload?.error?.msg === 'string'
        ? `${response.status} ${payload.error.msg}`
        : `booking deeplink failed (HTTP ${response.status})`,
    );
  }
  return url;
}

/** Resolve a booking UUID returned by the MaaS routing API into a TRA app link. */
export function getTRABookingDeepLinkByUuid(uuid: string): Promise<string> {
  const query = new URLSearchParams({ uuid });
  return requestBookingDeepLink('tra', 'url', query);
}

/** Resolve a booking UUID returned by the MaaS routing API into a T-EX app link. */
export function getHSRBookingDeepLinkByUuid(uuid: string): Promise<string> {
  const query = new URLSearchParams({ uuid });
  return requestBookingDeepLink('hsr', 'url', query);
}

/** Request a short-lived Taiwan Railways e-booking app deeplink through TDX OAuth. */
export async function getTRABookingDeepLink(params: TRABookingDeepLinkParams): Promise<string> {
  const query = new URLSearchParams({
    start_station: params.startStation,
    end_station: params.endStation,
    train_date: params.trainDate,
    train_number: params.trainNumber,
  });
  return requestBookingDeepLink('tra', 'direct', query);
}

/** Request a short-lived Taiwan HSR T-EX app deeplink through TDX OAuth. */
export async function getHSRBookingDeepLink(params: HSRBookingDeepLinkParams): Promise<string> {
  const query = new URLSearchParams({
    start_station: params.startStation.replace(/臺/g, '台'),
    end_station: params.endStation.replace(/臺/g, '台'),
    train_date: params.trainDate,
    train_time: params.trainTime,
    train_number: params.trainNumber,
  });
  return requestBookingDeepLink('hsr', 'direct', query);
}

// --- Geocoding (place name → coordinates, via /api/geocode proxy) ---
// Lets the trip planner accept arbitrary destinations, not just stations.
export interface GeoPlace {
  name: string;
  detail?: string;
  lat: number;
  lon: number;
}

export async function geocodePlace(q: string, lang = 'zh-TW'): Promise<GeoPlace[]> {
  if (q.trim().length < 2) return [];
  try {
    const headers = await liveGatewayHeaders();
    const res = await fetch(
      `/api/geocode?q=${encodeURIComponent(q)}&lang=${encodeURIComponent(lang)}`,
      { headers, credentials: 'include' },
    );
    if (!res.ok) return [];
    const j = await res.json();
    return Array.isArray(j?.results) ? (j.results as GeoPlace[]) : [];
  } catch {
    return [];
  }
}
