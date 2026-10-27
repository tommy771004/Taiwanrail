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
// 只是預填——本次定位、深連結與手動選站都會蓋過它。過期後曾允許的使用者會再被詢問一次（App.tsx）。
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
export function requestGeolocation(timeoutMs = 8000, maximumAgeMs = 5 * 60_000): Promise<GeoCoords> {
  return new Promise((resolve, reject) => {
    if (!isGeoSupported()) {
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
          resolve(g);
        },
        (err) => {
          if (err && err.code === 1) setGeoPref('denied');
          reject(err);
        },
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: maximumAgeMs },
      );
    } catch (err) {
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
