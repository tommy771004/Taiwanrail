import assert from 'node:assert/strict';
import test from 'node:test';
import {
  searchIntentCommitAfterConsume,
  planRailSearchStart,
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
