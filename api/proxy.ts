import type { VercelRequest, VercelResponse } from '@vercel/node';

let cachedToken: string | null = null;
let tokenExpiry = 0;
// Dedup concurrent token fetches and remember failures briefly. A cold-start
// page load fires many /api/tdx/* calls at once; without dedup each one POSTs
// to the TDX auth endpoint in parallel, tripping its rate limit and turning
// the whole burst into 503s.
let tokenInFlight: Promise<string | null> | null = null;
let tokenFailedUntil = 0;
const TOKEN_FAIL_BACKOFF_MS = 15000;

const apiCache = new Map<string, { data: any, expires: number }>();
// Dedup concurrent in-flight requests to the same upstream URL so a burst
// only produces one TDX hit instead of N, which is what triggers 429.
const inFlight = new Map<string, Promise<{ status: number; data: any }>>();

async function requestTDXToken(clientId: string, clientSecret: string): Promise<string | null> {
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
    const body = await response.text().catch(() => '');
    console.error(`[tdx-proxy] token endpoint responded ${response.status}: ${body.slice(0, 300)}`);
    return null;
  }
  const data = await response.json() as any;
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

async function getTDXToken(): Promise<string | null> {
  const clientId = process.env.TDX_CLIENT_ID;
  const clientSecret = process.env.TDX_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    // Log once per cold start so Vercel logs show the real cause of 503 Token Error.
    if (!(globalThis as any).__tdxCredsWarned) {
      (globalThis as any).__tdxCredsWarned = true;
      console.error('[tdx-proxy] Missing TDX_CLIENT_ID / TDX_CLIENT_SECRET in environment');
    }
    return null;
  }
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  if (Date.now() < tokenFailedUntil) return null;

  if (!tokenInFlight) {
    tokenInFlight = (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const token = await requestTDXToken(clientId, clientSecret);
          if (token) return token;
          console.warn(`[tdx-proxy] token request failed (attempt ${attempt + 1}/2)`);
        } catch (err) {
          console.warn(
            `[tdx-proxy] token request error (attempt ${attempt + 1}/2):`,
            err instanceof Error ? err.message : String(err),
          );
        }
        if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
      }
      tokenFailedUntil = Date.now() + TOKEN_FAIL_BACKOFF_MS;
      console.error(`[tdx-proxy] token unavailable; backing off ${TOKEN_FAIL_BACKOFF_MS}ms`);
      return null;
    })().finally(() => { tokenInFlight = null; });
  }
  return tokenInFlight;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 軟性同源防盜用：這是「公眾查詢服務」，必須放行所有直接來訪的民眾。
  // 因此只有在請求「帶了 Origin、且明確來自其他網域」時才擋（別人把本站
  // proxy 嵌進他自己網站盜用的情境）。沒帶 Origin（隱私瀏覽器、直接開網址、
  // 一般 GET 不送 Origin）一律放行，絕不誤傷真人。
  // 允許：同源（自動涵蓋任何自訂網域）、localhost、任一 *.vercel.app 預覽。
  const origin = (req.headers['origin'] as string) || '';
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      const selfHost = (req.headers['host'] as string) || '';
      const allowed =
        originHost === selfHost ||
        /^(?:localhost(?::\d+)?|[\w-]+\.vercel\.app)$/.test(originHost);
      if (!allowed) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    } catch {
      // Origin 格式異常時寧可放行，也不冒險擋到正常使用者。
    }
  }

  const urlStr = req.url || '';
  const urlObj = new URL(urlStr, 'https://localhost');

  // 核心邏輯：從 /api/tdx/ 或 /api/proxy/ 後面抓取完整路徑
  let apiPath = urlObj.pathname.startsWith('/api/tdx/') 
    ? urlObj.pathname.substring(9) 
    : urlObj.pathname.replace(/^\/api\/proxy\//, '');
  apiPath = apiPath.replace(/^\/+/, '');

  // 1. Path Correcting & Reliability Logic
  // TDX paths REQUIRE their service segment: /api/basic/... or /api/advanced/...
  // — /api/v3/... without it is a 404 (verified 2026-07). Do NOT strip 'basic/'.
  let correctedPath = apiPath;

  // Rewrite to known-good endpoint versions:
  // TRA Alert only responds under v3.
  if (correctedPath.includes('TRA/Alert')) correctedPath = 'basic/v3/Rail/TRA/Alert';
  // TRA LiveBoard per-station only exists under v2 — basic/v3/.../LiveBoard/Station/{id}
  // is a 404 (v3 renamed it StationLiveBoard with $filter).
  if (correctedPath.includes('TRA/LiveBoard')) {
     const stationMatch = correctedPath.match(/Station\/(\d+)/);
     if (stationMatch) {
       correctedPath = `basic/v2/Rail/TRA/LiveBoard/Station/${stationMatch[1]}`;
     } else {
       correctedPath = 'basic/v2/Rail/TRA/LiveBoard';
     }
  }

  // THSR corrections
  if (correctedPath.includes('THSR/Alert')) correctedPath = 'basic/v2/Rail/THSR/Alert';
  if (correctedPath.includes('THSR/LiveBoard')) correctedPath = 'basic/v2/Rail/THSR/LiveBoard';

  // Bus Station/NearBy is an 'advanced'-tier service; under basic/ it 404s.
  if (correctedPath.includes('Bus/Station/NearBy')) {
    correctedPath = `advanced/${correctedPath.replace(/^(?:basic|advanced)\//, '')}`;
  }

  const isAlertRequest = /\/Rail\/(?:TRA|THSR)\/Alert/i.test(correctedPath);
  const isBookingRequest = /maas\/booking\/deeplink\//i.test(correctedPath);
    
  // Build a stable cache key (sorted keys) but forward the ORIGINAL search
  // string to TDX. URLSearchParams.toString() percent-encodes '$' -> '%24',
  // which TDX's WAF rejects as invalid OData and returns 404/429.
  const searchParams = new URLSearchParams(urlObj.search);
  searchParams.sort();
  const cacheQuery = searchParams.toString();

  if (!correctedPath) return res.status(400).json({ error: 'Missing path' });

  const cacheKey = `${correctedPath}?${cacheQuery}`;
  const now = Date.now();
  const cached = apiCache.get(cacheKey);

  if (!isBookingRequest && cached && cached.expires > now) {
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
      // apiCache never evicts, so an expired entry may still exist — stale
      // data beats a 503 while TDX auth is briefly unavailable.
      if (!isBookingRequest && cached) {
        res.setHeader('X-Cache', 'STALE');
        return res.status(200).json(cached.data);
      }
      const missingCreds = !process.env.TDX_CLIENT_ID || !process.env.TDX_CLIENT_SECRET;
      res.setHeader('Retry-After', String(Math.ceil(TOKEN_FAIL_BACKOFF_MS / 1000)));
      // Keep the public error short; detail is in server logs + optional reason for ops.
      return res.status(503).json({
        error: 'Token Error',
        reason: missingCreds ? 'missing_credentials' : 'auth_failed',
      });
    }

    // Forward the original search string (preserves '$' and other OData
    // literals). urlObj.search already includes the leading '?'.
    const tdxUrl = `https://tdx.transportdata.tw/api/${correctedPath}${urlObj.search}`;

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
    if (!isBookingRequest && (status === 429 || status >= 500) && cached) {
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
    else if (apiPath.includes('maas/routing')) ttl = 60 * 1000; // routing is time-sensitive; cache key already includes depart/gc/coords



    if (!isBookingRequest && status >= 200 && status < 300) {
      apiCache.set(cacheKey, { data, expires: now + ttl });
    }

    if (isBookingRequest) res.setHeader('Cache-Control', 'no-store');
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
