/**
 * api/feedback.ts
 * 接收使用者意見回饋並寫入資料庫
 *
 * 對應 DB 建表 SQL（首次部署前執行一次）：
 *
 *   CREATE TABLE IF NOT EXISTS feedbacks (
 *     id           BIGSERIAL PRIMARY KEY,
 *     session_id   VARCHAR(36),
 *     message      TEXT NOT NULL,
 *     language     VARCHAR(20),
 *     timezone     VARCHAR(60),
 *     device_type  VARCHAR(10),
 *     user_agent   VARCHAR(300),
 *     page_path    VARCHAR(200),
 *     country_code VARCHAR(10),
 *     region       VARCHAR(20),
 *     city         VARCHAR(80),
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const origin = (req.headers['origin'] as string) || '';
  const allowedOriginPattern = /^https?:\/\/(localhost(:\d+)?|taiwanrail\.vercel\.app|[\w-]+\.vercel\.app)$/;
  if (origin && !allowedOriginPattern.test(origin)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.setHeader('Access-Control-Allow-Origin', origin || '*');

  const b = req.body ?? {};
  const message = typeof b.message === 'string' ? b.message.trim().slice(0, 5000) : '';
  if (!message) {
    return res.status(400).json({ error: 'Empty message' });
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return res.status(200).json({ ok: true });
  }

  try {
    const countryCode = trunc(req.headers['x-vercel-ip-country'],        10);
    const region      = trunc(req.headers['x-vercel-ip-country-region'], 20);
    const city        = trunc(req.headers['x-vercel-ip-city'],           80);
    const ipTimezone  = trunc(req.headers['x-vercel-ip-timezone'],       60);

    const deviceType = typeof b.deviceType === 'string' && VALID_DEVICE.has(b.deviceType)
      ? b.deviceType : null;

    const sql = neon(dbUrl);

    await sql`
      INSERT INTO feedbacks (
        session_id,
        message,
        language,       timezone,
        device_type,    user_agent,    page_path,
        country_code,   region,        city,
        ip_timezone
      ) VALUES (
        ${trunc(b.sessionId, 36)},
        ${message},
        ${trunc(b.language, 20)},       ${trunc(b.timezone, 60)},
        ${deviceType},                  ${trunc(b.userAgent, 300)},  ${trunc(b.pagePath, 200)},
        ${countryCode},                 ${region},                   ${city},
        ${ipTimezone}
      )
    `;

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[feedback] DB insert failed:', err);
    return res.status(500).json({ error: 'Failed to save feedback' });
  }
}
