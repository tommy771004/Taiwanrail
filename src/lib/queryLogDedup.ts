/**
 * queryLogDedup.ts
 * 瀏覽器端的查詢 log 去重：同一個瀏覽器在同一個台北日曆日內，同運具 + 同起迄 + 同乘車日期
 * 只送一次 /api/log。
 *
 * /api/log 自己也會去重（同 session、同台北日、同一組鍵就不 INSERT），但要先叫起 Function
 * 才知道重複；這裡先擋掉，省下那次執行。鍵與伺服器端完全相同（active_filter 不在鍵裡），
 * 而且只在伺服器回 2xx 之後才標記，所以這裡跳過的，伺服器本來也不會寫入。
 * session 取不到（'unknown'）時伺服器不去重，呼叫端也不該用這裡。
 */

const STORAGE_KEY = '_rl_log_seen';
/** 一天內記住的鍵數上限，超過就丟最舊的（最壞只是多送一次，由伺服器去重）。 */
const MAX_KEYS = 200;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export interface QueryLogKeyInput {
  transportType: string;
  originStationId: string;
  destStationId?: string;
  queryDate: string;
}

/** 台北時間的日曆日（YYYY-MM-DD），與 /api/log 去重用的 date_trunc('day', … 'Asia/Taipei') 一致。 */
export function taipeiDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function queryLogKey(p: QueryLogKeyInput): string {
  return JSON.stringify([p.transportType, p.originStationId, p.destStationId ?? null, p.queryDate]);
}

function readKeys(storage: StorageLike, day: string): string[] {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null');
    if (parsed && parsed.day === day && Array.isArray(parsed.keys)) {
      return parsed.keys.filter((k: unknown): k is string => typeof k === 'string');
    }
  } catch {
    /* 壞掉或被手改的值當作沒記過 */
  }
  return [];
}

export function wasLoggedToday(storage: StorageLike, key: string, now: Date = new Date()): boolean {
  return readKeys(storage, taipeiDay(now)).includes(key);
}

export function markLoggedToday(storage: StorageLike, key: string, now: Date = new Date()): void {
  const day = taipeiDay(now);
  const keys = readKeys(storage, day).filter((k) => k !== key);
  keys.push(key);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ day, keys: keys.slice(-MAX_KEYS) }));
  } catch {
    /* storage 滿了或不可用：下次照送，由伺服器去重 */
  }
}
