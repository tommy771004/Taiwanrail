import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  searchIntentCommitAfterConsume,
  planRailSearchStart,
  recentSearchStep,
} from '../src/lib/searchIntentCommit.ts';

test('failed consume retains pending and does not mark one-shot or run search', () => {
  // Known product rule: throttle deny must not drop User search intent.
  assert.deepEqual(searchIntentCommitAfterConsume(false), {
    clearPending: false,
    markAutoFired: false,
    runSearch: false,
  });
});

test('successful consume commits intent and allows search to start', () => {
  assert.deepEqual(searchIntentCommitAfterConsume(true), {
    clearPending: true,
    markAutoFired: true,
    runSearch: true,
  });
});

test('planRailSearchStart: deny shows message and never clears intent flags', () => {
  for (const intent of ['manual', 'recent', 'autofire'] as const) {
    assert.deepEqual(planRailSearchStart(false, intent), {
      runSearch: false,
      showThrottleMessage: true,
      clearPending: false,
      markAutoFired: false,
      resetPage: false,
      scrollToResults: false,
    });
  }
});

test('planRailSearchStart: manual accept runs search, resets page, scrolls; no intent flags', () => {
  assert.deepEqual(planRailSearchStart(true, 'manual'), {
    runSearch: true,
    showThrottleMessage: false,
    clearPending: false,
    markAutoFired: false,
    resetPage: true,
    scrollToResults: true,
  });
});

test('planRailSearchStart: recent accept clears pending only', () => {
  assert.deepEqual(planRailSearchStart(true, 'recent'), {
    runSearch: true,
    showThrottleMessage: false,
    clearPending: true,
    markAutoFired: false,
    resetPage: false,
    scrollToResults: false,
  });
});

test('planRailSearchStart: autofire accept marks one-shot only', () => {
  assert.deepEqual(planRailSearchStart(true, 'autofire'), {
    runSearch: true,
    showThrottleMessage: false,
    clearPending: false,
    markAutoFired: true,
    resetPage: false,
    scrollToResults: false,
  });
});

const pending = { transportType: 'train', originId: '1000', destId: '3300', tripType: 'one-way' } as const;
const form = { transportType: 'train', originId: '1000', destId: '3300', tripType: 'one-way', stationsReady: true } as const;

test('recentSearchStep: nothing pending never touches the form', () => {
  assert.equal(recentSearchStep(null, form), 'idle');
});

test('recentSearchStep: another transport waits for the switch and its stations', () => {
  // 台鐵與高鐵的 StationID 會撞號，舊運具的車站清單不能拿來填新運具的起訖站。
  assert.equal(recentSearchStep(pending, { ...form, transportType: 'hsr' }), 'wait');
  assert.equal(recentSearchStep(pending, { ...form, stationsReady: false }), 'wait');
});

test('recentSearchStep: fills the stations once they are loaded, then searches', () => {
  assert.equal(recentSearchStep(pending, { ...form, originId: '' }), 'fill');
  assert.equal(recentSearchStep(pending, { ...form, destId: '7000' }), 'fill');
  assert.equal(recentSearchStep(pending, form), 'search');
});

test('recentSearchStep: waits for the trip type to land', () => {
  assert.equal(recentSearchStep(pending, { ...form, tripType: 'round-trip' }), 'wait');
});

test('recent search fires after the effect that clears hasSearched on a station change', async () => {
  // 同一輪 effect 後者勝出：順序反過來，查詢有送出但結果永遠不顯示。
  const source = await readFile(join(process.cwd(), 'src/App.tsx'), 'utf8');
  const reset = source.indexOf('[selectedDate, originStationId, destStationId]);');
  const fire = source.indexOf("attemptRailSearch('recent')");
  assert.ok(reset > 0 && fire > reset);
});
