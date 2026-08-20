import assert from 'node:assert/strict';
import test from 'node:test';

import { loadRailLiveDelays } from '../src/lib/railLiveDelays';

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
