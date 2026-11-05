import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { findFallbackSnapshot, loadSnapshot, saveSnapshot, type SnapshotMeta } from '../src/lib/offlineSnapshot.ts';
import type { DailyTimetableOD } from '../src/lib/api.ts';

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};

const train = { DailyTrainInfo: { TrainNo: '111' } } as unknown as DailyTimetableOD;
const oneWay: SnapshotMeta = { transportType: 'train', originId: '1000', destId: '3300', date: '2026-11-05', tripType: 'one-way' };
const roundTrip: SnapshotMeta = { ...oneWay, tripType: 'round-trip', returnDate: '2026-11-06' };

beforeEach(() => store.clear());

test('an empty result falls back to the real snapshot of the same search', () => {
  saveSnapshot(oneWay, [train], []);
  assert.deepEqual(findFallbackSnapshot(oneWay, [], [])?.timetables, [train]);
});

test('any fresh train wins over the snapshot', () => {
  saveSnapshot(roundTrip, [train], [train]);
  assert.equal(findFallbackSnapshot(roundTrip, [train], []), null);
  assert.equal(findFallbackSnapshot(roundTrip, [], [train]), null);
});

test('no snapshot of another date or route stands in', () => {
  saveSnapshot(oneWay, [train], []);
  assert.equal(findFallbackSnapshot({ ...oneWay, date: '2026-11-06' }, [], []), null);
  assert.equal(findFallbackSnapshot({ ...oneWay, destId: '7000' }, [], []), null);
});

test('a round trip with a failed leg does not overwrite a complete snapshot', () => {
  saveSnapshot(roundTrip, [train], [train]);
  saveSnapshot(roundTrip, [train], []);
  saveSnapshot(roundTrip, [], [train]);
  assert.equal(loadSnapshot(roundTrip)?.returnTimetables.length, 1);
  assert.equal(loadSnapshot(roundTrip)?.timetables.length, 1);
});
