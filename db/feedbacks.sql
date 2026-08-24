-- 使用者意見回饋表：由 /api/feedback 寫入。
--
-- 執行目標：DATABASE_URL 指向的**本專案主資料庫**（與 query_logs / rail_audit_log 同一個）。
--   psql "$DATABASE_URL" -f db/feedbacks.sql
--
-- 欄位與長度必須與 api/feedback.ts 的 INSERT 一致（同 query_logs，Function 先 trunc()
-- 到這裡的長度才寫入）。這份 DDL 原本只以註解形式躺在 api/feedback.ts 開頭，
-- 全新建庫時無從執行，已移到這裡作為單一來源。
--
-- 與 query_logs 一樣是 best-effort 寫入：沒有這張表不會報錯，只會安靜地收不到任何回饋。

CREATE TABLE IF NOT EXISTS feedbacks (
  id           BIGSERIAL PRIMARY KEY,

  -- 前端產生的匿名 session id，可與 query_logs.session_id 對照出「這位使用者
  -- 回報前查了什麼」，但兩表不加 foreign key：回饋不該因為查詢紀錄被清掉而消失。
  session_id   VARCHAR(36),

  message      TEXT NOT NULL,
  language     VARCHAR(20),
  timezone     VARCHAR(60),

  -- 'mobile' | 'tablet' | 'desktop'（VALID_DEVICE）。
  device_type  VARCHAR(10),
  user_agent   VARCHAR(300),
  page_path    VARCHAR(200),

  -- 由 Vercel 的 x-vercel-ip-* header 推得（城市級精度）。
  country_code VARCHAR(10),
  region       VARCHAR(20),
  city         VARCHAR(80),
  ip_timezone  VARCHAR(60),

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS feedbacks_created_at_idx
  ON feedbacks (created_at DESC);
