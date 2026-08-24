/**
 * api/feedback.ts
 * 接收使用者意見回饋並寫入資料庫
 *
 * 對應 DB 建表 SQL：db/feedbacks.sql（首次部署前對 DATABASE_URL 執行一次）。
 * DDL 以前只以註解形式躺在這裡，全新建庫時無從執行；現在 db/ 是單一來源，
 * scripts/db-schema.test.ts 會確保下面的 INSERT 欄位與那份 DDL 不會走鐘。
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { createHmac, randomUUID } from 'node:crypto';
import { allowBrowserOrigin } from '../src/lib/tdxProxyAccessPolicy.js';

const VALID_DEVICE = new Set(['mobile', 'tablet', 'desktop']);

// Inlined (do NOT extract to a sibling api/*.ts module): Vercel Node under
// "type":"module" fails at runtime with ERR_MODULE_NOT_FOUND for local imports.
function sendTelemetry(name: string, properties: Record<string, string | number | boolean | null> = {}): void {
  const url = process.env.TELEMETRY_INGEST_URL;
  const project = process.env.TELEMETRY_PROJECT_KEY;
  const key = process.env.TELEMETRY_INGEST_KEY;
  if (!url || !project || !key) return;

  const event = {
    id: randomUUID(),
    name,
    source: 'server' as const,
    occurredAt: new Date().toISOString(),
    properties,
  };
  const raw = JSON.stringify({ events: [event] });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `sha256=${createHmac('sha256', key).update(`${timestamp}.`).update(raw).digest('hex')}`;

  void fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telemetry-project': project,
      'x-telemetry-timestamp': timestamp,
      'x-telemetry-signature': signature,
    },
    body: raw,
  }).catch((err) => console.warn('[telemetry] forward failed:', err instanceof Error ? err.message : String(err)));
}

function trunc(val: unknown, maxLen: number): string | null {
  if (typeof val !== 'string' || val.length === 0) return null;
  return val.slice(0, maxLen);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const origin = (req.headers['origin'] as string) || '';
  const requestHost = (req.headers.host as string) || '';
  if (!allowBrowserOrigin({ origin, requestHost, method: 'POST' }).allow) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.setHeader('Access-Control-Allow-Origin', origin);

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

    sendTelemetry('feedback.submitted', {
      route: trunc(b.pagePath, 120) ?? '/',
      device_type: deviceType,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[feedback] DB insert failed:', err);
    return res.status(500).json({ error: 'Failed to save feedback' });
  }
}
