// --- Request cache + in-flight dedup ---
type CacheEntry<T> = { data: T; expiresAt: number };
const requestCache = new Map<string, CacheEntry<any>>();
const inFlight = new Map<string, Promise<any>>();

function getCacheTTL(url: string): number {
  if (url.includes('LiveBoard')) return 30_000;          // 30 s live board
  if (url.includes('Alert'))    return 5 * 60_000;       // 5 min alerts
  if (url.includes('Station?') || url.includes('Station?$format')) return 24 * 3600_000; // 24 h stations
  return 90_000;                                         // 90 s timetables / fares
}

// Unwrap TDX envelope objects that may wrap arrays under various keys
function unwrapArray<T>(payload: any): T[] {
  if (Array.isArray(payload)) return payload as T[];
  // Common TDX envelope keys
  for (const key of ['TrainTimetables', 'ODFares', 'LiveBoards', 'Stations', 'Fares', 'Alerts']) {
    if (Array.isArray(payload?.[key])) return payload[key] as T[];
  }
  return [] as T[];
}

export async function fetchTDXApi<T>(url: string): Promise<T> {
  const now = Date.now();
  console.log(`[TDX Request] Original: ${url}`);
  
  // Transform full TDX URL to relative proxy URL
  const proxyUrl = url.replace('https://tdx.transportdata.tw/api', '/api/tdx');
  console.log(`[TDX Request] Proxy: ${proxyUrl}`);

  const cached = requestCache.get(proxyUrl);
  if (cached && cached.expiresAt > now) return cached.data as T;

  const existing = inFlight.get(proxyUrl);
  if (existing) return existing as Promise<T>;

  const task = (async (): Promise<T> => {
    try {
      const response = await fetch(proxyUrl, {
        headers: { 'Accept': 'application/json' },
      });

      if (response.status === 429) {
        if (cached) return cached.data as T;
        return getMockData<T>(url);
      }

      if (!response.ok) {
        if (cached) return cached.data as T;
        return getMockData<T>(url);
      }

      const data = await response.json() as T;
      requestCache.set(proxyUrl, { data, expiresAt: Date.now() + getCacheTTL(url) });
      return data;
    } catch (error) {
      if (cached) return cached.data as T;
      console.error('TDX Proxy Fetch Error:', error);
      return getMockData<T>(url);
    }
  })();

  inFlight.set(proxyUrl, task);
  try {
    return await task;
  } finally {
    inFlight.delete(proxyUrl);
  }
}

// --- Mock Data ---
function getMockData<T>(url: string): T {
  if (url.includes('TRA/Station')) {
    return [
      { StationID: '1000', StationName: { Zh_tw: '臺北', En: 'Taipei' } },
      { StationID: '1060', StationName: { Zh_tw: '板橋', En: 'Banqiao' } },
      { StationID: '3300', StationName: { Zh_tw: '新竹', En: 'Hsinchu' } },
      { StationID: '4220', StationName: { Zh_tw: '臺中', En: 'Taichung' } },
      { StationID: '6000', StationName: { Zh_tw: '高雄', En: 'Kaohsiung' } },
    ] as any;
  }
  if (url.includes('THSR/Station')) {
    return [
      { StationID: '0990', StationName: { Zh_tw: '南港', En: 'Nangang' } },
      { StationID: '1000', StationName: { Zh_tw: '台北', En: 'Taipei' } },
      { StationID: '1070', StationName: { Zh_tw: '左營', En: 'Zuoying' } },
    ] as any;
  }
  if (url.includes('Timetable/OD') || url.includes('TrainTimetable/OD')) {
    const isHsr = url.includes('THSR');
    return Array.from({ length: 12 }).map((_, i) => {
      const depHour = 6 + i;
      const durMinutes = isHsr ? 90 + (i % 3) * 15 : 180 + (i % 5) * 20;
      const arrHour = depHour + Math.floor(durMinutes / 60);
      const arrMin = durMinutes % 60;
      return {
        TrainDate: new Date().toISOString().split('T')[0],
        DailyTrainInfo: {
          TrainNo: isHsr ? (600 + i * 11).toString() : (100 + i * 13).toString(),
          TrainTypeID: isHsr ? '1' : (i % 2 === 0 ? '1100' : '1131'),
          TrainTypeName: { Zh_tw: isHsr ? '高鐵' : (i % 2 === 0 ? '自強號' : '區間車') },
          Direction: i % 2,
          TripLine: isHsr ? 0 : (i % 4),
          WheelchairFlag: i % 2,
          BikeFlag: i % 3 === 0 ? 1 : 0,
          Note: { Zh_tw: i % 5 === 0 ? '每日行駛' : '' }
        },
        OriginStopTime: { DepartureTime: `${depHour.toString().padStart(2, '0')}:00` },
        DestinationStopTime: { ArrivalTime: `${arrHour.toString().padStart(2, '0')}:${arrMin.toString().padStart(2, '0')}` },
      };
    }) as any;
  }
  if (url.includes('ODFare')) {
    if (url.includes('THSR')) {
      return [{
        Fares: [
          { TicketType: '標準座-全票', FareClass: 1, CabinClass: 1, Price: 1490 },
          { TicketType: '商務座-全票', FareClass: 1, CabinClass: 2, Price: 2440 },
          { TicketType: '自由座-全票', FareClass: 1, CabinClass: 3, Price: 1445 }
        ]
      }] as any;
    }
    return [
      { TrainType: 3, Fares: [{ TicketType: '成人', Price: 843 }] },
      { TrainType: 6, Fares: [{ TicketType: '成人', Price: 469 }] },
    ] as any;
  }
  if (url.includes('LiveBoard')) {
    return [] as any; // Return empty so no fake delays are shown
  }
  if (url.includes('Alert')) {
    return [] as any;
  }
  return [] as any;
}

