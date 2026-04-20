import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';

/**
 * POST /api/log-query
 *
 * 接收前端送來的查詢 log，補充 Vercel IP 地理資訊後寫入 Neon PostgreSQL。
 * 此 endpoint 僅接受內部前端呼叫，不對外開放。
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 只允許 POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 資料庫連線（HTTP driver，適合 Vercel serverless 無常駐連線環境）
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[log-query] DATABASE_URL not configured');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  const sql = neon(databaseUrl);

  try {
    const {
      session_id,
      transport_type,
      origin_id,
      dest_id,
      origin_name,
      dest_name,
      trip_type,
      travel_date,
      return_date,
      language,
      active_filter,
      result_count,
      latency_ms,
      viewport_w,
      viewport_h,
      device_type,
      client_timezone,
      referrer,
    } = req.body ?? {};

    // 基本欄位驗證
    if (!session_id || !transport_type || !origin_id || !dest_id || !trip_type || !travel_date) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Vercel 自動注入的 IP 地理資訊 headers（城市級精度，無需使用者授權）
    const ip_country = (req.headers['x-vercel-ip-country']         as string) || null;
    const ip_region  = (req.headers['x-vercel-ip-country-region']  as string) || null;
    const ip_city    = (req.headers['x-vercel-ip-city']            as string) || null;
    const ip_lat_raw = req.headers['x-vercel-ip-latitude']  as string | undefined;
    const ip_lon_raw = req.headers['x-vercel-ip-longitude'] as string | undefined;
    const ip_lat     = ip_lat_raw  ? parseFloat(ip_lat_raw)  : null;
    const ip_lon     = ip_lon_raw  ? parseFloat(ip_lon_raw)  : null;

    // User-Agent 由後端取，防止前端偽造
    const user_agent = (req.headers['user-agent'] as string) || null;

    await sql`
      INSERT INTO query_logs (
        session_id,
        transport_type, origin_id, dest_id, origin_name, dest_name,
        trip_type, travel_date, return_date,
        language, active_filter, result_count, latency_ms,
        ip_country, ip_region, ip_city, ip_lat, ip_lon,
        user_agent, referrer,
        viewport_w, viewport_h, device_type, client_timezone
      ) VALUES (
        ${session_id},
        ${transport_type}, ${origin_id}, ${dest_id},
        ${origin_name ?? null}, ${dest_name ?? null},
        ${trip_type}, ${travel_date}, ${return_date ?? null},
        ${language ?? null}, ${active_filter ?? null},
        ${result_count ?? null}, ${latency_ms ?? null},
        ${ip_country}, ${ip_region}, ${ip_city}, ${ip_lat}, ${ip_lon},
        ${user_agent}, ${referrer ?? null},
        ${viewport_w ?? null}, ${viewport_h ?? null},
        ${device_type ?? null}, ${client_timezone ?? null}
      )
    `;

    return res.status(200).json({ ok: true });
  } catch (err) {
    // 不將 DB 錯誤細節暴露給前端
    console.error('[log-query] DB write error:', err);
    return res.status(500).json({ error: 'Failed to write log' });
  }
}
