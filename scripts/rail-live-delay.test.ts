import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getTRALiveBoard } from '../src/lib/api';
import { loadRailLiveDelays, mergeRailLiveDelays } from '../src/lib/railLiveDelays';
import { isTraOffHours, RAIL_LIVE_IDLE_LIMIT_MS, shouldPollRailLive } from '../src/lib/railLivePolling';
import { taiwanDateOf, taiwanDateString, taiwanHourOf } from '../src/lib/taiwanDate';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('one LiveBoard request indexes every returned train for timetable cards', async () => {
  let requestCount = 0;
  const fetchLiveBoard = async (stationId: string) => {
    requestCount += 1;
    assert.equal(stationId, '1000');
    return [
      { TrainNo: '101', DelayTime: 7, Platform: '2A' },
      { TrainNo: '102', DelayTime: 0, Platform: '1B' },
    ];
  };

  const result = await loadRailLiveDelays(fetchLiveBoard, '1000');

  assert.equal(requestCount, 1);
  assert.deepEqual(result.delays, { '101': 7, '102': 0 });
  assert.equal(result.details['101']?.Platform, '2A');
});

test('invalid LiveBoard rows are ignored and invalid delays do not create a false delay', async () => {
  const result = await loadRailLiveDelays(async () => [
    { TrainNo: '', DelayTime: 9 },
    { TrainNo: '201', DelayTime: Number.NaN },
    null,
  ], '1000');

  assert.deepEqual(result.delays, { '201': 0 });
  assert.equal(result.details['201']?.DelayTime, Number.NaN);
});

test('LiveTrainDelay fills in trains the station LiveBoard does not list', () => {
  const board = { delays: { '101': 7 }, details: { '101': { TrainNo: '101', DelayTime: 7, Platform: '2A' } } };
  const result = mergeRailLiveDelays([
    { TrainNo: '101', DelayTime: 3 },
    { TrainNo: 305, DelayTime: 12 },
    { TrainNo: '306', DelayTime: 0 },
  ], board);

  // 101: the station board is the delay predicted for the searched station, so it wins.
  assert.deepEqual(result.delays, { '101': 7, '305': 12, '306': 0 });
  assert.equal(result.details['101']?.Platform, '2A');
  assert.equal(result.details['305'], undefined);
});

test('a missing reading never becomes an on-time train', () => {
  const board = { delays: { '201': 0 }, details: { '201': { TrainNo: '201', DelayTime: Number.NaN } } };
  const result = mergeRailLiveDelays([
    { TrainNo: '201', DelayTime: 9 },
    { TrainNo: '202', DelayTime: Number.NaN },
    { TrainNo: '', DelayTime: 4 },
    null as never,
  ], board);

  assert.deepEqual(result.delays, { '201': 9 });
});

test('LiveTrainDelay failure leaves the station board untouched', () => {
  const board = { delays: { '101': 5 }, details: { '101': { TrainNo: '101', DelayTime: 5 } } };
  assert.deepEqual(mergeRailLiveDelays(undefined, board).delays, { '101': 5 });
});

const pollState = {
  hidden: false,
  searchDate: '2026-11-04',
  today: '2026-11-04',
  lastActivityAt: 0,
  now: 60_000,
};

test('今天的結果留在前景且有人在看時才輪詢', () => {
  assert.equal(shouldPollRailLive(pollState), true);
  assert.equal(shouldPollRailLive({ ...pollState, hidden: true }), false);
});

test('分頁開過午夜後，昨天的查詢不再輪詢', () => {
  assert.equal(shouldPollRailLive({ ...pollState, today: '2026-11-05' }), false);
});

test('開著沒人動的分頁在閒置上限（10 分鐘）到達時停止輪詢，互動後恢復', () => {
  assert.equal(RAIL_LIVE_IDLE_LIMIT_MS, 10 * 60_000);
  const justInside = { ...pollState, now: RAIL_LIVE_IDLE_LIMIT_MS - 1 };
  const atLimit = { ...pollState, now: RAIL_LIVE_IDLE_LIMIT_MS };
  assert.equal(shouldPollRailLive(justInside), true);
  assert.equal(shouldPollRailLive(atLimit), false);
  assert.equal(shouldPollRailLive({ ...atLimit, lastActivityAt: atLimit.now - 1 }), true);
});

test('台北時間凌晨 01:00–04:00 暫停背景輪詢，04:00 起恢復（清晨首班車約 04:20 就開）', () => {
  const t0059 = Date.parse('2026-11-05T00:59:00+08:00');
  const t0100 = Date.parse('2026-11-05T01:00:00+08:00');
  const t0359 = Date.parse('2026-11-05T03:59:59+08:00');
  const t0400 = Date.parse('2026-11-05T04:00:00+08:00');

  assert.equal(taiwanHourOf(new Date(t0059)), 0);
  assert.equal(taiwanHourOf(new Date(t0100)), 1);
  assert.equal(taiwanHourOf(new Date(t0359)), 3);
  assert.equal(taiwanHourOf(new Date(t0400)), 4);
  assert.equal(isTraOffHours(0), false);
  assert.equal(isTraOffHours(1), true);
  assert.equal(isTraOffHours(3), true);
  assert.equal(isTraOffHours(4), false);

  const onNov5 = { hidden: false, searchDate: '2026-11-05', today: '2026-11-05' };
  assert.equal(shouldPollRailLive({ ...onNov5, lastActivityAt: t0059, now: t0059 }), true);
  assert.equal(shouldPollRailLive({ ...onNov5, lastActivityAt: t0100, now: t0100 }), false);
  assert.equal(shouldPollRailLive({ ...onNov5, lastActivityAt: t0359, now: t0359 }), false);
  assert.equal(shouldPollRailLive({ ...onNov5, lastActivityAt: t0400, now: t0400 }), true);
});

