/**
 * Query throttle — pure sliding-window policy + shared browser session bucket.
 * Product rule: 10s / 8 submitted searches across TRA/HSR/metro/planner.
 * See CONTEXT.md and docs/adr/0001-query-throttle-and-page-view-log-filter.md.
 */

export const QUERY_THROTTLE_WINDOW_MS = 10_000;
export const QUERY_THROTTLE_MAX = 8;

export interface ThrottleDecision {
  allow: boolean;
  /** Timestamps still inside the window (and including `now` when allowed). */
  times: number[];
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
  const recent = times.filter((t) => now - t < windowMs && Number.isFinite(t));
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
  const recent = times.filter((t) => now - t < windowMs && Number.isFinite(t));
  if (recent.length < max) return 0;
  const oldest = Math.min(...recent);
  return Math.max(0, oldest + windowMs - now);
}

// ── Browser session bucket (shared across App / Metro / Planner in one tab) ──

let sessionTimes: number[] = [];

/** Test helper: reset the in-tab bucket. */
export function resetSessionQueryThrottle(): void {
  sessionTimes = [];
}

/** Test helper: inspect timestamps (copy). */
export function getSessionQueryTimes(): number[] {
  return [...sessionTimes];
}

/**
 * Try to consume one Query slot for this browser tab.
 * @returns true if the search may proceed
 */
export function tryConsumeQuerySlot(now: number = Date.now()): boolean {
  const decision = allowQueryInWindow(sessionTimes, now);
  sessionTimes = decision.times;
  return decision.allow;
}

/** Whether a Query would be allowed right now (does not consume). */
export function peekSessionQueryAllowed(now: number = Date.now()): boolean {
  return sessionTimes.filter((t) => now - t < QUERY_THROTTLE_WINDOW_MS).length < QUERY_THROTTLE_MAX;
}

export function sessionRetryAfterMs(now: number = Date.now()): number {
  return retryAfterMs(sessionTimes, now);
}

// ── In-memory IP buckets for serverless Query-log backstop (best-effort) ──

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
  // Always store pruned list so memory stays bounded per key
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
