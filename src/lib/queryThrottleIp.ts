/**
 * Best-effort per-process IP Query-log throttle (serverless-friendly).
 * Server-only — do not import from browser UI.
 */

import {
  allowQueryInWindow,
  QUERY_THROTTLE_MAX,
  QUERY_THROTTLE_WINDOW_MS,
} from './queryThrottlePolicy';

const ipBuckets = new Map<string, number[]>();
const IP_BUCKET_MAX_KEYS = 5_000;

export function tryConsumeIpQuerySlot(
  ip: string,
  now: number = Date.now(),
  windowMs: number = QUERY_THROTTLE_WINDOW_MS,
  max: number = QUERY_THROTTLE_MAX,
): boolean {
  const key = ip || 'unknown';
  const prev = ipBuckets.get(key) ?? [];
  const decision = allowQueryInWindow(prev, now, windowMs, max);
  if (decision.allow || ipBuckets.has(key) || ipBuckets.size < IP_BUCKET_MAX_KEYS) {
    if (ipBuckets.size >= IP_BUCKET_MAX_KEYS && !ipBuckets.has(key)) {
      const first = ipBuckets.keys().next().value;
      if (first !== undefined) ipBuckets.delete(first);
    }
    ipBuckets.set(key, decision.times);
  }
  return decision.allow;
}

/** Test helper */
export function resetIpQueryThrottle(): void {
  ipBuckets.clear();
}
