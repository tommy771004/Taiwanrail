import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import path from 'path';
import { createGunzip, gunzipSync } from 'zlib';
import { pipeline as streamPipeline } from 'stream/promises';
import { Readable } from 'stream';
import 'dotenv/config';

const METRO_BASE = 'https://tdx.transportdata.tw/api/basic/v2/Rail/Metro';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getTDXToken(): Promise<string | null> {
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

async function fetchAndSplitByStation(url: string, token: string, systemCode: string, dataDir: string) {
  let retryCount = 0;
  while (retryCount < 6) {
    console.log(`⬇️ Fetching ${url} (Retry ${retryCount})`);
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        },
      });

      if (response.status === 429 || response.status === 403) {
        await new Promise(r => setTimeout(r, 6000));
        retryCount++;
        continue;
      }
      if (!response.ok || !response.body) {
        console.error(`❌ Failed: ${response.status}`);
        return;
      }

      const tmpFile = path.join(process.cwd(), `tmp-${systemCode}.json`);
      const nodeStream = Readable.fromWeb(response.body as any);
      await streamPipeline(nodeStream, createWriteStream(tmpFile));

      // decompress if gzipped
      const firstBytes = Buffer.alloc(2);
      const fd = await fs.open(tmpFile, 'r');
      await fd.read(firstBytes, 0, 2, 0);
      await fd.close();
      const isGzip = firstBytes[0] === 0x1f && firstBytes[1] === 0x8b;

      if (isGzip) {
        const tmpDecompressed = tmpFile + '.decompressed';
        await streamPipeline(createReadStream(tmpFile), createGunzip(), createWriteStream(tmpDecompressed));
        await fs.unlink(tmpFile);
        await fs.rename(tmpDecompressed, tmpFile);
      }

      const rawData = await fs.readFile(tmpFile, 'utf8');
      const jsonData = JSON.parse(rawData);
      
      const byStation: Record<string, any[]> = {};
      const timetables = Array.isArray(jsonData) ? jsonData : (jsonData.StationTimetables || []);

      if (!Array.isArray(timetables) || timetables.length === 0) {
        console.warn(`⚠️ No StationTimeTable for ${systemCode}, skipping.`);
        await fs.unlink(tmpFile).catch(() => {});
        return;
      }

      for (const item of timetables) {
        const key = item?.StationID;
        if (key) {
          if (!byStation[key]) byStation[key] = [];
          byStation[key].push(item);
        }
      }

      await fs.unlink(tmpFile);

      const sysDir = path.join(dataDir, `metro_${systemCode}`);
      await fs.mkdir(sysDir, { recursive: true });

      for (const [st, entries] of Object.entries(byStation)) {
        await fs.writeFile(path.join(sysDir, `${st}.json`), JSON.stringify(entries));
      }
      console.log(`✅ Saved ${Object.keys(byStation).length} stations for ${systemCode}`);
      return;
    } catch (e) {
      console.error(e);
      retryCount++;
    }
  }
}

/**
 * Fetch a (small-to-medium) TDX endpoint fully into memory and parse JSON,
 * transparently gunzipping a gzip response and backing off on 429/403.
 * Returns null when the endpoint keeps failing.
 */
async function fetchTdxJson(url: string, token: string): Promise<any | null> {
  let retryCount = 0;
  while (retryCount < 6) {
    try {
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
      });

      if (response.status === 429 || response.status === 403) {
        await sleep(6000);
        retryCount++;
        continue;
      }
      if (!response.ok) {
        console.error(`❌ ${response.status} for ${url}`);
        return null;
      }

      const buf = Buffer.from(await response.arrayBuffer());
      const isGzip = buf[0] === 0x1f && buf[1] === 0x8b;
      const text = (isGzip ? gunzipSync(buf) : buf).toString('utf8');
      return JSON.parse(text);
    } catch (e) {
      console.error(e);
      retryCount++;
      await sleep(2000);
    }
  }
  return null;
}

/**
 * Pre-fetch the rarely-changing per-system reference data the metro search,
 * transfer router and detail card need — Station, S2STravelTime, LineTransfer,
 * StationTransfer and StationPlatform — into public/data/metro_<sys>/<name>.json.
 * The client (src/lib/metro.ts) reads these static snapshots first and only hits
 * the live TDX API as a fallback, so queries keep working under 429. ODFare and
 * the timetables are snapshotted separately (saveSystemODFare /
 * fetchAndSplitByStation); only LiveBoard / LivePosition / Alert stay live.
 */
