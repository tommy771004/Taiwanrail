import type { VercelRequest, VercelResponse } from '@vercel/node';

let cachedToken: string | null = null;
let tokenExpiry = 0;

// Simple in-memory cache to reduce TDX rate limit (429) hits
// Since Vercel functions can stay warm, this will help.
const apiCache = new Map<string, { data: any, expires: number }>();

async function getTDXToken() {
  const clientId = process.env.TDX_CLIENT_ID;
  const clientSecret = process.env.TDX_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('[Proxy Auth] Missing TDX_CLIENT_ID or TDX_CLIENT_SECRET environment variables');
    return null;
  }

  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

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

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Proxy Auth] Token request failed: ${response.status} ${errorText}`);
      return null;
    }

    const data = await response.json() as any;
    if (!data.access_token) {
      console.error('[Proxy Auth] No access_token in response');
      return null;
    }

    cachedToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return cachedToken;
  } catch (err) {
    console.error('[Proxy Auth] Fatal error during token fetch:', err);
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const urlStr = req.url || '';
  const urlObj = new URL(urlStr, 'https://localhost');
  const apiPath = urlObj.pathname.replace(/^\/api\/tdx\//, '');
  const searchParams = new URLSearchParams(urlObj.search);
  searchParams.sort(); // Normalize parameter order
  const normalizedQuery = searchParams.toString();

  if (!apiPath) {
    return res.status(400).json({ error: 'Missing API path' });
  }

  const cacheKey = `${apiPath}${normalizedQuery ? `?${normalizedQuery}` : ''}`;
  const now = Date.now();
  const cached = apiCache.get(cacheKey);
  
  if (cached && cached.expires > now) {
    console.log(`[Proxy] Cache hit: ${apiPath}`);
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    return res.status(200).json(cached.data);
  }

  console.log(`[Proxy] Routing: ${apiPath}`);

  try {
    const token = await getTDXToken();
    if (!token) {
      console.warn('[Proxy] Token not available. Returning 503.');
      return res.status(503).json({ error: 'TDX Token Unavailable. Please check environment variables.' });
    }

    // Attempting correction for common paths - Stripping 'basic/' if it exists to normalize
    let correctedPath = apiPath.startsWith('basic/') ? apiPath.substring(6) : apiPath;
    
    // Specific reliability overrides
    // Fix for 404 Alerts & LiveBoard - V3 is more reliable for TRA
    if (apiPath.includes('TRA/Alert')) correctedPath = 'v3/Rail/TRA/Alert';
    if (apiPath.includes('TRA/LiveBoard')) {
       // Extract station if present
       const stationMatch = apiPath.match(/Station\/(\d+)/);
       if (stationMatch) {
         correctedPath = `v3/Rail/TRA/LiveBoard/Station/${stationMatch[1]}`;
       } else {
         correctedPath = 'v3/Rail/TRA/LiveBoard';
       }
    }
    
    // THSR corrections
    if (apiPath.includes('THSR/Alert')) correctedPath = 'v2/Rail/THSR/Alert';
    if (apiPath.includes('THSR/LiveBoard')) correctedPath = 'v2/Rail/THSR/LiveBoard';

    const tdxUrl = `https://tdx.transportdata.tw/api/${correctedPath}${normalizedQuery ? `?${normalizedQuery}` : ''}`;
    const tdxResponse = await fetch(tdxUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (tdxResponse.status === 429) {
      console.warn('[Proxy] TDX Rate Limit Hit (429)');
      if (cached) {
        console.log('[Proxy] Level 2 Cache Fallback (Serving stale data)');
        res.setHeader('X-Cache', 'STALE-FALLBACK');
        return res.status(200).json(cached.data);
      }
    }

    if (!tdxResponse.ok) {
      console.warn(`[Proxy] TDX API returned ${tdxResponse.status}`);
    }

    const data = await tdxResponse.json();
    
    // Heirarchical caching based on path volatility
    let ttl = 120000; // 2 min default (LiveBoard, Alerts)
    
    if (apiPath.includes('Station') || apiPath.includes('ODFare')) {
      ttl = 24 * 3600000; // 24 hours for station lists and fares (static)
    } else if (apiPath.includes('Timetable')) {
      // Covers DailyTimetable, DailyTrainTimetable, GeneralTimetable
      ttl = 3600000; // 1 hour for timetables
    }

    // Only cache successful responses
    if (tdxResponse.ok) {
      apiCache.set(cacheKey, { data, expires: now + ttl });
    }

    res.setHeader('X-Cache', 'MISS');
    const sMaxAge = Math.floor(ttl / 1000);
    res.setHeader('Cache-Control', `public, s-maxage=${sMaxAge}, stale-while-revalidate=${Math.floor(sMaxAge / 2)}`);
    return res.status(tdxResponse.status).json(data);
  } catch (error: any) {
    console.error('[Proxy] Handler Error:', error);
    if (cached) {
      return res.status(200).json(cached.data);
    }
    return res.status(503).json({ error: error.message || 'Service Unavailable' });
  }
}
