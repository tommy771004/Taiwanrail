export interface TDXToken {
  access_token: string;
  expires_in: number;
}

let token: TDXToken | null = null;
let tokenExpirationTime = 0;

export async function getTDXToken(): Promise<string> {
  const clientId = import.meta.env.VITE_TDX_CLIENT_ID;
  const clientSecret = import.meta.env.VITE_TDX_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('請在環境變數中設定 VITE_TDX_CLIENT_ID 與 VITE_TDX_CLIENT_SECRET');
  }

  if (token && Date.now() < tokenExpirationTime) {
    return token.access_token;
  }

  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', clientId.trim());
  params.append('client_secret', clientSecret.trim());

  const response = await fetch('https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`取得 TDX Token 失敗: HTTP ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  token = data;
  // 提早 60 秒過期以避免邊界情況
  tokenExpirationTime = Date.now() + (data.expires_in - 60) * 1000;

  return data.access_token;
}

// --- Request cache (dedupe + rate-limit friendly) ---
type CacheEntry<T> = { data: T; expiresAt: number };
const requestCache = new Map<string, CacheEntry<any>>();
const inFlight = new Map<string, Promise<any>>();

function getCacheTTL(url: string): number {
  if (url.includes('LiveBoard')) return 15_000;         // 15s for live board
  if (url.includes('Alert')) return 3 * 60_000;         // 3m for alerts
  if (url.includes('Station?') || url.endsWith('/Station?$format=JSON')) return 24 * 60 * 60_000; // 24h stations
  return 60_000;                                         // 60s for timetables, fares
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

export async function fetchTDXApi<T>(url: string): Promise<T> {
  const clientId = import.meta.env.VITE_TDX_CLIENT_ID;
  const clientSecret = import.meta.env.VITE_TDX_CLIENT_SECRET;

  // 如果沒有設定金鑰，回傳模擬資料
  if (!clientId || !clientSecret) {
    console.warn('VITE_TDX_CLIENT_ID 或 VITE_TDX_CLIENT_SECRET 未設定，切換至模擬資料模式');
    return getMockData<T>(url);
  }

  const now = Date.now();
  const cached = requestCache.get(url);
  if (cached && cached.expiresAt > now) return cached.data as T;

  const existing = inFlight.get(url);
  if (existing) return existing as Promise<T>;

  const task = (async (): Promise<T> => {
    let lastErr: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const accessToken = await getTDXToken();
        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
          },
        });

        if (response.status === 429) {
          // Too many requests: back off & retry, or fall back to stale cache / mock
          const retryAfter = Number(response.headers.get('Retry-After')) || 0;
          const backoff = retryAfter > 0 ? retryAfter * 1000 : 800 * Math.pow(2, attempt);
          if (attempt < 2) {
            await sleep(Math.min(backoff, 4000));
            continue;
          }
          if (cached) return cached.data as T; // serve stale
          console.warn('TDX API 429 速率限制，切換至模擬資料');
          return getMockData<T>(url);
        }

        if (!response.ok) {
          console.warn(`TDX API 請求失敗 (${response.status} ${response.statusText})，切換至模擬資料模式`);
          if (cached) return cached.data as T;
          return getMockData<T>(url);
        }

        const data = await response.json() as T;
        requestCache.set(url, { data, expiresAt: Date.now() + getCacheTTL(url) });
        return data;
      } catch (error) {
        lastErr = error;
        if (attempt < 2) {
          await sleep(500 * Math.pow(2, attempt));
          continue;
        }
      }
    }
    console.error('TDX API 錯誤:', lastErr);
    if (cached) return cached.data as T;
    return getMockData<T>(url);
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
      { StationID: '090', StationName: { Zh_tw: '南港', En: 'Nangang' } },
      { StationID: '100', StationName: { Zh_tw: '台北', En: 'Taipei' } },
      { StationID: '107', StationName: { Zh_tw: '左營', En: 'Zuoying' } },
    ] as any;
  }
  if (url.includes('Timetable/OD')) {
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
          TrainTypeName: { Zh_tw: isHsr ? '高鐵' : (i % 2 === 0 ? '自強號' : '區間車') }
        },
        OriginStopTime: { DepartureTime: `${depHour.toString().padStart(2, '0')}:00` },
        DestinationStopTime: { ArrivalTime: `${arrHour.toString().padStart(2, '0')}:${arrMin.toString().padStart(2, '0')}` }
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
    return [
      { TrainNo: '100', DelayTime: 0 },
      { TrainNo: '113', DelayTime: 5 },
      { TrainNo: '126', DelayTime: 0 },
    ] as any;
  }
  return [] as any;
}

// --- API Functions ---

export interface Station {
  StationID: string;
  StationName: {
    Zh_tw: string;
    En: string;
  };
}

export async function getTRAStations(): Promise<Station[]> {
  return fetchTDXApi<Station[]>('https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/Station?$format=JSON');
}