// --- Interfaces ---
export interface Station {
  StationID: string;
  StationName: { Zh_tw: string; En: string };
}

export async function getTRAStations(): Promise<Station[]> {
  try {
    const raw = await fetchTDXApi<any>('https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/Station?$format=JSON');
    if (raw?.Stations) return raw.Stations;
    return unwrapArray<Station>(raw);
  } catch (error) {
    const v2raw = await fetchTDXApi<any>('https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/Station?$format=JSON');
    return unwrapArray<Station>(v2raw);
  }
}

export async function getTHSRStations(): Promise<Station[]> {
  const raw = await fetchTDXApi<any>('https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/Station?$format=JSON');
  return unwrapArray<Station>(raw);
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
    // Handle both V3 (TrainInfo) and V2/Mock (DailyTrainInfo) structures
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
        WheelchairFlag: info?.WheelchairFlag || 0,
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

export async function getTRATimetableOD(originId: string, destId: string, date: string): Promise<DailyTimetableOD[]> {
  const url = `https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/DailyTrainTimetable/OD/${originId}/to/${destId}/${date}?$format=JSON`;
  const raw = await fetchTDXApi<any>(url);
  const mapped = mapV3ToOD(raw, date);
  if (mapped.length > 0) return mapped;
  // v3 returned nothing (404/empty) – fall back to v2
  const v2raw = await fetchTDXApi<any>(`https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/DailyTimetable/OD/${originId}/to/${destId}/${date}?$format=JSON`);
  return unwrapArray<DailyTimetableOD>(v2raw);
}

export async function getTHSRTimetableOD(originId: string, destId: string, date: string): Promise<DailyTimetableOD[]> {
  const raw = await fetchTDXApi<any>(`https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/DailyTimetable/OD/${originId}/to/${destId}/${date}?$format=JSON`);
  return unwrapArray<DailyTimetableOD>(raw);
}

// --- Fares ---
export interface Fare { TicketType: string | number; Price?: number; Fare?: number; CabinClass?: number; FareClass?: number; }
export interface TRAODFare { OriginStationID: string; DestinationStationID: string; Direction: number; TrainType: number; Fares: Fare[] }
export interface THSRODFare { OriginStationID: string; DestinationStationID: string; Direction: number; Fares: Fare[] }

export async function getTRAODFare(originId: string, destId: string): Promise<TRAODFare[]> {
  const url = `https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/ODFare/${originId}/to/${destId}?$format=JSON`;
  try {
    const raw = await fetchTDXApi<any>(url);
    if (raw?.ODFares) return raw.ODFares;
    return unwrapArray<TRAODFare>(raw);
  } catch (error) {
    const v2raw = await fetchTDXApi<any>(`https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/ODFare/${originId}/to/${destId}?$format=JSON`);
    return unwrapArray<TRAODFare>(v2raw);
  }
}
export async function getTHSRODFare(originId: string, destId: string): Promise<THSRODFare[]> {
  const raw = await fetchTDXApi<any>(`https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/ODFare/${originId}/to/${destId}?$format=JSON`);
  return unwrapArray<THSRODFare>(raw);
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
    return {
      TrainDate: t.TrainDate || date,
      TrainInfo: { TrainNo: info?.TrainNo || '' },
      StopTimes: (t.StopTimes || []).map((s: any) => ({
        ...s,
        SuspendedFlag: s.SuspendedFlag || 0
      })) as StopTime[],
    };
  });
}

