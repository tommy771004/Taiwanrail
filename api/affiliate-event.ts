/**
 * api/affiliate-event.ts
 * 推廣檔位的曝光／點擊事件寫入 — 規格 docs/affiliate-integration-spec.md §7
 *
 * 事件留在本專案的主資料庫（DATABASE_URL → audit_log），推廣內容本身住在
 * SUP_DATABASE_URL；這支端點完全不碰共用資料庫（§2.1）。
 *
 * 建表 SQL：db/audit_log.sql（在 DATABASE_URL 上執行）。
 *
 * 所有失敗都回 200：追蹤不可以影響版位顯示或主要查詢功能。
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { allowBrowserOrigin } from '../src/lib/tdxProxyAccessPolicy.js';

// §7.1 的兩種事件；其他 action 一律丟棄。
const VALID_ACTIONS = new Set(['affiliate_impression', 'affiliate_click']);

/** 一次請求最多帶幾筆事件（前端會把同批曝光合併送出）。 */
const MAX_EVENTS_PER_REQUEST = 24;

// ─── Inlined from src/lib/queryThrottlePolicy.ts (mirrors api/log.ts) ──────
// Vercel Node under "type":"module" fails at runtime with ERR_MODULE_NOT_FOUND
// for local relative imports of sibling api/*.ts. Keep in sync with api/log.ts.
const THROTTLE_WINDOW_MS = 10_000;
const THROTTLE_MAX = 20;
const IP_BUCKET_MAX_KEYS = 5_000;
const ipBuckets = new Map<string, number[]>();

function tryConsumeIpSlot(ip: string, now: number = Date.now()): boolean {
  const key = ip || 'unknown';
  const prev = ipBuckets.get(key) ?? [];
  const recent = prev.filter((t) => Number.isFinite(t) && now - t < THROTTLE_WINDOW_MS);
  const allow = recent.length < THROTTLE_MAX;
  const next = allow ? [...recent, now] : recent;
  if (allow || ipBuckets.has(key) || ipBuckets.size < IP_BUCKET_MAX_KEYS) {
    if (ipBuckets.size >= IP_BUCKET_MAX_KEYS && !ipBuckets.has(key)) {
      const first = ipBuckets.keys().next().value;
      if (first !== undefined) ipBuckets.delete(first);
    }
    ipBuckets.set(key, next);
  }
  return allow;
}
// ─── end inlined throttle ─────────────────────────────────────────────────

function clientIp(req: VercelRequest): string {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length > 0) return xf.split(',')[0].trim();
  if (Array.isArray(xf) && xf[0]) return String(xf[0]).split(',')[0].trim();
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real) return real;
  return 'unknown';
}

function trunc(val: unknown, maxLen: number): string | null {
  if (typeof val !== 'string' || val.length === 0) return null;
  return val.slice(0, maxLen);
}

interface AuditRow {
  action: string;
  target: string;
  metadata: Record<string, string | boolean | null>;
}

/**
 * 只保留規格列出的 metadata 欄位（§7.1），避免前端夾帶任意內容進稽核表。
 * `crop` 只在內容版位出現，可為 null。
 */
function normalizeEvent(raw: unknown): AuditRow | null {
  if (raw === null || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;

  const action = typeof e.action === 'string' && VALID_ACTIONS.has(e.action) ? e.action : null;
  if (!action) return null;

  // target 必須是 affiliates.id，且 id 不含空白（§7.2 / §8）。
  const target = trunc(e.target, 120);
  if (!target || /\s/.test(target)) return null;

  const meta = (e.metadata ?? {}) as Record<string, unknown>;
  const projectName = trunc(meta.project_name, 80);
  if (!projectName) return null;
  const placement = trunc(meta.placement, 40);
  if (!placement) return null;

  return {
    action,
    target,
    metadata: {
      project_name: projectName,
      placement,
      sponsored: typeof meta.sponsored === 'boolean' ? meta.sponsored : false,
      partner: trunc(meta.partner, 120),
      crop: trunc(meta.crop, 80),
    },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const origin = (req.headers['origin'] as string) || '';
  const requestHost = (req.headers.host as string) || '';
  if (!allowBrowserOrigin({ origin, requestHost, method: 'POST' }).allow) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.setHeader('Access-Control-Allow-Origin', origin);

  // 本機沒設 DB 時直接成功，不阻礙 UX（與 api/log.ts 一致）。
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return res.status(200).json({ ok: true });
  }

  try {
    const b = req.body ?? {};
    const incoming = Array.isArray(b.events) ? b.events : [];
    const rows = incoming
      .slice(0, MAX_EVENTS_PER_REQUEST)
      .map(normalizeEvent)
      .filter((r: AuditRow | null): r is AuditRow => r !== null);

    if (rows.length === 0) {
      return res.status(200).json({ ok: true, written: 0 });
    }

    if (!tryConsumeIpSlot(clientIp(req))) {
      return res.status(200).json({ ok: true, written: 0 });
    }

    const sessionId = trunc(b.sessionId, 36);
    const sql = neon(dbUrl);

    // Neon HTTP driver 每次呼叫都是獨立 request，逐筆寫入但一起 await。
    await Promise.all(
      rows.map(
        (row: AuditRow) => sql`
          INSERT INTO audit_log (action, target, metadata, session_id)
          VALUES (${row.action}, ${row.target}, ${JSON.stringify(row.metadata)}::jsonb, ${sessionId})
        `,
      ),
    );

    return res.status(200).json({ ok: true, written: rows.length });
  } catch (err) {
    // 追蹤失敗絕不回錯給前端（與 api/log.ts 相同策略）。
    console.error('[affiliate-event] DB insert failed:', err instanceof Error ? err.message : String(err));
    return res.status(200).json({ ok: true });
  }
}
