/**
 * 台鐵支線轉乘：起訖之間沒有直達車時（臺北→十分、臺北→集集、臺北→六家…），
 * 在台鐵公布的轉乘站換一次車。純函式，不碰 DOM／網路；資料由 api.ts 的靜態時刻表提供。
 *
 * 轉乘站來自 TDX v3 Rail/TRA/LineTransfer（2026-10-22 快照：scripts/tra-transfer-snapshot/，
 * npm run test:tra-branch-transfers 核對兩者一致）。TDX 只給一個方向（主線 → 支線），但同一站
 * 反向一樣能轉，所以規劃時兩個方向都試。note 是 TDX 的 TransferDescription，去掉了條列編號。
 */
import type { DailyTimetableOD } from './api';

export interface TraLineTransfer {
  stationId: string;
  stationName: string;
  stationNameEn: string;
  /** TDX ToLineName：從主線在這站可轉的路線 */
  toLine: string;
  toLineEn: string;
  /** TDX MinTransferTime（分鐘） */
  minTransferMinutes: number;
  /** 月台提示，例如瑞芳「3 月臺：平溪線、深澳線」 */
  note: string;
}

export const TRA_LINE_TRANSFERS: readonly TraLineTransfer[] = [
  { stationId: '3430', stationName: '二水', stationNameEn: 'Ershui', toLine: '集集線', toLineEn: 'Jiji Line', minTransferMinutes: 3, note: '' },
  { stationId: '6000', stationName: '臺東', stationNameEn: 'Taitung', toLine: '東部幹線', toLineEn: 'Eastern Main Line', minTransferMinutes: 3, note: '' },
  { stationId: '1190', stationName: '北新竹', stationNameEn: 'North Hsinchu', toLine: '內灣線', toLineEn: 'Neiwan Line', minTransferMinutes: 3, note: '1 月臺：西部幹線；2 月臺：六家／內灣線' },
  { stationId: '2260', stationName: '追分', stationNameEn: 'Zhuifen', toLine: '成追線', toLineEn: 'Chengzhui Line', minTransferMinutes: 3, note: '' },
  { stationId: '0920', stationName: '八堵', stationNameEn: 'Badu', toLine: '東部幹線', toLineEn: 'Eastern Main Line', minTransferMinutes: 3, note: '' },
  { stationId: '4270', stationName: '中洲', stationNameEn: 'Zhongzhou', toLine: '沙崙線', toLineEn: 'Shalun Line', minTransferMinutes: 3, note: '' },
  { stationId: '7360', stationName: '瑞芳', stationNameEn: 'Ruifang', toLine: '深澳線', toLineEn: 'Shenao Line', minTransferMinutes: 3, note: '3 月臺：平溪線、深澳線' },
  { stationId: '3360', stationName: '彰化', stationNameEn: 'Changhua', toLine: '西部幹線 (海線)', toLineEn: 'Western Main Line (Coast Line)', minTransferMinutes: 3, note: '' },
  { stationId: '5000', stationName: '屏東', stationNameEn: 'Pingtung', toLine: '南迴線', toLineEn: 'South Link Line', minTransferMinutes: 3, note: '' },
  { stationId: '7330', stationName: '三貂嶺', stationNameEn: 'Sandiaoling', toLine: '平溪線', toLineEn: 'Pingxi Line', minTransferMinutes: 3, note: '' },
  { stationId: '1250', stationName: '竹南', stationNameEn: 'Zhunan', toLine: '西部幹線 (海線)', toLineEn: 'Western Main Line (Coast Line)', minTransferMinutes: 3, note: '' },
  { stationId: '3350', stationName: '成功', stationNameEn: 'Chenggong', toLine: '成追線', toLineEn: 'Chengzhui Line', minTransferMinutes: 3, note: '' },
  { stationId: '1193', stationName: '竹中', stationNameEn: 'Zhuzhong', toLine: '六家線', toLineEn: 'Liujia Line', minTransferMinutes: 3, note: '' },
  { stationId: '7130', stationName: '蘇澳新', stationNameEn: "Su'aoxin", toLine: '蘇澳新-蘇澳', toLineEn: "Su'aoxin-Su'ao", minTransferMinutes: 3, note: '' },
];

