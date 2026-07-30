import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import path from 'path';
import { createGunzip, gunzipSync } from 'zlib';
import { pipeline as streamPipeline } from 'stream/promises';
import { Readable } from 'stream';
import { JSONParser } from '@streamparser/json';
import 'dotenv/config'; // 自動嘗試載入 .env
import { writeValidatedJsonAtomically } from './tdx-data-integrity.js';
import { encodeDailyTimetable, pruneDailyDirectory } from './tdx-daily-timetable.js';
import { pickShortestRouteFares } from '../src/lib/odFareDirection.js';
import {
  DAILY_MIN_TRAINS,
  DAILY_WINDOW_DAYS,
  taipeiDateWindow,
  type DailyRail,
} from '../src/lib/dailyTimetable.js';

async function getTDXToken(): Promise<string | null> {
  const clientId = process.env.TDX_CLIENT_ID;
  const clientSecret = process.env.TDX_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('\n❌ 錯誤 [Error]: 找不到 TDX_CLIENT_ID 或 TDX_CLIENT_SECRET 環境變數。');
    return null;
  }

  console.log('🔑 正在向 TDX 申請 Access Token...');
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
    console.log('✅ 成功取得 Token！');
    return data.access_token;
  } catch (err) {
    return null;
  }
}

/**
 * @param transform optional per-origin reducer applied before the file is written.
 *   Opt-in at the call site rather than keyed off `dirName`, so this stays a generic
 *   splitter.
 */
async function fetchAndSplitByOrigin(
  url: string,
  token: string,
  dirName: string,
  transform?: (rows: any[]) => any[],
) {
  const maxRetries = 3;
  let retryCount = 0;
  const tmpFile = path.join(process.cwd(), `tmp-${dirName.replace(/\//g, '-')}.json`);

  while (retryCount <= maxRetries) {
    console.log(`⬇️ 正在拉取並分割資料 [${retryCount > 0 ? `重試 ${retryCount}` : '開始'}]: ${dirName}/...`);
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        },
      });

      if (response.status === 429) {
        const waitTime = Math.pow(2, retryCount) * 5000;
        console.warn(`⚠️ 遇到 429 限制，等待 ${waitTime / 1000} 秒後重試...`);
        await new Promise(r => setTimeout(r, waitTime));
        retryCount++;
        continue;
      }

      if (!response.ok || !response.body) {
        console.error(`❌ 拉取資料失敗 ${dirName}: ${response.status}`);
        return;
      }

      // 串流下載：先把 raw body 寫到暫存檔（不做任何轉換）
      const nodeStream = Readable.fromWeb(response.body as any);
      await streamPipeline(nodeStream, createWriteStream(tmpFile));

      // TDX 對大型回應強制 gzip，但不設 content-encoding header，
      // 用 magic bytes (0x1f 0x8b) 偵測後串流解壓到第二個暫存檔
      const firstBytes = Buffer.alloc(2);
      const fd = await fs.open(tmpFile, 'r');
      await fd.read(firstBytes, 0, 2, 0);
      await fd.close();
      const isGzip = firstBytes[0] === 0x1f && firstBytes[1] === 0x8b;

      if (isGzip) {
        const tmpDecompressed = tmpFile + '.decompressed';
        console.log(`🗜️ 偵測到 gzip magic bytes，串流解壓中...`);
        await streamPipeline(createReadStream(tmpFile), createGunzip(), createWriteStream(tmpDecompressed));
        await fs.unlink(tmpFile);
        await fs.rename(tmpDecompressed, tmpFile);
      }

      const sizeMB = Math.round((await fs.stat(tmpFile)).size / 1024 / 1024 * 10) / 10;
      console.log(`📦 暫存檔大小: ${sizeMB} MB，串流 JSON 解析中...`);

      // 串流 JSON 解析：使用 push API，逐筆按 OriginStationID 分組
      const byOrigin: Record<string, any[]> = {};
      await new Promise<void>((resolve, reject) => {
        const jsonParser = new JSONParser({ paths: ['$.ODFares.*'], keepStack: false });
        jsonParser.onValue = (parsedElementInfo) => {
          const value = parsedElementInfo.value as any;
          const key: string = value?.OriginStationID;
          if (key) {
            if (!byOrigin[key]) byOrigin[key] = [];
            byOrigin[key].push(value);
          }
        };
        jsonParser.onEnd = resolve;
        jsonParser.onError = (err: Error) => reject(err);
        const readStream = createReadStream(tmpFile);
        readStream.on('data', (chunk: string | Buffer) => {
          try { jsonParser.write(chunk as any); } catch (err) { reject(err as Error); }
        });
        readStream.on('error', reject);
      });

      await fs.unlink(tmpFile).catch(() => {});

      const targetDir = path.join(process.cwd(), 'public', 'data', dirName);
      await fs.mkdir(targetDir, { recursive: true });

      const originIds = Object.keys(byOrigin);
      let writtenRows = 0;
      for (const originId of originIds) {
        const filePath = path.join(targetDir, `${originId}.json`);
        const rows = transform ? transform(byOrigin[originId]) : byOrigin[originId];
        writtenRows += rows.length;
        await fs.writeFile(filePath, JSON.stringify(rows));
      }
      if (transform) {
        const inputRows = Object.values(byOrigin).reduce((n, r) => n + r.length, 0);
        console.log(`🔎 消歧義後保留 ${writtenRows} / ${inputRows} 筆`);
      }

      console.log(`✅ 成功分割為 ${originIds.length} 個起始站檔案，存入 public/data/${dirName}/`);
      await new Promise(r => setTimeout(r, 2000));
      return;
    } catch (err) {
      await fs.unlink(tmpFile).catch(() => {});
      console.error(`❌ 處理 ${dirName} 時發生錯誤:`, err);
      retryCount++;
    }
  }
  console.error(`❌ 達到最大重試次數，放棄抓取 ${dirName}`);
}

