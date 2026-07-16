import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowApiInWindow,
  API_ABUSE_THROTTLE_MAX,
  API_ABUSE_THROTTLE_WINDOW_MS,
} from '../src/lib/apiAbuseThrottlePolicy.ts';

test('API abuse throttle allows under the max within the window', () => {
  const now = 1_000_000;
  const times = Array.from(
    { length: API_ABUSE_THROTTLE_MAX - 1 },
    (_, i) => now - (i + 1) * 100,
  );
  const decision = allowApiInWindow(times, now);

  assert.equal(decision.allow, true);
  assert.equal(decision.times.length, API_ABUSE_THROTTLE_MAX);
  assert.equal(decision.times[decision.times.length - 1], now);
});

test('API abuse throttle denies the request after max within the window', () => {
  const now = 1_000_000;
  // Full window already used by earlier events (none equal to `now`).
  const times = Array.from(
    { length: API_ABUSE_THROTTLE_MAX },
    (_, i) => now - (i + 1) * 100,
  );
  const decision = allowApiInWindow(times, now);

  assert.equal(decision.allow, false);
  assert.equal(decision.times.length, API_ABUSE_THROTTLE_MAX);
  assert.ok(!decision.times.includes(now));
});

test('API abuse product rule is 60s / 30', () => {
  assert.equal(API_ABUSE_THROTTLE_WINDOW_MS, 60_000);
  assert.equal(API_ABUSE_THROTTLE_MAX, 30);
});

test('API abuse store allows under max then denies over max for the same client', async () => {
  const {
    tryConsumeApiAbuseSlot,
    resetApiAbuseBucketsForTests,
  } = await import('../src/lib/apiAbuseThrottleStore.ts');
  resetApiAbuseBucketsForTests();
  const now = 2_000_000;
  const key = 'store-test-ip';

  for (let i = 0; i < API_ABUSE_THROTTLE_MAX; i += 1) {
    assert.equal(
      tryConsumeApiAbuseSlot(key, now + i),
      true,
      `slot ${i + 1} should allow`,
    );
  }
  assert.equal(tryConsumeApiAbuseSlot(key, now + API_ABUSE_THROTTLE_MAX), false);
  resetApiAbuseBucketsForTests();
});
