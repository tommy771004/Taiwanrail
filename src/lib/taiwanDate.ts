/**
 * src/lib/taiwanDate.ts
 * 台北時區日曆日的共用工具，全站唯一的一份實作。
 *
 * 全站的日期字串（時刻表查詢、每日快照檔名、車站人流資料集、查詢紀錄）都是「台北的
 * 日曆日」，與瀏覽器或執行環境所在時區無關。這裡有兩個各自獨立的陷阱：
 *
 * 1. 取星期：`new Date('2026-08-24').getDay()` 是錯的。該字串被解析成 UTC 午夜，再用
 *    「本地」星期讀出——在 UTC+8 剛好對，在 UTC-7 就會退回前一天，把週二的時刻表當成
 *    週一去比對 ServiceDay。一律用 UTC 午夜 + getUTCDay()，讓結果只由字串本身決定。
 * 2. 取今天：`new Date().toISOString().slice(0, 10)` 是 UTC 的今天，不是台北的今天。
 *    台北時間 08:00 之前，它會少一天。一律走 Asia/Taipei 的 Intl 格式化。
 *
 * 台灣沒有日光節約，所以日期字串一旦定了，加減天數可以直接在 UTC 上算。
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 0 = 週日 … 6 = 週六；字串不是 YYYY-MM-DD 時回傳 null。 */
export function taiwanWeekdayIndex(date: string): number | null {
  const match = DATE_RE.exec(date);
  if (!match) return null;
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(utc.getTime()) ? null : utc.getUTCDay();
}

/**
 * 把某個時間點格式化成台北的日曆日 YYYY-MM-DD。
 * 用 formatToParts 逐段組字串，不依賴 locale 的分隔符輸出。
 */
export function taiwanDateOf(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** 台北「現在」的日曆日 + offsetDays，格式 YYYY-MM-DD。 */
export function taiwanDateString(offsetDays = 0): string {
  const today = taiwanDateOf();
  if (offsetDays === 0) return today;
  const match = DATE_RE.exec(today);
  if (!match) return today;
  const shifted = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + offsetDays),
  );
  return shifted.toISOString().slice(0, 10);
}
