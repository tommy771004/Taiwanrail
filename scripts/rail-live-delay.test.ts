import assert from 'node:assert/strict';
import test from 'node:test';

import { loadRailLiveDelays, mergeRailLiveDelays } from '../src/lib/railLiveDelays';

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
