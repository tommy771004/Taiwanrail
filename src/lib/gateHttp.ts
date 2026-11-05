/**
 * Gate mint HTTP orchestration (runtime-neutral).
 */

import { allowBrowserOrigin } from './tdxProxyAccessPolicy.js';
import {
  GATE_COOKIE_NAME,
  GATE_TICKET_TTL_MS,
  advanceGateChain,
  buildChainCookieHeader,
  buildSetCookieHeader,
  mintClaims,
  parseCookieJti,
  readGateChain,
  shouldRefresh,
  signGateTicket,
  verifyGateTicket,
  extractTicketFromHeaders,
} from './gateTicketCrypto.js';
import { tryConsumeGateMint } from './gateTicketStore.js';
import { GATE_MINT_WINDOW_MS } from './gateTicketStore.js';
import { LIVE_CLIENT_VERSION } from './liveClientVersion.js';

/** Body `code` telling a current bundle to stop and ask the rider to reload. */
export const GATE_RELOAD_REQUIRED = 'reload_required';

export interface GateMintHttpRequest {
  method: string;
  origin: string;
  requestHost: string;
  clientKey: string;
  cookieHeader: string;
  authorization: string;
  ticketHeader?: string;
  /** First mint of a page load (`X-Gate-New-Page`); old bundles never send it. */
  newPage?: boolean;
}

export interface GateMintHttpOptions {
  secret: string;
  now?: number;
  secureCookie?: boolean;
}

export interface GateMintHttpResponse {
  status: number;
  body: unknown;
  headers: Record<string, string | string[]>;
}

function corsHeaders(origin: string): Record<string, string> {
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Gate-Ticket, X-Gate-New-Page',
  };
}

/**
 * Handle POST /api/gate (and OPTIONS preflight).
 */
export function runGateMintHttp(
  request: GateMintHttpRequest,
  options: GateMintHttpOptions,
): GateMintHttpResponse {
  const method = (request.method || 'GET').toUpperCase();
  const origin = request.origin || '';
  const now = options.now ?? Date.now();

  if (method === 'OPTIONS') {
    const originOk = allowBrowserOrigin({
      origin,
      requestHost: request.requestHost || '',
      method: 'OPTIONS',
    });
    if (!originOk.allow) {
      return { status: 403, body: { error: 'Forbidden' }, headers: {} };
    }
    return {
      status: 204,
      body: null,
      headers: corsHeaders(origin),
    };
  }

  if (method !== 'POST') {
    return { status: 405, body: { error: 'Method Not Allowed' }, headers: {} };
  }

  if (!options.secret) {
    return {
      status: 503,
      body: { error: 'Gate unavailable' },
      headers: { 'Retry-After': '60' },
    };
  }

  const originDecision = allowBrowserOrigin({
    origin,
    requestHost: request.requestHost || '',
    method: 'POST',
  });
  if (!originDecision.allow) {
    return { status: 403, body: { error: 'Forbidden' }, headers: {} };
  }

  const mint = tryConsumeGateMint(request.clientKey || 'unknown', now);
  if (!mint.allow) {
    const status = mint.reason === 'escalated' ? 403 : 429;
    return {
      status,
      body: { error: mint.reason === 'escalated' ? 'Forbidden' : 'Too Many Requests' },
      headers: {
        ...corsHeaders(origin),
        ...(mint.reason === 'mint_throttled'
          ? { 'Retry-After': String(Math.ceil(GATE_MINT_WINDOW_MS / 1000)) }
          : {}),
      },
    };
  }

  const secure =
    options.secureCookie !== false &&
    !/localhost|127\.0\.0\.1/i.test(request.requestHost || '');
  const { chain, exhausted } = advanceGateChain(
    readGateChain(request.cookieHeader || '', options.secret),
    now,
    request.newPage === true,
  );
  const chainCookie = buildChainCookieHeader(chain, options.secret, secure);
  if (exhausted) {
    // The cookie is still rewritten: a tab that keeps asking must not look like a break.
    return {
      status: 403,
      body: { error: 'Reload required', code: GATE_RELOAD_REQUIRED },
      headers: { ...corsHeaders(origin), 'Set-Cookie': chainCookie, 'Cache-Control': 'no-store' },
    };
  }

  // Prefer re-issue; silent refresh path still consumes mint slot (ADR rate limit).
  const existingToken = extractTicketFromHeaders(
    request.authorization || '',
    request.ticketHeader || '',
  );
  if (existingToken) {
    const existing = verifyGateTicket(existingToken, options.secret, now);
    const cookieJti = parseCookieJti(request.cookieHeader || '');
    if (
      existing &&
      cookieJti === existing.jti &&
      !shouldRefresh(existing, now)
    ) {
      // Still valid and not in refresh window — return same ticket (idempotent).
      const maxAge = Math.max(0, Math.ceil((existing.exp - now) / 1000));
      return {
        status: 200,
        body: { ticket: existingToken, expiresAt: existing.exp, minClientVersion: LIVE_CLIENT_VERSION },
        headers: {
          ...corsHeaders(origin),
          'Set-Cookie': [buildSetCookieHeader(existing.jti, maxAge, secure), chainCookie],
          'Cache-Control': 'no-store',
        },
      };
    }
  }

  const claims = mintClaims(now);
  const ticket = signGateTicket(claims, options.secret);

  return {
    status: 200,
    body: { ticket, expiresAt: claims.exp, minClientVersion: LIVE_CLIENT_VERSION },
    headers: {
      ...corsHeaders(origin),
      'Set-Cookie': [
        buildSetCookieHeader(claims.jti, Math.ceil(GATE_TICKET_TTL_MS / 1000), secure),
        chainCookie,
      ],
      'Cache-Control': 'no-store',
    },
  };
}

export { GATE_COOKIE_NAME };
