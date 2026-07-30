-- 行為稽核表：推廣檔位的曝光與點擊事件
-- 規格：docs/affiliate-integration-spec.md §7（點擊與曝光追蹤）
--
-- 執行目標：DATABASE_URL 指向的**本專案主資料庫**（與 query_logs / feedbacks 同一個）。
-- 推廣內容本身住在 SUP_DATABASE_URL 的共用 affiliates 表；事件留在各自網站，
-- 所以這裡不加 foreign key。
--   psql "$DATABASE_URL" -f db/rail_audit_log.sql
--
-- 表名 `Rail_Audit_log` 未加雙引號，PostgreSQL 會摺疊成小寫 `rail_audit_log`。
-- 因此 `Rail_Audit_log`、`rail_audit_log`、`RAIL_AUDIT_LOG`（未加引號）都指向同一張表；
-- 但**加引號**的 `"Rail_Audit_log"` 不會命中。要保留大小寫就得所有地方都加引號，
-- 那是常見的踩雷點，所以這裡刻意走 PostgreSQL 慣例的未引號寫法。

CREATE TABLE IF NOT EXISTS Rail_Audit_log (
  id         BIGSERIAL PRIMARY KEY,
  action     TEXT NOT NULL,
  -- 推廣事件放 affiliates.id；必須永久穩定（§7.2）。
  target     TEXT,
  -- 至少含 project_name / sponsored / partner / placement，作物詳情版位另加 crop（§7.1）。
  metadata   JSONB NOT NULL DEFAULT '{}'::JSONB,
  session_id VARCHAR(36),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rail_audit_log_action_target_idx
  ON Rail_Audit_log (action, target);

CREATE INDEX IF NOT EXISTS rail_audit_log_created_at_idx
  ON Rail_Audit_log (created_at DESC);

-- 跨系統分析要用 metadata->>'project_name' 分組，不可用 id 前綴猜來源（§7.2）。
CREATE INDEX IF NOT EXISTS rail_audit_log_project_idx
  ON Rail_Audit_log ((metadata->>'project_name'));

-- ── 若先前已建過舊表名 audit_log，改用這行搬過來（只在確定該表屬於本專案時執行）──
-- ALTER TABLE audit_log RENAME TO Rail_Audit_log;
-- 舊索引名不會自動更名，可一併整理：
-- ALTER INDEX audit_log_action_target_idx RENAME TO rail_audit_log_action_target_idx;
-- ALTER INDEX audit_log_created_at_idx    RENAME TO rail_audit_log_created_at_idx;
-- ALTER INDEX audit_log_project_idx       RENAME TO rail_audit_log_project_idx;

-- ── 常用分析（§7.3）──────────────────────────────────────────────────────
-- SELECT
--   metadata->>'project_name' AS project_name,
--   target AS offer_id,
--   count(*) FILTER (WHERE action = 'affiliate_impression') AS impressions,
--   count(*) FILTER (WHERE action = 'affiliate_click') AS clicks,
--   ROUND(
--     100.0 * count(*) FILTER (WHERE action = 'affiliate_click') /
--     NULLIF(count(*) FILTER (WHERE action = 'affiliate_impression'), 0),
--     2
--   ) AS ctr_pct
-- FROM Rail_Audit_log
-- WHERE action IN ('affiliate_impression', 'affiliate_click')
-- GROUP BY metadata->>'project_name', target
-- ORDER BY clicks DESC;
--
-- 依版位拆解（§10：點擊事件能依 placement 區分來源）：
-- SELECT metadata->>'placement' AS placement, target, count(*)
-- FROM Rail_Audit_log WHERE action = 'affiliate_click' GROUP BY 1, 2 ORDER BY 3 DESC;
