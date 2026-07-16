/**
 * Pure Query throttle policy — sliding window math only.
 * Product rule: 10s / 8 (CONTEXT.md, ADR-0001).
 */

export const QUERY_THROTTLE_WINDOW_MS = 10_000;
export const QUERY_THROTTLE_MAX = 8;

export interface ThrottleDecision {
  allow: boolean;
  /** Timestamps still inside the window (and including `now` when allowed). */
  times: number[];
}

/** Events still strictly inside the sliding window. Single definition for allow + retry. */
export function recentEventsInWindow(
  times: readonly number[],
  now: number,
  windowMs: number = QUERY_THROTTLE_WINDOW_MS,
): number[] {
  return times.filter((t) => now - t < windowMs && Number.isFinite(t));
}

/**
 * Pure sliding-window gate. Does not mutate inputs.
 */
export function allowQueryInWindow(
  times: readonly number[],
  now: number,
  windowMs: number = QUERY_THROTTLE_WINDOW_MS,
  max: number = QUERY_THROTTLE_MAX,
): ThrottleDecision {
  const recent = recentEventsInWindow(times, now, windowMs);
  if (recent.length >= max) {
    return { allow: false, times: recent };
  }
  return { allow: true, times: [...recent, now] };
}

/**
 * When at capacity, ms until the oldest event leaves the window (0 if under limit).
 */
export function retryAfterMs(
  times: readonly number[],
  now: number,
  windowMs: number = QUERY_THROTTLE_WINDOW_MS,
  max: number = QUERY_THROTTLE_MAX,
): number {
  const recent = recentEventsInWindow(times, now, windowMs);
  if (recent.length < max) return 0;
  const oldest = Math.min(...recent);
  return Math.max(0, oldest + windowMs - now);
}