/**
 * 拉取單一 TDX 端點並回傳解壓後的 body；重試用盡（或 404）時回 null，
 * 由呼叫端決定這是致命錯誤還是可略過的缺漏。
 */
async function fetchTDXBuffer(
  url: string,
  token: string,
  label: string,
  maxRetries = 3,
): Promise<Buffer | null> {
  let retryCount = 0;

  while (retryCount <= maxRetries) {
    console.log(`⬇️ 正在拉取資料 [${retryCount > 0 ? `重試 ${retryCount}` : '開始'}]: ${label}...`);
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        },
      });

      if (response.status === 429) {
        const waitTime = Math.pow(2, retryCount) * 5000; // Exponential backoff
        console.warn(`⚠️ 遇到 429 限制，等待 ${waitTime / 1000} 秒後重試...`);
        await new Promise(r => setTimeout(r, waitTime));
        retryCount++;
        continue;
      }

      // 404 = 該端點／日期沒有資料，重試也不會變出來。
      if (response.status === 404) {
        console.warn(`⚠️ ${label}: HTTP 404，TDX 沒有這筆資料`);
        return null;
      }

      if (!response.ok) {
        throw new Error(`拉取資料失敗 ${label}: HTTP ${response.status}`);
      }

      // 手動處理 gzip：TDX 對大型回應強制壓縮，伺服器忽略 Accept-Encoding:identity
      const rawBuffer = Buffer.from(await response.arrayBuffer());

      if (rawBuffer[0] === 0x1f && rawBuffer[1] === 0x8b) {
        // 偵測到 gzip magic bytes，手動解壓縮
        console.log(`🗜️ 偵測到 gzip 壓縮，正在解壓 ${label}...`);
        return gunzipSync(rawBuffer);
      }
      return rawBuffer;
    } catch (err) {
      console.error(`❌ 處理 ${label} 時發生錯誤:`, err);
      retryCount++;
    }
  }
  return null;
}

async function fetchAndSave(url: string, token: string, filename: string) {
  const finalBuffer = await fetchTDXBuffer(url, token, filename);
  if (!finalBuffer) {
    throw new Error(`達到最大重試次數，放棄抓取 ${filename}`);
  }

  const dataDir = path.join(process.cwd(), 'public', 'data');
  await fs.mkdir(dataDir, { recursive: true });

  const filePath = path.join(dataDir, filename);
  // Validate the complete payload and atomically replace the old file.
  // A partial HTTP 200 response must never destroy the last known-good data.
  await writeValidatedJsonAtomically(filePath, finalBuffer);

  console.log(`✅ 成功儲存 ${filename} (檔案大小: ${Math.round(finalBuffer.length / 1024 / 1024 * 10) / 10} MB)`);

  // Polite delay between different endpoints
  await new Promise(r => setTimeout(r, 2000));
}

// 每日時刻表來源：台鐵先試 v3，失敗退 v2；高鐵只有 v2。
const DAILY_SOURCES: { rail: DailyRail; dirName: string; urls: (date: string) => string[] }[] = [
  {
    rail: 'TRA',
    dirName: 'tra-daily',
    urls: (date) => [
      `https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/DailyTrainTimetable/TrainDate/${date}?$format=JSON`,
      `https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/DailyTimetable/TrainDate/${date}?$format=JSON`,
    ],
  },
  {
    rail: 'THSR',
    dirName: 'thsr-daily',
    urls: (date) => [
      `https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/DailyTimetable/TrainDate/${date}?$format=JSON`,
    ],
  },
];

