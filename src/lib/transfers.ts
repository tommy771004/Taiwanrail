// Station → transfer (mass-transit / airport) mapping.
// Keyed by Zh_tw station name to tolerate TRA vs THSR StationID collisions
// (both systems reuse "1000" etc. for different cities). TRA stations use their
// TRA name (臺北, not 台北); THSR stations are looked up as 高鐵 + THSR name (高鐵台中).
//
// Checked 2026-10-22 against TDX v3 Rail/TRA/StationTransfer (snapshot in
// scripts/tra-transfer-snapshot/) and against station coordinates: every TRA station
// within walking distance of a metro / light-rail / THSR station in public/data has an
// entry here. TDX's own StationTransfer lists only parking and taxi in its structured
// fields, so it is a checklist (stations it maps as 「捷運」/「軌道運輸」), not a source of
// line names; npm run test:transfers pins the coverage.

export interface Transfer {
  /** Short label shown on badge — keep to <= 4 CJK chars */
  label: string;
  labelEn: string;
  /** Longer tooltip shown on hover */
  detail: string;
  detailEn: string;
  /** Color theme (Tailwind palette key) */
  color: 'pink' | 'red' | 'blue' | 'green' | 'brown' | 'orange' | 'purple' | 'amber' | 'cyan' | 'slate';
  /**
   * Straight-line metres between the two stations, set only when the transfer means
   * walking out to a separate station. TransferMapModal turns it into a walking time.
   */
  walkMeters?: number;
}

