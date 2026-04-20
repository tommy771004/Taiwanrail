/**
 * logger.ts
 * 使用者查詢行為記錄工具（前端）
 *
 * - fire-and-forget：不阻塞 UI，失敗時靜默忽略
 * - session_id 存於 sessionStorage，每開新分頁重置
 * - user-agent / geo 資訊由後端 API 補充，前端只送 UI 狀態
 */

let _sessionId: string | null = null;

/** 取得或建立當前 session ID（UUID v4，存於 sessionStorage） */
function getSessionId(): string {
  if (_sessionId) return _sessionId;
  try {
    const stored = sessionStorage.getItem('ql_session_id');
    if (stored) {
      _sessionId = stored;
      return _sessionId;
    }
    const newId = crypto.randomUUID();
    sessionStorage.setItem('ql_session_id', newId);
    _sessionId = newId;
    return _sessionId;
  } catch {
    // Private browsing 或 storage 被封鎖時，回傳暫時 ID
    _sessionId = crypto.randomUUID();
    return _sessionId;
  }
}

/** 依視窗寬度判斷裝置類型 */
function getDeviceType(): 'mobile' | 'tablet' | 'desktop' {
  const w = window.innerWidth;
  if (w < 768)  return 'mobile';
  if (w < 1024) return 'tablet';
  return 'desktop';
}

export interface QueryLogPayload {
  transport_type: 'hsr' | 'train';
  origin_id:      string;
  dest_id:        string;
  origin_name?:   string;
  dest_name?:     string;
  trip_type:      'one-way' | 'round-trip';
  travel_date:    string;          // 'YYYY-MM-DD'
  return_date?:   string;          // 'YYYY-MM-DD'，僅來回票
  language:       string;          // i18n 語系
  active_filter:  string;          // 目前選擇的排序方式
  result_count?:  number;          // 查詢後取得的班次數
  latency_ms?:    number;          // 前端感知延遲
}

/**
 * 送出查詢 log（非阻塞）
 * 在 fetchTimetable 完成後呼叫，帶入結果數與延遲時間
 */
export function logQuery(payload: QueryLogPayload): void {
  // 在本機開發環境（localhost）不送 log，避免污染資料
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') return;

  const body = {
    ...payload,
    session_id:      getSessionId(),
    viewport_w:      window.innerWidth,
    viewport_h:      window.innerHeight,
    device_type:     getDeviceType(),
    client_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    referrer:        document.referrer || null,
  };

  // keepalive 確保即使使用者立即離頁，請求仍能送達
  fetch('/api/log-query', {
    method:    'POST',
    headers:   { 'Content-Type': 'application/json' },
    body:      JSON.stringify(body),
    keepalive: true,
  }).catch(() => {
    // 靜默失敗，記錄問題不應影響使用者體驗
  });
}
