import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { createHmac, randomUUID } from 'node:crypto';
import { tryConsumeIpQuerySlot } from '../src/lib/queryThrottle';

// 允許的枚舉值
const VALID_TRANSPORT = new Set(['hsr', 'train', 'metro', 'planner']);
const VALID_TRIP_TYPE = new Set(['one-way', 'round-trip']);
const VALID_DEVICE    = new Set(['mobile', 'tablet', 'desktop']);

function clientIp(req: VercelRequest): string {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length > 0) return xf.split(',')[0].trim();
  if (Array.isArray(xf) && xf[0]) return String(xf[0]).split(',')[0].trim();
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real) return real;
  return 'unknown';
}

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

// 安全截斷字串
function trunc(val: unknown, maxLen: number): string | null {
  if (typeof val !== 'string') return null;
  return val.slice(0, maxLen) || null;
}

// 安全取整數
function safeInt(val: unknown): number | null {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

// 安全取浮點數（含範圍檢查）
function safeFloat(val: unknown, min: number, max: number): number | null {
  const n = Number(val);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

// 安全日期字串 → Date 或 null（防止 SQL injection）
function safeDate(val: unknown): Date | null {
  if (typeof val !== 'string') return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 僅允許 POST
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

  // 若 DATABASE_URL 未設定（如本機未配 DB），直接回傳成功，不阻礙 UX
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return res.status(200).json({ ok: true });
  }

  try {
    const b = req.body ?? {};

    // 驗證必填欄位
    const transportType = typeof b.transportType === 'string' && VALID_TRANSPORT.has(b.transportType)
      ? b.transportType : null;
    if (!transportType) {
      return res.status(400).json({ error: 'Invalid transportType' });
    }

    // Best-effort IP sliding window (10s/8). Skipped writes still return 200.
    if (!tryConsumeIpQuerySlot(clientIp(req))) {
      return res.status(200).json({ ok: true });
    }

    // 從 Vercel Edge Network 請求標頭取得地理資訊（無需呼叫外部 API）
    const countryCode = trunc(req.headers['x-vercel-ip-country'],       10);
    const region      = trunc(req.headers['x-vercel-ip-country-region'], 20);
    const city        = trunc(req.headers['x-vercel-ip-city'],           80);
    const postalCode  = trunc(req.headers['x-vercel-ip-postal-code'],    20);
    const ipTimezone  = trunc(req.headers['x-vercel-ip-timezone'],       60);
    const latRaw      = req.headers['x-vercel-ip-latitude'];
    const lngRaw      = req.headers['x-vercel-ip-longitude'];
    const latitude    = latRaw  ? parseFloat(latRaw  as string)  : null;
    const longitude   = lngRaw  ? parseFloat(lngRaw  as string)  : null;

    const tripType = typeof b.tripType === 'string' && VALID_TRIP_TYPE.has(b.tripType)
      ? b.tripType : null;
    const deviceType = typeof b.deviceType === 'string' && VALID_DEVICE.has(b.deviceType)
      ? b.deviceType : null;

    // 使用者授權的精準定位（瀏覽器 GPS）；未授權則為 null
    const geoLatitude  = safeFloat(b.geoLatitude,  -90,  90);
    const geoLongitude = safeFloat(b.geoLongitude, -180, 180);
    const geoAccuracy  = safeFloat(b.geoAccuracy,  0,    1e7);

    const sql = neon(dbUrl);

    await sql`
      INSERT INTO query_logs (
        session_id,
        transport_type,
        origin_station_id,  origin_station_name,
        dest_station_id,    dest_station_name,
        query_date,         trip_type,          return_date,
        active_filter,      result_count,
        language,           timezone,
        device_type,        screen_width,       screen_height,
        user_agent,
        country_code,       region,             city,
        postal_code,        latitude,           longitude,
        ip_timezone,
        geo_latitude,       geo_longitude,      geo_accuracy
      ) VALUES (
        ${trunc(b.sessionId, 36)},
        ${transportType},
        ${trunc(b.originStationId,   20)},  ${trunc(b.originStationName, 100)},
        ${trunc(b.destStationId,     20)},  ${trunc(b.destStationName,   100)},
        ${safeDate(b.queryDate)},           ${tripType},    ${safeDate(b.returnDate)},
        ${trunc(b.activeFilter, 50)},       ${safeInt(b.resultCount)},
        ${trunc(b.language,  20)},          ${trunc(b.timezone, 60)},
        ${deviceType},                      ${safeInt(b.screenWidth)},  ${safeInt(b.screenHeight)},
        ${trunc(b.userAgent, 300)},
        ${countryCode},                     ${region},      ${city},
        ${postalCode},                      ${latitude},    ${longitude},
        ${ipTimezone},
        ${geoLatitude},                     ${geoLongitude}, ${geoAccuracy}
      )
    `;

    sendTelemetry('route_search.completed', {
      transport_type: transportType,
      result_count: safeInt(b.resultCount) ?? 0,
      trip_type: tripType,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    // 記錄伺服器錯誤但對前端回傳成功，避免影響使用者體驗
    console.error('[query-log] DB insert failed:', err);
    return res.status(200).json({ ok: true });
  }
}
