/**
 * api/youbike.ts
 * 回傳離給定座標最近的 YouBike2.0 站點即時資訊（臺北市公共自行車）。
 * 資料來源：data.taipei dataset c6bc8aed-557d-41d5-bfb1-8da24f78f2fb
 * 後端代理避免瀏覽器 CORS / CSP，並把整包資料縮成單一最近站點（前端每 3 秒輪詢）。
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

const FEED = 'https://tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json';
const MAX_DISTANCE_M = 1500; // 超過此距離視為「附近無站點」(此資料僅含臺北市)

// 暖機實例內快取，避免每次輪詢都打上游（上游約 3 秒更新一次）
let cache: { at: number; data: any[] } | null = null;

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers['origin'] as string) || '';
  const allowedOriginPattern = /^https?:\/\/(localhost(:\d+)?|taiwanrail\.vercel\.app|[\w-]+\.vercel\.app)$/;
  if (origin && !allowedOriginPattern.test(origin)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.setHeader('Access-Control-Allow-Origin', origin || '*');

  const lat = num(req.query.lat);
  const lon = num(req.query.lon);
  if (lat === null || lon === null) {
    return res.status(400).json({ error: 'lat/lon required' });
  }

  try {
    const now = Date.now();
    if (!cache || now - cache.at > 3000) {
      const r = await fetch(FEED);
      const j = await r.json();
      // v2 為陣列；舊格式為 { retVal: { sno: {...} } }
      const arr = Array.isArray(j) ? j : j?.retVal ? Object.values(j.retVal) : [];
      cache = { at: now, data: arr as any[] };
    }

    let best: any = null;
    let bestD = Infinity;
    for (const it of cache.data) {
      const sLat = num(it.lat ?? it.latitude);
      const sLon = num(it.lng ?? it.longitude);
      if (sLat === null || sLon === null) continue;
      const d = haversineM(lat, lon, sLat, sLon);
      if (d < bestD) {
        bestD = d;
        best = it;
      }
    }

    if (!best || bestD > MAX_DISTANCE_M) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ station: null });
    }

    const bikes = num(best.sbi ?? best.available_rent_bikes) ?? 0;
    const docks = num(best.bemp ?? best.available_return_bikes) ?? 0;
    const total = num(best.tot ?? best.total) ?? bikes + docks;
    const name = String(best.sna ?? best.name_tw ?? '').replace(/^YouBike2?\.?0?_?/i, '');
    const nameEn = String(best.snaen ?? best.name_en ?? '').replace(/^YouBike2?\.?0?_?/i, '');

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      station: {
        name,
        nameEn,
        lat: num(best.lat ?? best.latitude),
        lng: num(best.lng ?? best.longitude),
        bikes,
        docks,
        total,
        distance: Math.round(bestD),
        updateTime: best.mday ?? best.updateTime ?? best.srcUpdateTime ?? null,
        act: String(best.act ?? '1'),
      },
    });
  } catch (err) {
    console.error('[youbike] fetch failed:', err);
    return res.status(200).json({ station: null, error: 'fetch_failed' });
  }
}
