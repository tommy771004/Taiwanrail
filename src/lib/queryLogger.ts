/**
 * queryLogger.ts
 * 使用者查詢行為記錄工具（Fire-and-forget，不影響主流程）
 */

export interface QueryLogPayload {
  transportType: string;
  originStationId: string;
  originStationName: string;
  destStationId: string;
  destStationName: string;
  queryDate: string;
  tripType: string;
  returnDate?: string;
  activeFilter: string;
  resultCount: number;
}

/** 取得或建立本次瀏覽器分頁的 session ID */
function getSessionId(): string {
  try {
    let id = sessionStorage.getItem('_rl_sid');
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('_rl_sid', id);
    }
    return id;
  } catch {
    return 'unknown';
  }
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

  try {
    const body = JSON.stringify({
      ...payload,
      sessionId:    getSessionId(),
      language:     navigator.language,
      timezone:     Intl.DateTimeFormat().resolvedOptions().timeZone,
      deviceType:   getDeviceType(),
      screenWidth:  window.screen.width,
      screenHeight: window.screen.height,
      userAgent:    navigator.userAgent.slice(0, 300),
    });

    // keepalive 確保頁面切換時請求仍會送出
    fetch('/api/log', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => { /* 靜默忽略 */ });
  } catch {
    // 靜默忽略所有例外
  }
}
