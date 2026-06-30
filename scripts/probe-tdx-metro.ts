/**
 * One-off probe for the TDX Metro endpoints whose field names are NOT published
 * in the OAS (LivePosition / StationTransfer / StationPlatform / ODFare …).
 *
 * It fetches a 2-row sample per endpoint for one operator and prints the row
 * keys (plus nested array-element keys) and a trimmed sample, so the defensive
 * field aliases in src/lib/metro.ts can be confirmed or extended.
 *
 *   TDX_CLIENT_ID=… TDX_CLIENT_SECRET=… npm run probe-metro          # TRTC
 *   TDX_CLIENT_ID=… TDX_CLIENT_SECRET=… npm run probe-metro KRTC     # other op
 *
 * Read-only; makes ~10 small requests with pacing. Nothing is written to disk.
 */
import { gunzipSync } from 'zlib';
import 'dotenv/config';

const BASE = 'https://tdx.transportdata.tw/api/basic/v2/Rail/Metro';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getToken(): Promise<string | null> {
  const clientId = process.env.TDX_CLIENT_ID;
  const clientSecret = process.env.TDX_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);
  try {
    const res = await fetch('https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!res.ok) return null;
    return (await res.json() as any).access_token;
  } catch {
    return null;
  }
}

async function fetchSample(url: string, token: string): Promise<{ status: number; data: any }> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!res.ok) return { status: res.status, data: null };
  const buf = Buffer.from(await res.arrayBuffer());
  const isGzip = buf[0] === 0x1f && buf[1] === 0x8b;
  const text = (isGzip ? gunzipSync(buf) : buf).toString('utf8');
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { return { status: res.status, data: text.slice(0, 200) }; }
}

const keysOf = (o: any): string[] => (o && typeof o === 'object' ? Object.keys(o) : []);

function summarize(name: string, data: any) {
  console.log(`\n===== ${name} =====`);
  const arr: any[] = Array.isArray(data) ? data : (data?.[keysOf(data)[0]] ?? []);
  console.log('top-level:', Array.isArray(data) ? `array[${data.length}]` : `${typeof data} (envelope key: ${keysOf(data)[0] ?? '—'})`);
  const first = Array.isArray(arr) ? arr[0] : arr;
  if (!first) { console.log('(no rows)'); return; }
  console.log('row keys:', keysOf(first).join(', '));
  for (const k of ['Fares', 'TravelTimes', 'Segments', 'Platforms', 'PlatformList', 'Timetables', 'Stations', 'Exits']) {
    if (Array.isArray(first[k]) && first[k][0]) {
      console.log(`  ${k}[0] keys:`, keysOf(first[k][0]).join(', '));
    }
  }
  console.log('sample row:\n' + JSON.stringify(first, null, 2).slice(0, 1400));
}

async function main() {
  const op = process.argv[2] || process.env.METRO_OP || 'TRTC';
  const token = await getToken();
  if (!token) { console.error('❌ Missing TDX_CLIENT_ID / TDX_CLIENT_SECRET.'); return; }

  const q = '$top=2&$format=JSON';
  const endpoints: [string, string][] = [
    ['Station',          `${BASE}/Station/${op}?${q}`],
    ['StationOfLine',    `${BASE}/StationOfLine/${op}?${q}`],
    ['S2STravelTime',    `${BASE}/S2STravelTime/${op}?${q}`],
    ['LineTransfer',     `${BASE}/LineTransfer/${op}?${q}`],
    ['StationTransfer',  `${BASE}/StationTransfer/${op}?${q}`],
    ['StationPlatform',  `${BASE}/StationPlatform/${op}?${q}`],
    ['LivePosition',     `${BASE}/LivePosition/${op}?${q}`],
    ['LiveBoard',        `${BASE}/LiveBoard/${op}?${q}`],
    ['ODFare',           `${BASE}/ODFare/${op}?${q}`],
    ['StationTimeTable', `${BASE}/StationTimeTable/${op}?${q}`],
  ];

  console.log(`🔎 Probing TDX Metro endpoints for operator: ${op}`);
  for (const [name, url] of endpoints) {
    try {
      const { status, data } = await fetchSample(url, token);
      if (status !== 200) console.log(`\n===== ${name} ===== HTTP ${status} (not available for ${op})`);
      else summarize(name, data);
    } catch (e) {
      console.log(`\n===== ${name} ===== error`, e);
    }
    await sleep(600);
  }
}

main().catch(console.error);
