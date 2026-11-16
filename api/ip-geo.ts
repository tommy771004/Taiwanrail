import type { VercelRequest, VercelResponse } from '@vercel/node';
import { IP_GEO_CACHE_CONTROL, ipLocationFromHeaders } from '../src/lib/ipLocation.js';

/**
 * GET /api/ip-geo — the visitor's own network location (city level, from Vercel's
 * x-vercel-ip-* headers), used only to pre-fill the origin station for a rider who
 * never tapped a locate button. No third party, no TDX call, never CDN-cached.
 * 204 when Vercel sent no usable coordinates.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', IP_GEO_CACHE_CONTROL);
  if (req.method !== 'GET') return res.status(405).end();
  const loc = ipLocationFromHeaders((name) => {
    const v = req.headers[name];
    return Array.isArray(v) ? v[0] : v;
  });
  if (!loc) return res.status(204).end();
  return res.status(200).json(loc);
}
