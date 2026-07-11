import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeMetroStationName,
  resolveStationFootfall,
  serviceDateForStationTime,
  type StationFootfallDataset,
} from '../src/lib/stationFootfall.js';

const blankMetro = () => Array.from({ length: 7 }, () => Array<number | null>(24).fill(null));
const dataset: StationFootfallDataset = {
  version: 1,
  metro: {},
  tra: { '1000': [0, 1, 2, null, null, null, null] },
};
dataset.metro['台北車站'] = blankMetro();
dataset.metro['台北車站'][1][8] = 2; // Monday 08:00

test('normalizes 台/臺 and whitespace before resolving a Metro station', () => {
  assert.equal(normalizeMetroStationName(' 臺北 車站 '), '台北車站');
  assert.deepEqual(
    resolveStationFootfall(dataset, {
      mode: 'metro-trtc',
      stationName: '臺北 車站',
      date: '2026-07-13', // Monday
      time: '08:36',
    }),
    { level: 'high' },
  );
});

test('requires the searched weekday and time bucket to exist', () => {
  assert.equal(resolveStationFootfall(dataset, {
    mode: 'metro-trtc',
    stationName: '台北車站',
    date: '2026-07-12', // Sunday
    time: '08:36',
  }), null);
  assert.equal(resolveStationFootfall(dataset, {
    mode: 'metro-trtc',
    stationName: '台北車站',
    date: '2026-07-13',
    time: 'invalid',
  }), null);
});

test('resolves TRA values by station code and selected weekday', () => {
  assert.deepEqual(resolveStationFootfall(dataset, {
    mode: 'tra',
    stationId: '1000',
    date: '2026-07-13',
    time: '08:36',
  }), { level: 'medium' });
});

test('moves post-midnight stops onto the next service day', () => {
  assert.equal(serviceDateForStationTime('2026-07-13', '23:45', '00:12'), '2026-07-14');
  assert.equal(serviceDateForStationTime('2026-07-13', '08:45', '09:12'), '2026-07-13');
});
