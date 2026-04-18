// Station → transfer (mass-transit / airport) mapping.
// Keyed by Zh_tw station name to tolerate TRA vs THSR StationID collisions
// (both systems reuse "1000" etc. for different cities).

export interface Transfer {
  /** Short label shown on badge — keep to <= 4 CJK chars */
  label: string;
  /** Longer tooltip shown on hover */
  detail: string;
  /** Color theme (Tailwind palette key) */
  color: 'pink' | 'red' | 'blue' | 'green' | 'brown' | 'orange' | 'purple' | 'amber' | 'cyan' | 'slate';
}

// Maps Zh_tw station name → list of transfers available at that station.
// Covers TRA / THSR interchanges with metro, light rail, airport and BRT.
const TRANSFERS: Record<string, Transfer[]> = {
  // ===== Taipei MRT =====
  '臺北':   [{ label: '北捷',  detail: '台北捷運 板南線 / 淡水信義線', color: 'blue' }],
  '台北':   [{ label: '北捷',  detail: '台北捷運 板南線 / 淡水信義線', color: 'blue' }],
  '南港':   [{ label: '北捷',  detail: '台北捷運 板南線 / 文湖線',       color: 'brown' }],
  '板橋':   [{ label: '北捷',  detail: '台北捷運 板南線',              color: 'blue' }],
  '松山':   [{ label: '北捷',  detail: '台北捷運 松山新店線',           color: 'green' }],
  '萬華':   [{ label: '北捷',  detail: '台北捷運 板南線 (步行至龍山寺站)', color: 'slate' }],
  '圓山':   [{ label: '北捷',  detail: '台北捷運 淡水信義線',           color: 'red' }],

  // ===== Taoyuan Airport MRT =====
  '桃園':   [{ label: '機捷',  detail: '桃園捷運 機場線 (A18 高鐵桃園站)', color: 'purple' }],
  '中壢':   [{ label: '機捷',  detail: '桃園捷運 機場線 (A21 環北站)',    color: 'purple' }],

  // ===== Taichung MRT =====
  '臺中':   [{ label: '中捷',  detail: '台中捷運 綠線 (台鐵新烏日站)',    color: 'green' }],
  '台中':   [{ label: '中捷',  detail: '台中捷運 綠線 (台鐵新烏日站)',    color: 'green' }],
  '新烏日': [{ label: '中捷',  detail: '台中捷運 綠線',                color: 'green' }],

  // ===== Kaohsiung MRT / Light Rail =====
  '新左營': [{ label: '高捷',  detail: '高雄捷運 紅線 R16 左營站',        color: 'red' }],
  '左營':   [{ label: '高捷',  detail: '高雄捷運 紅線 R16 左營站',        color: 'red' }],
  '高雄':   [{ label: '高捷',  detail: '高雄捷運 紅線 R11 / 環狀輕軌 C8', color: 'red' }],
  '美麗島': [{ label: '高捷',  detail: '高雄捷運 紅線 / 橘線',           color: 'orange' }],

  // ===== Airports =====
  '高鐵桃園': [{ label: '桃機', detail: '桃園國際機場 (機場捷運一站直達)', color: 'cyan' }],

  // ===== HSR ↔ TRA connections =====
  '高鐵新竹': [{ label: '台鐵', detail: '台鐵六家線 六家站轉乘',          color: 'amber' }],
  '高鐵嘉義': [{ label: '台鐵', detail: 'BRT 嘉義公車捷運 / 台鐵轉乘',     color: 'amber' }],
  '高鐵台南': [{ label: '台鐵', detail: '台鐵沙崙線 沙崙站轉乘',          color: 'amber' }],
  '高鐵臺中': [{ label: '台鐵', detail: '台鐵新烏日站 / 台中捷運綠線',     color: 'green' }],
};

// Tailwind class lookup — static so Tailwind's JIT can pick them up.
export const TRANSFER_COLOR: Record<Transfer['color'], string> = {
  pink:   'bg-pink-50 text-pink-700 border-pink-100',
  red:    'bg-red-50 text-red-700 border-red-100',
  blue:   'bg-blue-50 text-blue-700 border-blue-100',
  green:  'bg-emerald-50 text-emerald-700 border-emerald-100',
  brown:  'bg-amber-50 text-amber-800 border-amber-100',
  orange: 'bg-orange-50 text-orange-700 border-orange-100',
  purple: 'bg-purple-50 text-purple-700 border-purple-100',
  amber:  'bg-yellow-50 text-yellow-800 border-yellow-100',
  cyan:   'bg-cyan-50 text-cyan-700 border-cyan-100',
  slate:  'bg-slate-100 text-slate-600 border-slate-200',
};

export function getTransfers(stationName?: string | null): Transfer[] {
  if (!stationName) return [];
  return TRANSFERS[stationName] || [];
}
