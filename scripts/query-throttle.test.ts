import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowQueryInWindow,
  retryAfterMs,
  tryConsumeQuerySlot,
  tryConsumeIpQuerySlot,
  resetSessionQueryThrottle,
  resetIpQueryThrottle,
  peekSessionQueryAllowed,
  QUERY_THROTTLE_MAX,
  QUERY_THROTTLE_WINDOW_MS,
} from '../src/lib/queryThrottle.ts';

test('allows under the max within the window', () => {
  const t0 = 1_000_000;
  let times: number[] = [];
  for (let i = 0; i < QUERY_THROTTLE_MAX; i++) {
    const d = allowQueryInWindow(times, t0 + i * 100);
    assert.equal(d.allow, true);
    times = d.times;
  }
  assert.equal(times.length, QUERY_THROTTLE_MAX);
});

test('denies the 9th event inside the window', () => {
  const t0 = 2_000_000;
  let times: number[] = [];
  for (let i = 0; i < QUERY_THROTTLE_MAX; i++) {
    times = allowQueryInWindow(times, t0 + i).times;
  }
  const denied = allowQueryInWindow(times, t0 + 500);
  assert.equal(denied.allow, false);
  assert.equal(denied.times.length, QUERY_THROTTLE_MAX);
});

test('allows again after oldest events leave the sliding window', () => {
  const t0 = 3_000_000;
  let times: number[] = [];
  for (let i = 0; i < QUERY_THROTTLE_MAX; i++) {
    times = allowQueryInWindow(times, t0 + i).times;
  }
  assert.equal(allowQueryInWindow(times, t0 + 500).allow, false);

  // Wait long enough that every event from t0..t0+7 is outside the window.
  const later = t0 + QUERY_THROTTLE_WINDOW_MS + QUERY_THROTTLE_MAX + 1;
  const d = allowQueryInWindow(times, later);
  assert.equal(d.allow, true);
  assert.equal(d.times.length, 1);
  assert.equal(d.times[0], later);
});

test('drops events outside the window from the returned list', () => {
  const now = 10_000_000;
  const times = [now - QUERY_THROTTLE_WINDOW_MS - 5, now - 100];
  const d = allowQueryInWindow(times, now);
  assert.equal(d.allow, true);
  assert.deepEqual(d.times, [now - 100, now]);
});

test('retryAfterMs is 0 under limit and positive when full', () => {
  const t0 = 4_000_000;
  let times: number[] = [];
  assert.equal(retryAfterMs(times, t0), 0);
  for (let i = 0; i < QUERY_THROTTLE_MAX; i++) {
    times = allowQueryInWindow(times, t0 + i * 10).times;
  }
  const wait = retryAfterMs(times, t0 + 100);
  assert.ok(wait > 0);
  assert.ok(wait <= QUERY_THROTTLE_WINDOW_MS);
});

test('session bucket is shared and resets for tests', () => {
  resetSessionQueryThrottle();
  const t0 = 5_000_000;
  for (let i = 0; i < QUERY_THROTTLE_MAX; i++) {
    assert.equal(tryConsumeQuerySlot(t0 + i), true);
  }
  assert.equal(tryConsumeQuerySlot(t0 + 50), false);
  assert.equal(peekSessionQueryAllowed(t0 + 50), false);
  assert.equal(tryConsumeQuerySlot(t0 + QUERY_THROTTLE_WINDOW_MS + 1), true);
  resetSessionQueryThrottle();
  assert.equal(peekSessionQueryAllowed(t0), true);
});

test('IP bucket is independent per key', () => {
  resetIpQueryThrottle();
  const t0 = 6_000_000;
  for (let i = 0; i < QUERY_THROTTLE_MAX; i++) {
    assert.equal(tryConsumeIpQuerySlot('1.1.1.1', t0 + i), true);
  }
  assert.equal(tryConsumeIpQuerySlot('1.1.1.1', t0 + 20), false);
  assert.equal(tryConsumeIpQuerySlot('2.2.2.2', t0 + 20), true);
  resetIpQueryThrottle();
});
