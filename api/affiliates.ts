/**
 * api/affiliates.ts
 * 聯盟／合作推廣資料讀取 API — 規格 docs/affiliate-integration-spec.md §6
 *
 * 只讀 SUP_DATABASE_URL 指向的共用資料庫，且只回傳本專案
 * （AFFILIATE_PROJECT_NAME）啟用中的資料。SUP_DATABASE_URL 絕不可送到瀏覽器，
 * 未設定時也**不得**改用 DATABASE_URL 代替（§2.1）。
 *
 * 建表 SQL：db/affiliates.sql（在 SUP_DATABASE_URL 上執行）。
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { allowBrowserOrigin } from '../src/lib/tdxProxyAccessPolicy.js';
import {
  AFFILIATE_DEFAULT_PROJECT_NAME,
  parseAffiliateOffers,
} from '../src/lib/affiliates.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 純讀取端點：只接受安全方法。
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed', offers: [] });
  }

  const origin = (req.headers['origin'] as string) || '';
  const requestHost = (req.headers.host as string) || '';
  if (!allowBrowserOrigin({ origin, requestHost, method }).allow) {
    return res.status(403).json({ error: 'Forbidden', offers: [] });
  }
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);

  // §6.4：未設定 SUP_DATABASE_URL → 503 + 空清單，前端不顯示推廣區塊。
  const dbUrl = process.env.SUP_DATABASE_URL;
  if (!dbUrl) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ offers: [] });
  }

  // §2.1：每個消費端都要有自己的 AFFILIATE_PROJECT_NAME，未設定時用本專案正式名稱。
  const projectName = (process.env.AFFILIATE_PROJECT_NAME || '').trim() || AFFILIATE_DEFAULT_PROJECT_NAME;

  try {
    const sql = neon(dbUrl);

    // §6.2。project_name 以參數帶入（tagged template 會參數化，不做字串拼接）。
    const rows = await sql`
      SELECT
        project_name AS "projectName",
        id,
        enabled,
        sponsored,
        title,
        description,
        cta_label AS "ctaLabel",
        url,
        icon,
        categories,
        crops,
        priority,
        partner
      FROM affiliates
      WHERE project_name = ${projectName}
        AND enabled = TRUE
      ORDER BY priority DESC, id ASC
    `;

    // §6.4：單筆格式錯誤只忽略該筆，其他合法資料照回。
    const offers = parseAffiliateOffers(rows);

    // 推廣內容變動不需即時；短快取讓版位不必每次 render 都打 DB。
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ offers });
  } catch (err) {
    // §6.4：查詢失敗或資料表不存在 → 500 + 空清單，不阻塞主功能。
    // 只記錄訊息，不要把連線字串或整個 error 物件寫進 log。
    console.error('[affiliates] query failed:', err instanceof Error ? err.message : String(err));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ offers: [] });
  }
}
