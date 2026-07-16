/**
 * Dual authorization for live gateways (ADR-0005):
 * valid Gate ticket + cookie jti binding + Origin/Host (ADR-0004).
 */

import { allowBrowserOrigin } from './tdxProxyAccessPolicy.js';
import {
  extractTicketFromHeaders,
  parseCookieJti,
  verifyGateTicket,
  type GateTicketClaims,
} from './gateTicketCrypto.js';

export type LiveGatewayAuthReason =
  | 'ok'
  | 'missing_ticket'
  | 'invalid_ticket'
  | 'cookie_mismatch'
  | 'missing_origin'
  | 'malformed_origin'
  | 'origin_not_allowed';

export interface LiveGatewayAuthInput {
  origin: string;
  requestHost: string;
  method: string;
  authorization?: string;
  cookieHeader?: string;
  ticketHeader?: string;
  secret: string;
  now?: number;
}

export interface LiveGatewayAuthDecision {
  allow: boolean;
  reason: LiveGatewayAuthReason;
  claims?: GateTicketClaims;
}

/**
 * Whether a request may use a live gateway (TDX / geocode / YouBike).
 * OPTIONS is not authorized here — callers short-circuit preflight separately.
 */
export function allowLiveGatewayAuth(
  input: LiveGatewayAuthInput,
): LiveGatewayAuthDecision {
  const method = (input.method || 'GET').toUpperCase();

  const originDecision = allowBrowserOrigin({
    origin: input.origin || '',
    requestHost: input.requestHost || '',
    method,
  });
  if (!originDecision.allow) {
    return {
      allow: false,
      reason: originDecision.reason as LiveGatewayAuthReason,
    };
  }

  const token = extractTicketFromHeaders(
    input.authorization || '',
    input.ticketHeader || '',
  );
  if (!token) {
    return { allow: false, reason: 'missing_ticket' };
  }

  const claims = verifyGateTicket(
    token,
    input.secret,
    input.now ?? Date.now(),
  );
  if (!claims) {
    return { allow: false, reason: 'invalid_ticket' };
  }

  const cookieJti = parseCookieJti(input.cookieHeader || '');
  if (!cookieJti || cookieJti !== claims.jti) {
    return { allow: false, reason: 'cookie_mismatch' };
  }

  return { allow: true, reason: 'ok', claims };
}
