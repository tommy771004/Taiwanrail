import type { VercelRequest, VercelResponse } from '@vercel/node';

// ---------------------------------------------------------------------------
// Server-side token cache (per cold-start instance; Vercel reuses warm instances)
// ---------------------------------------------------------------------------
let cachedToken: string | null = null;
let tokenExpiresAt = 0;
let tokenInflight: Promise<string | null> | null = null;

async function getTDXAccessToken(): Promise<string | null> {
  const clientId = process.env.TDX_CLIENT_ID;
  const clientSecret = process.env.TDX_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  if (tokenInflight) return tokenInflight;

  tokenInflight = (async (): Promise<string | null> => {
    try {
      const params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      });
      const res = await fetch(
        'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        }
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { access_token: string; expires_in: number };
      cachedToken = data.access_token;
      tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
      return cachedToken;
    } catch {
      return null;
    } finally {
      tokenInflight = null;
    }
  })();

  return tokenInflight;
}

// ---------------------------------------------------------------------------
// Cache-Control TTL helpers (mirrors client-side getCacheTTL logic)
// ---------------------------------------------------------------------------
function getCacheSeconds(path: string): number {
  if (path.includes('LiveBoard')) return 30;
  if (path.includes('Alert')) return 5 * 60;
  if (path.includes('/Station')) return 24 * 3600;
  return 90; // timetables, fares
}

// ---------------------------------------------------------------------------
// Allowed path whitelist — only Rail endpoints, nothing else
// ---------------------------------------------------------------------------
const ALLOWED_PATH_RE = /^\/?(basic\/v[23]\/Rail\/|basic\/v[23]\/Rail)/;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only GET is needed; reject everything else.
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Reconstruct the TDX path from the catch-all segment.
  // Vercel sets req.query.path as string[] for [...path].ts
  const segments: string[] = Array.isArray(req.query.path)
    ? req.query.path
    : req.query.path
    ? [req.query.path as string]
    : [];

  const tdxPath = '/' + segments.join('/');

  // Whitelist check — must be a Rail API path
  if (!ALLOWED_PATH_RE.test(tdxPath)) {
    return res.status(403).json({ error: 'Forbidden path' });
  }

  // Forward original query string (e.g. $format, $filter, $select …)
  const qs = new URLSearchParams(req.query as Record<string, string>);
  qs.delete('path'); // remove the catch-all param itself
  // Always request JSON from TDX
  qs.set('$format', 'JSON');

  const tdxUrl = `https://tdx.transportdata.tw/api${tdxPath}${qs.toString() ? '?' + qs.toString() : ''}`;

  // Obtain server-side token
  const token = await getTDXAccessToken();
  if (!token) {
    return res.status(503).json({ error: 'TDX token unavailable' });
  }

  try {
    const upstream = await fetch(tdxUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    // Pass through TDX status codes transparently
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `TDX returned ${upstream.status}` });
    }

    const data = await upstream.json();

    // Set Vercel edge cache so repeated calls within TTL are served from CDN
    const ttl = getCacheSeconds(tdxPath);
    res.setHeader('Cache-Control', `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 2}`);
    res.setHeader('Content-Type', 'application/json');

    return res.status(200).json(data);
  } catch (err) {
    console.error('[tdx-proxy] upstream fetch error:', err);
    return res.status(502).json({ error: 'Upstream error' });
  }
}
