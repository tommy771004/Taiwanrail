/**
 * api/log-pageview.ts
 * 記錄使用者進入網站時的裝置資訊與大略地理位置
 *
 * 對應 DB 建表 SQL（首次部署前執行一次）：
 *
 *   CREATE TABLE IF NOT EXISTS page_view_logs (
 *     id           BIGSERIAL PRIMARY KEY,
 *     session_id   VARCHAR(36),
 *     language     VARCHAR(20),
 *     timezone     VARCHAR(60),
 *     device_type  VARCHAR(10),
 *     screen_width  INT,
 *     screen_height INT,
 *     viewport_w   INT,
 *     viewport_h   INT,
 *     user_agent   VARCHAR(300),
 *     referrer     VARCHAR(500),
 *     page_path    VARCHAR(200),
 *     country_code VARCHAR(10),
 *     region       VARCHAR(20),
 *     city         VARCHAR(80),
 *     postal_code  VARCHAR(20),
 *     latitude     DOUBLE PRECISION,
 *     longitude    DOUBLE PRECISION,
 *     ip_timezone  VARCHAR(60),
 *     created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   );
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';

const VALID_DEVICE = new Set(['mobile', 'tablet', 'desktop']);

function trunc(val: unknown, maxLen: number): string | null {
  if (typeof val !== 'string' || val.length === 0) return null;
  return val.slice(0, maxLen);
}

function safeInt(val: unknown): number | null {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 && n < 100000 ? Math.trunc(n) : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // CORS：只允許同源與已知正式域名
  const origin = (req.headers['origin'] as string) || '';
  const allowedOriginPattern = /^https?:\/\/(localhost(:\d+)?|taiwanrail\.vercel\.app|[\w-]+\.vercel\.app)$/;
  if (origin && !allowedOriginPattern.test(origin)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.setHeader('Access-Control-Allow-Origin', origin || '*');

  // 若 DATABASE_URL 未設定（如本機未配 DB），直接回傳成功
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return res.status(200).json({ ok: true });
  }

  try {
    const b = req.body ?? {};

    // 從 Vercel Edge Network 請求標頭取得地理資訊（無需呼叫外部 API）
    const countryCode = trunc(req.headers['x-vercel-ip-country'],        10);
    const region      = trunc(req.headers['x-vercel-ip-country-region'], 20);
    const city        = trunc(req.headers['x-vercel-ip-city'],           80);
    const postalCode  = trunc(req.headers['x-vercel-ip-postal-code'],    20);
    const ipTimezone  = trunc(req.headers['x-vercel-ip-timezone'],       60);
    const latRaw      = req.headers['x-vercel-ip-latitude'];
    const lngRaw      = req.headers['x-vercel-ip-longitude'];
    const latitude    = typeof latRaw === 'string' ? parseFloat(latRaw) : null;
    const longitude   = typeof lngRaw === 'string' ? parseFloat(lngRaw) : null;

    const deviceType = typeof b.deviceType === 'string' && VALID_DEVICE.has(b.deviceType)
      ? b.deviceType : null;

    const sql = neon(dbUrl);

    await sql`
      INSERT INTO page_view_logs (
        session_id,
        language,       timezone,
        device_type,    screen_width,  screen_height,
        viewport_w,     viewport_h,
        user_agent,     referrer,      page_path,
        country_code,   region,        city,
        postal_code,    latitude,      longitude,
        ip_timezone
      ) VALUES (
        ${trunc(b.sessionId, 36)},
        ${trunc(b.language, 20)},       ${trunc(b.timezone, 60)},
        ${deviceType},                  ${safeInt(b.screenWidth)},  ${safeInt(b.screenHeight)},
        ${safeInt(b.viewportW)},        ${safeInt(b.viewportH)},
        ${trunc(b.userAgent, 300)},     ${trunc(b.referrer, 500)},  ${trunc(b.pagePath, 200)},
        ${countryCode},                 ${region},                  ${city},
        ${postalCode},                  ${latitude},                ${longitude},
        ${ipTimezone}
      )
    `;

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[page-view-log] DB insert failed:', err);
    return res.status(200).json({ ok: true });
  }
}
