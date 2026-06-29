import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import path from 'path';
import { createGunzip } from 'zlib';
import { pipeline as streamPipeline } from 'stream/promises';
import { Readable } from 'stream';
import { JSONParser } from '@streamparser/json';
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

      const byStation: Record<string, any[]> = {};
      await new Promise<void>((resolve, reject) => {
        const jsonParser = new JSONParser({ paths: ['$.StationTimetables.*'], keepStack: false });
        jsonParser.onValue = (info) => {
          const value = info.value as any;
          const key: string = value?.StationID;
          if (key) {
            if (!byStation[key]) byStation[key] = [];
            byStation[key].push(value);
          }
        };
        jsonParser.onEnd = () => resolve();
        jsonParser.onError = reject;
        createReadStream(tmpFile).pipe(jsonParser as any);
      });

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

async function main() {
  const token = await getTDXToken();
  if (!token) return;

  const dataDir = path.join(process.cwd(), 'public', 'data');
  await fs.mkdir(dataDir, { recursive: true });

  const systems = ['TRTC', 'NTMC', 'TYMC', 'TMRT', 'KRTC', 'KLRT', 'NTDLRT'];

  for (const sys of systems) {
    const url = `https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/StationTimeTable/${sys}?$format=JSON`;
    await fetchAndSplitByStation(url, token, sys, dataDir);
    await new Promise(r => setTimeout(r, 1000));
  }
}

main().catch(console.error);
