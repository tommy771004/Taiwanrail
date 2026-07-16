import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { shouldStartAlertPolling } from '../src/lib/alertPollingPolicy.ts';

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
  assert.match(alertEffect, /setInterval\(fetchAlerts, 5 \* 60 \* 1000\)/);
  assert.match(alertEffect, /\}, \[hasSearched\]\);/);
});
