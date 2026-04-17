export interface TDXToken {
  access_token: string;
  expires_in: number;
}

let token: TDXToken | null = null;
let tokenExpirationTime = 0;
let tokenPromise: Promise<string> | null = null; // 新增這行

export async function getTDXToken(): Promise<string> {
  const clientId = import.meta.env.VITE_TDX_CLIENT_ID;
  const clientSecret = import.meta.env.VITE_TDX_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('請在環境變數中設定 VITE_TDX_CLIENT_ID 與 VITE_TDX_CLIENT_SECRET');
  }

  if (token && Date.now() < tokenExpirationTime) {
    return token.access_token;
  }

if (tokenPromise) {
    return tokenPromise;
  }

  tokenPromise = (async () => {
    try {
      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');
      params.append('client_id', clientId.trim());
      params.append('client_secret', clientSecret.trim());

      const response = await fetch('https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      if (!response.ok) throw new Error(`Token API failed`);
      
      const data = await response.json();
      token = data;
      tokenExpirationTime = Date.now() + (data.expires_in - 60) * 1000;
      return data.access_token;
    } finally {
      // 獲取完畢或失敗後，將 promise 清空
      tokenPromise = null;
    }
  })();

  return tokenPromise;
}

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
  const clientId = import.meta.env.VITE_TDX_CLIENT_ID;
  const clientSecret = import.meta.env.VITE_TDX_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.warn('TDX 金鑰未設定，使用模擬資料');
    return getMockData<T>(url);
  }

  const now = Date.now();
  const cached = requestCache.get(url);
  if (cached && cached.expiresAt > now) return cached.data as T;

  const existing = inFlight.get(url);
  if (existing) return existing as Promise<T>;

  const task = (async (): Promise<T> => {
    try {
      const accessToken = await getTDXToken();
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' },
      });

      if (response.status === 429) {
        // Never retry 429 – consuming retries just burns more quota.
        // Return stale cache if available, otherwise mock.
        if (cached) return cached.data as T;
        console.warn(`TDX 429 速率限制: ${url.split('?')[0].split('/').slice(-3).join('/')}`);
        return getMockData<T>(url);
      }

      if (!response.ok) {
        // 404 and other errors → stale cache or mock
        if (cached) return cached.data as T;
        console.warn(`TDX ${response.status}: ${url.split('?')[0].split('/').slice(-3).join('/')}`);
        return getMockData<T>(url);
      }

      const data = await response.json() as T;
      requestCache.set(url, { data, expiresAt: Date.now() + getCacheTTL(url) });
      return data;
    } catch (error) {
      if (cached) return cached.data as T;
      console.error('TDX 請求錯誤:', error);
      return getMockData<T>(url);
    }
  })();

  inFlight.set(url, task);
  try {
    return await task;
  } finally {
    inFlight.delete(url);
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
        },
        OriginStopTime: { DepartureTime: `${depHour.toString().padStart(2, '0')}:00` },
        DestinationStopTime: { ArrivalTime: `${arrHour.toString().padStart(2, '0')}:${arrMin.toString().padStart(2, '0')}` },
      };
    }) as any;
  }
  if (url.includes('ODFare')) {
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
  };
  OriginStopTime?: { DepartureTime: string };
  DestinationStopTime?: { ArrivalTime: string };
  StopTimes?: StopTime[];
}
interface V3ODEnvelope { TrainTimetables?: V3TrainOD[] }

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
  // v3 returned nothing (404/empty) – fall back to v2
  const v2raw = await fetchTDXApi<any>(`https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/DailyTimetable/OD/${originId}/to/${destId}/${date}?$format=JSON`);
  return unwrapArray<DailyTimetableOD>(v2raw);
}

export async function getTHSRTimetableOD(originId: string, destId: string, date: string): Promise<DailyTimetableOD[]> {
  const raw = await fetchTDXApi<any>(`https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/DailyTimetable/OD/${originId}/to/${destId}/${date}?$format=JSON`);
  return unwrapArray<DailyTimetableOD>(raw);
}

// --- Fares ---
export interface Fare { TicketType: string; Price?: number; Fare?: number }
export interface TRAODFare { OriginStationID: string; DestinationStationID: string; Direction: number; TrainType: number; Fares: Fare[] }
export interface THSRODFare { OriginStationID: string; DestinationStationID: string; Direction: number; Fares: Fare[] }

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
    StopTimes: (t.StopTimes || []) as StopTime[],
  }));
}

export async function getTRATrainTimetable(trainNo: string, date: string): Promise<TrainTimetable[]> {
  const url = `https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/DailyTrainTimetable/TrainNo/${trainNo}/TrainDate/${date}?$format=JSON`;
  const raw = await fetchTDXApi<any>(url);
  const mapped = mapV3ToTrainTimetable(raw, date);
  if (mapped.length > 0) return mapped;
  const v2raw = await fetchTDXApi<any>(`https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/DailyTimetable/TrainNo/${trainNo}/TrainDate/${date}?$format=JSON`);
  return unwrapArray<TrainTimetable>(v2raw);
}

export async function getTHSRTrainTimetable(trainNo: string, date: string): Promise<TrainTimetable[]> {
  const url = `https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/DailyTimetable/TrainDate/${date}?$filter=DailyTrainInfo/TrainNo eq '${trainNo}'&$format=JSON`;
  const raw = await fetchTDXApi<any>(url);
  return unwrapArray<TrainTimetable>(raw);
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
