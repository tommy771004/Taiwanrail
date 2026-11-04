/**
 * Whether a tab showing today's TRA results should refresh its live delays.
 *
 * Every refresh is a billed TDX call, so a tab nobody is looking at must not keep
 * spending them: a foreground tab left open would otherwise poll around the clock,
 * and one left open past midnight would keep polling for yesterday's search.
 */
export const RAIL_LIVE_POLL_MS = 2 * 60_000;
export const RAIL_LIVE_IDLE_LIMIT_MS = 30 * 60_000;

export function shouldPollRailLive(state: {
  hidden: boolean;
  searchDate: string;
  today: string;
  lastActivityAt: number;
  now: number;
}): boolean {
  if (state.hidden) return false;
  if (state.searchDate !== state.today) return false;
  return state.now - state.lastActivityAt < RAIL_LIVE_IDLE_LIMIT_MS;
}
