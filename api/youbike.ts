/**
 * api/youbike.ts
 * 全台 YouBike 即時站點資訊（14 個營運區）。
 * 資料來源：YouBike 官方 apis.youbike.com.tw/json/station-yb2.json（約每分鐘更新），
 * 失敗且沒有近期全國資料時退回 data.taipei 的臺北市即時資料。解析、快取、查詢都在
 * src/lib/youbikeFeed.ts（與 vite.config.ts 的 dev middleware 共用，`npm run test:youbike`）。
 *
 * - 無 mode、帶 lat/lon：1.5 公里內最近的一站 `{ station }`（台鐵／高鐵詳情的 YouBike 卡片）。
 * - mode=nearby / search / ids：單車分頁的附近站點、站名搜尋、常用站。
 *
 * 暖機實例內快取 60 秒：上游約一分鐘才更新一次，整包 6 MB，不要每個請求都重抓。
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { denyUnlessLiveGatewayAllowed } from '../src/lib/liveGatewayGuard.js';
import { resolveGateSecret } from '../src/lib/gateSecret.js';
import { answerYoubikeQuery, createDockSource } from '../src/lib/youbikeFeed.js';

const source = createDockSource({
  fetchJson: async (url) => {
    const r = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'taiwanrail-youbike/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    return r.json();
  },
});

function header(req: VercelRequest, name: string): string {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0] || '';
  return (v as string) || '';
}

function clientIp(req: VercelRequest): string {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length > 0) return xf.split(',')[0].trim();
  if (Array.isArray(xf) && xf[0]) return String(xf[0]).split(',')[0].trim();
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real) return real;
  return 'unknown';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = header(req, 'origin');
  const requestHost = header(req, 'host');
  const deny = denyUnlessLiveGatewayAllowed({
    method: req.method || 'GET',
    origin,
    requestHost,
    authorization: header(req, 'authorization'),
    cookieHeader: header(req, 'cookie'),
    ticketHeader: header(req, 'x-gate-ticket'),
    clientKey: clientIp(req),
    secret: resolveGateSecret(),
  });
  if (deny) {
    for (const [k, v] of Object.entries(deny.headers)) res.setHeader(k, v);
    return res.status(deny.status).json(deny.body);
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  // 不用 req.query：Vercel 的 query helper 底層走舊版 url.parse()，
  // 在 Node 23+ 每次請求都會噴 DEP0169 DeprecationWarning。
  const search = new URL(req.url || '/', 'http://localhost').searchParams;
  try {
    const { status, body } = await answerYoubikeQuery(search, source);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(status).json(body);
  } catch (err) {
    console.error('[youbike] query failed:', err);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'fetch_failed', docks: [] });
  }
}
