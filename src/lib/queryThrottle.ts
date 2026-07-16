/**
 * Pure policy re-export for callers that only need sliding-window math.
 * Client UI: useQueryThrottle / queryThrottleSession.
 * Server log IP: queryThrottleIp.
 */
export {
  QUERY_THROTTLE_WINDOW_MS,
  QUERY_THROTTLE_MAX,
  allowQueryInWindow,
  retryAfterMs,
  recentEventsInWindow,
  type ThrottleDecision,
} from './queryThrottlePolicy';
