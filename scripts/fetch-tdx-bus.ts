/**
 * 公車靜態資料快照：public/data/bus/<City>.json for 臺北、新北、桃園、臺中、高雄.
 *
 *   npm run fetch-bus-data            # every city whose TDX DataVersion changed
 *   npm run fetch-bus-data -- --force # every city
 *
 * Quota: one DataVersion call per city, and only a city whose VersionID differs from the
 * committed file's fetches Route + StopOfRoute (two calls, the large ones). An unchanged city
 * costs one small call. The client reads only these files for stops and routes — Route,
 * StopOfRoute and Stop are not allowed through the live gateway at all.
 *
 * A reply thinner than BUS_MIN (scripts/tdx-bus.ts) leaves the old file in place.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import 'dotenv/config';
import { BUS_CITIES, type BusCityCode } from '../src/lib/busData.js';
import { encodeBusCity, isBusFileUsable } from './tdx-bus.js';
import { writeValidatedJsonAtomically } from './tdx-data-integrity.js';

const BASE = 'https://tdx.transportdata.tw/api/basic/v2/Bus';
const OUT_DIR = path.join(process.cwd(), 'public', 'data', 'bus');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getToken(): Promise<string | null> {
  const clientId = process.env.TDX_CLIENT_ID;
  const clientSecret = process.env.TDX_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret });
  const res = await fetch('https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) return null;
  return ((await res.json()) as { access_token?: string }).access_token ?? null;
}

/** GET + JSON, gunzipping TDX's header-less gzip (CLAUDE.md), backing off on 429/403. */
async function fetchJson(url: string, token: string): Promise<unknown | null> {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Accept-Encoding': 'gzip' } });
      if (res.status === 429 || res.status === 403) { await sleep(6000); continue; }
      if (!res.ok) { console.error(`❌ ${res.status} ${url}`); return null; }
      const buf = Buffer.from(await res.arrayBuffer());
      const text = (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8');
      console.log(`   ${url.replace(BASE, '')} → ${(buf.length / 1e6).toFixed(1)} MB`);
      return JSON.parse(text);
    } catch (e) {
      console.error(e);
      await sleep(2000);
    }
  }
  return null;
}

async function readExisting(city: BusCityCode): Promise<{ version: number | null; updated: string } | null> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(OUT_DIR, `${city}.json`), 'utf8'));
    return { version: typeof raw.version === 'number' ? raw.version : null, updated: typeof raw.updated === 'string' ? raw.updated : '' };
  } catch {
    return null;
  }
}

async function main() {
  const force = process.argv.includes('--force');
  const token = await getToken();
  if (!token) {
    console.error('❌ TDX_CLIENT_ID / TDX_CLIENT_SECRET missing or rejected; nothing fetched.');
    process.exitCode = 1;
    return;
  }
  await fs.mkdir(OUT_DIR, { recursive: true });

  let failed = 0;
  for (const { code } of BUS_CITIES) {
    console.log(`🚌 ${code}`);
    const versionRaw = await fetchJson(`${BASE}/DataVersion/City/${code}?$format=JSON`, token);
    const v = versionRaw && typeof versionRaw === 'object' ? (versionRaw as Record<string, unknown>) : null;
    const version = typeof v?.VersionID === 'number' ? v.VersionID : null;
    const updated = typeof v?.UpdateTime === 'string' ? v.UpdateTime : new Date().toISOString();
    const existing = await readExisting(code);
    if (!force && existing && version !== null && existing.version === version) {
      console.log(`   unchanged (VersionID ${version}), skipped`);
      continue;
    }

    const routes = await fetchJson(`${BASE}/Route/City/${code}?$format=JSON`, token);
    const stopOfRoute = await fetchJson(`${BASE}/StopOfRoute/City/${code}?$format=JSON`, token);
    if (!Array.isArray(routes) || !Array.isArray(stopOfRoute)) {
      console.error(`   ❌ Route or StopOfRoute unreadable; kept the old file`);
      failed++;
      continue;
    }
    const { file, stats } = encodeBusCity(code, routes, stopOfRoute, { updated, version });
    console.log(`   routes ${stats.routes}, stations ${stats.stations}, stops ${stats.stops}, patterns ${stats.patterns}` +
      ` (dropped ${stats.droppedPatterns} patterns, ${stats.droppedStops} stops)`);
    if (!isBusFileUsable(stats)) {
      console.error(`   ❌ too thin to trust; kept the old file`);
      failed++;
      continue;
    }
    const buf = Buffer.from(JSON.stringify(file));
    await writeValidatedJsonAtomically(path.join(OUT_DIR, `${code}.json`), buf);
    console.log(`   ✅ ${(buf.length / 1e6).toFixed(2)} MB written`);
  }
  if (failed) process.exitCode = 1;
}

main();
