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

export async function fetchTDXApi<T>(url: string): Promise<T> {
  const clientId = import.meta.env.VITE_TDX_CLIENT_ID;
  const clientSecret = import.meta.env.VITE_TDX_CLIENT_SECRET;

  // 如果沒有設定金鑰，回傳模擬資料
  if (!clientId || !clientSecret) {
    console.warn('VITE_TDX_CLIENT_ID 或 VITE_TDX_CLIENT_SECRET 未設定，切換至模擬資料模式');
    return getMockData<T>(url);
  }

  try {
    const accessToken = await getTDXToken();
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.warn(`TDX API 請求失敗 (${response.statusText})，切換至模擬資料模式`);
      return getMockData<T>(url);
    }

    return response.json();
  } catch (error) {
    console.error('TDX API 錯誤:', error);
    return getMockData<T>(url);
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

export async function getTRATimetableOD(originId: string, destId: string, date: string): Promise<DailyTimetableOD[]> {
  return fetchTDXApi<DailyTimetableOD[]>(`https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/DailyTimetable/OD/${originId}/to/${destId}/${date}?$format=JSON`);
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
  return fetchTDXApi<TRAODFare[]>(`https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/ODFare/${originId}/to/${destId}?$format=JSON`);
}
export async function getTHSRODFare(originId: string, destId: string): Promise<THSRODFare[]> {
  return fetchTDXApi<THSRODFare[]>(`https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/ODFare/${originId}/to/${destId}?$format=JSON`);
}

// --- Train Stops ---
export interface StopTime {
  StopSequence: number;
  StationID: string;
  StationName: { Zh_tw: string };
  ArrivalTime: string;
  DepartureTime: string;
}
export interface TrainTimetable {
  TrainDate: string;
  TrainInfo: { TrainNo: string };
  StopTimes: StopTime[];
}
export async function getTRATrainTimetable(trainNo: string, date: string): Promise<TrainTimetable[]> {
  return fetchTDXApi<TrainTimetable[]>(`https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/DailyTimetable/TrainNo/${trainNo}/TrainDate/${date}?$format=JSON`);
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
