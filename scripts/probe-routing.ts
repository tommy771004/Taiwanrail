/* One-off: dump real MaaS routing leg/section shape. Read-only. */
import 'dotenv/config';

async function getToken(): Promise<string | null> {
  const id = process.env.TDX_CLIENT_ID, sec = process.env.TDX_CLIENT_SECRET;
  if (!id || !sec) return null;
  const p = new URLSearchParams();
  p.append('grant_type', 'client_credentials');
  p.append('client_id', id);
  p.append('client_secret', sec);
  const r = await fetch('https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: p.toString(),
  });
  return r.ok ? ((await r.json()) as any).access_token : null;
}

(async () => {
  const token = await getToken();
  if (!token) { console.log('no token'); return; }
  // 南港 -> 八堵 (TRA), approx coords
  const qs = new URLSearchParams();
  qs.set('origin', '25.05328,121.60670');
  qs.set('destination', '25.10806,121.72330');
  qs.set('gc', '1'); qs.set('top', '2'); qs.set('transit', '3,4,5,6,7');
  const url = `https://tdx.transportdata.tw/api/maas/routing?${qs.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  console.log('status', res.status);
  const j = await res.json().catch(async () => (await res.text()).slice(0, 300));
  const routes = (j as any)?.data?.routes ?? (j as any)?.routes ?? [];
  console.log('routes:', Array.isArray(routes) ? routes.length : typeof routes);
  console.log('route[0] keys:', routes[0] ? Object.keys(routes[0]).join(', ') : '—');
  const secs = routes[0]?.sections;
  const arr = Array.isArray(secs) ? secs : secs && typeof secs === 'object' ? Object.values(secs) : [];
  console.log('section count:', arr.length);
  arr.slice(0, 4).forEach((s: any, i: number) => {
    console.log(`\n--- section[${i}] keys:`, Object.keys(s).join(', '));
    console.log('mode raw:', JSON.stringify(s.mode), '| transport:', JSON.stringify(s.transport), '| type:', JSON.stringify(s.type));
    console.log('sample:', JSON.stringify(s).slice(0, 600));
  });
})();
