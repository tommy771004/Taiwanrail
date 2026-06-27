// Station → transfer (mass-transit / airport) mapping.
// Keyed by Zh_tw station name to tolerate TRA vs THSR StationID collisions
// (both systems reuse "1000" etc. for different cities).

export interface Transfer {
  /** Short label shown on badge — keep to <= 4 CJK chars */
  label: string;
  labelEn: string;
  /** Longer tooltip shown on hover */
  detail: string;
  detailEn: string;
  /** Color theme (Tailwind palette key) */
  color: 'pink' | 'red' | 'blue' | 'green' | 'brown' | 'orange' | 'purple' | 'amber' | 'cyan' | 'slate';
}

// Maps Zh_tw station name → list of transfers available at that station.
// Covers TRA / THSR interchanges with metro, light rail, airport and BRT.
const TRANSFERS: Record<string, Transfer[]> = {
  // ===== Taipei MRT =====
  '臺北':   [{ label: '北捷', labelEn: 'Taipei MRT', detail: '台北捷運 板南線 / 淡水信義線', detailEn: 'Taipei Metro Bannan & Tamsui-Xinyi Lines', color: 'blue' }],
  '台北':   [{ label: '北捷', labelEn: 'Taipei MRT', detail: '台北捷運 板南線 / 淡水信義線', detailEn: 'Taipei Metro Bannan & Tamsui-Xinyi Lines', color: 'blue' }],
  '南港':   [{ label: '北捷', labelEn: 'Taipei MRT', detail: '台北捷運 板南線 / 文湖線', detailEn: 'Taipei Metro Bannan & Wenhu Lines', color: 'brown' }],
  '板橋':   [{ label: '北捷', labelEn: 'Taipei MRT', detail: '台北捷運 板南線', detailEn: 'Taipei Metro Bannan Line', color: 'blue' }],
  '松山':   [{ label: '北捷', labelEn: 'Taipei MRT', detail: '台北捷運 松山新店線', detailEn: 'Taipei Metro Songshan-Xindian Line', color: 'green' }],
  '萬華':   [{ label: '北捷', labelEn: 'Taipei MRT', detail: '台北捷運 板南線 (步行至龍山寺站)', detailEn: 'Taipei Metro Bannan Line (Walk to Longshan Temple)', color: 'slate' }],
  '圓山':   [{ label: '北捷', labelEn: 'Taipei MRT', detail: '台北捷運 淡水信義線', detailEn: 'Taipei Metro Tamsui-Xinyi Line', color: 'red' }],

  // ===== Taoyuan Airport MRT =====
  '桃園':   [{ label: '機捷', labelEn: 'TY Metro', detail: '桃園捷運 機場線 (A18 高鐵桃園站)', detailEn: 'Taoyuan Airport MRT (A18 HSR Taoyuan Station)', color: 'purple' }],
  '中壢':   [{ label: '機捷', labelEn: 'TY Metro', detail: '桃園捷運 機場線 (A21 環北站)', detailEn: 'Taoyuan Airport MRT (A21 Huanbei Station)', color: 'purple' }],

  // ===== Taichung MRT =====
  '臺中':   [{ label: '中捷', labelEn: 'TC Metro', detail: '台中捷運 綠線 (台鐵新烏日站)', detailEn: 'Taichung Metro Green Line (via Xinwuri Station)', color: 'green' }],
  '台中':   [{ label: '中捷', labelEn: 'TC Metro', detail: '台中捷運 綠線 (台鐵新烏日站)', detailEn: 'Taichung Metro Green Line (via Xinwuri Station)', color: 'green' }],
  '新烏日': [{ label: '中捷', labelEn: 'TC Metro', detail: '台中捷運 綠線', detailEn: 'Taichung Metro Green Line', color: 'green' }],

  // ===== Kaohsiung MRT / Light Rail =====
  '新左營': [{ label: '高捷', labelEn: 'KH Metro', detail: '高雄捷運 紅線 R16 左營站', detailEn: 'Kaohsiung Metro Red Line R16 Zuoying Station', color: 'red' }],
  '左營':   [{ label: '高捷', labelEn: 'KH Metro', detail: '高雄捷運 紅線 R16 左營站', detailEn: 'Kaohsiung Metro Red Line R16 Zuoying Station', color: 'red' }],
  '高雄':   [{ label: '高捷', labelEn: 'KH Metro', detail: '高雄捷運 紅線 R11 / 環狀輕軌 C8', detailEn: 'Kaohsiung Metro Red Line R11 / Circular LRT C8', color: 'red' }],
  '美麗島': [{ label: '高捷', labelEn: 'KH Metro', detail: '高雄捷運 紅線 / 橘線', detailEn: 'Kaohsiung Metro Red & Orange Lines', color: 'orange' }],

  // ===== Airports =====
  '高鐵桃園': [{ label: '桃機', labelEn: 'Airport', detail: '桃園國際機場 (機場捷運一站直達)', detailEn: 'Taoyuan International Airport (1 Stop via Airport MRT)', color: 'cyan' }],

  // ===== HSR ↔ TRA connections =====
  '高鐵新竹': [{ label: '台鐵', labelEn: 'TRA', detail: '台鐵六家線 六家站轉乘', detailEn: 'Transfer to TRA Liujia Line (Liujia Station)', color: 'amber' }],
  '高鐵嘉義': [{ label: '台鐵', labelEn: 'TRA', detail: 'BRT 嘉義公車捷運 / 台鐵轉乘', detailEn: 'Chiayi BRT (Express Bus) / TRA Transfer', color: 'amber' }],
  '高鐵台南': [{ label: '台鐵', labelEn: 'TRA', detail: '台鐵沙崙線 沙崙站轉乘', detailEn: 'Transfer to TRA Shalun Line (Shalun Station)', color: 'amber' }],
  '高鐵臺中': [{ label: '台鐵', labelEn: 'TRA', detail: '台鐵新烏日站 / 台中捷運綠線', detailEn: 'Transfer to TRA Xinwuri Station & Taichung Metro Green Line', color: 'green' }],
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
