/**
 * api/geocode.ts
 * 將地名解析為經緯度，供「行程規劃」的任意地點終點使用。
 * 資料來源：OpenStreetMap Nominatim（免金鑰）。後端代理以符合其使用政策：
 *   - 必須帶 User-Agent，否則 Nominatim 會回 403
 *   - 限定台灣 (countrycodes=tw)，結果快取 1 小時（座標穩定）
 * 若日後流量變大，改用 Google/TGOS 等付費 geocoder 只需替換這支檔案。
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { allowBrowserOrigin } from '../src/lib/tdxProxyAccessPolicy.js';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const UA = 'Taiwanrail/1.0 (+https://taiwanrail.vercel.app)';

// 暖機實例內快取
const cache = new Map<string, { at: number; data: any }>();
const TTL = 60 * 60 * 1000; // 1h

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers['origin'] as string) || '';
  const requestHost = (req.headers.host as string) || '';
  if (!allowBrowserOrigin({ origin, requestHost, method: req.method || 'GET' }).allow) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  // 不用 req.query：Vercel 的 query helper 底層走舊版 url.parse()，
  // 在 Node 23+ 每次請求都會噴 DEP0169 DeprecationWarning。
  const search = new URL(req.url || '/', 'http://localhost').searchParams;
  const q = (search.get('q') || '').trim();
  const lang = (search.get('lang') || 'zh-TW').slice(0, 10);
  if (q.length < 2) return res.status(200).json({ results: [] });

  const key = `${lang}:${q.toLowerCase()}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(hit.data);
  }

  try {
    const u = new URL(NOMINATIM);
    u.searchParams.set('q', q);
    u.searchParams.set('format', 'jsonv2');
    u.searchParams.set('countrycodes', 'tw');
    u.searchParams.set('limit', '5');
    u.searchParams.set('accept-language', lang);

    const r = await fetch(u.toString(), {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!r.ok) return res.status(200).json({ results: [] });

    const arr = (await r.json()) as any[];
    const results = (Array.isArray(arr) ? arr : [])
      .map((it) => ({
        name: it.name || String(it.display_name || '').split(',')[0],
        detail: it.display_name as string,
        lat: Number(it.lat),
        lon: Number(it.lon),
      }))
      .filter((p) => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon));

    const data = { results };
    cache.set(key, { at: now, data });
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(data);
  } catch (err) {
    console.error('[geocode] fetch failed:', err);
    return res.status(200).json({ results: [] });
  }
}
