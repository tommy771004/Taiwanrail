/**
 * api/log-pageview.ts
 * 記錄使用者進入網站時的裝置資訊與大略地理位置
 *
 * 噪音過濾：config/log-filters.json（可隨時改規則後 redeploy；不擋地區、不擋爬蟲）
 *
 * 對應 DB 建表 SQL（首次部署前執行一次）：
 *
 *   CREATE TABLE IF NOT EXISTS page_view_logs (
 *     id           BIGSERIAL PRIMARY KEY,
 *     session_id   VARCHAR(36),
 *     language     VARCHAR(20),
 *     timezone     VARCHAR(60),
 *     device_type  VARCHAR(10),
 *     screen_width  INT,
 *     screen_height INT,
 *     viewport_w   INT,
 *     viewport_h   INT,
 *     user_agent   VARCHAR(300),
 *     referrer     VARCHAR(500),
 *     page_path    VARCHAR(200),
 *     country_code VARCHAR(10),
 *     region       VARCHAR(20),
 *     city         VARCHAR(80),
 *     postal_code  VARCHAR(20),
 *     latitude     DOUBLE PRECISION,
 *     longitude    DOUBLE PRECISION,
 *     ip_timezone  VARCHAR(60),
 *     geo_latitude  DOUBLE PRECISION,
 *     geo_longitude DOUBLE PRECISION,
 *     geo_accuracy  DOUBLE PRECISION,
 *     created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   );
 *
 * 既有資料表升級（新增精準定位欄位，執行一次）：
 *
 *   ALTER TABLE page_view_logs
 *     ADD COLUMN IF NOT EXISTS geo_latitude  DOUBLE PRECISION,
 *     ADD COLUMN IF NOT EXISTS geo_longitude DOUBLE PRECISION,
 *     ADD COLUMN IF NOT EXISTS geo_accuracy  DOUBLE PRECISION;
 *
 *   ALTER TABLE query_logs
 *     ADD COLUMN IF NOT EXISTS geo_latitude  DOUBLE PRECISION,
 *     ADD COLUMN IF NOT EXISTS geo_longitude DOUBLE PRECISION,
 *     ADD COLUMN IF NOT EXISTS geo_accuracy  DOUBLE PRECISION;
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const VALID_DEVICE = new Set(['mobile', 'tablet', 'desktop']);

// ─── Inlined from src/lib/pageViewLogFilter.ts ─────────────────────────────
// Vercel Node under "type":"module" fails at runtime with ERR_MODULE_NOT_FOUND
// for local relative imports (../src/lib/*). Keep pure logic duplicated here;
// unit tests still import the src/lib module. Keep both in sync when changing
// filter rules evaluation.
const GEO_BLOCK_KEYS = new Set([
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

interface FingerprintRule {
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

interface PageViewFilterConfig {
  userAgentIncludesAny?: string[];
  userAgentRegexAny?: string[];
  fingerprintsAllMatch?: FingerprintRule[];
}

interface LogFiltersFile {
  version?: number;
  enabled?: boolean;
  pageView?: PageViewFilterConfig;
}

interface ClientLogSignals {
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

interface FilterDecision {
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

function evaluatePageViewFilter(
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
// ─── end inlined pageViewLogFilter ─────────────────────────────────────────

const DEFAULT_FILTERS: LogFiltersFile = {
  version: 1,
  enabled: true,
  pageView: {
    userAgentIncludesAny: ['HeadlessChrome'],
    fingerprintsAllMatch: [],
  },
};

let cachedFilters: LogFiltersFile | null = null;

function loadLogFilters(): LogFiltersFile {
  if (cachedFilters) return cachedFilters;

  const candidates = [
    join(process.cwd(), 'config/log-filters.json'),
    join(process.cwd(), 'api/../config/log-filters.json'),
  ];

  for (const path of candidates) {
    try {
      const raw = readFileSync(path, 'utf8');
      const parsed = JSON.parse(raw) as LogFiltersFile;
      if (parsed && typeof parsed === 'object') {
        cachedFilters = parsed;
        return parsed;
      }
    } catch {
      // try next path
    }
  }

  console.warn('[page-view-log] config/log-filters.json not found; using built-in defaults');
  cachedFilters = DEFAULT_FILTERS;
  return DEFAULT_FILTERS;
}

function shouldSkipPageViewLog(signals: ClientLogSignals): { skip: boolean; reason?: string } {
  return evaluatePageViewFilter(signals, loadLogFilters(), (msg, detail) => {
    console.warn('[page-view-log]', msg, detail ?? '');
  });
}

// Inlined (do NOT extract to a sibling api/*.ts module): Vercel Node under
// "type":"module" fails at runtime with ERR_MODULE_NOT_FOUND for local imports.
function sendTelemetry(name: string, properties: Record<string, string | number | boolean | null> = {}): void {
  const url = process.env.TELEMETRY_INGEST_URL;
  const project = process.env.TELEMETRY_PROJECT_KEY;
  const key = process.env.TELEMETRY_INGEST_KEY;
  if (!url || !project || !key) return;

  const event = {
    id: randomUUID(),
    name,
    source: 'server' as const,
    occurredAt: new Date().toISOString(),
    properties,
  };
  const raw = JSON.stringify({ events: [event] });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `sha256=${createHmac('sha256', key).update(`${timestamp}.`).update(raw).digest('hex')}`;

  void fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telemetry-project': project,
      'x-telemetry-timestamp': timestamp,
      'x-telemetry-signature': signature,
    },
    body: raw,
  }).catch((err) => console.warn('[telemetry] forward failed:', err instanceof Error ? err.message : String(err)));
}

function trunc(val: unknown, maxLen: number): string | null {
  if (typeof val !== 'string' || val.length === 0) return null;
  return val.slice(0, maxLen);
}

function safeInt(val: unknown): number | null {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 && n < 100000 ? Math.trunc(n) : null;
}

function safeFloat(val: unknown, min: number, max: number): number | null {
  const n = Number(val);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // CORS：只允許同源與已知正式域名
  const origin = (req.headers['origin'] as string) || '';
  const allowedOriginPattern = /^https?:\/\/(localhost(:\d+)?|taiwanrail\.vercel\.app|[\w-]+\.vercel\.app)$/;
  if (origin && !allowedOriginPattern.test(origin)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.setHeader('Access-Control-Allow-Origin', origin || '*');

  // 若 DATABASE_URL 未設定（如本機未配 DB），直接回傳成功
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return res.status(200).json({ ok: true });
  }

  try {
    const b = req.body ?? {};

    const deviceType = typeof b.deviceType === 'string' && VALID_DEVICE.has(b.deviceType)
      ? b.deviceType : null;

    // 過濾：只看 client 指紋，不看 IP 國家/地區（AI SEO / 海外真人不受影響）
    const filterHit = shouldSkipPageViewLog({
      userAgent: typeof b.userAgent === 'string' ? b.userAgent : '',
      timezone: trunc(b.timezone, 60),
      language: trunc(b.language, 20),
      deviceType,
      screenWidth: safeInt(b.screenWidth),
      screenHeight: safeInt(b.screenHeight),
      viewportW: safeInt(b.viewportW),
      viewportH: safeInt(b.viewportH),
      referrer: trunc(b.referrer, 500),
      pagePath: trunc(b.pagePath, 200),
    });

    if (filterHit.skip) {
      // 不寫 DB、不送 telemetry；對外仍 200，避免影響 UX 或讓 bot 改行為
      return res.status(200).json({ ok: true });
    }

    // 從 Vercel Edge Network 請求標頭取得地理資訊（無需呼叫外部 API）
    // 地理僅供記錄，從不參與過濾
    const countryCode = trunc(req.headers['x-vercel-ip-country'],        10);
    const region      = trunc(req.headers['x-vercel-ip-country-region'], 20);
    const city        = trunc(req.headers['x-vercel-ip-city'],           80);
    const postalCode  = trunc(req.headers['x-vercel-ip-postal-code'],    20);
    const ipTimezone  = trunc(req.headers['x-vercel-ip-timezone'],       60);
    const latRaw      = req.headers['x-vercel-ip-latitude'];
    const lngRaw      = req.headers['x-vercel-ip-longitude'];
    const latitude    = typeof latRaw === 'string' ? parseFloat(latRaw) : null;
    const longitude   = typeof lngRaw === 'string' ? parseFloat(lngRaw) : null;

    // 使用者授權的精準定位（瀏覽器 GPS）；未授權則為 null
    const geoLatitude  = safeFloat(b.geoLatitude,  -90,  90);
    const geoLongitude = safeFloat(b.geoLongitude, -180, 180);
    const geoAccuracy  = safeFloat(b.geoAccuracy,  0,    1e7);

    const sql = neon(dbUrl);

    await sql`
      INSERT INTO page_view_logs (
        session_id,
        language,       timezone,
        device_type,    screen_width,  screen_height,
        viewport_w,     viewport_h,
        user_agent,     referrer,      page_path,
        country_code,   region,        city,
        postal_code,    latitude,      longitude,
        ip_timezone,
        geo_latitude,   geo_longitude, geo_accuracy
      ) VALUES (
        ${trunc(b.sessionId, 36)},
        ${trunc(b.language, 20)},       ${trunc(b.timezone, 60)},
        ${deviceType},                  ${safeInt(b.screenWidth)},  ${safeInt(b.screenHeight)},
        ${safeInt(b.viewportW)},        ${safeInt(b.viewportH)},
        ${trunc(b.userAgent, 300)},     ${trunc(b.referrer, 500)},  ${trunc(b.pagePath, 200)},
        ${countryCode},                 ${region},                  ${city},
        ${postalCode},                  ${latitude},                ${longitude},
        ${ipTimezone},
        ${geoLatitude},                 ${geoLongitude},            ${geoAccuracy}
      )
    `;

    sendTelemetry('page.viewed', { route: trunc(b.pagePath, 120) ?? '/' });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[page-view-log] DB insert failed:', err);
    return res.status(200).json({ ok: true });
  }
}
