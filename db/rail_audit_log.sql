-- 行為稽核表：推廣檔位的曝光與點擊事件
-- 規格：docs/affiliate-integration-spec.md §7（點擊與曝光追蹤）
--
-- 執行目標：DATABASE_URL 指向的**本專案主資料庫**（與 query_logs / feedbacks 同一個）。
-- 推廣內容本身住在 SUP_DATABASE_URL 的共用 affiliates 表；事件留在各自網站，
-- 所以這裡不加 foreign key。
--   psql "$DATABASE_URL" -f db/audit_log.sql

CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  action     TEXT NOT NULL,
  -- 推廣事件放 affiliates.id；必須永久穩定（§7.2）。
  target     TEXT,
  -- 至少含 project_name / sponsored / partner / placement，作物詳情版位另加 crop（§7.1）。
  metadata   JSONB NOT NULL DEFAULT '{}'::JSONB,
  session_id VARCHAR(36),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_action_target_idx
  ON audit_log (action, target);

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx
  ON audit_log (created_at DESC);

-- 跨系統分析要用 metadata->>'project_name' 分組，不可用 id 前綴猜來源（§7.2）。
CREATE INDEX IF NOT EXISTS audit_log_project_idx
  ON audit_log ((metadata->>'project_name'));

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
-- FROM audit_log
-- WHERE action IN ('affiliate_impression', 'affiliate_click')
-- GROUP BY metadata->>'project_name', target
-- ORDER BY clicks DESC;
--
-- 依版位拆解（§10：點擊事件能依 placement 區分來源）：
-- SELECT metadata->>'placement' AS placement, target, count(*)
-- FROM audit_log WHERE action = 'affiliate_click' GROUP BY 1, 2 ORDER BY 3 DESC;
