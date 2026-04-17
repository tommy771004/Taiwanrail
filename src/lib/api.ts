// ---------------------------------------------------------------------------
// TDX API client — proxy edition
//
// All requests go through /api/tdx/... (Vercel serverless function or local
// Express proxy in server.ts).  No tokens, no secrets, no CORS issues.
// ---------------------------------------------------------------------------

// --- Request cache + in-flight dedup ---
type CacheEntry<T> = { data: T; expiresAt: number };
const requestCache = new Map<string, CacheEntry<any>>();
const inFlight = new Map<string, Promise<any>>();

function getCacheTTL(url: string): number {
  if (url.includes('LiveBoard')) return 30_000;          // 30 s live board
  if (url.includes('Alert'))    return 5 * 60_000;       // 5 min alerts
  if (url.includes('/Station')) return 24 * 3600_000;    // 24 h stations
  return 90_000;                                         // 90 s timetables / fares
}

// Unwrap TDX envelope objects that may wrap arrays under various keys
function unwrapArray<T>(payload: any): T[] {
  if (Array.isArray(payload)) return payload as T[];
  for (const key of ['TrainTimetables', 'ODFares', 'LiveBoards', 'Stations', 'Fares', 'Alerts']) {
    if (Array.isArray(payload?.[key])) return payload[key] as T[];
  }
  return [] as T[];
}

// ---------------------------------------------------------------------------
// Convert a full TDX URL into a relative /api/tdx/... proxy URL.
// e.g. https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/Station?$format=JSON
//   → /api/tdx/basic/v2/Rail/TRA/Station?$format=JSON
// ---------------------------------------------------------------------------
function toProxyUrl(tdxUrl: string): string {
  // Strip the TDX origin prefix; keep everything from /api/ onward
  const match = tdxUrl.match(/https?:\/\/tdx\.transportdata\.tw\/api(\/.*)/);
  if (!match) return tdxUrl; // fallback — shouldn't happen
  return `/api/tdx${match[1]}`;
}

// ---------------------------------------------------------------------------
// Concurrency Limiter (prevents Vercel serverless stampede triggering TDX 429)
// ---------------------------------------------------------------------------
class ConcurrencyQueue {
  private activeCount = 0;
  private queue: (() => void)[] = [];

  constructor(private maxConcurrent: number) {}

  async enqueue(): Promise<void> {
    if (this.activeCount >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.activeCount++;
  }

  dequeue() {
    this.activeCount--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) next();
    }
  }
}
const requestQueue = new ConcurrencyQueue(3); // Max 3 concurrent upstream fetches

export async function fetchTDXApi<T>(tdxUrl: string): Promise<T> {
  const proxyUrl = toProxyUrl(tdxUrl);
  const now = Date.now();
  const cached = requestCache.get(proxyUrl);
  if (cached && cached.expiresAt > now) return cached.data as T;

  const existing = inFlight.get(proxyUrl);
  if (existing) return existing as Promise<T>;

  const task = (async (): Promise<T> => {
    // Wait in queue before establishing the actual fetch to prevent thundering herds
    await requestQueue.enqueue();

    try {
      const response = await fetch(proxyUrl, {
        headers: { 'Accept': 'application/json' },
      });

      if (response.status === 429) {
        if (cached) return cached.data as T;
        console.warn(`TDX 429 速率限制: ${proxyUrl.split('?')[0].split('/').slice(-3).join('/')}`);
        const mock = getMockData<T>(tdxUrl);
        // Temporarily cache the mock data for 10 seconds to stop rapid re-fetches
        requestCache.set(proxyUrl, { data: mock, expiresAt: Date.now() + 10_000 });
        return mock;
      }

      if (!response.ok) {
        if (cached) return cached.data as T;
        console.warn(`TDX ${response.status}: ${proxyUrl.split('?')[0].split('/').slice(-3).join('/')}`);
        const mock = getMockData<T>(tdxUrl);
        requestCache.set(proxyUrl, { data: mock, expiresAt: Date.now() + 10_000 });
        return mock;
      }

      const data = await response.json() as T;
      requestCache.set(proxyUrl, { data, expiresAt: Date.now() + getCacheTTL(proxyUrl) });
      return data;
    } catch (error) {
      if (cached) return cached.data as T;
      console.error('TDX 請求錯誤:', error);
      const mock = getMockData<T>(tdxUrl);
      requestCache.set(proxyUrl, { data: mock, expiresAt: Date.now() + 10_000 });
      return mock;
    } finally {
      requestQueue.dequeue();
    }
  })();

  inFlight.set(proxyUrl, task);
  try {
    return await task;
  } finally {
    inFlight.delete(proxyUrl);
  }
}

