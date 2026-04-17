// Vercel Serverless Function — TDX API Proxy
// Receives requests rewritten from /api/tdx/** via vercel.json
// The original path is forwarded in the X-TDX-Path header by the rewrite rule.

// ---------------------------------------------------------------------------
// Server-side token cache (shared across warm invocations)
// ---------------------------------------------------------------------------
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getTDXAccessToken(): Promise<string | null> {
  const clientId = process.env.TDX_CLIENT_ID;
  const clientSecret = process.env.TDX_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

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
    const data = await res.json() as { access_token: string; expires_in: number };
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    return cachedToken;
  } catch {
    return null;
  }
}

function getCacheSeconds(tdxPath: string): number {
  if (tdxPath.includes('LiveBoard')) return 30;
  if (tdxPath.includes('Alert')) return 5 * 60;
  if (tdxPath.includes('/Station')) return 24 * 3600;
  return 90;
}

// Vercel Functions use Node.js IncomingMessage / ServerResponse
export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Extract the original TDX sub-path from query param injected by vercel.json rewrite
  // e.g. request: /api/tdx/basic/v2/Rail/TRA/Alert?$format=JSON
  //      → rewritten to /api/proxy?tdxpath=basic/v2/Rail/TRA/Alert&$format=JSON
  const { tdxpath, ...rest } = req.query as Record<string, string | string[]>;
  const subPath = Array.isArray(tdxpath) ? tdxpath.join('/') : (tdxpath || '');

  if (!subPath) {
    res.status(400).json({ error: 'Missing tdxpath' });
    return;
  }

  // Whitelist: only Rail API endpoints
  if (!/^basic\/v[23]\/Rail\//.test(subPath)) {
    res.status(403).json({ error: 'Forbidden path' });
    return;
  }

  // Rebuild query string (exclude our injected param)
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(rest)) {
    if (Array.isArray(v)) v.forEach(val => qs.append(k, val));
    else qs.set(k, v as string);
  }
  qs.set('$format', 'JSON');

  const tdxUrl = `https://tdx.transportdata.tw/api/${subPath}?${qs.toString()}`;

  const token = await getTDXAccessToken();
  if (!token) {
    res.status(503).json({ error: 'TDX token unavailable — ensure TDX_CLIENT_ID and TDX_CLIENT_SECRET are set in Vercel Environment Variables' });
    return;
  }

  try {
    const upstream = await fetch(tdxUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `TDX returned ${upstream.status}`, url: tdxUrl });
      return;
    }

    const data = await upstream.json();
    const ttl = getCacheSeconds(subPath);
    res.setHeader('Cache-Control', `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 2}`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).json(data);
  } catch (err) {
    console.error('[tdx-proxy] upstream error:', err);
    res.status(502).json({ error: 'Upstream fetch error' });
  }
}
