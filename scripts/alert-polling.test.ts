import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { shouldStartAlertPolling } from '../src/lib/alertPollingPolicy.ts';
import { parseCancelledTrainNos } from '../src/lib/railAlertCancellations.ts';

test('passive page opens do not start Alert polling', () => {
  assert.equal(shouldStartAlertPolling(false), false);
});

test('an accepted route search may start Alert polling', () => {
  assert.equal(shouldStartAlertPolling(true), true);
});

test('App gates Alert polling on engaged rail search state', async () => {
  const source = await readFile(join(process.cwd(), 'src/App.tsx'), 'utf8');
  const start = source.indexOf('if (!shouldStartAlertPolling(hasSearched)) return;');
  const end = source.indexOf('const scrollToTrain', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const alertEffect = source.slice(start, end);
  assert.match(alertEffect, /setInterval\(refreshIfVisible, 5 \* 60 \* 1000\)/);
  // A background tab must not keep spending TDX calls.
  assert.match(alertEffect, /document\.visibilityState === 'hidden'\) return;/);
  assert.match(alertEffect, /removeEventListener\('visibilitychange', onVisible\)/);
  assert.match(alertEffect, /\}, \[hasSearched\]\);/);
});

test('停駛車次只認「…次」與「車次 …」，不把年份、時間、里程當車次', () => {
  const got = parseCancelledTrainNos([
    { Title: '颱風停駛', Description: '115年11月3日 10:30 起，花蓮至台東間第 402、404 及 406 次停駛，K123 處搶修。' },
    { Description: '2026/11/03 車次：1234、1236 取消' },
    { Description: '區間車 3185次 部分停駛' },
  ]);
  assert.deepEqual([...got].sort(), ['1234', '1236', '3185', '402', '404', '406']);
});

test('沒有停駛／取消字樣的公告不產生停駛車次', () => {
  assert.equal(parseCancelledTrainNos([{ Title: '第 123 次延誤 10 分', Description: '' }]).size, 0);
});

test('「全線停駛」等沒有車次號碼的公告不誤標任何車次', () => {
  assert.equal(parseCancelledTrainNos([{ Description: '115年颱風，東部幹線 2026 年 11 月 3 日全線停駛' }]).size, 0);
});
