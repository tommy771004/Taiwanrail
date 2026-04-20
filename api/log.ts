import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';

// 允許的枚舉值
const VALID_TRANSPORT = new Set(['hsr', 'train']);
const VALID_TRIP_TYPE = new Set(['one-way', 'round-trip']);
const VALID_DEVICE    = new Set(['mobile', 'tablet', 'desktop']);

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

    // 從 Vercel Edge Network 請求標頭取得地理資訊（無需呼叫外部 API）
    const countryCode = trunc(req.headers['x-vercel-ip-country'],       10);
    const region      = trunc(req.headers['x-vercel-ip-country-region'], 20);
    const city        = trunc(req.headers['x-vercel-ip-city'],           80);

    const tripType = typeof b.tripType === 'string' && VALID_TRIP_TYPE.has(b.tripType)
      ? b.tripType : null;
    const deviceType = typeof b.deviceType === 'string' && VALID_DEVICE.has(b.deviceType)
      ? b.deviceType : null;

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
        country_code,       region,             city
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
        ${countryCode},                     ${region},      ${city}
      )
    `;

    return res.status(200).json({ ok: true });
  } catch (err) {
    // 記錄伺服器錯誤但對前端回傳成功，避免影響使用者體驗
    console.error('[query-log] DB insert failed:', err);
    return res.status(200).json({ ok: true });
  }
}
