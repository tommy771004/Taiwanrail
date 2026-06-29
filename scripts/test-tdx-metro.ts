import 'dotenv/config';

async function getTDXToken(): Promise<string | null> {
  const clientId = process.env.TDX_CLIENT_ID;
  const clientSecret = process.env.TDX_CLIENT_SECRET;

  if (!clientId || !clientSecret) return null;

  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);

  try {
    const response = await fetch('https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!response.ok) return null;
    const data = await response.json() as any;
    return data.access_token;
  } catch {
    return null;
  }
}

async function main() {
  const token = await getTDXToken();
  if (!token) throw new Error('No token');
  
  const res = await fetch('https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/LiveBoard/TRTC?$top=10&$format=JSON', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  console.log('Status:', res.status);
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

main().catch(console.error);