export async function getTRATrainTimetable(trainNo: string, date: string): Promise<TrainTimetable[]> {
  // 🛡️ 防呆機制：如果是未知車次，直接中斷不打 API
  if (!trainNo || trainNo === 'Unknown') {
    return [];
  }

  // 1. 優先使用 V3 指定車次的 API 節省頻寬與運算資源
  try {
    const url = `https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/DailyTrainTimetable/TrainNo/${trainNo}/TrainDate/${date}?$format=JSON`;
    const raw = await fetchTDXApi<any>(url);
    
    // V3 單一車次回傳可能跟 V3 每日清單格式相似，以 mapV3ToTrainTimetable 轉接
    const allTrains = mapV3ToTrainTimetable(raw, date);
    if (allTrains.length > 0) {
      return allTrains;
    }
  } catch (error) {
    console.warn(`V3 指定車次 API 失敗 (${trainNo})，嘗試使用 fallback`, error);
  }

  // 若 V3 失敗，回退至 V2 舊版 API 嘗試
  try {
    const v2raw = await fetchTDXApi<any>(`https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/DailyTimetable/TrainNo/${trainNo}/TrainDate/${date}?$format=JSON`);
    return unwrapArray<TrainTimetable>(v2raw);
  } catch (error) {
    console.error("取得台鐵停靠站失敗:", error);
    return [];
  }
}

export async function getTHSRTrainTimetable(trainNo: string, date: string): Promise<TrainTimetable[]> {
  // 1. 抓取當日「全部」高鐵車次 (這筆請求會被 fetchTDXApi 自動快取)
  const url = `https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/DailyTimetable/TrainDate/${date}?$format=JSON`;
  const raw = await fetchTDXApi<any>(url);
  const allTrains = unwrapArray<any>(raw);
  
  // 2. 在前端 JavaScript 直接過濾出我們要的車次，不再觸發 TDX 的 $filter 運算
  return allTrains.filter(t => t.DailyTrainInfo?.TrainNo === trainNo);
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

export async function getTRALiveBoard(stationId: string): Promise<RailLiveBoard[]> {
  try {
    const raw = await fetchTDXApi<any>(`https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/LiveBoard/Station/${stationId}?$format=JSON`);
    if (raw?.LiveBoards) return raw.LiveBoards;
    return unwrapArray<RailLiveBoard>(raw);
  } catch (error) {
    const v2raw = await fetchTDXApi<any>(`https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/LiveBoard/Station/${stationId}?$format=JSON`);
    return unwrapArray<RailLiveBoard>(v2raw);
  }
}

export async function getTHSRLiveBoard(stationId: string): Promise<RailLiveBoard[]> {
  // THSR per-station LiveBoard endpoint returns 404; fetch general board and filter client-side.
  const raw = await fetchTDXApi<any>('https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/LiveBoard?$format=JSON');
  const all = unwrapArray<RailLiveBoard>(raw);
  return stationId ? all.filter(b => b.StationID === stationId) : all;
}

// --- Alerts ---
export interface RailAlert { AlertID: string; Title: string; Description: string; AlertTime: string; Level: number }

export async function getTRAAlerts(): Promise<RailAlert[]> {
  const raw = await fetchTDXApi<any>('https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/Alert?$format=JSON');
  return unwrapArray<RailAlert>(raw);
}
export async function getTHSRAlerts(): Promise<RailAlert[]> {
  const raw = await fetchTDXApi<any>('https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/Alert?$format=JSON');
  return unwrapArray<RailAlert>(raw);
}