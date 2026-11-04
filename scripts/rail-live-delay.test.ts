import assert from 'node:assert/strict';
import test from 'node:test';

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadRailLiveDelays, mergeRailLiveDelays } from '../src/lib/railLiveDelays';
import { RAIL_LIVE_IDLE_LIMIT_MS, shouldPollRailLive } from '../src/lib/railLivePolling';

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

test('開著沒人動的分頁在閒置上限到達時停止輪詢，互動後恢復', () => {
  const justInside = { ...pollState, now: RAIL_LIVE_IDLE_LIMIT_MS - 1 };
  const atLimit = { ...pollState, now: RAIL_LIVE_IDLE_LIMIT_MS };
  assert.equal(shouldPollRailLive(justInside), true);
  assert.equal(shouldPollRailLive(atLimit), false);
  assert.equal(shouldPollRailLive({ ...atLimit, lastActivityAt: atLimit.now - 1 }), true);
});

test('App 的誤點輪詢每次都經過 shouldPollRailLive，並追蹤使用者互動', async () => {
  const source = await readFile(join(process.cwd(), 'src/App.tsx'), 'utf8');
  const start = source.indexOf('const refresh = async () => {', source.indexOf('今天的台鐵結果停在畫面上時'));
  assert.notEqual(start, -1);
  const pollEffect = source.slice(start, source.indexOf('const filteredTimetables', start));
  assert.match(pollEffect, /shouldPollRailLive\(\{/);
  assert.match(pollEffect, /taiwanDateString\(\)/);
  assert.match(pollEffect, /removeEventListener/);
});
