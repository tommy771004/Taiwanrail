/**
 * Shared TDX proxy HTTP orchestration (Vercel + Express adapters stay thin).
 * Access policy + Gate ticket (ADR-0005) + optional abuse gate + path extraction + gateway call.
 */

import {
  allowTdxProxyAccess,
} from './tdxProxyAccessPolicy.js';
import type { TdxGatewayRequest, TdxGatewayResponse } from './tdxGateway.js';
import {
  API_ABUSE_THROTTLE_WINDOW_MS,
} from './apiAbuseThrottlePolicy.js';
import { allowLiveGatewayAuth } from './gateTicketAuth.js';
import { recordApiAbuseThrottleHit } from './gateTicketStore.js';

export interface TdxProxyHttpRequest {
  method: string;
  origin: string;
  requestHost: string;
  /** Full request pathname (e.g. /api/tdx/basic/v2/...) or gateway path. */
  pathname: string;
  /** Query string including leading `?`, or empty. */
  rawQuery: string;
  /** Optional client identity for abuse throttling (e.g. IP). */
  clientKey?: string;
  /** Authorization: Bearer <ticket> */
  authorization?: string;
  /** Cookie header (for tr_gate_jti binding). */
  cookieHeader?: string;
  /** Optional X-Gate-Ticket header. */
  ticketHeader?: string;
}

export interface TdxProxyHttpResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

export interface TdxProxyHttpGateway {
  execute(input: TdxGatewayRequest): Promise<TdxGatewayResponse>;
}

export interface TdxProxyAbuseGate {
  /** Return false when the client is over the abuse limit (does not call gateway). */
  tryConsume: (clientKey: string) => boolean;
}

export interface TdxProxyGateOptions {
  /** HMAC secret; empty string fails closed for non-OPTIONS live requests. */
  secret: string;
  now?: number;
}

function extractTdxPath(pathname: string): string {
  const path = (
    pathname.startsWith('/api/tdx/')
      ? pathname.slice('/api/tdx/'.length)
      : pathname.replace(/^\/api\/proxy\//, '')
  ).replace(/^\/+/, '');
  return path;
}

const CORS_ALLOW_HEADERS =
  'Content-Type, Authorization, X-Gate-Ticket';

/**
 * Run one public TDX proxy HTTP request. Does not touch Node/Vercel response objects.
 */
export async function runTdxProxyHttp(
  request: TdxProxyHttpRequest,
  gateway: TdxProxyHttpGateway,
  abuseGate?: TdxProxyAbuseGate,
  gateOptions?: TdxProxyGateOptions,
): Promise<TdxProxyHttpResponse> {
  const method = request.method || 'GET';
  const origin = request.origin || '';
  const access = allowTdxProxyAccess({
    origin,
    requestHost: request.requestHost || '',
    method,
  });
  if (!access.allow) {
    return { status: 403, body: { error: 'Forbidden' }, headers: {} };
  }

  if (method.toUpperCase() === 'OPTIONS') {
    return {
      status: 204,
      body: null,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
        'Access-Control-Allow-Credentials': 'true',
      },
    };
  }

  // ADR-0005: dual auth (ticket + cookie jti + Origin/Host) on live TDX path.
  if (gateOptions) {
    if (!gateOptions.secret) {
      return {
        status: 503,
        body: { error: 'Gate unavailable' },
        headers: { 'Retry-After': '60' },
      };
    }
    const gate = allowLiveGatewayAuth({
      origin,
      requestHost: request.requestHost || '',
      method,
      authorization: request.authorization || '',
      cookieHeader: request.cookieHeader || '',
      ticketHeader: request.ticketHeader || '',
      secret: gateOptions.secret,
      now: gateOptions.now,
    });
    if (!gate.allow) {
      const status =
        gate.reason === 'missing_ticket' || gate.reason === 'invalid_ticket'
          ? 401
          : 403;
      return { status, body: { error: 'Unauthorized' }, headers: {} };
    }
  }

  if (abuseGate && request.clientKey) {
    if (!abuseGate.tryConsume(request.clientKey)) {
      recordApiAbuseThrottleHit(request.clientKey);
      return {
        status: 429,
        body: { error: 'Too Many Requests' },
        headers: {
          'Retry-After': String(Math.ceil(API_ABUSE_THROTTLE_WINDOW_MS / 1000)),
        },
      };
    }
  }

  const path = extractTdxPath(request.pathname);
  if (!path) {
    return { status: 400, body: { error: 'Missing path' }, headers: {} };
  }

  try {
    const result = await gateway.execute({
      path,
      rawQuery: request.rawQuery || '',
    });
    const headers: Record<string, string> = { ...result.headers };
    if (origin) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Credentials'] = 'true';
    }
    return { status: result.status, body: result.body, headers };
  } catch {
    // Do not return upstream/exception text — Information disclosure risk.
    return {
      status: 500,
      body: { error: 'Internal Server Error' },
      headers: {},
    };
  }
}
