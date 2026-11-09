/**
 * geo.ts
 * 瀏覽器精準定位工具：請求權限、找最近車站、保存座標供 log 使用。
 * 使用者授權後座標會暫存於模組層，queryLogger 會自動帶入 page_view / query logs。
 */
import type { Station } from './api';

export interface GeoCoords {
  lat: number;
  lon: number;
  accuracy: number; // 公尺
}

// 模組層保存最近一次取得的精準座標，供 queryLogger 讀取。取消授權時清為 null。
let _currentGeo: GeoCoords | null = null;
export function getCurrentGeo(): GeoCoords | null {
  return _currentGeo;
}
export function setCurrentGeo(g: GeoCoords | null): void {
  _currentGeo = g;
}

// 使用者偏好（跨造訪保存）：'granted' 允許 / 'denied' 取消或拒絕 / 'prompted' 已於首次開頁詢問過
const PREF_KEY = '_rl_geo_pref';
export type GeoPref = 'granted' | 'denied' | 'prompted' | null;
export function getGeoPref(): GeoPref {
  try {
    const v = localStorage.getItem(PREF_KEY);
    return v === 'granted' || v === 'denied' || v === 'prompted' ? v : null;
  } catch {
    return null;
  }
}
export function setGeoPref(p: GeoPref): void {
  try {
    if (p === null) localStorage.removeItem(PREF_KEY);
    else localStorage.setItem(PREF_KEY, p);
  } catch {
    /* ignore */
  }
}

/** 是否為預渲染或自動化爬蟲環境（避免 SSG 建置或爬蟲觸發定位詢問） */
export function isAutomatedClient(): boolean {
  try {
    if (typeof navigator === 'undefined') return true;
    if (navigator.webdriver) return true;
    return /Prerender Bot|HeadlessChrome/i.test(navigator.userAgent || '');
  } catch {
    return false;
  }
}

/**
 * 瀏覽器目前的定位權限狀態。
 * 首次開啟（localStorage 尚無 _rl_geo_pref）時會主動請求定位並由原生瀏覽器詢問，
 * 允許或拒絕都會寫入 localStorage；之後再進入網站已有 localStorage 紀錄時，
 * 僅在 state === 'granted'（瀏覽器不會彈窗）時靜默定位；曾允許（_rl_geo_pref === 'granted'）
 * 但上次最近站的快取已過期時才再詢問一次，拒絕過就不再詢問。
 */
export type GeoPermission = 'granted' | 'prompt' | 'denied' | 'unknown';
export async function queryGeoPermission(): Promise<GeoPermission> {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unknown';
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return status.state;
  } catch {
    return 'unknown';
  }
}

