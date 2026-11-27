/**
 * queryLogger.ts
 * 使用者查詢行為記錄工具（Fire-and-forget，不影響主流程）
 */
import { getLogGeo } from './geo';
import { getSessionId } from './sessionId';
import { markLoggedToday, queryLogKey, wasLoggedToday } from './queryLogDedup';

/** 同一分頁內正在送出的鍵，避免回應回來前同一查詢又送一次。 */
const inFlight = new Set<string>();

function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export interface QueryLogPayload {
  transportType: string;
  originStationId: string;
  originStationName: string;
  /** Omitted by the metro arrivals board, which has no destination (stored as NULL). */
  destStationId?: string;
  destStationName?: string;
  queryDate: string;
  /** Omitted where one-way / round-trip means nothing (the arrivals board). */
  tripType?: string;
  returnDate?: string;
  activeFilter: string;
  resultCount: number;
}

/** 依螢幕寬度判斷裝置類型 */
function getDeviceType(): 'mobile' | 'tablet' | 'desktop' {
  const w = window.innerWidth;
  if (w < 768)  return 'mobile';
  if (w < 1024) return 'tablet';
  return 'desktop';
}

/**
 * 記錄查詢行為至後端 /api/log
 * 完全非阻塞；任何失敗都被靜默吞掉，不影響 UX。
 */
export function logQuery(payload: QueryLogPayload): void {
  if (typeof window === 'undefined') return; // SSR guard

  // 本機開發不送 log，避免用開發流量污染正式資料。
  // 這個 guard 原本只存在於已廢棄的 lib/logger.ts（打的是不存在的 /api/log-query），
  // 這支取而代之時漏掉了，於是 localhost 照樣 POST /api/log —— server.ts 沒有這個
  // route，請求安靜地 404。行為上無害，但文件寫「localhost 不記錄」就變成假的。
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return;

  try {
    const sessionId = getSessionId();
    // 與 /api/log 相同的去重：今天已記過同一組查詢就不叫 Function。session 取不到時伺服器
    // 不去重（會把不同人併成一人），這裡也照送。
    const storage = sessionId !== 'unknown' ? localStorageOrNull() : null;
    const dedupKey = storage ? queryLogKey(payload) : null;
    if (storage && dedupKey) {
      if (inFlight.has(dedupKey) || wasLoggedToday(storage, dedupKey)) return;
      inFlight.add(dedupKey);
    }

    const geo = getLogGeo();
    const body = JSON.stringify({
      ...payload,
      sessionId,
      language:     navigator.language,
      timezone:     Intl.DateTimeFormat().resolvedOptions().timeZone,
      deviceType:   getDeviceType(),
      screenWidth:  window.screen.width,
      screenHeight: window.screen.height,
      userAgent:    navigator.userAgent.slice(0, 300),
      // 本次即時定位優先；沒有即時定位時用按定位鈕記下的精度座標（都沒有則為 null）
      geoLatitude:  geo?.lat ?? null,
      geoLongitude: geo?.lon ?? null,
      geoAccuracy:  geo?.accuracy ?? null,
    });

    // keepalive 確保頁面切換時請求仍會送出
    fetch('/api/log', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    })
      .then((res) => {
        // 只有伺服器收下（含它自己判定重複）才記住；失敗時下次照送，不會少一筆。
        if (res.ok && storage && dedupKey) markLoggedToday(storage, dedupKey);
      })
      .catch(() => { /* 靜默忽略 */ })
      .finally(() => {
        if (dedupKey) inFlight.delete(dedupKey);
      });
  } catch {
    // 靜默忽略所有例外
  }
}
