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
      const isNetworkError = error instanceof TypeError && error.message.includes('Failed to fetch');
      if (isNetworkError) {
        console.warn(`[TDX] Network error fetching ${proxyUrl} (server restarted?) - Using mock fallback`);
      } else {
        console.warn(`[TDX Proxy Fetch Error] ${proxyUrl}:`, error);
      }
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
  if (url.includes('Rail/Metro/Station')) {
    if (url.includes('TRTC')) { // 台北捷運
      return [
        { StationID: 'BL12', StationName: { Zh_tw: '台北車站', En: 'Taipei Main Station' }, StationPosition: { PositionLat: 25.046254, PositionLon: 121.517532 } },
        { StationID: 'BL11', StationName: { Zh_tw: '西門', En: 'Ximen' }, StationPosition: { PositionLat: 25.042125, PositionLon: 121.508284 } },
        { StationID: 'BL18', StationName: { Zh_tw: '市政府', En: 'Taipei City Hall' }, StationPosition: { PositionLat: 25.041164, PositionLon: 121.565191 } },
        { StationID: 'BL07', StationName: { Zh_tw: '板橋', En: 'Banqiao' }, StationPosition: { PositionLat: 25.013589, PositionLon: 121.462312 } },
        { StationID: 'R16', StationName: { Zh_tw: '中山', En: 'Zhongshan' }, StationPosition: { PositionLat: 25.052695, PositionLon: 121.520412 } },
        { StationID: 'R10', StationName: { Zh_tw: '東門', En: 'Dongmen' }, StationPosition: { PositionLat: 25.033878, PositionLon: 121.528514 } },
        { StationID: 'O08', StationName: { Zh_tw: '古亭', En: 'Guting' }, StationPosition: { PositionLat: 25.026362, PositionLon: 121.522645 } },
        { StationID: 'O12', StationName: { Zh_tw: '松江南京', En: 'Songjiang Nanjing' }, StationPosition: { PositionLat: 25.051911, PositionLon: 121.533267 } }
      ] as any;
    }
    if (url.includes('KRTC')) { // 高雄捷運
      return [
        { StationID: 'R10', StationName: { Zh_tw: '美麗島', En: 'Formosa Boulevard' }, StationPosition: { PositionLat: 22.631386, PositionLon: 120.301931 } },
        { StationID: 'R16', StationName: { Zh_tw: '左營', En: 'Zuoying' }, StationPosition: { PositionLat: 22.687747, PositionLon: 120.307521 } },
        { StationID: 'O5', StationName: { Zh_tw: '鹽埕埔', En: 'Yanchengpu' }, StationPosition: { PositionLat: 22.623432, PositionLon: 120.283125 } },
        { StationID: 'R14', StationName: { Zh_tw: '巨蛋', En: 'Kaohsiung Arena' }, StationPosition: { PositionLat: 22.665971, PositionLon: 120.302347 } }
      ] as any;
    }
    if (url.includes('TYMC')) { // 桃園捷運
      return [
        { StationID: 'A1', StationName: { Zh_tw: '台北車站', En: 'Taipei Main Station' }, StationPosition: { PositionLat: 25.048324, PositionLon: 121.512643 } },
        { StationID: 'A12', StationName: { Zh_tw: '機場第一航廈', En: 'Airport Terminal 1' }, StationPosition: { PositionLat: 25.082531, PositionLon: 121.240325 } },
        { StationID: 'A13', StationName: { Zh_tw: '機場第二航廈', En: 'Airport Terminal 2' }, StationPosition: { PositionLat: 25.079231, PositionLon: 121.237241 } },
        { StationID: 'A18', StationName: { Zh_tw: '高鐵桃園站', En: 'Taoyuan HSR Station' }, StationPosition: { PositionLat: 25.012543, PositionLon: 121.214892 } }
      ] as any;
    }
    if (url.includes('TMRT')) { // 台中捷運
      return [
        { StationID: '106', StationName: { Zh_tw: '文心櫻花', En: 'Wenxin Yinghua' }, StationPosition: { PositionLat: 24.166324, PositionLon: 120.648212 } },
        { StationID: '110', StationName: { Zh_tw: '市政府', En: 'Taichung City Hall' }, StationPosition: { PositionLat: 24.162341, PositionLon: 120.644123 } },
        { StationID: '119', StationName: { Zh_tw: '高鐵台中站', En: 'HSR Taichung Station' }, StationPosition: { PositionLat: 24.112341, PositionLon: 120.615234 } }
      ] as any;
    }
    if (url.includes('NTMC')) { // 新北捷運
      return [
        { StationID: 'Y15', StationName: { Zh_tw: '大坪林', En: 'Dapinglin' }, StationPosition: { PositionLat: 24.982341, PositionLon: 121.541234 } },
        { StationID: 'Y20', StationName: { Zh_tw: '十四張', En: 'Shishizhang' }, StationPosition: { PositionLat: 24.985412, PositionLon: 121.528412 } }
      ] as any;
    }
    // 其他輕軌等
    return [
      { StationID: '01', StationName: { Zh_tw: '起點站', En: 'Start Station' }, StationPosition: { PositionLat: 25.0, PositionLon: 121.5 } },
      { StationID: '02', StationName: { Zh_tw: '終點站', En: 'End Station' }, StationPosition: { PositionLat: 25.1, PositionLon: 121.6 } }
    ] as any;
  }
  if (url.includes('Rail/Metro/ODFare')) {
    // Multiple passenger categories so the fare breakdown UI is exercised.
    return [
      {
        OriginStationID: 'BL12',
        DestinationStationID: 'BL11',
        Fares: [
          { TicketType: '單程票', FareClass: 1, Price: 20 },
          { TicketType: '電子票證', Price: 16 },
          { TicketType: '兒童票', FareClass: 2, Price: 10 },
          { TicketType: '敬老票', FareClass: 3, Price: 10 },
          { TicketType: '愛心票', FareClass: 4, Price: 10 }
        ]
      },
      {
        OriginStationID: 'BL12',
        DestinationStationID: 'BL18',
        Fares: [
          { TicketType: '單程票', FareClass: 1, Price: 30 },
          { TicketType: '電子票證', Price: 24 },
          { TicketType: '兒童票', FareClass: 2, Price: 15 },
          { TicketType: '敬老票', FareClass: 3, Price: 15 },
          { TicketType: '愛心票', FareClass: 4, Price: 15 }
        ]
      },
      {
        Fares: [
          { TicketType: '單程票', FareClass: 1, Price: 25 },
          { TicketType: '悠遊卡/一卡通', Price: 20 },
          { TicketType: '兒童票', FareClass: 2, Price: 13 },
          { TicketType: '敬老票', FareClass: 3, Price: 13 }
        ]
      }
    ] as any;
  }
  if (url.includes('Rail/Metro/S2STravelTime')) {
    return [
      {
        LineID: 'BL',
        LineNo: 'BL',
        TravelTimes: [
          { FromStationID: 'BL12', FromStationName: { Zh_tw: '台北車站' }, ToStationID: 'BL11', ToStationName: { Zh_tw: '西門' }, RunTime: 120, StopTime: 30 },
          { FromStationID: 'BL11', FromStationName: { Zh_tw: '西門' }, ToStationID: 'BL12', ToStationName: { Zh_tw: '台北車站' }, RunTime: 120, StopTime: 30 },
          { FromStationID: 'BL12', FromStationName: { Zh_tw: '台北車站' }, ToStationID: 'BL18', ToStationName: { Zh_tw: '市政府' }, RunTime: 300, StopTime: 30 },
          { FromStationID: 'BL18', FromStationName: { Zh_tw: '市政府' }, ToStationID: 'BL12', ToStationName: { Zh_tw: '台北車站' }, RunTime: 300, StopTime: 30 }
        ]
      }
    ] as any;
  }
  // NOTE: no Rail/Metro/LivePosition mock on purpose — fabricating a live train
  // would misrepresent a real-time feature. The endpoint degrades to [] and the
  // stop timeline simply renders without the live-position highlight.
  if (url.includes('Rail/Metro/LiveBoard')) {
    return [
      { StationID: 'BL12', StationName: { Zh_tw: '台北車站' }, DestinationStationID: 'BL18', DestinationStationName: { Zh_tw: '市政府' }, EstimateTime: 3 },
      { StationID: 'BL12', StationName: { Zh_tw: '台北車站' }, DestinationStationID: 'BL11', DestinationStationName: { Zh_tw: '西門' }, EstimateTime: 5 }
    ] as any;
  }

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
  if (url.includes('maas/routing')) {
    // Provisional dev mock so the planner renders without credentials.
    // ⚠️ The `sections` shape is a best guess — reconcile with scripts/probe-routing.ts output.
    const now = new Date();
    const iso = (addMin: number) => new Date(now.getTime() + addMin * 60000).toISOString();
    return {
      result: 'success',
      data: {
        routes: [
          {
            travel_time: 95 * 60,
            start_time: iso(8),
            end_time: iso(103),
            transfers: 1,
            sections: [
              { mode: '0', mode_name: '步行', start: { name: '出發地' }, end: { name: '臺北車站' }, travel_time: 8 * 60 },
              { mode: '4', mode_name: '台鐵', line_name: '自強號 1234', start: { name: '臺北', time: iso(8) }, end: { name: '新竹', time: iso(73) }, travel_time: 65 * 60, fare: 177 },
              { mode: '0', mode_name: '步行', start: { name: '新竹車站' }, end: { name: '目的地' }, travel_time: 22 * 60 },
            ],
          },
        ],
      },
    } as any;
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
    return fares.filter((f: TRAODFare) => f.DestinationStationID === destId);
  } catch (error) {
    _traFaresFailed.add(originId);
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
export interface RailAlert { AlertID: string; Title: string; Description: string; AlertTime: string; Level: number; Url?: string }

export async function getTRAAlerts(): Promise<RailAlert[]> {
  const raw = await fetchTDXApi<any>('https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/Alert?$format=JSON');
  return unwrapArray<RailAlert>(raw);
}
export async function getTHSRAlerts(): Promise<RailAlert[]> {
  // TDX does not publish a THSR Alert endpoint (both v2 and v3 return 404).
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

export async function getNearestYouBike(lat: number, lon: number): Promise<YouBikeStation | null> {
  try {
    const res = await fetch(`/api/youbike?lat=${lat}&lon=${lon}`);
    if (!res.ok) return null;
    const j = await res.json();
    return (j?.station as YouBikeStation) ?? null;
  } catch {
    return null;
  }
}

// --- Nearby Bus Stops ---
export interface BusStation {
  StationID: string;
  StationUID: string;
  StationName: { Zh_tw: string; En?: string };
  StationAddress?: string;
  Stops?: { RouteID: string; RouteName: { Zh_tw: string; En?: string } }[];
  Distance?: number;
}

export async function getNearbyBusStops(
  lat: number,
  lon: number,
  stationName: string
): Promise<BusStation[]> {
  try {
    const url = `https://tdx.transportdata.tw/api/basic/v2/Bus/Station/NearBy?$spatialFilter=nearby(${lat},${lon},500)&$format=JSON`;
    const data = await fetchTDXApi<any>(url);
    const arr = unwrapArray<any>(data);
    
    if (arr && arr.length > 0) {
      const stations: BusStation[] = arr.map((item: any) => {
        const stopsMap = new Map<string, string>();
        if (Array.isArray(item.Stops)) {
          item.Stops.forEach((stop: any) => {
            const rName = stop.RouteName?.Zh_tw || stop.RouteName?.En || stop.RouteID;
            if (rName) {
              stopsMap.set(stop.RouteID, rName);
            }
          });
        }
        
        const stopsList = Array.from(stopsMap.entries()).map(([rId, rName]) => ({
          RouteID: rId,
          RouteName: { Zh_tw: rName }
        }));

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
    console.warn("Failed to fetch real bus stops, using simulation fallback:", error);
  }

  return getMockBusStops(stationName);
}

function getMockBusStops(stationName: string): BusStation[] {
  const cleanName = stationName.replace('高鐵', '').replace('臺', '台');
  
  const presets: Record<string, { name: string, routes: string[] }[]> = {
    '台北': [
      { name: '台北車站(忠孝)', routes: ['14', '39', '218', '221', '260', '265', '274', '299', '310', '652'] },
      { name: '台北車站(公園)', routes: ['5', '37', '849', '藍1', '222', '307'] },
      { name: '台北車站(重慶)', routes: ['252', '262', '513', '605', '重慶幹線'] },
      { name: '台北車站(青島)', routes: ['2', '5', '222', '295', '604', 'M7'] }
    ],
    '南港': [
      { name: '南港車站', routes: ['551', '817', '市民小巴15', '棕19', '藍21'] },
      { name: '捷運南港站', routes: ['212', '270', '281', '藍15', '藍25', '小1'] }
    ],
    '板橋': [
      { name: '板橋公車站', routes: ['234', '307', '651', '667', '705', '810', '965', '982'] },
      { name: '板橋車站(文化路)', routes: ['99', '245', '264', '310', '701', '806'] }
    ],
    '桃園': [
      { name: '高鐵桃園站', routes: ['170', '206', '302', '5087', '5089', 'L206'] },
      { name: '桃園客運桃園總站', routes: ['1', '101', '102', '105', '5014', 'GR'] }
    ],
    '新竹': [
      { name: '高鐵新竹站', routes: ['5700', '5900', '快捷5號', '快捷7號', '竹北市免費公車'] },
      { name: '新竹火車站', routes: ['1', '2', '15', '27', '31', '藍線', '藍15區'] }
    ],
    '台中': [
      { name: '高鐵台中站(站區二路)', routes: ['26', '70', '82', '93', '99', '159高鐵快捷', '161'] },
      { name: '台中車站(台灣大道)', routes: ['300', '301', '302', '303', '304', '307', '308', '310'] },
      { name: '台中車站(復興路)', routes: ['51', '89', '280', '281', '285', '286'] }
    ],
    '彰化': [
      { name: '高鐵彰化站', routes: ['7', '8', '11', '12', '彰化客運'] },
      { name: '彰化火車站', routes: ['1', '2', '6900', '6901', '6903', '6912'] }
    ],
    '雲林': [
      { name: '高鐵雲林站', routes: ['201', '202', '301', '快捷市區線'] }
    ],
    '苗栗': [
      { name: '高鐵苗栗站', routes: ['5803', '5807', '5808', '5814', '5815', '快捷公車'] }
    ],
    '嘉義': [
      { name: '高鐵嘉義站', routes: ['BRT 7211', 'BRT 7212', '105', '166', '168'] },
      { name: '嘉義火車站(前站)', routes: ['1', '7201', '7202', '7203', '中山幹線'] }
    ],
    '台南': [
      { name: '高鐵台南站', routes: ['綠16', '藍39', '紅3', 'H31快捷', 'H62快捷'] },
      { name: '台南火車站(北站)', routes: ['0左', '2', '5', '18', '19', '綠幹線', '紅幹線'] },
      { name: '台南火車站(南站)', routes: ['1', '6', '14', '99', '藍幹線'] }
    ],
    '左營': [
      { name: '高鐵左營站', routes: ['紅35', '紅50', '紅60', '藍24', '3', '16', '90', '92'] },
      { name: '新左營東站', routes: ['紅51', '301', '環狀168東'] }
    ],
    '高雄': [
      { name: '高雄車站(中山路)', routes: ['12', '26', '28', '36', '52', '53', '69', '100', '301'] },
      { name: '高雄車站(建國路)', routes: ['53', '73', '88', '248', '紅27'] }
    ],
    '花蓮': [
      { name: '花蓮轉運站', routes: ['301', '302', '303', '1121', '1122', '1133', '1141'] }
    ],
    '台東': [
      { name: '台東火車站', routes: ['8101', '8103', '8119', '市區公車(陸路)', '台灣好行'] }
    ]
  };

  const matched = presets[cleanName];
  if (matched) {
    return matched.map((m, idx) => ({
      StationID: `MOCK_ST_${cleanName}_${idx}`,
      StationUID: `MOCK_ST_${cleanName}_${idx}`,
      StationName: { Zh_tw: m.name },
      StationAddress: `${cleanName}市區轉乘區`,
      Stops: m.routes.map((r, rIdx) => ({
        RouteID: `MOCK_RT_${cleanName}_${idx}_${rIdx}`,
        RouteName: { Zh_tw: r }
      }))
    }));
  }

  return [
    {
      StationID: `MOCK_ST_${cleanName}_0`,
      StationUID: `MOCK_ST_${cleanName}_0`,
      StationName: { Zh_tw: `${cleanName}火車站(前站)` },
      StationAddress: `${cleanName}站前廣場`,
      Stops: [
        { RouteID: 'MOCK_R1', RouteName: { Zh_tw: '101' } },
        { RouteID: 'MOCK_R2', RouteName: { Zh_tw: '202' } },
        { RouteID: 'MOCK_R3', RouteName: { Zh_tw: `${cleanName}市區公車` } },
        { RouteID: 'MOCK_R4', RouteName: { Zh_tw: '藍線' } }
      ]
    },
    {
      StationID: `MOCK_ST_${cleanName}_1`,
      StationUID: `MOCK_ST_${cleanName}_1`,
      StationName: { Zh_tw: `${cleanName}公車轉運站` },
      StationAddress: `${cleanName}站旁路口`,
      Stops: [
        { RouteID: 'MOCK_R5', RouteName: { Zh_tw: '綠17' } },
        { RouteID: 'MOCK_R6', RouteName: { Zh_tw: '紅5' } },
        { RouteID: 'MOCK_R7', RouteName: { Zh_tw: '快捷幹線' } }
      ]
    }
  ];
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

async function requestBookingDeepLink(path: string, query: URLSearchParams): Promise<string> {
  const response = await fetch(`/api/tdx/maas/booking/deeplink/${path}?${query.toString()}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => null);
  const url = findBookingDeepLink(payload);

  if (!response.ok || !url) {
    throw new Error(
      typeof payload?.error?.msg === 'string'
        ? payload.error.msg
        : 'Unable to create booking link',
    );
  }
  return url;
}

/** Resolve a booking UUID returned by the MaaS routing API into a TRA app link. */
export function getTRABookingDeepLinkByUuid(uuid: string): Promise<string> {
  const query = new URLSearchParams({ uuid });
  return requestBookingDeepLink('url/tra', query);
}

/** Resolve a booking UUID returned by the MaaS routing API into a T-EX app link. */
export function getHSRBookingDeepLinkByUuid(uuid: string): Promise<string> {
  const query = new URLSearchParams({ uuid });
  return requestBookingDeepLink('url/hsr', query);
}

/** Request a short-lived Taiwan Railways e-booking app deeplink through TDX OAuth. */
export async function getTRABookingDeepLink(params: TRABookingDeepLinkParams): Promise<string> {
  const query = new URLSearchParams({
    start_station: params.startStation,
    end_station: params.endStation,
    train_date: params.trainDate,
    train_number: params.trainNumber,
  });
  return requestBookingDeepLink('direct/tra', query);
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
  return requestBookingDeepLink('direct/hsr', query);
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
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}&lang=${encodeURIComponent(lang)}`);
    if (!res.ok) return [];
    const j = await res.json();
    return Array.isArray(j?.results) ? (j.results as GeoPlace[]) : [];
  } catch {
    return [];
  }
}