test('getTRALiveBoard 直接抓共用全線 URL 並依 StationID 精確篩選，使不同車站共用同一份 CDN 快取', async () => {
  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrls.push(String(input));
    return new Response(
      JSON.stringify({
        LiveBoards: [
          { StationID: '1000', TrainNo: '101', DelayTime: 3 },
          { StationID: '10000', TrainNo: '999', DelayTime: 0 },
          { StationID: '3300', TrainNo: '125', DelayTime: 5 },
        ],
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  const taipei = await getTRALiveBoard('1000');
  const taichung = await getTRALiveBoard('3300');
  const empty = await getTRALiveBoard('4400');

  assert.deepEqual(requestedUrls, ['/api/tdx/basic/v2/Rail/TRA/LiveBoard?$format=JSON']);
  assert.equal(taipei.length, 1);
  assert.equal(taipei[0]?.TrainNo, '101');
  assert.equal(taichung.length, 1);
  assert.equal(taichung[0]?.TrainNo, '125');
  assert.deepEqual(empty, []);
});

test('App 的誤點輪詢每次都經過 shouldPollRailLive，並追蹤使用者互動', async () => {
  const source = await readFile(join(process.cwd(), 'src/App.tsx'), 'utf8');
  const start = source.indexOf('const refresh = async', source.indexOf('今天的台鐵結果停在畫面上時'));
  assert.notEqual(start, -1);
  const pollEffect = source.slice(start, source.indexOf('const filteredTimetables', start));
  assert.match(pollEffect, /shouldPollRailLive\(\{/);
  assert.match(pollEffect, /taiwanDateString\(\)/);
  assert.match(pollEffect, /removeEventListener/);
});

test('台北時間工具不會每次呼叫都建立 Intl.DateTimeFormat（捲動事件每次都會經過）', () => {
  const RealFormat = Intl.DateTimeFormat;
  let constructed = 0;
  Intl.DateTimeFormat = new Proxy(RealFormat, {
    construct(target, args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      constructed += 1;
      return new target(...args);
    },
    apply(target, _thisArg, args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      constructed += 1;
      return target(...args);
    },
  });
  try {
    for (let i = 0; i < 100; i += 1) {
      taiwanHourOf();
      taiwanDateOf();
      taiwanDateString();
    }
  } finally {
    Intl.DateTimeFormat = RealFormat;
  }
  assert.equal(constructed, 0);
  // 共用之後結果仍要是台北時間，不是執行環境的時區。
  assert.equal(taiwanHourOf(new Date('2026-11-05T17:30:00Z')), 1);
  assert.equal(taiwanDateOf(new Date('2026-11-05T17:30:00Z')), '2026-11-06');
});

test('誤點輪詢：切回台鐵分頁時若已過期就立刻補抓，捲動時未到時間先離開', async () => {
  const source = await readFile(join(process.cwd(), 'src/App.tsx'), 'utf8');
  const effectStart = source.indexOf('今天的台鐵結果停在畫面上時');
  const effect = source.slice(effectStart, source.indexOf('const filteredTimetables', effectStart));

  // 上次抓取時間跨 effect 保留；放在 effect 內的話每次重掛都會歸零，切回分頁就不補抓。
  assert.doesNotMatch(effect, /let lastFetchAt/);
  assert.match(source, /const lastLiveFetchAtRef = useRef\(0\);/);
  // 搜尋時也算一次抓取，否則剛搜尋完 effect 掛上就重抓一次。
  assert.match(source, /if \(shouldFetchLiveDelays\) lastLiveFetchAtRef\.current = Date\.now\(\);/);

  const elapsedCheck = effect.indexOf('if (now - lastLiveFetchAtRef.current < minElapsedMs) return;');
  assert.notEqual(elapsedCheck, -1);
  assert.ok(elapsedCheck < effect.indexOf('shouldPollRailLive({'), '未到時間要在算台北日期之前就離開');
  assert.match(effect, /document\.addEventListener\('visibilitychange', markActive\);\n\s*\/\/[^\n]*\n\s*void refresh\(RAIL_LIVE_POLL_MS\);/);
});

test('the timetable never waits for the live delay feed', async () => {
  const source = await readFile(join(process.cwd(), 'src/App.tsx'), 'utf8');
  const search = source.slice(source.indexOf('const fetchTimetable = async'), source.indexOf('const handleSelectRecentSearch'));
  assert.doesNotMatch(search, /await (?:liveBoardPromise|liveDelaysPromise|fetchTraLiveDelays)/);
  // 晚回來的誤點不能蓋掉更新的查詢。
  assert.match(search, /liveDelaysPromise[\s\S]*seatSearchSeqRef\.current !== seatSeq/);
});