// 上次定位得到的最近車站（只存車站 ID 不存座標），依 scope 分開：'train' / 'hsr' 的 StationID
// 互相撞號，捷運存成 '<system>:<stationId>'。超過 TTL 就不再自動帶入，免得人已換地方還帶舊站。
// TTL 必須遠長於 Safari 忘記授權的約 24 小時：原本 12 小時，每天開一次的回訪者兩頭落空，起站永遠是空的。
// 只是預填——本次定位、深連結與手動選站都會蓋過它；有按定位鈕留下的位置記錄（下方 _rl_geo_saved）時
// 以那筆為準。兩者都沒有（或都過期）時，曾允許的使用者會再被詢問一次（App.tsx）。
const NEAREST_KEY = '_rl_geo_nearest';
const NEAREST_TTL_MS = 30 * 24 * 60 * 60_000;
type NearestCache = Record<string, { id: string; at: number }>;
function readNearestCache(): NearestCache {
  try {
    const parsed = JSON.parse(localStorage.getItem(NEAREST_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
export function getCachedNearest(scope: string): string | null {
  const entry = readNearestCache()[scope];
  if (!entry || typeof entry.id !== 'string' || typeof entry.at !== 'number') return null;
  return Date.now() - entry.at <= NEAREST_TTL_MS ? entry.id : null;
}
export function setCachedNearest(scope: string, id: string): void {
  try {
    const cache = readNearestCache();
    cache[scope] = { id, at: Date.now() };
    localStorage.setItem(NEAREST_KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

// 使用者「按定位鈕」取得的位置記錄（台鐵／高鐵／捷運的定位鈕都會寫入，再按一次就覆寫）。
// 存座標而不是站 ID，三個運具共用一筆：在台鐵頁按過，切到高鐵或捷運也能由同一個位置算出最近站。
// 只當後備——開頁時能即時定位（瀏覽器已授權）就用即時位置，拿不到時才用這筆記錄帶入起站；
// 背景自動定位不會覆寫它。存的是按下當時的原始精度座標與 accuracy：本次造訪沒有即時定位時，
// queryLogger 以這筆寫入 geo_latitude / geo_longitude / geo_accuracy（見 getLogGeo）。
// 不寫進 _currentGeo——即時定位成功與否（App 的 geoStatus）仍以 _currentGeo 判斷。
const SAVED_LOCATION_KEY = '_rl_geo_saved';
const SAVED_LOCATION_TTL_MS = NEAREST_TTL_MS;
export interface SavedLocation {
  lat: number;
  lon: number;
  /** 公尺；舊格式記錄沒有這欄時為 null */
  accuracy: number | null;
  at: number;
}
export function getSavedLocation(): SavedLocation | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_LOCATION_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    const { lat, lon, at, accuracy } = parsed as Partial<SavedLocation>;
    if (typeof lat !== 'number' || typeof lon !== 'number' || typeof at !== 'number') return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    if (Date.now() - at > SAVED_LOCATION_TTL_MS) return null;
    const acc = typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null;
    return { lat, lon, accuracy: acc, at };
  } catch {
    return null;
  }
}
export function saveLocation(g: GeoCoords): void {
  try {
    const entry: SavedLocation = { lat: g.lat, lon: g.lon, accuracy: g.accuracy, at: Date.now() };
    localStorage.setItem(SAVED_LOCATION_KEY, JSON.stringify(entry));
  } catch {
    /* ignore */
  }
}

/**
 * query log 要帶的座標：本次造訪有即時定位（使用者同意、定位成功）就用即時位置；
 * 沒有（未同意、拒絕或逾時）就用最近一次按定位鈕記下的精度座標；兩者都沒有回傳 null。
 */
export function getLogGeo(): { lat: number; lon: number; accuracy: number | null } | null {
  return _currentGeo ?? getSavedLocation();
}

export function isGeoSupported(): boolean {
  try {
    return typeof navigator !== 'undefined' && 'geolocation' in navigator;
  } catch {
    return false;
  }
}

/**
 * 請求一次定位（包裝成 Promise，含逾時）。成功會同步寫入模組儲存。
 * maximumAgeMs：可接受多舊的快取位置。開頁自動定位用 5 分鐘即可；使用者按定位鈕要傳 0，
 * 否則瀏覽器會回傳最多 5 分鐘前的位置（搭捷運 5 分鐘就過好幾站）。
 */
let _pendingRequests = 0;
/** 目前是否有定位請求還沒回覆（含正在等使用者回應原生詢問），讓其他頁面別再重複詢問。 */
export function isGeoRequestPending(): boolean {
  return _pendingRequests > 0;
}

export function requestGeolocation(timeoutMs = 8000, maximumAgeMs = 5 * 60_000): Promise<GeoCoords> {
  _pendingRequests++;
  let settled = false;
  const done = () => {
    if (!settled) { settled = true; _pendingRequests--; }
  };
  return new Promise<GeoCoords>((resolve, reject) => {
    if (!isGeoSupported()) {
      done();
      reject(new Error('unsupported'));
      return;
    }
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const g: GeoCoords = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          };
          _currentGeo = g;
          setGeoPref('granted');
          done();
          resolve(g);
        },
        (err) => {
          if (err && err.code === 1) setGeoPref('denied');
          done();
          reject(err);
        },
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: maximumAgeMs },
      );
    } catch (err) {
      done();
      reject(err);
    }
  });
}

export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * 找出距離座標最近、且有座標資訊的車站。
 * maxKm：若最近車站仍超過此距離（例如人在國外），回傳 null 不自動帶入。
 */
export function findNearestStation(
  lat: number,
  lon: number,
  stations: Station[],
  maxKm = Infinity,
): Station | null {
  let best: Station | null = null;
  let bestDist = Infinity;
  for (const s of stations) {
    const p = s.StationPosition;
    if (!p || typeof p.PositionLat !== 'number' || typeof p.PositionLon !== 'number') continue;
    const d = haversineKm(lat, lon, p.PositionLat, p.PositionLon);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return bestDist <= maxKm ? best : null;
}
