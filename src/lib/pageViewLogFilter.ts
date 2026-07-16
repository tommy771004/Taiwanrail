/**
 * Pure Page View Log filter evaluation (no I/O).
 * Used by unit tests (scripts/page-view-log-filter.test.ts).
 * Must not deny by country/region/city.
 *
 * NOTE: api/log-pageview.ts inlines a copy of this module — Vercel Node under
 * "type":"module" cannot resolve ../src/lib/* at runtime (ERR_MODULE_NOT_FOUND).
 * When changing evaluation logic, update both this file and the api/ inline.
 */

/** Geo fields that must never be used as deny conditions. */
export const GEO_BLOCK_KEYS = new Set([
  'country',
  'countryCode',
  'country_code',
  'region',
  'city',
  'postalCode',
  'postal_code',
  'latitude',
  'longitude',
  'ipTimezone',
  'ip_timezone',
]);

export interface FingerprintRule {
  id?: string;
  userAgentIncludes?: string;
  userAgentIncludesAlso?: string;
  timezone?: string;
  language?: string;
  deviceType?: string;
  screenWidth?: number;
  screenHeight?: number;
  viewportW?: number;
  viewportH?: number;
  referrerExact?: string;
  pagePathExact?: string;
  [key: string]: unknown;
}

export interface PageViewFilterConfig {
  userAgentIncludesAny?: string[];
  userAgentRegexAny?: string[];
  fingerprintsAllMatch?: FingerprintRule[];
}

export interface LogFiltersFile {
  version?: number;
  enabled?: boolean;
  pageView?: PageViewFilterConfig;
}

export interface ClientLogSignals {
  userAgent: string;
  timezone: string | null;
  language: string | null;
  deviceType: string | null;
  screenWidth: number | null;
  screenHeight: number | null;
  viewportW: number | null;
  viewportH: number | null;
  referrer: string | null;
  pagePath: string | null;
}

export interface FilterDecision {
  skip: boolean;
  reason?: string;
}

function eqNum(a: number | null, b: unknown): boolean {
  if (typeof b !== 'number' || !Number.isFinite(b)) return false;
  return a !== null && a === b;
}

function eqStr(a: string | null, b: unknown): boolean {
  if (typeof b !== 'string') return false;
  return (a ?? '') === b;
}

/**
 * Evaluate whether a Page View should skip DB insert.
 */
export function evaluatePageViewFilter(
  signals: ClientLogSignals,
  cfg: LogFiltersFile,
  onWarn?: (msg: string, detail?: unknown) => void,
): FilterDecision {
  if (cfg.enabled === false) return { skip: false };

  const pv = cfg.pageView ?? {};
  const ua = signals.userAgent || '';

  for (const needle of pv.userAgentIncludesAny ?? []) {
    if (typeof needle === 'string' && needle.length > 0 && ua.includes(needle)) {
      return { skip: true, reason: `ua_includes:${needle}` };
    }
  }

  for (const pattern of pv.userAgentRegexAny ?? []) {
    if (typeof pattern !== 'string' || !pattern) continue;
    try {
      if (new RegExp(pattern, 'i').test(ua)) {
        return { skip: true, reason: `ua_regex:${pattern}` };
      }
    } catch {
      onWarn?.('invalid userAgentRegexAny', pattern);
    }
  }

  for (const rule of pv.fingerprintsAllMatch ?? []) {
    if (!rule || typeof rule !== 'object') continue;

    if (Object.keys(rule).some((k) => GEO_BLOCK_KEYS.has(k))) {
      onWarn?.('fingerprint rule has geo keys; ignored', rule.id ?? '(no id)');
      continue;
    }

    const checks: boolean[] = [];

    if (rule.userAgentIncludes != null) {
      checks.push(typeof rule.userAgentIncludes === 'string' && ua.includes(rule.userAgentIncludes));
    }
    if (rule.userAgentIncludesAlso != null) {
      checks.push(
        typeof rule.userAgentIncludesAlso === 'string' && ua.includes(rule.userAgentIncludesAlso),
      );
    }
    if (rule.timezone != null) checks.push(eqStr(signals.timezone, rule.timezone));
    if (rule.language != null) checks.push(eqStr(signals.language, rule.language));
    if (rule.deviceType != null) checks.push(eqStr(signals.deviceType, rule.deviceType));
    if (rule.screenWidth != null) checks.push(eqNum(signals.screenWidth, rule.screenWidth));
    if (rule.screenHeight != null) checks.push(eqNum(signals.screenHeight, rule.screenHeight));
    if (rule.viewportW != null) checks.push(eqNum(signals.viewportW, rule.viewportW));
    if (rule.viewportH != null) checks.push(eqNum(signals.viewportH, rule.viewportH));
    if (rule.referrerExact != null) checks.push(eqStr(signals.referrer, rule.referrerExact));
    if (rule.pagePathExact != null) checks.push(eqStr(signals.pagePath, rule.pagePathExact));

    if (checks.length > 0 && checks.every(Boolean)) {
      return { skip: true, reason: `fingerprint:${rule.id ?? 'unnamed'}` };
    }
  }

  return { skip: false };
}
