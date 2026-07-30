/**
 * 每日時刻表 (per-date daily timetable) — 壓縮格式定義與解碼。
 *
 * `GeneralTrainTimetable` 只描述「一週」的行駛樣式 (ServiceDay)，抓不到加開車、
 * 臨時停駛與改點。所以 `scripts/fetch-tdx-data.ts` 另外抓未來 DAILY_WINDOW_DAYS
 * 天的 TDX 每日時刻表，寫成 `public/data/{tra,thsr}-daily/{YYYY-MM-DD}.json`。
 *
 * TDX 原始每日回應約 3.3 MB／天（台鐵），14 天直接存進 repo 每次更新會產生
 * ~46 MB 的 git blob。因此檔案改存壓縮格式：站名等可由車站資料還原的欄位一律
 * 省略，停靠站壓成 `"stationID,arrival,departure[,1]"` 字串，體積約為原始的 1/6
 * （~0.5 MB／天），前端也只需下載當天那一支檔案而不是 3.5 MB 的全週時刻表。
 *
 * 編碼在 `scripts/tdx-daily-timetable.ts`，解碼在此，格式由
 * `scripts/daily-timetable.test.ts` 的 round-trip 測試綁住。
 */

export type DailyRail = 'TRA' | 'THSR';

/**
 * 抓取／保留的天數（含今天）。刻意對齊 App.tsx 日期選擇器提供的「今天起 14 天」，
 * 使用者選得到的每一天都有當日快照；改這個值時要一起改選擇器，否則兩邊會不一致。
 * 視窗外的日期（含過去）不保留檔案，前端讀不到就退回全週時刻表。
 */
export const DAILY_WINDOW_DAYS = 14;

/**
 * 一支每日檔案至少要有幾班車才視為可信。低於門檻代表 TDX 回了不完整的資料，
 * 寧可退回全週時刻表，也不要讓使用者看到空白或缺一半的班次。
 */
export const DAILY_MIN_TRAINS: Record<DailyRail, number> = { TRA: 300, THSR: 50 };

/** 旗標在壓縮字串中的固定順序。 */
export const DAILY_FLAG_ORDER = [
  'WheelChairFlag',
  'BikeFlag',
  'DiningFlag',
  'BreastFeedFlag',
  'PackageServiceFlag',
  'CarFlag',
  'ExtraTrainFlag',
] as const;

export interface CompactDailyTrain {
  /** TrainNo */
  n: string;
  /** TrainTypeID */
  ty?: string;
  /** TrainTypeCode */
  tc?: string;
  /** TrainTypeName.Zh_tw */
  tz?: string;
  /** TrainTypeName.En */
  te?: string;
  /** StartingStationID */
  ss?: string;
  /** EndingStationID */
  es?: string;
  /** Direction */
  d?: number;
  /** TripLine */
  tl?: number;
  /** OverNightStationID */
  ov?: string;
  /** Note（中文） */
  nz?: string;
  /** DAILY_FLAG_ORDER 順序的 '0'/'1' 字串 */
  f?: string;
  /** 停靠站：`"stationID,arrivalTime,departureTime[,1 = 停靠取消]"` */
  st: string[];
}

export interface CompactDailyTimetable {
  Rail: DailyRail;
  TrainDate: string;
  /** TDX 來源的更新時間，方便判斷資料新舊。 */
  UpdateTime?: string;
  Trains: CompactDailyTrain[];
}

export interface DecodedDailyStop {
  StopSequence: number;
  StationID: string;
  StationName: { Zh_tw: string; En?: string };
  ArrivalTime: string;
  DepartureTime: string;
  SuspendedFlag: number;
}

export interface DecodedDailyTrain {
  TrainDate: string;
  /** 已正規化成 App 讀得懂的形狀（旗標兩種拼法都給，Note 統一為物件）。 */
  TrainInfo: Record<string, any>;
  StopTimes: DecodedDailyStop[];
}

export type StationNameLookup = (
  stationId: string,
) => { Zh_tw: string; En?: string } | undefined;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isDailyDateString(value: unknown): value is string {
  return typeof value === 'string' && DATE_PATTERN.test(value);
}

