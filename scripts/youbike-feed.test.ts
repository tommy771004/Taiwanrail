import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OFFICIAL_FEED_URL,
  TAIPEI_FEED_URL,
  answerYoubikeQuery,
  createDockSource,
  foldSearchText,
  nearbyDocks,
  normalizeOfficialFeed,
  normalizeTaipeiFeed,
  searchDocks,
  type BikeDock,
} from '../src/lib/youbikeFeed';

// Rows copied from the live feeds on 2026-11-09 (trimmed to the fields read).
const officialRow = (over: Record<string, unknown> = {}) => ({
  country_code: '00',
  area_code: '01',
  type: 2,
  status: 1,
  station_no: '500601001',
  name_tw: '綠川東中山路口',
  district_tw: '中區',
  address_tw: '綠川東街/中山路口(東側)',
  name_en: 'Luchuan E. St. / Zhongshan Rd.',
  district_en: 'Central Dist',
  address_en: 'Luchuan E. St. & Zhongshan Rd. Intersection (East)',
  parking_spaces: 16,
  available_spaces: 3,
  available_spaces_detail: { yb1: 0, yb2: 3, eyb: 0 },
  empty_spaces: 13,
  forbidden_spaces: 0,
  lat: '24.13785',
  lng: '120.68337',
  updated_at: '2026-11-09 13:35:31',
  ...over,
});

const taipeiRow = (over: Record<string, unknown> = {}) => ({
  sno: '500101001',
  sna: 'YouBike2.0_捷運科技大樓站',
  sarea: '大安區',
  mday: '2026-11-09 13:34:04',
  ar: '復興南路二段235號前',
  sareaen: 'Daan Dist.',
  snaen: 'YouBike2.0_MRT Technology Bldg. Sta.',
  aren: 'No.235， Sec. 2， Fuxing S. Rd.',
  act: '1',
  Quantity: 28,
  available_rent_bikes: 2,
  latitude: 25.02605,
  longitude: 121.5436,
  available_return_bikes: 25,
  ...over,
});

const dock = (over: Partial<BikeDock>): BikeDock => ({
  id: '1', name: 'X', nameEn: 'X', area: '00', district: '', districtEn: '', address: '', addressEn: '',
  lat: 25.0, lng: 121.5, bikes: 1, ebikes: null, docks: 1, total: 2, suspended: false, updateTime: null,
  ...over,
});

test('official feed: string coordinates, e-bike breakdown, status 2 is suspended', () => {
  const [a, b] = normalizeOfficialFeed([officialRow(), officialRow({ station_no: '500601002', status: 2, available_spaces_detail: { yb1: 0, yb2: 1, eyb: 2 } })]);
  assert.equal(a.lat, 24.13785);
  assert.equal(a.lng, 120.68337);
  assert.equal(a.bikes, 3);
  assert.equal(a.docks, 13);
  assert.equal(a.total, 16);
  assert.equal(a.ebikes, 0);
  assert.equal(a.area, '01');
  assert.equal(a.suspended, false);
  assert.equal(b.suspended, true);
  assert.equal(b.ebikes, 2);
});

test('rows without readable counts or coordinates are dropped, never zero-filled', () => {
  const docks = normalizeOfficialFeed([
    officialRow({ available_spaces: null }),
    officialRow({ empty_spaces: '' }),
    officialRow({ lat: 'x' }),
    officialRow({ lat: '0', lng: '0' }),
    officialRow(),
  ]);
  assert.equal(docks.length, 1);
});

test('Taipei feed: YouBike2.0_ prefix stripped, act decides suspension, no e-bike breakdown', () => {
  const [a, b] = normalizeTaipeiFeed([taipeiRow(), taipeiRow({ sno: '500101002', act: '0' })]);
  assert.equal(a.name, '捷運科技大樓站');
  assert.equal(a.nameEn, 'MRT Technology Bldg. Sta.');
  assert.equal(a.area, '00');
  assert.equal(a.bikes, 2);
  assert.equal(a.docks, 25);
  assert.equal(a.total, 28);
  assert.equal(a.ebikes, null);
  assert.equal(b.suspended, true);
  // The Kaohsiung-style envelope { retVal: [...] } is read too.
  assert.equal(normalizeTaipeiFeed({ retVal: [taipeiRow()] }).length, 1);
});

test('nearby: radius cut-off and nearest first', () => {
  const docks = [
    dock({ id: 'far', lat: 25.02, lng: 121.5 }), // ~2.2 km
    dock({ id: 'near', lat: 25.0005, lng: 121.5 }), // ~56 m
    dock({ id: 'mid', lat: 25.004, lng: 121.5 }), // ~445 m
  ];
  const hits = nearbyDocks(docks, 25.0, 121.5, 800, 10);
  assert.deepEqual(hits.map(d => d.id), ['near', 'mid']);
  assert.ok(Math.abs((hits[0].distance as number) - 56) <= 1);
  assert.deepEqual(nearbyDocks(docks, 25.0, 121.5, 800, 1).map(d => d.id), ['near']);
});

