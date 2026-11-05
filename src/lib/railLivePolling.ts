import { taiwanHourOf } from './taiwanDate.js';

/**
 * Whether a tab showing today's TRA results should refresh its live delays.
 *
 * Every refresh is a billed TDX call, so a tab nobody is looking at must not keep
 * spending them: polling stops when the tab is hidden, past midnight, during the
 * overnight gap (01:00–04:00 Taipei), or idle for 10 minutes.
 */
export const RAIL_LIVE_POLL_MS = 2 * 60_000;
export const RAIL_LIVE_IDLE_LIMIT_MS = 10 * 60_000;

/**
 * Taipei 01:00–03:59 has almost no TRA stops (over 14 days: 36 stop times, nearly all
 * from the Friday overnight 452). It ends at 04:00, not 05:00: trains leave from about
 * 04:20, ~34 stop times a day fall in the 04:00 hour.
 */
export function isTraOffHours(taipeiHour: number): boolean {
  return taipeiHour >= 1 && taipeiHour < 4;
}

export function shouldPollRailLive(state: {
  hidden: boolean;
  searchDate: string;
  today: string;
  lastActivityAt: number;
  now: number;
}): boolean {
  if (state.hidden) return false;
  if (state.searchDate !== state.today) return false;
  if (isTraOffHours(taiwanHourOf(new Date(state.now)))) return false;
  return state.now - state.lastActivityAt < RAIL_LIVE_IDLE_LIMIT_MS;
}
