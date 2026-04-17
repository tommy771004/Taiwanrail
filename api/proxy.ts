import type { VercelRequest, VercelResponse } from '@vercel/node';

let cachedToken: string | null = null;
let tokenExpiry = 0;

const apiCache = new Map<string, { data: any, expires: number }>();

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
    
  const searchParams = new URLSearchParams(urlObj.search);
  searchParams.sort();
  const normalizedQuery = searchParams.toString();

  if (!apiPath) return res.status(400).json({ error: 'Missing path' });

  const cacheKey = `${apiPath}?${normalizedQuery}`;
  const now = Date.now();
  const cached = apiCache.get(cacheKey);
  
  if (cached && cached.expires > now) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(cached.data);
  }

  try {
    const token = await getTDXToken();
    if (!token) return res.status(503).json({ error: 'Token Error' });

    const tdxUrl = `https://tdx.transportdata.tw/api/${apiPath}${normalizedQuery ? `?${normalizedQuery}` : ''}`;
    const tdxResponse = await fetch(tdxUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (tdxResponse.status === 429 && cached) {
      return res.status(200).json(cached.data);
    }

    const data = await tdxResponse.json();
    
    // Cache logic
    let ttl = 120000;
    if (apiPath.includes('Station')) ttl = 24 * 3600000;
    
    if (tdxResponse.ok) {
      apiCache.set(cacheKey, { data, expires: now + ttl });
    }

    res.setHeader('X-Cache', 'MISS');
    return res.status(tdxResponse.status).json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