export interface TransferLegs {
  via: string;
  /** 起站 → 轉乘站 的班次 */
  first: DailyTimetableOD[];
  /** 轉乘站 → 迄站 的班次 */
  second: DailyTimetableOD[];
}

export interface BranchTransferPlan {
  first: DailyTimetableOD;
  second: DailyTimetableOD;
  via: TraLineTransfer;
  /** 起站出發、迄站抵達（分鐘，凌晨 0–3 點算成 24–27 點，與 App 的 timeToMinutes 一致） */
  departMin: number;
  arriveMin: number;
  /** 轉乘站等車分鐘數（≥ minTransferMinutes） */
  waitMinutes: number;
}

/** "HH:mm[:ss]" → 分鐘；凌晨 0–3 點視為前一天的 24–27 點（跨午夜的台鐵車次）。 */
export function serviceMinutes(time: string | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(time ?? '');
  if (!match) return null;
  const h = Number(match[1]);
  return (h < 4 ? h + 24 : h) * 60 + Number(match[2]);
}

const depOf = (t: DailyTimetableOD) => serviceMinutes(t.OriginStopTime?.DepartureTime);
const arrOf = (t: DailyTimetableOD) => serviceMinutes(t.DestinationStopTime?.ArrivalTime);
const trainNoOf = (t: DailyTimetableOD) => t.DailyTrainInfo?.TrainNo ?? '';

/**
 * 每一班第二段車，配上「趕得上它的最晚一班」第一段車（起站最晚出發＝等最少）。
 * 排除：兩段同一班車（車沒換，只是經過轉乘站）、等車時間不到 TDX 最短轉乘時間。
 * 最後只留沒被支配的方案：若另一方案出發不早於它、抵達不晚於它，它就沒有理由被選。
 */
export function planBranchTransfers(
  legs: readonly TransferLegs[],
  transfers: readonly TraLineTransfer[] = TRA_LINE_TRANSFERS,
): BranchTransferPlan[] {
  const byStation = new Map(transfers.map(t => [t.stationId, t]));
  const bySecondTrain = new Map<string, BranchTransferPlan>();

  for (const { via, first, second } of legs) {
    const station = byStation.get(via);
    if (!station) continue;
    for (const s of second) {
      const sDep = depOf(s);
      const sArr = arrOf(s);
      if (sDep === null || sArr === null || sArr < sDep) continue;
      let best: BranchTransferPlan | null = null;
      for (const f of first) {
        const fDep = depOf(f);
        const fArr = arrOf(f);
        if (fDep === null || fArr === null || fArr < fDep) continue;
        if (trainNoOf(f) && trainNoOf(f) === trainNoOf(s)) continue;
        const wait = sDep - fArr;
        if (wait < station.minTransferMinutes) continue;
        // 同一分鐘出發的兩班第一段車，取先到轉乘站的（轉乘餘裕較大，最後抵達時間一樣）
        if (!best || fDep > best.departMin || (fDep === best.departMin && wait > best.waitMinutes)) {
          best = { first: f, second: s, via: station, departMin: fDep, arriveMin: sArr, waitMinutes: wait };
        }
      }
      if (!best) continue;
      const key = trainNoOf(s) || `${via}:${sDep}`;
      const prev = bySecondTrain.get(key);
      if (!prev || best.departMin > prev.departMin) bySecondTrain.set(key, best);
    }
  }

  const plans = [...bySecondTrain.values()];
  const kept = plans.filter(p => !plans.some(q => q !== p
    && q.departMin >= p.departMin && q.arriveMin <= p.arriveMin
    && (q.departMin > p.departMin || q.arriveMin < p.arriveMin)));

  // 同一個出發時間、同一個抵達時間的方案只留一個（不同轉乘站其實是同兩班車時）
  const seen = new Set<string>();
  return kept
    .sort((a, b) => a.departMin - b.departMin || a.arriveMin - b.arriveMin)
    .filter(p => {
      const key = `${p.departMin}-${p.arriveMin}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
