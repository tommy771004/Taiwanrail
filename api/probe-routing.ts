/**
 * Phase 0 probe for the TDX MaaS Routing API (跨運具旅運規劃).
 *
 * The published OAS leaves the `sections` (per-leg) object empty, so we must
 * call the live endpoint once to capture the REAL response shape before we can
 * type it (src/lib/api.ts) and render legs (JourneyPlanner.tsx).
 *
 * Usage (needs TDX_CLIENT_ID / TDX_CLIENT_SECRET in .env or the shell):
 *   npx tsx scripts/probe-routing.ts
 *   npx tsx scripts/probe-routing.ts 25.047743,121.516273 24.802340,120.970486
 *
 * Writes the raw JSON to scripts/routing-sample.json and prints a field map so
 * we can read the `sections` structure without scrolling the whole payload.
 */
import 'dotenv/config';
import { gunzipSync } from 'zlib';
import { writeFile } from 'fs/promises';
import { join } from 'path';

// Spec example: Taipei (≈台北車站) → Hsinchu. Override via argv.
const origin = process.argv[2] || '25.047743,121.516273';
const destination = process.argv[3] || '24.802340,120.970486';

async function getToken(): Promise<string> {
  const id = process.env.TDX_CLIENT_ID;
  const secret = process.env.TDX_CLIENT_SECRET;
  if (!id || !secret) {
    console.error('❌ 缺少 TDX_CLIENT_ID / TDX_CLIENT_SECRET（請設在 .env 或環境變數）');
    process.exit(1);
  }
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: id,
    client_secret: secret,
  });
  const r = await fetch('https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!r.ok) {
    console.error(`❌ 取得 token 失敗：${r.status}`);
    process.exit(1);
  }
  const j = (await r.json()) as { access_token: string };
  return j.access_token;
}

/** Read body as JSON, tolerating TDX's header-less gzip on large responses. */
async function readJson(res: Response): Promise<any> {
  const buf = Buffer.from(await res.arrayBuffer());
  const isGzip = buf[0] === 0x1f && buf[1] === 0x8b;
  const text = (isGzip ? gunzipSync(buf) : buf).toString('utf-8');
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}

/** Recursively summarise a value's shape (keys + leaf types), depth-limited. */
function shape(v: any, depth = 0): any {
  if (depth > 6) return '…';
  if (Array.isArray(v)) return v.length ? [shape(v[0], depth + 1)] : [];
  if (v && typeof v === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v)) out[k] = shape(v[k], depth + 1);
    return out;
  }
  return typeof v;
}

async function main() {
  const token = await getToken();

  const qs = new URLSearchParams({
    origin,
    destination,
    gc: '1',          // 1 = 最快
    top: '3',
    transit: '3,4,5,6,7', // 高鐵/台鐵/公車/捷運/輕軌
  });
  const url = `https://tdx.transportdata.tw/api/maas/routing?${qs.toString()}`;
  console.log(`⬇️  ${url}\n`);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  console.log(`HTTP ${res.status} ${res.statusText}`);

  const data = await readJson(res);
  const outPath = join(process.cwd(), 'scripts', 'routing-sample.json');
  await writeFile(outPath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`💾 完整回應已存：${outPath}\n`);

  console.log('=== 頂層 keys ===');
  console.log(Object.keys(data));

  const routes = data?.data?.routes ?? data?.routes ?? [];
  console.log(`\n=== routes 數量：${routes.length} ===`);
  if (routes.length) {
    console.log('\n=== route[0] 結構（型別圖）===');
    console.log(JSON.stringify(shape(routes[0]), null, 2));

    console.log('\n=== route[0].sections 完整內容（這是 spec 缺的部分）===');
    console.log(JSON.stringify(routes[0].sections, null, 2));
  } else {
    console.log('⚠️ 沒有 routes，印出完整回應供檢視：');
    console.log(JSON.stringify(data, null, 2).slice(0, 4000));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
