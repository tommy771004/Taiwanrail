// --- Request cache + in-flight dedup ---
type CacheEntry<T> = { data: T; expiresAt: number };
const requestCache = new Map<string, CacheEntry<any>>();
const inFlight = new Map<string, Promise<any>>();

function getCacheTTL(url: string): number {
  if (url.includes('LiveBoard')) return 1 * 60_000;       // 1 min live board (more aggressive)
  if (url.includes('Alert'))    return 10 * 60_000;      // 10 min alerts
  return 3 * 60_000;                                     // 3 min default
}

// 輔助函式：將日期轉換為 TDX 的曜日格式 (Monday, Tuesday...)
function getDayKey(dateStr: string): string {
  const date = new Date(dateStr);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getDay()];
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

      if (!response.ok) {
        // Suppress 429 warnings as they are handled by mock fallback gracefully
        const isSoftError = response.status === 429 || (response.status === 404 && url.includes('Alert'));
        
        if (isSoftError) {
          console.info(`[TDX] ${response.status} for ${proxyUrl} - Using simulation fallback`);
        } else {
          console.warn(`[TDX Error] ${response.status} for ${proxyUrl} - Falling back to mock data`);
        }
        
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
      { StationID: '0900', StationName: { Zh_tw: '基隆', En: 'Keelung' } },
      { StationID: '0920', StationName: { Zh_tw: '八堵', En: 'Badu' } },
      { StationID: '0930', StationName: { Zh_tw: '七堵', En: 'Qidu' } },
      { StationID: '0940', StationName: { Zh_tw: '汐止', En: 'Xizhi' } },
      { StationID: '0950', StationName: { Zh_tw: '汐科', En: 'Xike' } },
      { StationID: '0980', StationName: { Zh_tw: '松山', En: 'Songshan' } },
      { StationID: '0990', StationName: { Zh_tw: '南港', En: 'Nangang' } },
      { StationID: '1000', StationName: { Zh_tw: '臺北', En: 'Taipei' } },
      { StationID: '1010', StationName: { Zh_tw: '萬華', En: 'Wanhua' } },
      { StationID: '1020', StationName: { Zh_tw: '板橋', En: 'Banqiao' } },
      { StationID: '1030', StationName: { Zh_tw: '樹林', En: 'Shulin' } },
      { StationID: '1040', StationName: { Zh_tw: '鶯歌', En: 'Yingge' } },
      { StationID: '1050', StationName: { Zh_tw: '桃園', En: 'Taoyuan' } },
      { StationID: '1060', StationName: { Zh_tw: '內壢', En: 'Neili' } },
      { StationID: '1070', StationName: { Zh_tw: '中壢', En: 'Zhongli' } },
      { StationID: '1080', StationName: { Zh_tw: '埔心', En: 'Puxin' } },
      { StationID: '1090', StationName: { Zh_tw: '楊梅', En: 'Yangmei' } },
      { StationID: '1100', StationName: { Zh_tw: '湖口', En: 'Hukou' } },
      { StationID: '1110', StationName: { Zh_tw: '新豐', En: 'Xinfeng' } },
      { StationID: '1120', StationName: { Zh_tw: '竹北', En: 'Zhubei' } },
      { StationID: '1130', StationName: { Zh_tw: '新竹', En: 'Hsinchu' } },
      { StationID: '1140', StationName: { Zh_tw: '竹南', En: 'Zhunan' } },
      { StationID: '1150', StationName: { Zh_tw: '苗栗', En: 'Miaoli' } },
      { StationID: '1210', StationName: { Zh_tw: '大甲', En: 'Dajia' } },
      { StationID: '1250', StationName: { Zh_tw: '沙鹿', En: 'Shalu' } },
      { StationID: '3300', StationName: { Zh_tw: '臺中', En: 'Taichung' } },
      { StationID: '3360', StationName: { Zh_tw: '彰化', En: 'Changhua' } },
      { StationID: '3470', StationName: { Zh_tw: '員林', En: 'Yuanlin' } },
      { StationID: '4080', StationName: { Zh_tw: '斗六', En: 'Douliu' } },
      { StationID: '4220', StationName: { Zh_tw: '嘉義', En: 'Chiayi' } },
      { StationID: '4310', StationName: { Zh_tw: '新營', En: 'Xinying' } },
      { StationID: '4340', StationName: { Zh_tw: '善化', En: 'Shanhua' } },
      { StationID: '5000', StationName: { Zh_tw: '臺南', En: 'Tainan' } },
      { StationID: '5120', StationName: { Zh_tw: '岡山', En: 'Gangshan' } },
      { StationID: '6000', StationName: { Zh_tw: '高雄', En: 'Kaohsiung' } },
      { StationID: '6020', StationName: { Zh_tw: '新左營', En: 'Xinzuoying' } },
      { StationID: '6030', StationName: { Zh_tw: '鳳山', En: 'Fengshan' } },
      { StationID: '6080', StationName: { Zh_tw: '屏東', En: 'Pingtung' } },
      { StationID: '6110', StationName: { Zh_tw: '潮州', En: 'Chaozhou' } },
      { StationID: '7000', StationName: { Zh_tw: '臺東', En: 'Taitung' } },
      { StationID: '7040', StationName: { Zh_tw: '知本', En: 'Zhiben' } },
      { StationID: '7060', StationName: { Zh_tw: '關山', En: 'Guanshan' } },
      { StationID: '7110', StationName: { Zh_tw: '玉里', En: 'Yuli' } },
      { StationID: '7190', StationName: { Zh_tw: '瑞穗', En: 'Ruisui' } },
      { StationID: '7240', StationName: { Zh_tw: '光復', En: 'Guangfu' } },
      { StationID: '7260', StationName: { Zh_tw: '鳳林', En: 'Fenglin' } },
      { StationID: '7300', StationName: { Zh_tw: '壽豐', En: 'Shoufeng' } },
      { StationID: '7080', StationName: { Zh_tw: '花蓮', En: 'Hualien' } },
      { StationID: '7360', StationName: { Zh_tw: '羅東', En: 'Luodong' } },
      { StationID: '7361', StationName: { Zh_tw: '宜蘭', En: 'Yilan' } },
      { StationID: '7390', StationName: { Zh_tw: '礁溪', En: 'Jiaoxi' } },
      { StationID: '7420', StationName: { Zh_tw: '頭城', En: 'Toucheng' } },
      { StationID: '7480', StationName: { Zh_tw: '瑞芳', En: 'Ruifang' } },
    ] as any;
  }
  if (url.includes('THSR/Station')) {
    return [
      { StationID: '0990', StationName: { Zh_tw: '南港', En: 'Nangang' } },
      { StationID: '1000', StationName: { Zh_tw: '台北', En: 'Taipei' } },
      { StationID: '1010', StationName: { Zh_tw: '板橋', En: 'Banqiao' } },
      { StationID: '1020', StationName: { Zh_tw: '桃園', En: 'Taoyuan' } },
      { StationID: '1030', StationName: { Zh_tw: '新竹', En: 'Hsinchu' } },
      { StationID: '1035', StationName: { Zh_tw: '苗栗', En: 'Miaoli' } },
      { StationID: '1040', StationName: { Zh_tw: '台中', En: 'Taichung' } },
      { StationID: '1043', StationName: { Zh_tw: '彰化', En: 'Changhua' } },
      { StationID: '1047', StationName: { Zh_tw: '雲林', En: 'Yunlin' } },
      { StationID: '1050', StationName: { Zh_tw: '嘉義', En: 'Chiayi' } },
      { StationID: '1060', StationName: { Zh_tw: '台南', En: 'Tainan' } },
      { StationID: '1070', StationName: { Zh_tw: '左營', En: 'Zuoying' } },
    ] as any;
  }
  if (url.includes('Timetable/OD') || url.includes('TrainTimetable/OD')) {
    const isHsr = url.includes('THSR');
    const pathParts = url.split('/');
    const toIndex = pathParts.indexOf('to');
    const originStationID = toIndex > 0 ? pathParts[toIndex - 1] : (isHsr ? '0990' : '1000');
    const destStationID = toIndex > 0 ? pathParts[toIndex + 1] : (isHsr ? '1060' : '3300');

    // Notify UI about fallback (optional, but good for debugging/transparency)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tdx-api-fallback', { detail: { url } }));
    }

    return Array.from({ length: 12 }).map((_, i) => {
      const depHour = 6 + i;
      const durMinutes = isHsr ? 90 + (i % 3) * 15 : 180 + (i % 5) * 20;
      const arrHour = depHour + Math.floor(durMinutes / 60);
      const arrMin = durMinutes % 60;
      const depTime = `${depHour.toString().padStart(2, '0')}:00`;
      const arrTime = `${arrHour.toString().padStart(2, '0')}:${arrMin.toString().padStart(2, '0')}`;

      const trainInfo = {
        TrainNo: isHsr ? (600 + i * 11).toString() : (100 + i * 13).toString(),
        TrainTypeID: isHsr ? '1' : (i % 2 === 0 ? '1100' : '1131'),
        TrainTypeName: { Zh_tw: isHsr ? '高鐵' : (i % 2 === 0 ? '自強號' : '區間車') },
        Direction: i % 2,
        TripLine: isHsr ? 0 : (i % 4),
        WheelchairFlag: i % 2,
        BikeFlag: i % 3 === 0 ? 1 : 0,
        Note: { Zh_tw: i % 5 === 0 ? '每日行駛' : '' }
      };

      return {
        TrainDate: new Date().toISOString().split('T')[0],
        // Support both V2 (DailyTrainInfo) and V3 (TrainInfo)
        DailyTrainInfo: trainInfo,
        TrainInfo: trainInfo,
        OriginStopTime: { StationID: originStationID, DepartureTime: depTime },
        DestinationStopTime: { StationID: destStationID, ArrivalTime: arrTime },
      };
    }) as any;
  }
  if (url.includes('Timetable/TrainNo') || url.includes('TrainTimetable/TrainNo')) {
    const isHsr = url.includes('THSR');
    const parts = url.split('/');
    const trainNoIdx = parts.indexOf('TrainNo');
    const trainNo = trainNoIdx !== -1 ? parts[trainNoIdx + 1].split('?')[0] : '0687';
    
    const traMainStations = [
      { id: '1000', name: '台北' }, { id: '1020', name: '板橋' }, { id: '1040', name: '桃園' },
      { id: '1080', name: '新竹' }, { id: '1210', name: '台中' }, { id: '1240', name: '彰化' },
      { id: '1310', name: '嘉義' }, { id: '1320', name: '台南' }, { id: '1410', name: '高雄' }
    ];
    const hsrStations = [
      { id: '0990', name: '南港' }, { id: '1000', name: '台北' }, { id: '1010', name: '板橋' },
      { id: '1020', name: '桃園' }, { id: '1030', name: '新竹' }, { id: '1040', name: '台中' },
      { id: '1050', name: '嘉義' }, { id: '1060', name: '台南' }, { id: '1070', name: '左營' }
    ];

    const sourceStations = [...(isHsr ? hsrStations : traMainStations)];
    
    // Simple heuristic: Even is Northbound (reversed), Odd is Southbound (original)
    const isNorth = parseInt(trainNo) % 2 === 0;
    if (isNorth) sourceStations.reverse();

    return [{
      TrainDate: new Date().toISOString().split('T')[0],
      TrainInfo: { 
        TrainNo: trainNo, 
        TrainTypeName: { Zh_tw: isHsr ? '高鐵' : '自強' },
        IsMock: true // Internal flag
      },
      StopTimes: sourceStations.map((s, idx) => ({
        StopSequence: idx + 1,
        StationID: s.id,
        StationName: { Zh_tw: s.name, En: s.name },
        ArrivalTime: `${(8 + Math.floor(idx * 40 / 60)).toString().padStart(2, '0')}:${(idx * 40 % 60).toString().padStart(2, '0')}`,
        DepartureTime: `${(8 + Math.floor(idx * 40 / 60)).toString().padStart(2, '0')}:${(idx * 40 % 60 + 2).toString().padStart(2, '0')}`
      }))
    }] as any;
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
    const isHsr = url.includes('THSR');
    // Align LiveBoard numbers with Timetable mock numbers
    return Array.from({ length: 15 }).map((_, i) => ({
      TrainNo: isHsr ? (600 + i * 11).toString() : (100 + i * 13).toString(),
      DelayTime: i % 7 === 0 ? Math.floor(Math.random() * 10) : 0,
      StationID: isHsr ? '1000' : '1000',
    })) as any;
  }
  if (url.includes('DailyTimetable/TrainDate') || url.includes('TrainTimetable/TrainDate')) {
    const isHsr = url.includes('THSR');
    return Array.from({ length: 20 }).map((_, i) => ({
      TrainDate: new Date().toISOString().split('T')[0],
      TrainNo: isHsr ? (600 + i * 11).toString() : (100 + i * 13).toString(),
      TrainTypeID: isHsr ? '1' : '1100',
      TrainTypeName: { Zh_tw: isHsr ? '高鐵' : '自強號' },
      OriginStationID: isHsr ? '1000' : '1000',
      OriginStationName: { Zh_tw: '台北' },
      DestinationStationID: isHsr ? '1070' : '7000',
      DestinationStationName: { Zh_tw: isHsr ? '左營' : '高雄' },
    })) as any;
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
    console.warn('⚠️ 靜態台鐵車站讀取失敗，退回假資料:', error);
    return getMockData<Station[]>('TRA/Station');
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
    console.warn('⚠️ 靜態高鐵車站讀取失敗，退回假資料:', error);
    return getMockData<Station[]>('THSR/Station');
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

export async function getTRATimetableOD(originId: string, destId: string, date: string): Promise<DailyTimetableOD[]> {
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

      const results = timetables.filter((t: any) => {
        if (t.ServiceDay[dayKey] !== 1) return false;
        const stops = t.StopTimes || [];
        const originIdx = stops.findIndex((s: any) => s.StationID === originId);
        const destIdx = stops.findIndex((s: any) => s.StationID === destId);
        return originIdx !== -1 && destIdx !== -1 && originIdx < destIdx;
      }).map((t: any) => {
        const stops = t.StopTimes;
        const originIdx = stops.findIndex((s: any) => s.StationID === originId);
        const destIdx = stops.findIndex((s: any) => s.StationID === destId);
        return {
          OriginStationID: originId,
          DestinationStationID: destId,
          TrainDate: date,
          DailyTrainInfo: t.TrainInfo,
          OriginStopTime: { DepartureTime: stops[originIdx].DepartureTime },
          DestinationStopTime: { ArrivalTime: stops[destIdx].ArrivalTime },
        };
      });
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

export async function getTHSRTimetableOD(originId: string, destId: string, date: string): Promise<DailyTimetableOD[]> {
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

      return list
        .filter((item: any) => {
          const t = item.GeneralTimetable || item;
          if (t.ServiceDay[dayKey] !== 1) return false;
          const stops = t.StopTimes || [];
          const originIdx = stops.findIndex((s: any) => s.StationID === originId);
          const destIdx = stops.findIndex((s: any) => s.StationID === destId);
          return originIdx !== -1 && destIdx !== -1 && originIdx < destIdx;
        })
        .map((item: any) => {
          const t = item.GeneralTimetable || item;
          const originStop = t.StopTimes.find((s: any) => s.StationID === originId);
          const destStop = t.StopTimes.find((s: any) => s.StationID === destId);
          
          return {
            OriginStationID: originId,
            DestinationStationID: destId,
            TrainDate: date,
            DailyTrainInfo: t.GeneralTrainInfo || t.TrainInfo,
            OriginStopTime: { DepartureTime: originStop?.DepartureTime || '--:--' },
            DestinationStopTime: { ArrivalTime: destStop?.ArrivalTime || '--:--' },
          };
        });
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
export interface TRAODFare { OriginStationID: string; DestinationStationID: string; Direction: number; TrainType: number; Fares: Fare[] }
export interface THSRODFare { OriginStationID: string; DestinationStationID: string; Direction: number; Fares: Fare[] }

let _traFaresCache: any = null;
export async function getTRAODFare(originId: string, destId: string): Promise<TRAODFare[]> {
  try {
    if (!_traFaresCache) {
      const res = await fetch('/data/tra-fares.json');
      if (!res.ok) throw new Error();
      _traFaresCache = await res.json();
    }
    const odfares = _traFaresCache.ODFares || [];
    return odfares.filter((f:any) => f.OriginStationID === originId && f.DestinationStationID === destId);
  } catch (error) {
    const url = `https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/ODFare/${originId}/to/${destId}?$format=JSON`;
    const raw = await fetchTDXApi<any>(url);
    if (raw?.ODFares) return raw.ODFares;
    return unwrapArray<TRAODFare>(raw);
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
    const url = `https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/DailyTrainTimetable/TrainNo/${trainNo}?$filter=TrainDate eq '${date}'&$format=JSON`;
    const raw = await fetchTDXApi<any>(url);
    const allTrains = mapV3ToTrainTimetable(raw, date);
    if (allTrains.length > 0) return allTrains;
    
    const v2url = `https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/DailyTimetable/TrainNo/${trainNo}/TrainDate/${date}?$format=JSON`;
    const v2raw = await fetchTDXApi<any>(v2url);
    return unwrapArray<any>(v2raw).map(t => ({
      TrainDate: t.TrainDate,
      TrainInfo: { TrainNo: t.DailyTrainInfo?.TrainNo || trainNo },
      StopTimes: (t.StopTimes || []).map((s: any) => ({
        ...s,
        DepartureTime: s.DepartureTime || s.ArrivalTime,
        ArrivalTime: s.ArrivalTime || s.DepartureTime
      }))
    }));
  } catch (error) {
    console.error("取得台鐵停靠站失敗:", error);
    return [];
  }
}

export async function getTHSRTrainTimetable(trainNo: string, date: string): Promise<TrainTimetable[]> {
  if (!trainNo) return [];

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

export async function getTHSRLiveBoard(_stationId: string): Promise<RailLiveBoard[]> {
  // TDX does not publish a THSR LiveBoard endpoint (both v2 and v3 return 404).
  // THSR schedules are fixed; UI falls back to timetable data.
  return [];
}

// --- Alerts ---
export interface RailAlert { AlertID: string; Title: string; Description: string; AlertTime: string; Level: number }

export async function getTRAAlerts(): Promise<RailAlert[]> {
  const raw = await fetchTDXApi<any>('https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/Alert?$format=JSON');
  return unwrapArray<RailAlert>(raw);
}
export async function getTHSRAlerts(): Promise<RailAlert[]> {
  // TDX does not publish a THSR Alert endpoint (both v2 and v3 return 404).
  return [];
}