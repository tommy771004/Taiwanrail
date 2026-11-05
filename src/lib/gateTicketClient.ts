/**
 * Browser Gate ticket client (ADR-0005).
 * Mints/refreshes via POST /api/gate; attaches X-Gate-Ticket on live fetches.
 * SSR-safe: no-ops when window/fetch is unavailable.
 */

import { LIVE_CLIENT_VERSION } from './liveClientVersion';

const REFRESH_SKEW_MS = 2 * 60_000;
const RELOAD_REQUIRED_CODE = 'reload_required';

export const GATE_RELOAD_EVENT = 'tw-gate-reload-required';

let reloadRequired = false;
let newPage = true;
let cachedTicket: string | null = null;
let cachedExpiresAt = 0;
let inFlight: Promise<string | null> | null = null;

function canUseBrowser(): boolean {
  return typeof window !== 'undefined' && typeof fetch === 'function';
}

/** The gate refused this page or it is too old: live data stays off until a reload. */
export function isReloadRequired(): boolean {
  return reloadRequired;
}

function requireReload(): void {
  if (reloadRequired) return;
  reloadRequired = true;
  cachedTicket = null;
  cachedExpiresAt = 0;
  window.dispatchEvent(new Event(GATE_RELOAD_EVENT));
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
  if (!canUseBrowser() || reloadRequired) return null;
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
      if (newPage) {
        headers['X-Gate-New-Page'] = '1';
      }
      const res = await fetch('/api/gate', {
        method: 'POST',
        credentials: 'include',
        headers,
      });
      if (!res.ok) {
        cachedTicket = null;
        cachedExpiresAt = 0;
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (res.status === 403 && body?.code === RELOAD_REQUIRED_CODE) requireReload();
        return null;
      }
      const data = (await res.json()) as {
        ticket?: string;
        expiresAt?: number;
        minClientVersion?: number;
      };
      if (!data.ticket || typeof data.ticket !== 'string') {
        return null;
      }
      newPage = false;
      if ((data.minClientVersion ?? 0) > LIVE_CLIENT_VERSION) {
        requireReload();
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
 * Headers for a live gateway fetch, including the gate ticket when available.
 */
export async function liveGatewayHeaders(
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  const ticket = await ensureGateTicket();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...extra,
  };
  // Not `Authorization`: Vercel's CDN never caches a request carrying it, and
  // the TDX proxy relies on the CDN to share responses between visitors. Every
  // gated Function reads X-Gate-Ticket as well (extractTicketFromHeaders).
  if (ticket) {
    headers['X-Gate-Ticket'] = ticket;
  }
  return headers;
}

/** Test helper / forced remint. */
export function resetGateTicketClientForTests(): void {
  cachedTicket = null;
  cachedExpiresAt = 0;
  inFlight = null;
  reloadRequired = false;
  newPage = true;
}
