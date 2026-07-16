/**
 * Browser Gate ticket client (ADR-0005).
 * Mints/refreshes via POST /api/gate; attaches Authorization on live fetches.
 * SSR-safe: no-ops when window/fetch is unavailable.
 */

const REFRESH_SKEW_MS = 2 * 60_000;

let cachedTicket: string | null = null;
let cachedExpiresAt = 0;
let inFlight: Promise<string | null> | null = null;

function canUseBrowser(): boolean {
  return typeof window !== 'undefined' && typeof fetch === 'function';
}

function needsMint(now: number): boolean {
  if (!cachedTicket) return true;
  if (now >= cachedExpiresAt) return true;
  if (cachedExpiresAt - now <= REFRESH_SKEW_MS) return true;
  return false;
}

/**
 * Ensure a Gate ticket is available. Returns the ticket string or null on failure.
 */
export async function ensureGateTicket(): Promise<string | null> {
  if (!canUseBrowser()) return null;
  const now = Date.now();
  if (!needsMint(now) && cachedTicket) return cachedTicket;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      if (cachedTicket) {
        headers.Authorization = `Bearer ${cachedTicket}`;
      }
      const res = await fetch('/api/gate', {
        method: 'POST',
        credentials: 'include',
        headers,
      });
      if (!res.ok) {
        cachedTicket = null;
        cachedExpiresAt = 0;
        return null;
      }
      const data = (await res.json()) as { ticket?: string; expiresAt?: number };
      if (!data.ticket || typeof data.ticket !== 'string') {
        return null;
      }
      cachedTicket = data.ticket;
      cachedExpiresAt =
        typeof data.expiresAt === 'number'
          ? data.expiresAt
          : Date.now() + 10 * 60_000;
      return cachedTicket;
    } catch {
      return cachedTicket;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Headers for a live gateway fetch, including Bearer ticket when available.
 */
export async function liveGatewayHeaders(
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  const ticket = await ensureGateTicket();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...extra,
  };
  if (ticket) {
    headers.Authorization = `Bearer ${ticket}`;
  }
  return headers;
}

/** Test helper / forced remint. */
export function resetGateTicketClientForTests(): void {
  cachedTicket = null;
  cachedExpiresAt = 0;
  inFlight = null;
}
