/**
 * Process-local IP/client bucket for API abuse throttle (60s / 30).
 * Pure policy stays in apiAbuseThrottlePolicy; this is the mutable store.
 */

import {
  allowApiInWindow,
  API_ABUSE_THROTTLE_MAX,
  API_ABUSE_THROTTLE_WINDOW_MS,
} from './apiAbuseThrottlePolicy.js';

const IP_BUCKET_MAX_KEYS = 5_000;
const buckets = new Map<string, number[]>();

/**
 * Try to consume one slot for `clientKey`. Returns false when over the limit.
 */
export function tryConsumeApiAbuseSlot(
  clientKey: string,
  now: number = Date.now(),
): boolean {
  const key = clientKey || 'unknown';
  const prev = buckets.get(key) ?? [];
  const decision = allowApiInWindow(
    prev,
    now,
    API_ABUSE_THROTTLE_WINDOW_MS,
    API_ABUSE_THROTTLE_MAX,
  );
  if (decision.allow || buckets.has(key) || buckets.size < IP_BUCKET_MAX_KEYS) {
    if (buckets.size >= IP_BUCKET_MAX_KEYS && !buckets.has(key)) {
      const first = buckets.keys().next().value;
      if (first !== undefined) buckets.delete(first);
    }
    buckets.set(key, decision.times);
  }
  return decision.allow;
}

/** Test helper: clear process buckets. */
export function resetApiAbuseBucketsForTests(): void {
  buckets.clear();
}
