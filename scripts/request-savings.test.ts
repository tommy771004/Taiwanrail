/**
 * Requests the browser no longer has to make: cache headers on fixed-name static files, the
 * icons that used to fall through to the SPA rewrite, and the browser-side /api/log dedup.
 *   npm run test:request-savings
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { markLoggedToday, queryLogKey, taipeiDay, wasLoggedToday } from '../src/lib/queryLogDedup';

type Header = { key: string; value: string };
type RouteHeaders = { source: string; headers: Header[] };

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

const trip = { transportType: 'train', originStationId: '1000', destStationId: '4400', queryDate: '2026-11-27' };

test('a query is skipped only after it was logged the same Taipei day', () => {
  const storage = memoryStorage();
  const key = queryLogKey(trip);
  const noon = new Date('2026-11-27T04:00:00Z'); // 12:00 Taipei
  assert.equal(wasLoggedToday(storage, key, noon), false);
  markLoggedToday(storage, key, noon);
  assert.equal(wasLoggedToday(storage, key, noon), true);
  // 23:59 Taipei is still the same day; 00:00 the next day is not.
  assert.equal(wasLoggedToday(storage, key, new Date('2026-11-27T15:59:00Z')), true);
  assert.equal(wasLoggedToday(storage, key, new Date('2026-11-27T16:00:00Z')), false);
});

test('the key matches the server dedup: transport, origin, destination and travel date only', () => {
  const base = queryLogKey(trip);
  assert.notEqual(queryLogKey({ ...trip, transportType: 'hsr' }), base);
  assert.notEqual(queryLogKey({ ...trip, destStationId: '1020' }), base);
  assert.notEqual(queryLogKey({ ...trip, queryDate: '2026-11-28' }), base);
  // The arrivals board has no destination (NULL on the server).
  assert.notEqual(queryLogKey({ ...trip, destStationId: undefined }), base);
  assert.equal(queryLogKey({ ...trip, destStationId: undefined }), queryLogKey({ ...trip, destStationId: undefined }));
});

test('broken storage never suppresses a log', () => {
  const storage = memoryStorage();
  storage.data.set('_rl_log_seen', '{not json');
  assert.equal(wasLoggedToday(storage, queryLogKey(trip)), false);
  storage.data.set('_rl_log_seen', JSON.stringify({ day: taipeiDay(), keys: 'x' }));
  assert.equal(wasLoggedToday(storage, queryLogKey(trip)), false);
});

test('fixed-name icons and /data/ are browser-cached for a day; pages and the API are not', async () => {
  const config = JSON.parse(await readFile(join(process.cwd(), 'vercel.json'), 'utf8')) as {
    headers: RouteHeaders[];
  };
  const cacheRules = config.headers.filter((r) => r.headers.some((h) => h.key.toLowerCase() === 'cache-control'));
  const matches = (path: string) =>
    cacheRules.filter((r) => new RegExp(`^${r.source.replace(/\(\.\*\)/g, '.*')}$`).test(path));

  for (const path of [
    '/logo.svg', '/favicon.ico', '/apple-touch-icon.png', '/apple-touch-icon-precomposed.png',
    '/pwa-192x192.png', '/manifest.webmanifest', '/data/tra-stations.json', '/data/tra-daily/2026-11-27.json',
  ]) {
    const rules = matches(path);
    assert.equal(rules.length, 1, `${path} has one cache rule`);
    assert.equal(rules[0].headers.find((h) => h.key === 'Cache-Control')?.value, 'public, max-age=86400');
  }
  // HTML must revalidate (daily data deploys change it) and /api/ sets its own headers.
  for (const path of ['/', '/en/', '/thsr/', '/routes/hsr/taipei-to-taichung/', '/api/log', '/api/tdx/x', '/assets/index-x.js']) {
    assert.equal(matches(path).length, 0, `${path} has no static cache rule`);
  }
});

test('icons browsers request on their own exist as real files', async () => {
  for (const file of ['favicon.ico', 'apple-touch-icon-precomposed.png']) {
    await access(join(process.cwd(), 'public', file));
  }
});
