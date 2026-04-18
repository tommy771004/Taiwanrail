import fs from 'fs/promises';
import path from 'path';
import 'dotenv/config'; // 自動嘗試載入 .env

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
          // 明確要求不壓縮：避免 gzip 回應導致 JSON.parse 失敗
          'Accept-Encoding': 'identity',
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

      const data = await response.json();
      const dataDir = path.join(process.cwd(), 'public', 'data');
      await fs.mkdir(dataDir, { recursive: true });

      const filePath = path.join(dataDir, filename);
      await fs.writeFile(filePath, JSON.stringify(data), 'utf-8'); // No space to save size in production
      
      console.log(`✅ 成功儲存 ${filename} (檔案大小: ${Math.round(JSON.stringify(data).length / 1024)} KB)`);
      
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

  // 3. 票價對照表 (ODFare)
  // 台鐵 ODFare 全部拉下來約數 MB，我們也一併打包！
  await fetchAndSave('https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/ODFare?$format=JSON', token, 'tra-fares.json');
  await fetchAndSave('https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/ODFare?$format=JSON', token, 'thsr-fares.json');

  console.log('\n🎉 第二批靜態資料 (包含全台時刻表與票價) 已準備完畢！\n');
}

main();
