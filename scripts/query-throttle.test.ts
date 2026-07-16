import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowQueryInWindow,
  retryAfterMs,
  recentEventsInWindow,
  QUERY_THROTTLE_MAX,
  QUERY_THROTTLE_WINDOW_MS,
} from '../src/lib/queryThrottlePolicy.ts';
import {
  tryConsumeQuerySlot,
  resetSessionQueryThrottle,
  peekSessionQueryAllowed,
  isSessionQueryThrottled,
  subscribeSessionQueryThrottle,
} from '../src/lib/queryThrottleSession.ts';
import {
  tryConsumeIpQuerySlot,
  resetIpQueryThrottle,
} from '../src/lib/queryThrottleIp.ts';

test('recentEventsInWindow keeps only timestamps strictly inside the window', () => {
  const now = 1_000_000;
  const w = QUERY_THROTTLE_WINDOW_MS;
  // Known-good: boundary now - w is outside (< not <=); now - 1 is inside.
  assert.deepEqual(
    recentEventsInWindow([now - w - 1, now - w, now - 1, now], now, w),
    [now - 1, now],
  );
});

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

test('retryAfterMs matches the oldest recent event from recentEventsInWindow', () => {
  // Eight events at known offsets; at t0+100 the oldest in-window is t0.
  const t0 = 7_000_000;
  const times = Array.from({ length: QUERY_THROTTLE_MAX }, (_, i) => t0 + i * 10);
  const now = t0 + 100;
  const recent = recentEventsInWindow(times, now);
  assert.equal(recent.length, QUERY_THROTTLE_MAX);
  assert.equal(retryAfterMs(times, now), recent[0]! + QUERY_THROTTLE_WINDOW_MS - now);
});

test('session bucket is shared and resets for tests', () => {
  resetSessionQueryThrottle();
  const t0 = 5_000_000;
  for (let i = 0; i < QUERY_THROTTLE_MAX; i++) {
    assert.equal(tryConsumeQuerySlot(t0 + i), true);
  }
  assert.equal(tryConsumeQuerySlot(t0 + 50), false);
  assert.equal(peekSessionQueryAllowed(t0 + 50), false);
  assert.equal(isSessionQueryThrottled(t0 + 50), true);
  assert.equal(tryConsumeQuerySlot(t0 + QUERY_THROTTLE_WINDOW_MS + 1), true);
  assert.equal(isSessionQueryThrottled(t0 + QUERY_THROTTLE_WINDOW_MS + 1), false);
  resetSessionQueryThrottle();
  assert.equal(peekSessionQueryAllowed(t0), true);
  assert.equal(isSessionQueryThrottled(t0), false);
});

test('session store notifies subscribers on consume', () => {
  resetSessionQueryThrottle();
  let ticks = 0;
  const unsub = subscribeSessionQueryThrottle(() => {
    ticks += 1;
  });
  assert.equal(tryConsumeQuerySlot(8_000_000), true);
  assert.ok(ticks >= 1);
  const afterFirst = ticks;
  assert.equal(tryConsumeQuerySlot(8_000_001), true);
  assert.ok(ticks > afterFirst);
  unsub();
  const frozen = ticks;
  assert.equal(tryConsumeQuerySlot(8_000_002), true);
  assert.equal(ticks, frozen);
  resetSessionQueryThrottle();
});

test('isSessionQueryThrottled is true only when the shared window is full', () => {
  resetSessionQueryThrottle();
  const t0 = 9_000_000;
  assert.equal(isSessionQueryThrottled(t0), false);
  for (let i = 0; i < QUERY_THROTTLE_MAX - 1; i++) {
    tryConsumeQuerySlot(t0 + i);
    assert.equal(isSessionQueryThrottled(t0 + i), false);
  }
  tryConsumeQuerySlot(t0 + QUERY_THROTTLE_MAX - 1);
  assert.equal(isSessionQueryThrottled(t0 + QUERY_THROTTLE_MAX - 1), true);
  assert.equal(isSessionQueryThrottled(t0 + QUERY_THROTTLE_WINDOW_MS + QUERY_THROTTLE_MAX), false);
  resetSessionQueryThrottle();
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
