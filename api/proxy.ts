import type { VercelRequest, VercelResponse } from '@vercel/node';

let cachedToken: string | null = null;
let tokenExpiry = 0;

const apiCache = new Map<string, { data: any, expires: number }>();
// Dedup concurrent in-flight requests to the same upstream URL so a burst
// only produces one TDX hit instead of N, which is what triggers 429.
const inFlight = new Map<string, Promise<{ status: number; data: any }>>();

async function getTDXToken() {
  const clientId = process.env.TDX_CLIENT_ID;
  const clientSecret = process.env.TDX_CLIENT_SECRET;

  if (!clientId || !clientSecret) return null;
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);

    const response = await fetch('https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) return null;
    const data = await response.json() as any;
    cachedToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return cachedToken;
  } catch (err) {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const urlStr = req.url || '';
  const urlObj = new URL(urlStr, 'https://localhost');
  
  // 核心邏輯：從 /api/tdx/ 後面抓取完整路徑
  let apiPath = urlObj.pathname.startsWith('/api/tdx/') 
    ? urlObj.pathname.substring(9) 
    : urlObj.pathname.replace(/^\/api\/proxy\//, '');
  apiPath = apiPath.replace(/^\/+/, '');
  const isAlertRequest = /\/Rail\/(?:TRA|THSR)\/Alert/i.test(apiPath);
    
  // Build a stable cache key (sorted keys) but forward the ORIGINAL search
  // string to TDX. URLSearchParams.toString() percent-encodes '$' -> '%24',
  // which TDX's WAF rejects as invalid OData and returns 404/429.
  const searchParams = new URLSearchParams(urlObj.search);
  searchParams.sort();
  const cacheQuery = searchParams.toString();

  if (!apiPath) return res.status(400).json({ error: 'Missing path' });

  const cacheKey = `${apiPath}?${cacheQuery}`;
  const now = Date.now();
  const cached = apiCache.get(cacheKey);

  if (cached && cached.expires > now) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(cached.data);
  }

  try {
    const token = await getTDXToken();
    if (!token) {
      if (isAlertRequest) {
        res.setHeader('X-Fallback', 'ALERT_EMPTY_NO_TOKEN');
        return res.status(200).json([]);
      }
      return res.status(503).json({ error: 'Token Error' });
    }

    // Forward the original search string (preserves '$' and other OData
    // literals). urlObj.search already includes the leading '?'.
    const tdxUrl = `https://tdx.transportdata.tw/api/${apiPath}${urlObj.search}`;

    let pending = inFlight.get(cacheKey);
    if (!pending) {
      pending = (async () => {
        const r = await fetch(tdxUrl, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
        });
        const body = await r.json();
        return { status: r.status, data: body };
      })().finally(() => inFlight.delete(cacheKey));
      inFlight.set(cacheKey, pending);
    }

    const { status, data } = await pending;

    if (isAlertRequest && (status === 404 || status === 429 || status >= 500)) {
      // Alert endpoint is non-critical; prefer clean empty state over surfacing upstream instability.
      res.setHeader('X-Fallback', 'ALERT_EMPTY_UPSTREAM');
      return res.status(200).json([]);
    }

    // Serve stale cache on rate limit / upstream error when we have something.
    if ((status === 429 || status >= 500) && cached) {
      res.setHeader('X-Cache', 'STALE');
      return res.status(200).json(cached.data);
    }

    // Cache TTLs — keep daily timetables cached for 1h since they're stable.
    let ttl = 120000;
    if (apiPath.includes('Station')) ttl = 24 * 3600000;
    else if (apiPath.includes('Alert')) ttl = 5 * 60 * 1000;
    else if (apiPath.includes('LiveBoard')) ttl = 30 * 1000;
    else if (apiPath.includes('DailyTimetable') || apiPath.includes('DailyTrainTimetable')) ttl = 60 * 60 * 1000;
    else if (apiPath.includes('ODFare')) ttl = 24 * 3600000;

    if (status >= 200 && status < 300) {
      apiCache.set(cacheKey, { data, expires: now + ttl });
    }

    res.setHeader('X-Cache', 'MISS');
    return res.status(status).json(data);
  } catch (error: any) {
    if (isAlertRequest) {
      res.setHeader('X-Fallback', 'ALERT_EMPTY_EXCEPTION');
      return res.status(200).json([]);
    }
    return res.status(500).json({ error: error.message });
  }
}
