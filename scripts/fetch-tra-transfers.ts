/**
 * 一次性：下載 TDX 台鐵轉乘資料，供人工比對 src/lib/transfers.ts。
 * 不在排程內、不進 public/（前端不讀）；結果寫到 scripts/tra-transfer-snapshot/。
 *
 *   TDX_CLIENT_ID=… TDX_CLIENT_SECRET=… npx tsx scripts/fetch-tra-transfers.ts
 *
 * 端點名稱在 v2 / v3 不一定都有，所以每個候選都試一次，404 只記錄不失敗；
 * _status.json 記下每個 URL 的結果，連「全部 404」也看得出來。
 *
 * 2026-10-22 的結果：只有 v3 StationTransfer（67 站）與 v3 LineTransfer（14 筆台鐵支線轉乘）存在；
 * StationTransfer 的結構化欄位只有停車場與計程車，捷運／高鐵只出現在地圖名稱（「捷運」「軌道運輸」）。
 */
import fs from 'fs/promises';
import path from 'path';
import { gunzipSync } from 'zlib';
import 'dotenv/config';

const CANDIDATES = [
  { name: 'v3-StationTransfer', url: 'https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/StationTransfer?$format=JSON' },
  { name: 'v3-LineTransfer', url: 'https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/LineTransfer?$format=JSON' },
  { name: 'v2-StationTransfer', url: 'https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/StationTransfer?$format=JSON' },
  { name: 'v2-LineTransfer', url: 'https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/LineTransfer?$format=JSON' },
];

const OUT_DIR = path.join(process.cwd(), 'scripts', 'tra-transfer-snapshot');

async function getToken(): Promise<string> {
  const { TDX_CLIENT_ID: id, TDX_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) throw new Error('TDX_CLIENT_ID / TDX_CLIENT_SECRET 未設定');
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret });
  const res = await fetch('https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`取得 token 失敗：HTTP ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** 頂層陣列，或 TDX 信封裡第一個陣列欄位，用來在 log 裡印筆數與欄位。 */
function rowsOf(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    for (const value of Object.values(json)) if (Array.isArray(value)) return value;
  }
  return [];
}

async function main() {
  const token = await getToken();
  await fs.mkdir(OUT_DIR, { recursive: true });
  const status: Record<string, { url: string; http: number; rows?: number; error?: string }> = {};

  for (const { name, url } of CANDIDATES) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      const raw = Buffer.from(await res.arrayBuffer());
      // TDX 對大型回應強制 gzip 但不帶 Content-Encoding（見 fetch-tdx-data.ts）
      const text = (raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw).toString('utf8');
      if (!res.ok) {
        status[name] = { url, http: res.status, error: text.slice(0, 300) };
        console.warn(`⚠️ ${name}: HTTP ${res.status}`);
      } else {
        const json = JSON.parse(text);
        const rows = rowsOf(json);
        await fs.writeFile(path.join(OUT_DIR, `${name}.json`), JSON.stringify(json, null, 2) + '\n');
        status[name] = { url, http: res.status, rows: rows.length };
        console.log(`✅ ${name}: ${rows.length} 筆；第一筆欄位：${Object.keys((rows[0] as object) ?? {}).join(', ')}`);
      }
    } catch (err) {
      status[name] = { url, http: 0, error: String(err) };
      console.error(`❌ ${name}:`, err);
    }
    await new Promise(r => setTimeout(r, 1500)); // 免費會員金鑰每分鐘 5 次
  }

  await fs.writeFile(path.join(OUT_DIR, '_status.json'), JSON.stringify(status, null, 2) + '\n');
  if (!Object.values(status).some(s => s.http === 200)) {
    console.error('❌ 所有候選端點都沒有成功，請看 _status.json');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