async function saveSystemStatic(systemCode: string, token: string, dataDir: string) {
  const sysDir = path.join(dataDir, `metro_${systemCode}`);
  await fs.mkdir(sysDir, { recursive: true });

  const endpoints: { name: string; url: string }[] = [
    { name: 'stations',       url: `${METRO_BASE}/Station/${systemCode}?$format=JSON` },
    { name: 's2s',            url: `${METRO_BASE}/S2STravelTime/${systemCode}?$format=JSON` },
    { name: 'transfers',      url: `${METRO_BASE}/LineTransfer/${systemCode}?$format=JSON` },
    // In-station transfer text + boarding platforms: layout data that rarely
    // changes, so snapshot it instead of calling live (some operators may 404 —
    // saveSystemStatic skips those gracefully).
    { name: 'stationtransfer', url: `${METRO_BASE}/StationTransfer/${systemCode}?$format=JSON` },
    { name: 'platforms',       url: `${METRO_BASE}/StationPlatform/${systemCode}?$format=JSON` },
  ];

  for (const ep of endpoints) {
    const data = await fetchTdxJson(ep.url, token);
    if (data == null) {
      console.warn(`⚠️ Skipped ${systemCode}/${ep.name} (no data / fetch failed).`);
      await sleep(800);
      continue;
    }
    // Preserve the raw payload shape (bare array or TDX envelope); the client
    // unwraps defensively, mirroring the live-API parsing.
    const count = Array.isArray(data) ? data.length : '?';
    await fs.writeFile(path.join(sysDir, `${ep.name}.json`), JSON.stringify(data));
    console.log(`✅ Saved ${systemCode}/${ep.name}.json (${count} rows)`);
    await sleep(800); // gentle pacing between calls to avoid tripping 429
  }
}

/**
 * Pre-fetch the whole-system ODFare table once and split it per origin station
 * into metro_<sys>/fares/<originId>.json (mirrors the TRA per-origin fare files).
 * The client reads its origin's file statically and filters for the destination,
 * so fare lookups never hit the live (rate-limited) ODFare endpoint.
 */
async function saveSystemODFare(systemCode: string, token: string, dataDir: string) {
  const data = await fetchTdxJson(`${METRO_BASE}/ODFare/${systemCode}?$format=JSON`, token);
  if (data == null) {
    console.warn(`⚠️ Skipped ${systemCode}/fares (no data / fetch failed).`);
    return;
  }
  const rows: any[] = Array.isArray(data) ? data : (data.ODFares ?? []);
  const byOrigin: Record<string, any[]> = {};
  for (const r of rows) {
    const o = r?.OriginStationID;
    if (!o) continue;
    (byOrigin[o] ??= []).push(r);
  }
  const faresDir = path.join(dataDir, `metro_${systemCode}`, 'fares');
  await fs.mkdir(faresDir, { recursive: true });
  for (const [o, list] of Object.entries(byOrigin)) {
    await fs.writeFile(path.join(faresDir, `${o}.json`), JSON.stringify(list));
  }
  console.log(`✅ Saved ${systemCode}/fares: ${Object.keys(byOrigin).length} origins (${rows.length} OD rows)`);
}

async function main() {
  const token = await getTDXToken();
  if (!token) return;

  const dataDir = path.join(process.cwd(), 'public', 'data');
  await fs.mkdir(dataDir, { recursive: true });

  const systems = ['TRTC', 'NTMC', 'TYMC', 'TMRT', 'KRTC', 'KLRT', 'NTDLRT'];

  for (const sys of systems) {
    // 1) Static reference data (stations / travel times / line transfers / …).
    await saveSystemStatic(sys, token, dataDir);

    // 2) Per-origin OD fares (split into metro_<sys>/fares/<origin>.json).
    await saveSystemODFare(sys, token, dataDir);
    await sleep(800);

    // 3) Per-station timetables (split into metro_<sys>/<station>.json).
    const url = `${METRO_BASE}/StationTimeTable/${sys}?$format=JSON`;
    await fetchAndSplitByStation(url, token, sys, dataDir);
    await sleep(1000);
  }
}

main().catch(console.error);
