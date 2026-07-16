/**
 * Pure API abuse throttle policy — sliding window math only.
 * Product rule: 60s / 30 (coarser than Query throttle 10s / 8).
 * Protects open server proxies (geocode, feedback, youbike, optional TDX).
 */

import {
  allowQueryInWindow,
  type ThrottleDecision,
} from './queryThrottlePolicy.js';

export const API_ABUSE_THROTTLE_WINDOW_MS = 60_000;
export const API_ABUSE_THROTTLE_MAX = 30;

export type { ThrottleDecision };

/**
 * Pure sliding-window gate for API abuse control. Does not mutate inputs.
 */
export function allowApiInWindow(
  times: readonly number[],
  now: number,
  windowMs: number = API_ABUSE_THROTTLE_WINDOW_MS,
  max: number = API_ABUSE_THROTTLE_MAX,
): ThrottleDecision {
  return allowQueryInWindow(times, now, windowMs, max);
}