test('search: 台 matches 臺, every token must match, name hits rank first', () => {
  assert.equal(foldSearchText('台中 車站'), '臺中車站');
  const docks = [
    dock({ id: 'addr', name: '大智機車停車場', address: '臺中車站旁', area: '01' }),
    dock({ id: 'b', name: '臺中車站(大智北路)', area: '01' }),
    dock({ id: 'a', name: '臺中車站(建國路)', area: '01' }),
    dock({ id: 'tpe', name: '臺北車站', area: '00' }),
  ];
  const hits = searchDocks(docks, '台中車站', { limit: 10 });
  assert.deepEqual(hits.map(d => d.id).slice(0, 2).sort(), ['a', 'b']);
  assert.equal(hits[2].id, 'addr');
  assert.equal(hits.length, 3);
  assert.deepEqual(searchDocks(docks, '車站', { area: '00', limit: 10 }).map(d => d.id), ['tpe']);
  assert.deepEqual(searchDocks(docks, '台中 建國', { limit: 10 }).map(d => d.id), ['a']);
  assert.equal(searchDocks(docks, '台中車站', { limit: 10 })[0].distance, null);
});

const officialPayload = (n: number) => Array.from({ length: n }, (_, i) =>
  officialRow({ station_no: String(500600000 + i), lat: String(24.1 + i * 1e-5) }));

function scriptedSource(script: Record<string, Array<unknown | Error>>) {
  let t = 0;
  const calls: string[] = [];
  const source = createDockSource({
    now: () => t,
    fetchJson: async (url) => {
      calls.push(url);
      const next = script[url]?.shift();
      if (next === undefined || next instanceof Error) throw next ?? new Error('no script');
      return next;
    },
  });
  return { source, calls, advance: (ms: number) => { t += ms; } };
}

test('source: caches for a minute, serves the held nationwide snapshot as stale when a refresh fails', async () => {
  const s = scriptedSource({ [OFFICIAL_FEED_URL]: [officialPayload(3000), new Error('down')] });
  const first = await s.source.get();
  assert.equal(first?.snapshot.source, 'official');
  assert.equal(first?.stale, false);
  await s.source.get();
  assert.equal(s.calls.length, 1, 'second call within the TTL hits the cache');
  s.advance(61_000);
  const second = await s.source.get();
  assert.equal(second?.snapshot.source, 'official');
  assert.equal(second?.stale, true);
  assert.deepEqual(s.calls, [OFFICIAL_FEED_URL, OFFICIAL_FEED_URL], 'Taipei is not fetched while a recent nationwide snapshot exists');
});

test('source: falls back to Taipei only with no recent nationwide snapshot; a thin payload is a failure', async () => {
  const s = scriptedSource({
    [OFFICIAL_FEED_URL]: [officialPayload(50)],
    [TAIPEI_FEED_URL]: [Array.from({ length: 300 }, (_, i) => taipeiRow({ sno: String(500100000 + i) }))],
  });
  const got = await s.source.get();
  assert.equal(got?.snapshot.source, 'taipei');
  assert.equal(got?.snapshot.docks.length, 300);
});

test('source: nothing usable → null (the UI shows 無法取得, not invented docks)', async () => {
  const s = scriptedSource({ [OFFICIAL_FEED_URL]: [new Error('x')], [TAIPEI_FEED_URL]: [new Error('y')] });
  assert.equal(await s.source.get(), null);
});

test('HTTP contract: legacy nearest shape, nearby, search, ids, bad input', async () => {
  const s = scriptedSource({ [OFFICIAL_FEED_URL]: [officialPayload(3000)] });
  const legacy = await answerYoubikeQuery(new URLSearchParams('lat=24.1&lon=120.68337'), s.source);
  const station = (legacy.body as { station: Record<string, unknown> }).station;
  assert.equal(legacy.status, 200);
  assert.deepEqual(Object.keys(station).sort(), ['act', 'bikes', 'distance', 'docks', 'lat', 'lng', 'name', 'nameEn', 'total', 'updateTime']);
  assert.equal(station.act, '1');

  const nearby = await answerYoubikeQuery(new URLSearchParams('mode=nearby&lat=24.1&lon=120.68337&radius=100&limit=5'), s.source);
  const nb = nearby.body as { docks: Array<{ distance: number }>; source: string; stale: boolean };
  assert.equal(nb.docks.length, 5);
  assert.ok(nb.docks.every((d, i, a) => i === 0 || a[i - 1].distance <= d.distance));
  assert.equal(nb.source, 'official');

  const search = await answerYoubikeQuery(new URLSearchParams('mode=search&q=綠川&area=01'), s.source);
  assert.equal((search.body as { docks: unknown[] }).docks.length, 40);
  const ids = await answerYoubikeQuery(new URLSearchParams('mode=ids&ids=500600001,abc,500600002'), s.source);
  assert.deepEqual((ids.body as { docks: Array<{ id: string }> }).docks.map(d => d.id), ['500600001', '500600002']);

  assert.equal((await answerYoubikeQuery(new URLSearchParams('mode=nearby'), s.source)).status, 400);
  assert.equal((await answerYoubikeQuery(new URLSearchParams('mode=search&q='), s.source)).status, 400);
  assert.equal((await answerYoubikeQuery(new URLSearchParams('mode=zzz'), s.source)).status, 400);
});

test('HTTP contract: failed source → 503 for list modes, station:null + error for the legacy lookup', async () => {
  const s = scriptedSource({});
  assert.equal((await answerYoubikeQuery(new URLSearchParams('mode=nearby&lat=25&lon=121.5'), s.source)).status, 503);
  const legacy = await answerYoubikeQuery(new URLSearchParams('lat=25&lon=121.5'), s.source);
  assert.deepEqual(legacy.body, { station: null, error: 'fetch_failed' });
});
