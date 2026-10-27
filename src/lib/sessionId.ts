/**
 * sessionId.ts
 * 這個瀏覽器的匿名識別碼，供查詢 log、意見回饋與推廣事件共用同一個 ID。
 *
 * 存在 localStorage：同一個瀏覽器跨分頁、關掉重開都是同一個 ID，/api/log 靠它判斷
 * 「同一個人今天已查過同起迄」。它只是隨機 UUID，不含裝置或個人資訊；無痕模式、清除
 * 瀏覽資料或換瀏覽器就會換一個。
 */

const STORAGE_KEY = '_rl_sid';

/** 取得或建立這個瀏覽器的 ID；storage 不可用時回傳 'unknown'。 */
export function getSessionId(): string {
  try {
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      // 舊版存在 sessionStorage；已開著的分頁沿用原 ID，避免升級當下同一查詢被記兩次。
      try { id = sessionStorage.getItem(STORAGE_KEY); } catch { /* ignore */ }
      id = id || crypto.randomUUID();
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    return 'unknown';
  }
}
