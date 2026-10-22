/**
 * 台鐵路線間（支線）轉乘站，顯示在列車明細的停靠站上（例：二水「西部幹線 ⇄ 集集線」）。
 *
 * 來源是 TDX v3 Rail/TRA/LineTransfer（2026-10-22 快照：scripts/tra-transfer-snapshot/，
 * npm run test:tra-line-transfers 核對一致）。TDX 每站只給一個方向（From → To），但同一站
 * 兩個方向都能轉，所以畫面用 ⇄。note 是 TDX 的 TransferDescription，去掉了條列編號。
 *
 * 以台鐵 StationID 為 key：只能用在台鐵停靠站，高鐵 StationID 會撞號（見 CLAUDE.md）。
 * 這是同站換月台，不是出站轉乘，所以不進 transfers.ts / TransferMapModal
 * （那裡的通用步驟是「出站、刷卡進站」）。
 */
export interface TraLineTransfer {
  stationId: string;
  stationName: string;
  fromLine: string;
  fromLineEn: string;
  toLine: string;
  toLineEn: string;
  /** TDX MinTransferTime（分鐘） */
  minTransferMinutes: number;
  /** 月台提示，例如瑞芳「3 月臺：平溪線、深澳線」 */
  note: string;
}

export const TRA_LINE_TRANSFERS: readonly TraLineTransfer[] = [
  { stationId: '3430', stationName: '二水', fromLine: '西部幹線', fromLineEn: 'Western Main Line', toLine: '集集線', toLineEn: 'Jiji Line', minTransferMinutes: 3, note: '' },
  { stationId: '6000', stationName: '臺東', fromLine: '南迴線', fromLineEn: 'South Link Line', toLine: '東部幹線', toLineEn: 'Eastern Main Line', minTransferMinutes: 3, note: '' },
  { stationId: '1190', stationName: '北新竹', fromLine: '西部幹線', fromLineEn: 'Western Main Line', toLine: '內灣線', toLineEn: 'Neiwan Line', minTransferMinutes: 3, note: '1 月臺：西部幹線；2 月臺：六家／內灣線' },
  { stationId: '2260', stationName: '追分', fromLine: '西部幹線 (海線)', fromLineEn: 'Western Main Line (Coast Line)', toLine: '成追線', toLineEn: 'Chengzhui Line', minTransferMinutes: 3, note: '' },
  { stationId: '0920', stationName: '八堵', fromLine: '西部幹線', fromLineEn: 'Western Main Line', toLine: '東部幹線', toLineEn: 'Eastern Main Line', minTransferMinutes: 3, note: '' },
  { stationId: '4270', stationName: '中洲', fromLine: '西部幹線', fromLineEn: 'Western Main Line', toLine: '沙崙線', toLineEn: 'Shalun Line', minTransferMinutes: 3, note: '' },
  { stationId: '7360', stationName: '瑞芳', fromLine: '東部幹線', fromLineEn: 'Eastern Main Line', toLine: '深澳線', toLineEn: 'Shenao Line', minTransferMinutes: 3, note: '3 月臺：平溪線、深澳線' },
  { stationId: '3360', stationName: '彰化', fromLine: '西部幹線', fromLineEn: 'Western Main Line', toLine: '西部幹線 (海線)', toLineEn: 'Western Main Line (Coast Line)', minTransferMinutes: 3, note: '' },
  { stationId: '5000', stationName: '屏東', fromLine: '西部幹線', fromLineEn: 'Western Main Line', toLine: '南迴線', toLineEn: 'South Link Line', minTransferMinutes: 3, note: '' },
  { stationId: '7330', stationName: '三貂嶺', fromLine: '東部幹線', fromLineEn: 'Eastern Main Line', toLine: '平溪線', toLineEn: 'Pingxi Line', minTransferMinutes: 3, note: '' },
  { stationId: '1250', stationName: '竹南', fromLine: '西部幹線', fromLineEn: 'Western Main Line', toLine: '西部幹線 (海線)', toLineEn: 'Western Main Line (Coast Line)', minTransferMinutes: 3, note: '' },
  { stationId: '3350', stationName: '成功', fromLine: '西部幹線', fromLineEn: 'Western Main Line', toLine: '成追線', toLineEn: 'Chengzhui Line', minTransferMinutes: 3, note: '' },
  { stationId: '1193', stationName: '竹中', fromLine: '內灣線', fromLineEn: 'Neiwan Line', toLine: '六家線', toLineEn: 'Liujia Line', minTransferMinutes: 3, note: '' },
  { stationId: '7130', stationName: '蘇澳新', fromLine: '東部幹線', fromLineEn: 'Eastern Main Line', toLine: '蘇澳新-蘇澳', toLineEn: "Su'aoxin-Su'ao", minTransferMinutes: 3, note: '' },
];

const BY_STATION = new Map(TRA_LINE_TRANSFERS.map(t => [t.stationId, t]));

/** 台鐵停靠站的路線轉乘資訊；不是轉乘站回 undefined。只能傳台鐵 StationID。 */
export function getTraLineTransfer(traStationId: string | undefined): TraLineTransfer | undefined {
  return traStationId ? BY_STATION.get(traStationId) : undefined;
}
