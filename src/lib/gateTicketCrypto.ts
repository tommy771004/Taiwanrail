/**
 * Gate ticket crypto (ADR-0005): short-lived HMAC-signed anonymous credential.
 * Ticket body is presented by the SPA; HttpOnly cookie binds jti only.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const GATE_COOKIE_NAME = 'tr_gate_jti';
export const GATE_TICKET_TTL_MS = 10 * 60_000;
export const GATE_REFRESH_WINDOW_MS = 2 * 60_000;

export interface GateTicketClaims {
  jti: string;
  iat: number;
  exp: number;
}

function base64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf;
  return b
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

function hmac(secret: string, payload: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest();
}

export function mintClaims(now: number = Date.now()): GateTicketClaims {
  return {
    jti: randomBytes(16).toString('hex'),
    iat: now,
    exp: now + GATE_TICKET_TTL_MS,
  };
}

export function signGateTicket(claims: GateTicketClaims, secret: string): string {
  const payload = base64urlEncode(JSON.stringify(claims));
  const sig = base64urlEncode(hmac(secret, payload));
  return `${payload}.${sig}`;
}

export function verifyGateTicket(
  token: string,
  secret: string,
  now: number = Date.now(),
): GateTicketClaims | null {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;

  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = hmac(secret, payload);
    actual = base64urlDecode(sig);
  } catch {
    return null;
  }
  if (expected.length !== actual.length) return null;
  try {
    if (!timingSafeEqual(expected, actual)) return null;
  } catch {
    return null;
  }

  let claims: GateTicketClaims;
  try {
    claims = JSON.parse(base64urlDecode(payload).toString('utf8')) as GateTicketClaims;
  } catch {
    return null;
  }
  if (
    typeof claims.jti !== 'string' ||
    !claims.jti ||
    typeof claims.iat !== 'number' ||
    typeof claims.exp !== 'number'
  ) {
    return null;
  }
  if (now >= claims.exp) return null;
  if (claims.exp - claims.iat > GATE_TICKET_TTL_MS + 5_000) return null;
  return claims;
}

export function shouldRefresh(
  claims: GateTicketClaims,
  now: number = Date.now(),
): boolean {
  if (now >= claims.exp) return true;
  return claims.exp - now <= GATE_REFRESH_WINDOW_MS;
}

export function parseCookieJti(cookieHeader: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    if (name === GATE_COOKIE_NAME) {
      const value = part.slice(idx + 1).trim();
      return value || null;
    }
  }
  return null;
}

export function buildSetCookieHeader(
  jti: string,
  maxAgeSec: number,
  secure: boolean,
): string {
  const parts = [
    `${GATE_COOKIE_NAME}=${jti}`,
    'Path=/',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** Extract Bearer or X-Gate-Ticket raw token. */
export function extractTicketFromHeaders(
  authorization: string,
  ticketHeader: string,
): string {
  const auth = (authorization || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return (ticketHeader || '').trim();
}
