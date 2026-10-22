/**
 * 高鐵對號座剩餘座位（TDX v2）。純函式，供 api.ts 與測試共用，不碰 DOM／Node。
 *
 * 兩個來源，依查詢日期擇一：
 * - 今天：AvailableSeatStatusList（車站看板，整份一個 URL）。只列各站「即將發車」的班次，
 *   每班車再列出到各停靠站的座位狀態，所以要找 StationID = 起站、StopStations 裡 = 迄站的那格。
 *   當天較晚的班次不在看板上，就不顯示座位（不改打其他 API）。
 * - 其他日期：AvailableSeatStatus/Train/OD/{起}/to/{迄}/TrainDate/{日期}，一次拿到該起迄日全部班次。
 *
 * 狀態只有三級，沒有剩餘張數；看板用 O/L/X，OD 用 Available/Limited/Full，兩種都收。
 * 讀不懂的值一律略過，不猜成「有位」。
 */
export type SeatLevel = 'available' | 'limited' | 'full';

export interface TrainSeatStatus {
  standard?: SeatLevel;
  business?: SeatLevel;
}

export interface ThsrSeatResult {
  /** key 為去掉前導零的車次（"0803" 與 "803" 視為同一班） */
  seats: Record<string, TrainSeatStatus>;
  /** TDX 的 UpdateTime（ISO 字串），沒有就 undefined */
  updateTime?: string;
}

export function seatTrainKey(trainNo: unknown): string {
  const s = trainNo == null ? '' : String(trainNo).trim();
  return /^\d+$/.test(s) ? String(Number(s)) : s;
}

export function parseSeatLevel(raw: unknown): SeatLevel | undefined {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (s === 'o' || s === 'available') return 'available';
  if (s === 'l' || s === 'limited') return 'limited';
  if (s === 'x' || s === 'full') return 'full';
  return undefined;
}

/** 2026-07 版規格把資料陣列從 Items 改名為 AvailableSeats；兩者與裸陣列都接受。 */
function rowsOf(payload: unknown): any[] {
  if (Array.isArray(payload)) return payload;
  const p = payload as { AvailableSeats?: unknown; Items?: unknown } | null;
  if (Array.isArray(p?.AvailableSeats)) return p!.AvailableSeats as any[];
  if (Array.isArray(p?.Items)) return p!.Items as any[];
  return [];
}

function updateTimeOf(payload: unknown): string | undefined {
  const t = (payload as { UpdateTime?: unknown } | null)?.UpdateTime;
  return typeof t === 'string' && t ? t : undefined;
}

function statusOf(row: any): TrainSeatStatus | null {
  const standard = parseSeatLevel(row?.StandardSeatStatus);
  const business = parseSeatLevel(row?.BusinessSeatStatus);
  if (!standard && !business) return null;
  return { standard, business };
}

/** 今天：從整份車站看板挑出 起站 → 迄站 的座位狀態。 */
export function seatsFromStationBoard(payload: unknown, originId: string, destId: string): ThsrSeatResult {
  const seats: Record<string, TrainSeatStatus> = {};
  for (const row of rowsOf(payload)) {
    if (String(row?.StationID ?? '') !== originId) continue;
    const key = seatTrainKey(row?.TrainNo);
    if (!key) continue;
    const stops = Array.isArray(row?.StopStations) ? row.StopStations : [];
    const stop = stops.find((s: any) => String(s?.StationID ?? '') === destId);
    const status = stop ? statusOf(stop) : null;
    if (status) seats[key] = status;
  }
  return { seats, updateTime: updateTimeOf(payload) };
}

/** 其他日期：OD API 已是該起迄的結果，只需依車次建索引（仍核對起迄，防止回傳整份）。 */
export function seatsFromOD(payload: unknown, originId: string, destId: string): ThsrSeatResult {
  const seats: Record<string, TrainSeatStatus> = {};
  for (const row of rowsOf(payload)) {
    const o = row?.OriginStationID;
    const d = row?.DestinationStationID;
    if ((o != null && String(o) !== originId) || (d != null && String(d) !== destId)) continue;
    const key = seatTrainKey(row?.TrainNo);
    if (!key) continue;
    const status = statusOf(row);
    if (status) seats[key] = status;
  }
  return { seats, updateTime: updateTimeOf(payload) };
}
