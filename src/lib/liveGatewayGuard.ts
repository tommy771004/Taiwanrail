/**
 * Shared guard for Vercel/Express live gateways outside TDX proxy
 * (geocode, YouBike). ADR-0005 dual auth + optional abuse throttle.
 */

import { allowLiveGatewayAuth } from './gateTicketAuth.js';
import {
  API_ABUSE_THROTTLE_WINDOW_MS,
} from './apiAbuseThrottlePolicy.js';
import {
  recordApiAbuseThrottleHit,
} from './gateTicketStore.js';
import { tryConsumeApiAbuseSlot } from './apiAbuseThrottleStore.js';

export interface LiveGatewayGuardInput {
  method: string;
  origin: string;
  requestHost: string;
  authorization?: string;
  cookieHeader?: string;
  ticketHeader?: string;
  clientKey?: string;
  secret: string;
  /** When true (default), apply 60s/30 API abuse throttle. */
  abuseThrottle?: boolean;
  now?: number;
}

export interface LiveGatewayGuardDeny {
  status: number;
  body: { error: string };
  headers: Record<string, string>;
}

/**
 * Returns a deny response, or null when the request may proceed.
 * OPTIONS is not handled here — callers should short-circuit preflight.
 */
export function denyUnlessLiveGatewayAllowed(
  input: LiveGatewayGuardInput,
): LiveGatewayGuardDeny | null {
  if (!input.secret) {
    return {
      status: 503,
      body: { error: 'Gate unavailable' },
      headers: { 'Retry-After': '60' },
    };
  }

  const gate = allowLiveGatewayAuth({
    origin: input.origin || '',
    requestHost: input.requestHost || '',
    method: input.method || 'GET',
    authorization: input.authorization || '',
    cookieHeader: input.cookieHeader || '',
    ticketHeader: input.ticketHeader || '',
    secret: input.secret,
    now: input.now,
  });

  if (!gate.allow) {
    const status =
      gate.reason === 'missing_ticket' || gate.reason === 'invalid_ticket'
        ? 401
        : 403;
    return {
      status,
      body: { error: status === 401 ? 'Unauthorized' : 'Forbidden' },
      headers: {},
    };
  }

  if (input.abuseThrottle !== false && input.clientKey) {
    if (!tryConsumeApiAbuseSlot(input.clientKey, input.now)) {
      recordApiAbuseThrottleHit(input.clientKey, input.now);
      return {
        status: 429,
        body: { error: 'Too Many Requests' },
        headers: {
          'Retry-After': String(Math.ceil(API_ABUSE_THROTTLE_WINDOW_MS / 1000)),
        },
      };
    }
  }

  return null;
}
