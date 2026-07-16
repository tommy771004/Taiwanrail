/**
 * Browser-tab Query throttle bucket (shared across TRA/HSR/metro/planner).
 * Client-only — do not import from serverless IP handlers.
 *
 * UI should read throttled state via subscribe + isSessionQueryThrottled
 * (useSyncExternalStore) so every search entry shares one truth.
 */

import {
  allowQueryInWindow,
  retryAfterMs,
  recentEventsInWindow,
  QUERY_THROTTLE_MAX,
  QUERY_THROTTLE_WINDOW_MS,
} from './queryThrottlePolicy';

let sessionTimes: number[] = [];
const listeners = new Set<() => void>();
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

function clearExpiryTimer(): void {
  if (expiryTimer != null) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
}

/** When the window is full, wake subscribers once the oldest event ages out. */
function scheduleExpiryNotify(now: number = Date.now()): void {
  clearExpiryTimer();
  if (typeof setTimeout === 'undefined') return;
  const wait = retryAfterMs(sessionTimes, now);
  if (wait <= 0) return;
  expiryTimer = setTimeout(() => {
    expiryTimer = null;
    emitChange();
  }, wait + 1);
}

function emitChange(): void {
  scheduleExpiryNotify();
  for (const listener of listeners) listener();
}

/** Subscribe to session bucket changes (consume / reset / window expiry). */
export function subscribeSessionQueryThrottle(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  scheduleExpiryNotify();
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0) clearExpiryTimer();
  };
}

/** Test helper: reset the in-tab bucket. */
export function resetSessionQueryThrottle(): void {
  sessionTimes = [];
  clearExpiryTimer();
  emitChange();
}

/**
 * Try to consume one Query slot for this browser tab.
 * @returns true if the search may proceed
 */
export function tryConsumeQuerySlot(now: number = Date.now()): boolean {
  const decision = allowQueryInWindow(sessionTimes, now);
  sessionTimes = decision.times;
  emitChange();
  return decision.allow;
}

/** Whether a Query would be allowed right now (does not consume). */
export function peekSessionQueryAllowed(now: number = Date.now()): boolean {
  return recentEventsInWindow(sessionTimes, now).length < QUERY_THROTTLE_MAX;
}

/** Inverse of peek — true when search controls should be disabled. */
export function isSessionQueryThrottled(now: number = Date.now()): boolean {
  return !peekSessionQueryAllowed(now);
}

export function sessionRetryAfterMs(now: number = Date.now()): number {
  return retryAfterMs(sessionTimes, now);
}

export { QUERY_THROTTLE_MAX, QUERY_THROTTLE_WINDOW_MS };