/**
 * 抓未來 DAILY_WINDOW_DAYS 天的每日時刻表（含加開／停駛／改點），存成壓縮格式。
 * 單一日期抓不到不算失敗：TDX 對較遠的日期常常還沒發布，前端會自動退回全週時刻表。
 */
async function fetchDailyTimetables(token: string) {
  const dates = taipeiDateWindow(DAILY_WINDOW_DAYS);
  console.log(`\n📅 開始抓取每日時刻表：${dates[0]} ～ ${dates[dates.length - 1]}（共 ${dates.length} 天）\n`);

  for (const source of DAILY_SOURCES) {
    const targetDir = path.join(process.cwd(), 'public', 'data', source.dirName);
    await fs.mkdir(targetDir, { recursive: true });
    const minimum = DAILY_MIN_TRAINS[source.rail];
    let written = 0;

    for (const date of dates) {
      let compact: ReturnType<typeof encodeDailyTimetable> | null = null;

      for (const url of source.urls(date)) {
        const buffer = await fetchTDXBuffer(url, token, `${source.dirName}/${date}`, 2);
        if (!buffer) continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(buffer.toString('utf8'));
        } catch (err) {
          console.warn(`⚠️ ${source.dirName}/${date} 回應不是合法 JSON，換下一個版本`);
          continue;
        }

        const encoded = encodeDailyTimetable(source.rail, date, parsed);
        if (encoded.Trains.length >= minimum) {
          compact = encoded;
          break;
        }
        console.warn(`⚠️ ${source.dirName}/${date} 只有 ${encoded.Trains.length} 班車（少於 ${minimum}），視為不完整`);
      }

      if (!compact) {
        console.warn(`⏭️ 跳過 ${source.dirName}/${date}（TDX 尚未提供或資料不完整），保留既有檔案`);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      const payload = Buffer.from(JSON.stringify(compact));
      await writeValidatedJsonAtomically(path.join(targetDir, `${date}.json`), payload);
      written++;
      console.log(`✅ ${source.dirName}/${date}.json — ${compact.Trains.length} 班車 (${Math.round(payload.length / 1024)} KB)`);

      // 一次 14 天 × 2 個系統，拉開間隔避免觸發 429
      await new Promise(r => setTimeout(r, 3000));
    }

    const removed = await pruneDailyDirectory(targetDir, dates);
    if (removed.length) {
      console.log(`🧹 ${source.dirName}: 清除 ${removed.length} 個過期日期檔案`);
    }
    console.log(`📅 ${source.dirName}: ${written}/${dates.length} 天已更新\n`);
  }
}

async function main() {
  console.log('\n🚀 開始執行 TDX 靜態資料拉取腳本 (Stage 2: 終極效能版)...\n');
  
  const token = await getTDXToken();
  if (!token) {
    process.exit(1);
  }

  // 1. 車站列表
  await fetchAndSave('https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/Station?$format=JSON', token, 'tra-stations.json');
  await fetchAndSave('https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/Station?$format=JSON', token, 'thsr-stations.json');

  // 2. 全部時刻表 (GeneralTimetable: 包含所有車次及每週行駛日)
  await fetchAndSave('https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/GeneralTrainTimetable?$format=JSON', token, 'tra-timetable.json');
  await fetchAndSave('https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/GeneralTimetable?$format=JSON', token, 'thsr-timetable.json');

  // 3. 未來兩週的每日時刻表（GeneralTimetable 只有一週的行駛樣式，抓不到加開／停駛／改點）
  await fetchDailyTimetables(token);

  console.log('\n⏳ 為了避免觸發 TDX 針對大型檔案的 429 限制，等待 60 秒...\n');
  await new Promise(r => setTimeout(r, 60000));

  // 4. 票價對照表 (ODFare)
  // TRA ODFare 全量約 535 MB，超過 GitHub 100 MB 限制。
  // 解法：抓一次後按 OriginStationID 拆成小檔案存入 tra-fares/。
  // 每組 OD 都含順行與逆行兩筆（環島兩個方向），實際直達路線只會是距離較短的那筆，
  // 所以寫檔前先消歧義：檔案體積減半，用戶端每次台鐵搜尋要下載的量也減半。
  await fetchAndSplitByOrigin(
    'https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/ODFare?$format=JSON',
    token,
    'tra-fares',
    pickShortestRouteFares,
  );
  await fetchAndSave('https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/ODFare?$format=JSON', token, 'thsr-fares.json');

  console.log('\n🎉 第二批靜態資料 (包含全台時刻表與票價) 已準備完畢！\n');
}

main();
