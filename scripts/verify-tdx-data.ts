import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateJsonPayload } from './tdx-data-integrity.js';
import {
  DAILY_MIN_TRAINS,
  DAILY_WINDOW_DAYS,
  isDailyDateString,
  parseCompactDaily,
  taipeiDateString,
  type DailyRail,
} from '../src/lib/dailyTimetable.js';

type DatasetCheck = {
  path: string;
  collection?: string;
  minimumItems: number;
};

const checks: DatasetCheck[] = [
  { path: 'public/data/tra-stations.json', collection: 'Stations', minimumItems: 200 },
  { path: 'public/data/thsr-stations.json', minimumItems: 10 },
  { path: 'public/data/tra-timetable.json', collection: 'TrainTimetables', minimumItems: 500 },
  { path: 'public/data/thsr-timetable.json', minimumItems: 100 },
];

for (const check of checks) {
  const filePath = resolve(check.path);
  const payload = validateJsonPayload(await readFile(filePath));
  const collection = check.collection
    ? (payload as Record<string, unknown>)[check.collection]
    : payload;

  if (!Array.isArray(collection) || collection.length < check.minimumItems) {
    throw new Error(
      `${check.path} failed integrity check: expected at least ${check.minimumItems} items`,
    );
  }

  console.log(`✓ ${check.path}: ${collection.length} items`);
}

// 每日時刻表（未來兩週）。TDX 常常還沒發布較遠的日期，所以缺天數只警告；
// 但已經存在的檔案一定要是完整、日期正確的壓縮快照，否則寧可讓 workflow 失敗。
const dailyChecks: { rail: DailyRail; path: string }[] = [
  { rail: 'TRA', path: 'public/data/tra-daily' },
  { rail: 'THSR', path: 'public/data/thsr-daily' },
];

const today = taipeiDateString();

for (const check of dailyChecks) {
  let entries: string[];
  try {
    entries = (await readdir(resolve(check.path))).filter((entry) => entry.endsWith('.json'));
  } catch {
    console.warn(`! ${check.path}: 尚未產生每日時刻表快照（執行 npm run fetch-data 後才會出現）`);
    continue;
  }

  if (entries.length === 0) {
    console.warn(`! ${check.path}: 目錄是空的，跳過檢查`);
    continue;
  }

  let upcoming = 0;
  for (const entry of entries) {
    const date = entry.slice(0, -'.json'.length);
    const filePath = resolve(check.path, entry);

    if (!isDailyDateString(date)) {
      throw new Error(`${filePath} failed integrity check: filename must be YYYY-MM-DD.json`);
    }

    const payload = validateJsonPayload(await readFile(filePath));
    if (!parseCompactDaily(payload, { rail: check.rail, date })) {
      throw new Error(
        `${filePath} failed integrity check: expected a ${check.rail} snapshot for ${date} ` +
          `with at least ${DAILY_MIN_TRAINS[check.rail]} trains`,
      );
    }

    if (date >= today) upcoming += 1;
  }

  const label = `${check.path}: ${upcoming}/${DAILY_WINDOW_DAYS} 天`;
  if (upcoming < DAILY_WINDOW_DAYS) {
    console.warn(`! ${label}（TDX 尚未發布較遠日期時屬正常，前端會退回全週時刻表）`);
  } else {
    console.log(`✓ ${label}`);
  }
}