export async function getTHSRStations(): Promise<Station[]> {
  return fetchTDXApi<Station[]>('https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/Station?$format=JSON');
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
  OriginStopTime: {
    DepartureTime: string;
  };
  DestinationStopTime: {
    ArrivalTime: string;
  };
}

// TRA v3 response shapes (for OD & TrainNo timetables)
interface V3TrainOD {
  TrainInfo: {
    TrainNo: string;
    TrainTypeID: string;
    TrainTypeCode?: string;
    TrainTypeName?: { Zh_tw: string; En?: string };
  };
  OriginStopTime?: { DepartureTime: string };
  DestinationStopTime?: { ArrivalTime: string };
  StopTimes?: StopTime[];
}
interface V3ODEnvelope {
  UpdateTime?: string;
  TrainTimetables?: V3TrainOD[];
}

function mapV3ToOD(payload: V3ODEnvelope | V3TrainOD[] | any, date: string): DailyTimetableOD[] {
  const list: V3TrainOD[] = Array.isArray(payload) ? payload : (payload?.TrainTimetables ?? []);
  return list.map(t => {
    const stops = t.StopTimes || [];
    const originStop = t.OriginStopTime || (stops.length > 0 ? { DepartureTime: stops[0].DepartureTime } : { DepartureTime: '' });
    const destStop = t.DestinationStopTime || (stops.length > 0 ? { ArrivalTime: stops[stops.length - 1].ArrivalTime || stops[stops.length - 1].DepartureTime } : { ArrivalTime: '' });
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
  // Upgraded to v3 per TDX spec
  const url = `https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/DailyTrainTimetable/OD/${originId}/to/${destId}/${date}?$format=JSON`;
  const raw = await fetchTDXApi<V3ODEnvelope | V3TrainOD[] | any>(url);
  const mapped = mapV3ToOD(raw, date);
  if (mapped.length === 0) {
    // fall back to v2 if v3 returned nothing (future-proofing for outages)
    const v2 = await fetchTDXApi<DailyTimetableOD[]>(`https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/DailyTimetable/OD/${originId}/to/${destId}/${date}?$format=JSON`);
    return Array.isArray(v2) ? v2 : [];
  }
  return mapped;
}

export async function getTHSRTimetableOD(originId: string, destId: string, date: string): Promise<DailyTimetableOD[]> {
  return fetchTDXApi<DailyTimetableOD[]>(`https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/DailyTimetable/OD/${originId}/to/${destId}/${date}?$format=JSON`);
}

// --- Fares ---
export interface Fare {
  TicketType: string;
  Price?: number;
  Fare?: number;
}
export interface TRAODFare {
  OriginStationID: string;
  DestinationStationID: string;
  Direction: number;
  TrainType: number;
  Fares: Fare[];
}
export interface THSRODFare {
  OriginStationID: string;
  DestinationStationID: string;
  Direction: number;
  Fares: Fare[];
}
export async function getTRAODFare(originId: string, destId: string): Promise<TRAODFare[]> {
  return fetchTDXApi<TRAODFare[]>(`https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/ODFare/${originId}/to/${destId}?$format=JSON`).catch(() =>
    fetchTDXApi<TRAODFare[]>(`https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/ODFare/${originId}/to/${destId}?$format=JSON`)
  );
}
export async function getTHSRODFare(originId: string, destId: string): Promise<THSRODFare[]> {
  return fetchTDXApi<THSRODFare[]>(`https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/ODFare/${originId}/to/${destId}?$format=JSON`);
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
  if (mapped.length === 0) {
    const v2 = await fetchTDXApi<TrainTimetable[]>(`https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/DailyTimetable/TrainNo/${trainNo}/TrainDate/${date}?$format=JSON`);
    return Array.isArray(v2) ? v2 : [];
  }
  return mapped;
}

export async function getTHSRTrainTimetable(trainNo: string, date: string): Promise<TrainTimetable[]> {
  return fetchTDXApi<TrainTimetable[]>(`https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/DailyTimetable/TrainNo/${trainNo}/TrainDate/${date}?$format=JSON`);
}

// --- Live Board (Arrivals/Departures) ---
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
  return fetchTDXApi<RailLiveBoard[]>(`https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/LiveBoard/Station/${stationId}?$format=JSON`);
}
export async function getTHSRLiveBoard(stationId: string): Promise<RailLiveBoard[]> {
  return fetchTDXApi<RailLiveBoard[]>(`https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/LiveBoard/Station/${stationId}?$format=JSON`);
}

// --- Alerts (Disruptions) ---
export interface RailAlert {
  AlertID: string;
  Title: string;
  Description: string;
  AlertTime: string;
  Level: number;
}
export async function getTRAAlerts(): Promise<RailAlert[]> {
  return fetchTDXApi<RailAlert[]>('https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/Alert?$format=JSON');
}
export async function getTHSRAlerts(): Promise<RailAlert[]> {
  return fetchTDXApi<RailAlert[]>('https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/Alert?$format=JSON');
}