// --- Mock Data (fallback when proxy is unavailable) ---
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
    return [] as any;
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
  const raw = await fetchTDXApi<any>('https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/Station?$format=JSON');
  return unwrapArray<Station>(raw);
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

function mapV3ToOD(payload: any, date: string): DailyTimetableOD[] {
  const list: V3TrainOD[] = Array.isArray(payload) ? payload : (payload?.TrainTimetables ?? []);
  return list.map(t => {
    const stops = t.StopTimes || [];
    const originStop = t.OriginStopTime ?? (stops.length ? { DepartureTime: stops[0].DepartureTime } : { DepartureTime: '' });
    const destStop   = t.DestinationStopTime ?? (stops.length ? { ArrivalTime: stops[stops.length - 1].ArrivalTime || stops[stops.length - 1].DepartureTime } : { ArrivalTime: '' });
    return {
      OriginStationID: stops[0]?.StationID || '',
      OriginStationName: { Zh_tw: stops[0]?.StationName?.Zh_tw || '' },
      DestinationStationID: stops[stops.length - 1]?.StationID || '',
      DestinationStationName: { Zh_tw: stops[stops.length - 1]?.StationName?.Zh_tw || '' },
      TrainDate: date,
      DailyTrainInfo: {
        TrainNo: t.TrainInfo?.TrainNo || '',
        TrainTypeID: t.TrainInfo?.TrainTypeID || '',
        TrainTypeName: { Zh_tw: t.TrainInfo?.TrainTypeName?.Zh_tw || '' },
        StartingStationName: { Zh_tw: t.TrainInfo?.StartingStationName?.Zh_tw || '' },
        EndingStationName: { Zh_tw: t.TrainInfo?.EndingStationName?.Zh_tw || '' },
        Note: { Zh_tw: t.TrainInfo?.Note?.Zh_tw || '' },
        WheelchairFlag: t.TrainInfo?.WheelchairFlag || 0,
        BreastFeedingFlag: t.TrainInfo?.BreastFeedingFlag || 0,
        BikeFlag: t.TrainInfo?.BikeFlag || 0,
        DiningFlag: t.TrainInfo?.DiningFlag || 0,
        ParenthoodFlag: t.TrainInfo?.ParenthoodFlag || 0,
        Direction: t.TrainInfo?.Direction,
        TripLine: t.TrainInfo?.TripLine,
        OverNightStationID: t.TrainInfo?.OverNightStationID,
      },
      OriginStopTime: { DepartureTime: originStop.DepartureTime || '' },
      DestinationStopTime: { ArrivalTime: destStop.ArrivalTime || '' },
    } as DailyTimetableOD;
  });
}

export async function getTRATimetableOD(originId: string, destId: string, date: string): Promise<DailyTimetableOD[]> {
  const url = `https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/DailyTrainTimetable/OD/${originId}/to/${destId}/${date}?$format=JSON`;
  const raw = await fetchTDXApi<any>(url);
  const mapped = mapV3ToOD(raw, date);
  if (mapped.length > 0) return mapped;
  // v3 returned nothing — fall back to v2
  const v2raw = await fetchTDXApi<any>(`https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/DailyTimetable/OD/${originId}/to/${destId}/${date}?$format=JSON`);
  return unwrapArray<DailyTimetableOD>(v2raw);
}