// Maps Zh_tw station name → list of transfers available at that station.
// Covers TRA / THSR interchanges with metro, light rail, airport and BRT.
const TRANSFERS: Record<string, Transfer[]> = {
  // ===== Taipei MRT =====
  '臺北': [
    { label: '高鐵', labelEn: 'HSR', detail: '台灣高鐵 台北站', detailEn: 'Taiwan HSR Taipei Station', color: 'orange' },
    { label: '北捷', labelEn: 'Taipei MRT', detail: '台北捷運 板南線 / 淡水信義線', detailEn: 'Taipei Metro Bannan & Tamsui-Xinyi Lines', color: 'blue' },
    { label: '機捷', labelEn: 'TY Metro', detail: '桃園捷運 機場線 A1 台北車站', detailEn: 'Taoyuan Airport MRT A1 Taipei Main Station', color: 'purple' },
  ],
  '南港': [
    { label: '高鐵', labelEn: 'HSR', detail: '台灣高鐵 南港站', detailEn: 'Taiwan HSR Nangang Station', color: 'orange' },
    { label: '北捷', labelEn: 'Taipei MRT', detail: '台北捷運 板南線', detailEn: 'Taipei Metro Bannan Line', color: 'blue' },
  ],
  '板橋': [
    { label: '高鐵', labelEn: 'HSR', detail: '台灣高鐵 板橋站', detailEn: 'Taiwan HSR Banqiao Station', color: 'orange' },
    { label: '北捷', labelEn: 'Taipei MRT', detail: '台北捷運 板南線', detailEn: 'Taipei Metro Bannan Line', color: 'blue' },
    { label: '環狀', labelEn: 'Circular', detail: '新北捷運 環狀線 Y16 板橋站', detailEn: 'New Taipei Metro Circular Line Y16 Banqiao Station', color: 'amber' },
  ],
  '松山':   [{ label: '北捷', labelEn: 'Taipei MRT', detail: '台北捷運 松山新店線', detailEn: 'Taipei Metro Songshan-Xindian Line', color: 'green' }],
  '萬華':   [{ label: '北捷', labelEn: 'Taipei MRT', detail: '台北捷運 板南線 (步行至龍山寺站)', detailEn: 'Taipei Metro Bannan Line (Walk to Longshan Temple)', color: 'slate', walkMeters: 210 }],
  '鶯歌':   [{ label: '三鶯', labelEn: 'Sanying', detail: '新北捷運 三鶯線 LB08 鶯歌車站', detailEn: 'New Taipei Metro Sanying Line LB08 Yingge Station', color: 'cyan', walkMeters: 200 }],

  // ===== Taoyuan Airport MRT =====
  '高鐵台北': [
    { label: '台鐵', labelEn: 'TRA', detail: '台鐵 台北車站', detailEn: 'TRA Taipei Station', color: 'amber' },
    { label: '北捷', labelEn: 'Taipei MRT', detail: '台北捷運 板南線 / 淡水信義線', detailEn: 'Taipei Metro Bannan & Tamsui-Xinyi Lines', color: 'blue' },
    { label: '機捷', labelEn: 'TY Metro', detail: '桃園捷運 機場線 A1 台北車站', detailEn: 'Taoyuan Airport MRT A1 Taipei Main Station', color: 'purple' },
  ],
  '高鐵南港': [
    { label: '台鐵', labelEn: 'TRA', detail: '台鐵 南港車站', detailEn: 'TRA Nangang Station', color: 'amber' },
    { label: '北捷', labelEn: 'Taipei MRT', detail: '台北捷運 板南線', detailEn: 'Taipei Metro Bannan Line', color: 'blue' },
  ],
  '高鐵板橋': [
    { label: '台鐵', labelEn: 'TRA', detail: '台鐵 板橋車站', detailEn: 'TRA Banqiao Station', color: 'amber' },
    { label: '北捷', labelEn: 'Taipei MRT', detail: '台北捷運 板南線', detailEn: 'Taipei Metro Bannan Line', color: 'blue' },
    { label: '環狀', labelEn: 'Circular', detail: '新北捷運 環狀線 Y16 板橋站', detailEn: 'New Taipei Metro Circular Line Y16 Banqiao Station', color: 'amber' },
  ],
  '高鐵桃園': [{ label: '機捷', labelEn: 'TY Metro', detail: '桃園捷運 機場線 A18 高鐵桃園站', detailEn: 'Taoyuan Airport MRT A18 Taoyuan HSR Station', color: 'purple' }],

  // ===== Taichung MRT =====
  '新烏日': [
    { label: '高鐵', labelEn: 'HSR', detail: '台灣高鐵 台中站', detailEn: 'Taiwan HSR Taichung Station', color: 'orange' },
    { label: '中捷', labelEn: 'TC Metro', detail: '台中捷運 綠線 G17 高鐵臺中站', detailEn: 'Taichung Metro Green Line G17 HSR Taichung Station', color: 'green' },
  ],

  '松竹':   [{ label: '中捷', labelEn: 'TC Metro', detail: '台中捷運 綠線 G4 松竹站', detailEn: 'Taichung Metro Green Line G4 Songzhu Station', color: 'green' }],
  '大慶':   [{ label: '中捷', labelEn: 'TC Metro', detail: '台中捷運 綠線 G13 大慶站', detailEn: 'Taichung Metro Green Line G13 Daqing Station', color: 'green' }],
  '烏日':   [{ label: '中捷', labelEn: 'TC Metro', detail: '台中捷運 綠線 G16 烏日站', detailEn: 'Taichung Metro Green Line G16 Wuri Station', color: 'green', walkMeters: 250 }],

  // ===== Kaohsiung MRT / Light Rail =====
  '新左營': [
    { label: '高鐵', labelEn: 'HSR', detail: '台灣高鐵 左營站', detailEn: 'Taiwan HSR Zuoying Station', color: 'orange' },
    { label: '高捷', labelEn: 'KH Metro', detail: '高雄捷運 紅線 R16 左營站', detailEn: 'Kaohsiung Metro Red Line R16 Zuoying Station', color: 'red' },
  ],
  '高鐵左營': [
    { label: '台鐵', labelEn: 'TRA', detail: '台鐵 新左營車站', detailEn: 'TRA Xinzuoying Station', color: 'amber' },
    { label: '高捷', labelEn: 'KH Metro', detail: '高雄捷運 紅線 R16 左營站', detailEn: 'Kaohsiung Metro Red Line R16 Zuoying Station', color: 'red' },
  ],
  '高雄':   [{ label: '高捷', labelEn: 'KH Metro', detail: '高雄捷運 紅線 R11 高雄車站', detailEn: 'Kaohsiung Metro Red Line R11 Kaohsiung Main Station', color: 'red' }],
  '岡山':   [{ label: '高捷', labelEn: 'KH Metro', detail: '高雄捷運 紅線 RK1 岡山車站', detailEn: 'Kaohsiung Metro Red Line RK1 Gangshan Station', color: 'red' }],
  '橋頭':   [{ label: '高捷', labelEn: 'KH Metro', detail: '高雄捷運 紅線 R23 橋頭火車站', detailEn: 'Kaohsiung Metro Red Line R23 Ciaotou Station', color: 'red' }],
  '楠梓':   [{ label: '高捷', labelEn: 'KH Metro', detail: '高雄捷運 紅線 (步行至 R21 都會公園站)', detailEn: 'Kaohsiung Metro Red Line (Walk to R21 Metropolitan Park)', color: 'slate', walkMeters: 440 }],
  '鼓山':   [{ label: '輕軌', labelEn: 'KH LRT', detail: '高雄輕軌 環狀線 C18 鼓山站', detailEn: 'Kaohsiung Circular LRT C18 Gushan Station', color: 'green' }],
  '美術館': [{ label: '輕軌', labelEn: 'KH LRT', detail: '高雄輕軌 環狀線 C20 臺鐵美術館站', detailEn: 'Kaohsiung Circular LRT C20 TRA Museum of Fine Arts Station', color: 'green' }],
  '科工館': [{ label: '輕軌', labelEn: 'KH LRT', detail: '高雄輕軌 環狀線 C30 科工館站', detailEn: 'Kaohsiung Circular LRT C30 National Science and Technology Museum Station', color: 'green' }],

  // ===== HSR ↔ TRA connections =====
  '六家': [{ label: '高鐵', labelEn: 'HSR', detail: '台灣高鐵 新竹站', detailEn: 'Taiwan HSR Hsinchu Station', color: 'orange' }],
  '沙崙': [{ label: '高鐵', labelEn: 'HSR', detail: '台灣高鐵 台南站', detailEn: 'Taiwan HSR Tainan Station', color: 'orange' }],
  '豐富': [{ label: '高鐵', labelEn: 'HSR', detail: '台灣高鐵 苗栗站', detailEn: 'Taiwan HSR Miaoli Station', color: 'orange' }],
  '高鐵新竹': [{ label: '台鐵', labelEn: 'TRA', detail: '台鐵六家線 六家站轉乘', detailEn: 'Transfer to TRA Liujia Line (Liujia Station)', color: 'amber' }],
  '高鐵苗栗': [{ label: '台鐵', labelEn: 'TRA', detail: '台鐵豐富站站外步行轉乘', detailEn: 'Walk transfer to TRA Fengfu Station', color: 'amber' }],
  '高鐵嘉義': [{ label: 'BRT', labelEn: 'BRT', detail: '嘉義 BRT 接駁台鐵嘉義站', detailEn: 'Chiayi BRT shuttle to TRA Chiayi Station', color: 'amber' }],
  '高鐵台南': [{ label: '台鐵', labelEn: 'TRA', detail: '台鐵沙崙線 沙崙站轉乘', detailEn: 'Transfer to TRA Shalun Line (Shalun Station)', color: 'amber' }],
  '高鐵台中': [
    { label: '台鐵', labelEn: 'TRA', detail: '台鐵新烏日站', detailEn: 'Transfer to TRA Xinwuri Station', color: 'amber' },
    { label: '中捷', labelEn: 'TC Metro', detail: '台中捷運 綠線 G17 高鐵臺中站', detailEn: 'Taichung Metro Green Line G17 HSR Taichung Station', color: 'green' },
  ],
};

// Tailwind class lookup — static so Tailwind's JIT can pick them up.
export const TRANSFER_COLOR: Record<Transfer['color'], string> = {
  pink:   'bg-pink-500/10 text-pink-400 border-transparent',
  red:    'bg-red-500/10 text-red-400 border-transparent',
  blue:   'bg-blue-500/10 text-blue-400 border-transparent',
  green:  'bg-emerald-500/10 text-emerald-400 border-transparent',
  brown:  'bg-amber-500/10 text-amber-400/90 border-transparent',
  orange: 'bg-orange-500/10 text-orange-400 border-transparent',
  purple: 'bg-purple-500/10 text-purple-400 border-transparent',
  amber:  'bg-yellow-500/10 text-yellow-400 border-transparent',
  cyan:   'bg-cyan-500/10 text-cyan-400 border-transparent',
  slate:  'bg-slate-500/15 text-slate-300 border-transparent',
};

export function getTransfers(stationName?: string | null): Transfer[] {
  if (!stationName) return [];
  return TRANSFERS[stationName] || [];
}
