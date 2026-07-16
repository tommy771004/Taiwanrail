/**
 * Alert data is live and therefore goes through the Vercel TDX Function.
 * Passive opens must not start polling; a deliberate rail search is the gate.
 */
export function shouldStartAlertPolling(hasSearched: boolean): boolean {
  return hasSearched;
}
