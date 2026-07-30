/**
 * sessionId.ts
 * 本次瀏覽器分頁的匿名 session ID，供查詢 log 與推廣事件共用同一個識別碼。
 */

const STORAGE_KEY = '_rl_sid';

/** 取得或建立本次瀏覽器分頁的 session ID；storage 不可用時回傳 'unknown'。 */
export function getSessionId(): string {
  try {
    let id = sessionStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    return 'unknown';
  }
}