export async function getTHSRTimetableOD(originId: string, destId: string, date: string): Promise<DailyTimetableOD[]> {
  const raw = await fetchTDXApi<any>(`https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/DailyTimetable/OD/${originId}/to/${destId}/${date}?$format=JSON`);
  return unwrapArray<DailyTimetableOD>(raw);
}

// --- Fares ---
export interface Fare { TicketType: string; Price?: number; Fare?: number; CabinClass?: number; FareClass?: number; }
export interface TRAODFare { OriginStationID: string; DestinationStationID: string; Direction: number; TrainType: number; Fares: Fare[] }
export interface THSRODFare { OriginStationID: string; DestinationStationID: string; Direction: number; Fares: Fare[] }

// TRA TrainType (TDX ODFare) mapping:
//   1: 太魯閣, 2: 普悠瑪, 3: 自強號(含 EMU3000), 4: 莒光號,
//   5: 復興號, 6: 區間車/區間快, 7: 普快, 10: 觀光/騰雲座艙
export function getTRAFareTypeKey(trainTypeId: string, trainTypeName: string = ''): string {
  const name = trainTypeName || '';
  const id = trainTypeId || '';

  if (name.includes('太魯閣')) return '1';
  if (name.includes('普悠瑪')) return '2';
  if (name.includes('自強')) return '3';
  if (name.includes('莒光')) return '4';
  if (name.includes('復興')) return '5';
  if (name.includes('區間')) return '6';
  if (name.includes('普快')) return '7';
  if (name.includes('觀光') || name.includes('郵輪')) return '10';

  if (id === '1140') return '1';
  if (id === '1150') return '2';
  if (id.startsWith('110')) return '3';
  if (id.startsWith('111')) return '4';
  if (id === '1120' || id === '1121') return '5';
  if (id.startsWith('113')) return '6';
  return '6';
}

export async function getTRAODFare(originId: string, destId: string): Promise<TRAODFare[]> {
  const raw = await fetchTDXApi<any>(`https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/ODFare/${originId}/to/${destId}?$format=JSON`);
  return unwrapArray<TRAODFare>(raw);
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
  const list: V3TrainOD[] = Array.isArray(payload) ? payload : (payload?.TrainTimetables ?? []);
  return list.map(t => ({
    TrainDate: date,
    TrainInfo: { TrainNo: t.TrainInfo?.TrainNo || '' },
    StopTimes: (t.StopTimes || []).map((s: any) => ({
      ...s,
      SuspendedFlag: s.SuspendedFlag
    })) as StopTime[],
  }));
}

export async function getTRATrainTimetable(trainNo: string, date: string): Promise<TrainTimetable[]> {
  if (!trainNo || trainNo === 'Unknown') return [];

  const v3Url = `https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/DailyTrainTimetable/TrainDate/${date}/TrainNo/${trainNo}?$format=JSON`;
  try {
    const raw = await fetchTDXApi<any>(v3Url);
    const mapped = mapV3ToTrainTimetable(raw, date);
    if (mapped.length > 0 && mapped[0].StopTimes.length > 0) return mapped;

    const v2raw = await fetchTDXApi<any>(`https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/DailyTimetable/TrainNo/${trainNo}/TrainDate/${date}?$format=JSON`);
    return unwrapArray<TrainTimetable>(v2raw);
  } catch (error) {
    console.error('取得台鐵停靠站失敗:', error);
    return [];
  }
}

export async function getTHSRTrainTimetable(trainNo: string, date: string): Promise<TrainTimetable[]> {
  const url = `https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/DailyTimetable/TrainDate/${date}?$format=JSON`;
  const raw = await fetchTDXApi<any>(url);
  const allTrains = unwrapArray<any>(raw);
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
  const raw = await fetchTDXApi<any>(`https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/LiveBoard/Station/${stationId}?$format=JSON`);
  return unwrapArray<RailLiveBoard>(raw);
}

export async function getTHSRLiveBoard(stationId: string): Promise<RailLiveBoard[]> {
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