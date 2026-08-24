-- 查詢紀錄表：每次「搜尋班次」成功後由 /api/log 寫入一列。
--
-- 執行目標：DATABASE_URL 指向的**本專案主資料庫**（與 feedbacks / rail_audit_log 同一個）。
--   psql "$DATABASE_URL" -f db/query_logs.sql
--
-- 欄位與長度必須與 api/log.ts 的 INSERT 一致：那支 Function 會先 trunc() 到下面的
-- 長度再寫入，所以縮短這裡的 VARCHAR 會讓寫入被 Postgres 拒絕（Function 不會再截一次），
-- 加長則是白給。改任何一邊都要同時改另一邊。
--
-- 寫入是 best-effort：logQuery() 是 fire-and-forget，DATABASE_URL 未設定或這張表不存在
-- 時整條路徑會被吞掉，不會影響使用者查詢。所以「忘了建表」不會有任何錯誤浮出來，
-- 只會安靜地一列都沒有 —— 部署後請實際查一次 count(*) 確認。

CREATE TABLE IF NOT EXISTS query_logs (
  id                  BIGSERIAL PRIMARY KEY,

  -- 前端產生的匿名 session id（src/lib/sessionId.ts），非帳號、不可回推個人。
  session_id          VARCHAR(36),

  -- 'hsr' | 'train' | 'metro' | 'planner'（api/log.ts 的 VALID_TRANSPORT）。
  -- 與推廣檔位的 categories 共用同一組詞彙，見 docs/affiliate-integration-spec.md。
  transport_type      VARCHAR(20),

  origin_station_id   VARCHAR(20),
  origin_station_name VARCHAR(100),
  dest_station_id     VARCHAR(20),
  dest_station_name   VARCHAR(100),

  query_date          DATE,
  -- 'one-way' | 'round-trip'（VALID_TRIP_TYPE）。
  trip_type           VARCHAR(20),
  -- 僅來回票有值。
  return_date         DATE,

  active_filter       VARCHAR(50),
  result_count        INTEGER,

  language            VARCHAR(20),
  timezone            VARCHAR(60),

  -- 'mobile' | 'tablet' | 'desktop'（VALID_DEVICE）。
  device_type         VARCHAR(10),
  screen_width        INTEGER,
  screen_height       INTEGER,
  user_agent          VARCHAR(300),

  -- 以下由 Vercel 的 x-vercel-ip-* header 推得（城市級精度，非使用者授權）。
  country_code        VARCHAR(10),
  region              VARCHAR(20),
  city                VARCHAR(80),
  postal_code         VARCHAR(20),
  latitude            DOUBLE PRECISION,
  longitude           DOUBLE PRECISION,
  ip_timezone         VARCHAR(60),

  -- 以下是使用者**主動授權**的瀏覽器 GPS；未授權為 NULL。精度遠高於上面的 IP 定位，
  -- 兩者不要混用或互相回填。
  geo_latitude        DOUBLE PRECISION,
  geo_longitude       DOUBLE PRECISION,
  geo_accuracy        DOUBLE PRECISION,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 熱門 OD / 趨勢查詢用。
CREATE INDEX IF NOT EXISTS query_logs_created_at_idx
  ON query_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS query_logs_route_idx
  ON query_logs (transport_type, origin_station_id, dest_station_id);
