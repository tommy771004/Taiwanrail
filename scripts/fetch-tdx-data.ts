import fs from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';
import 'dotenv/config'; // 自動嘗試載入 .env

const gunzip = promisify(zlib.gunzip);

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

async function fetchAndSplitByOrigin(url: string, token: string, dirName: string) {
  const maxRetries = 3;
  let retryCount = 0;

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

      if (!response.ok) {
        console.error(`❌ 拉取資料失敗 ${dirName}: ${response.status}`);
        return;
      }

      const rawBuffer = Buffer.from(await response.arrayBuffer());
      let finalBuffer: Buffer;
      if (rawBuffer[0] === 0x1f && rawBuffer[1] === 0x8b) {
        console.log(`🗜️ 偵測到 gzip 壓縮，正在解壓...`);
        finalBuffer = await gunzip(rawBuffer);
      } else {
        finalBuffer = rawBuffer;
      }

      console.log(`📦 原始資料大小: ${Math.round(finalBuffer.length / 1024 / 1024 * 10) / 10} MB，開始按 OriginStationID 分割...`);

      const data = JSON.parse(finalBuffer.toString());
      const odfares: any[] = data.ODFares || (Array.isArray(data) ? data : []);

      // 按起始站 ID 分組
      const byOrigin: Record<string, any[]> = {};
      for (const fare of odfares) {
        const key = fare.OriginStationID;
        if (!byOrigin[key]) byOrigin[key] = [];
        byOrigin[key].push(fare);
      }

      const targetDir = path.join(process.cwd(), 'public', 'data', dirName);
      await fs.mkdir(targetDir, { recursive: true });

      const originIds = Object.keys(byOrigin);
      for (const originId of originIds) {
        const filePath = path.join(targetDir, `${originId}.json`);
        await fs.writeFile(filePath, JSON.stringify(byOrigin[originId]));
      }

      console.log(`✅ 成功分割為 ${originIds.length} 個起始站檔案，存入 public/data/${dirName}/`);
      await new Promise(r => setTimeout(r, 2000));
      return;
    } catch (err) {
      console.error(`❌ 處理 ${dirName} 時發生錯誤:`, err);
      retryCount++;
    }
  }
  console.error(`❌ 達到最大重試次數，放棄抓取 ${dirName}`);
}

async function fetchAndSave(url: string, token: string, filename: string) {
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount <= maxRetries) {
    console.log(`⬇️ 正在拉取資料 [${retryCount > 0 ? `重試 ${retryCount}` : '開始'}]: ${filename}...`);
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

      if (!response.ok) {
        console.error(`❌ 拉取資料失敗 ${filename}: ${response.status}`);
        return;
      }

      // 手動處理 gzip：TDX 對大型回應強制壓縮，伺服器忽略 Accept-Encoding:identity
      const rawBuffer = Buffer.from(await response.arrayBuffer());
      let finalBuffer: Buffer;
      
      if (rawBuffer[0] === 0x1f && rawBuffer[1] === 0x8b) {
        // 偵測到 gzip magic bytes，手動解壓縮
        console.log(`🗜️ 偵測到 gzip 壓縮，正在解壓 ${filename}...`);
        finalBuffer = await gunzip(rawBuffer);
      } else {
        finalBuffer = rawBuffer;
      }

      const dataDir = path.join(process.cwd(), 'public', 'data');
      await fs.mkdir(dataDir, { recursive: true });

      const filePath = path.join(dataDir, filename);
      // 直接把 Buffer 寫入檔案，避免大檔案超出 Node.js 的字串最大長度限制
      await fs.writeFile(filePath, finalBuffer);
      
      console.log(`✅ 成功儲存 ${filename} (檔案大小: ${Math.round(finalBuffer.length / 1024 / 1024 * 10) / 10} MB)`);
      
      // Polite delay between different endpoints
      await new Promise(r => setTimeout(r, 2000));
      return;
    } catch (err) {
      console.error(`❌ 處理 ${filename} 時發生錯誤:`, err);
      retryCount++;
    }
  }
  console.error(`❌ 達到最大重試次數，放棄抓取 ${filename}`);
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

  console.log('\n⏳ 為了避免觸發 TDX 針對大型檔案的 429 限制，等待 60 秒...\n');
  await new Promise(r => setTimeout(r, 60000));

  // 3. 票價對照表 (ODFare)
  // TRA ODFare 全量約 535 MB，超過 GitHub 100 MB 限制。
  // 解法：抓一次後按 OriginStationID 拆成小檔案（每檔 ~2 MB）存入 tra-fares/
  await fetchAndSplitByOrigin('https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/ODFare?$format=JSON', token, 'tra-fares');
  await fetchAndSave('https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/ODFare?$format=JSON', token, 'thsr-fares.json');

  console.log('\n🎉 第二批靜態資料 (包含全台時刻表與票價) 已準備完畢！\n');
}

main();
