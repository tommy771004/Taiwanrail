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

// 使用者偏好（跨造訪保存）：'granted' 允許 / 'denied' 取消或拒絕
const PREF_KEY = '_rl_geo_pref';
export type GeoPref = 'granted' | 'denied' | null;
export function getGeoPref(): GeoPref {
  try {
    const v = localStorage.getItem(PREF_KEY);
    return v === 'granted' || v === 'denied' ? v : null;
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

export function isGeoSupported(): boolean {
  try {
    return typeof navigator !== 'undefined' && 'geolocation' in navigator;
  } catch {
    return false;
  }
}

/** 請求一次定位（包裝成 Promise，含逾時）。成功會同步寫入模組儲存。 */
export function requestGeolocation(timeoutMs = 8000): Promise<GeoCoords> {
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
          resolve(g);
        },
        (err) => reject(err),
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 5 * 60_000 },
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
