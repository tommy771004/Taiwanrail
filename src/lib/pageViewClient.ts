import {
  evaluatePageViewFilter,
  type ClientLogSignals,
  type LogFiltersFile,
} from './pageViewLogFilter';

export type PageViewFetcher = (
  input: string,
  init: RequestInit,
) => Promise<unknown>;

/**
 * Drop known Synthetic traffic before it invokes the Vercel Function.
 * The API handler repeats the same check as a server-side backstop.
 */
export function postPageViewIfAllowed(
  signals: ClientLogSignals,
  payload: Record<string, unknown>,
  filters: LogFiltersFile,
  fetcher: PageViewFetcher = fetch,
): boolean {
  if (evaluatePageViewFilter(signals, filters).skip) return false;

  void fetcher('/api/log-pageview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => { /* analytics must never affect the product flow */ });

  return true;
}
