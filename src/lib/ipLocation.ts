/**
 * ipLocation.ts — 裝置的「網路位置」：由 Vercel 依連線 IP 推得的城市級座標
 * （x-vercel-ip-latitude / x-vercel-ip-longitude，見 /api/ip-geo）。
 *
 * 用途只有一個：使用者從沒按過定位鈕、瀏覽器也沒授權時，給台鐵／高鐵／捷運的起站一個初始值。
 * 它不是使用者授權的定位，所以：
 * - 不進 geo.ts 的 _currentGeo、_rl_geo_saved、_rl_geo_nearest，也不當成 App 的 geoCoords；
 * - 不寫進 query_logs 的 geo_*（那三欄只放瀏覽器定位；IP 座標另由 /api/log 從同一組 header 寫入
 *   latitude / longitude，見 db/query_logs.sql）；
 * - 不顯示距離，不當成公車／單車地圖上的「我的位置」。
 * 行動網路的 IP 常被定位到別的城市（多半是臺北），所以只能當預填，任何定位、選站都會蓋過它。
 *
 * 前半是純函式（Function 與 server.ts 共用），後半是瀏覽器端取用（每個分頁一次，存 sessionStorage）。
 */

export interface IpLocation {
  lat: number;
  lon: number;
  /** 城市名（英文，Vercel 提供）；沒有時為 null */
  city: string | null;
}

/** 從請求 header 解析 Vercel 的 IP 定位；缺欄位、非數字、超出範圍或 (0,0) 都回傳 null，絕不補預設值。 */
export function ipLocationFromHeaders(get: (name: string) => string | undefined): IpLocation | null {
  const lat = Number.parseFloat(get('x-vercel-ip-latitude') ?? '');
  const lon = Number.parseFloat(get('x-vercel-ip-longitude') ?? '');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null;
  let city: string | null = null;
  const rawCity = get('x-vercel-ip-city');
  if (rawCity) {
    try {
      city = decodeURIComponent(rawCity).slice(0, 80) || null;
    } catch {
      city = rawCity.slice(0, 80) || null;
    }
  }
  return { lat, lon, city };
}

/** 回應是給單一訪客的，不能讓 CDN 把一個人的城市交給下一個人。 */
export const IP_GEO_CACHE_CONTROL = 'private, no-store';

export function parseIpLocation(value: unknown): IpLocation | null {
  if (!value || typeof value !== 'object') return null;
  const { lat, lon, city } = value as Partial<IpLocation>;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, city: typeof city === 'string' && city ? city : null };
}

// ── 瀏覽器端 ────────────────────────────────────────────────────────────────

const SESSION_KEY = '_rl_ip_geo';
let _pending: Promise<IpLocation | null> | null = null;

/**
 * 取得網路位置。同一個分頁只打一次 /api/ip-geo（連「沒有位置」也記住），重新整理沿用 sessionStorage。
 * 本機（server.ts 沒有 Vercel header）、失敗或回應不是 JSON 都回傳 null。
 */
export function getIpLocation(): Promise<IpLocation | null> {
  if (_pending) return _pending;
  _pending = (async () => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) return parseIpLocation(JSON.parse(raw).v);
    } catch {
      /* 讀不到就重抓 */
    }
    let loc: IpLocation | null = null;
    // 只記住確定的答案：204（Vercel 沒給位置）或 200 且內容是 JSON。5xx、非 JSON 的 200
    // （例如 vite 把這個路徑當 SPA 回 index.html）、網路錯誤都不記，下次載入再問。
    let definite = false;
    try {
      const res = await fetch('/api/ip-geo', { cache: 'no-store' });
      if (res.status === 204) {
        definite = true;
      } else if (res.status === 200 && (res.headers.get('content-type') || '').includes('application/json')) {
        loc = parseIpLocation(await res.json());
        definite = true;
      }
    } catch {
      loc = null;
      definite = false;
    }
    if (definite) {
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ v: loc }));
      } catch {
        /* ignore */
      }
    }
    return loc;
  })();
  return _pending;
}
