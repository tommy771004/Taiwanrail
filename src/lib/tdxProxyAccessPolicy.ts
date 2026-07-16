/**
 * Pure browser Origin/Host authorization (ADR-0004).
 * Shared by TDX proxy and other public Functions (log, feedback, …).
 */

export type BrowserOriginReason =
  | 'ok'
  | 'missing_origin'
  | 'malformed_origin'
  | 'origin_not_allowed';

export type TdxProxyAccessReason =
  | BrowserOriginReason
  | 'method_not_allowed';

export interface BrowserOriginInput {
  origin: string;
  requestHost: string;
  /**
   * HTTP method. Same-origin GET/HEAD/OPTIONS often omit Origin (Fetch/MDN);
   * those methods allow a missing Origin so the SPA keeps working. Mutating
   * methods require Origin (browsers send it; bare clients without Origin are denied).
   */
  method?: string;
}

export interface BrowserOriginDecision {
  allow: boolean;
  reason: BrowserOriginReason;
}

export interface TdxProxyAccessInput {
  origin: string;
  requestHost: string;
  method: string;
}

export interface TdxProxyAccessDecision {
  allow: boolean;
  reason: TdxProxyAccessReason;
}

/** Canonical production host (no port). */
export const TDX_PROXY_CANONICAL_HOST = 'taiwanrail.vercel.app';

function isLocalhostHost(host: string): boolean {
  return /^localhost(?::\d+)?$/i.test(host) || /^127\.0\.0\.1(?::\d+)?$/.test(host);
}

function isAllowedOriginHost(originHost: string, requestHost: string): boolean {
  const req = requestHost.toLowerCase();
  const origin = originHost.toLowerCase();
  if (origin === req) return true;
  if (origin === TDX_PROXY_CANONICAL_HOST) return true;
  if (isLocalhostHost(origin) && isLocalhostHost(req)) return true;
  return false;
}

function isSafeMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
}

/**
 * Browser Origin/Host check.
 * - Origin present: must match request Host, canonical production, or localhost.
 * - Origin missing: allowed only for safe methods (SPA same-origin reads); denied for writes.
 * Resource abuse for missing-Origin GET is limited by path allowlist + rate limit, not Origin alone.
 */
export function allowBrowserOrigin(
  input: BrowserOriginInput,
): BrowserOriginDecision {
  const method = (input.method ?? 'GET').toUpperCase();
  const origin = (input.origin ?? '').trim();

  if (!origin) {
    if (isSafeMethod(method)) {
      return { allow: true, reason: 'ok' };
    }
    return { allow: false, reason: 'missing_origin' };
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return { allow: false, reason: 'malformed_origin' };
  }

  const requestHost = (input.requestHost ?? '').trim();
  if (!requestHost || !isAllowedOriginHost(originHost, requestHost)) {
    return { allow: false, reason: 'origin_not_allowed' };
  }

  return { allow: true, reason: 'ok' };
}

/**
 * Whether a browser request may use the public TDX proxy.
 */
export function allowTdxProxyAccess(
  input: TdxProxyAccessInput,
): TdxProxyAccessDecision {
  const method = (input.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    return { allow: false, reason: 'method_not_allowed' };
  }

  const originDecision = allowBrowserOrigin({
    origin: input.origin,
    requestHost: input.requestHost,
    method,
  });
  if (!originDecision.allow) {
    return originDecision;
  }

  return { allow: true, reason: 'ok' };
}