/** 把時間點格式化成台灣時區的 YYYY-MM-DD（台灣無日光節約，可直接加天數）。 */
export function taipeiDateString(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** 從 `from` 起算連續 `days` 天的台灣日期字串（含當天）。 */
export function taipeiDateWindow(
  days: number = DAILY_WINDOW_DAYS,
  from: Date = new Date(),
): string[] {
  const dates: string[] = [];
  for (let i = 0; i < Math.max(0, days); i += 1) {
    dates.push(taipeiDateString(new Date(from.getTime() + i * 86_400_000)));
  }
  return dates;
}

/**
 * 驗證並取出壓縮每日時刻表。形狀不對、日期不符或班次數低於門檻都回 null，
 * 呼叫端就會退回全週時刻表。
 */
export function parseCompactDaily(
  payload: unknown,
  expected?: { rail?: DailyRail; date?: string },
): CompactDailyTimetable | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const candidate = payload as Partial<CompactDailyTimetable>;
  const rail = candidate.Rail;
  if (rail !== 'TRA' && rail !== 'THSR') return null;
  if (!isDailyDateString(candidate.TrainDate)) return null;
  if (!Array.isArray(candidate.Trains)) return null;
  if (expected?.rail && expected.rail !== rail) return null;
  if (expected?.date && expected.date !== candidate.TrainDate) return null;
  if (candidate.Trains.length < DAILY_MIN_TRAINS[rail]) return null;

  return {
    Rail: rail,
    TrainDate: candidate.TrainDate,
    UpdateTime: candidate.UpdateTime,
    Trains: candidate.Trains as CompactDailyTrain[],
  };
}

function decodeFlags(flags: string | undefined): Record<string, number> {
  const decoded: Record<string, number> = {};
  DAILY_FLAG_ORDER.forEach((name, index) => {
    decoded[name] = flags?.[index] === '1' ? 1 : 0;
  });
  // App.tsx 讀的是 v2/v3 正規化後的拼法，兩種都給以免徽章消失。
  decoded.WheelchairFlag = decoded.WheelChairFlag;
  decoded.BreastFeedingFlag = decoded.BreastFeedFlag;
  return decoded;
}

function decodeStop(
  encoded: string,
  index: number,
  lookup?: StationNameLookup,
): DecodedDailyStop | null {
  const [stationId, arrival, departure, suspended] = encoded.split(',');
  if (!stationId) return null;
  return {
    StopSequence: index + 1,
    StationID: stationId,
    StationName: lookup?.(stationId) ?? { Zh_tw: '' },
    ArrivalTime: arrival || departure || '',
    DepartureTime: departure || arrival || '',
    SuspendedFlag: suspended === '1' ? 1 : 0,
  };
}

/** 把壓縮每日時刻表還原成與全週時刻表相同的 `{ TrainInfo, StopTimes }` 形狀。 */
export function decodeCompactDaily(
  timetable: CompactDailyTimetable,
  lookup?: StationNameLookup,
): DecodedDailyTrain[] {
  return timetable.Trains.map((train) => {
    const stops = train.st
      .map((stop, index) => decodeStop(stop, index, lookup))
      .filter((stop): stop is DecodedDailyStop => stop !== null);

    return {
      TrainDate: timetable.TrainDate,
      TrainInfo: {
        TrainNo: train.n,
        TrainTypeID: train.ty ?? '',
        TrainTypeCode: train.tc ?? '',
        TrainTypeName: { Zh_tw: train.tz ?? '', En: train.te ?? '' },
        StartingStationID: train.ss ?? '',
        StartingStationName: train.ss ? lookup?.(train.ss) ?? { Zh_tw: '' } : { Zh_tw: '' },
        EndingStationID: train.es ?? '',
        EndingStationName: train.es ? lookup?.(train.es) ?? { Zh_tw: '' } : { Zh_tw: '' },
        Direction: train.d,
        TripLine: train.tl,
        OverNightStationID: train.ov ?? '',
        Note: { Zh_tw: train.nz ?? '' },
        ...decodeFlags(train.f),
      },
      StopTimes: stops,
    };
  });
}
