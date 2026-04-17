import type { VercelRequest, VercelResponse } from '@vercel/node';

let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getTDXToken() {
  const clientId = process.env.TDX_CLIENT_ID;
  const clientSecret = process.env.TDX_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('TDX credentials not configured');
  }

  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

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
    throw new Error(`Failed to get TDX token: ${response.statusText}`);
  }

  const data = await response.json() as any;
  cachedToken = data.access_token;
  // Expire 1 minute early to be safe
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Extract the target path from the request URL
  // e.g. /api/tdx/basic/v2/Rail/... -> basic/v2/Rail/...
  const url = req.url || '';
  const apiPath = url.replace(/^\/api\/tdx\//, '').split('?')[0];
  const query = url.includes('?') ? url.split('?')[1] : '';

  if (!apiPath) {
    return res.status(400).json({ error: 'Missing API path' });
  }

  console.log(`[Proxy] Routing to TDX: ${apiPath}${query ? `?${query}` : ''}`);

  try {
    const token = await getTDXToken();
    const tdxUrl = `https://tdx.transportdata.tw/api/${apiPath}${query ? `?${query}` : ''}`;

    const tdxResponse = await fetch(tdxUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (!tdxResponse.ok) {
      console.warn(`[Proxy] TDX returned ${tdxResponse.status} for ${apiPath}`);
    }

    const data = await tdxResponse.json();

    // Copy relevant headers from TDX response if needed
    // We can also set our own cache headers
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    
    return res.status(tdxResponse.status).json(data);
  } catch (error: any) {
    console.error('[Proxy] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
