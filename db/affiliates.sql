-- 共用聯盟／合作推廣資料表
-- 規格：docs/affiliate-integration-spec.md（§3 資料表契約、§5 外部系統寫入規格）
--
-- 執行目標：SUP_DATABASE_URL 指向的資料庫（**不是** DATABASE_URL）。
--   psql "$SUP_DATABASE_URL" -f db/affiliates.sql
--
-- 這張表跨專案共用。欄位定義、預設值與 primary key 屬於共用契約，
-- 不要為了單一專案改動；本專案的資料一律帶 project_name = 'taiwanrail'。

CREATE TABLE IF NOT EXISTS affiliates (
  project_name TEXT NOT NULL DEFAULT 'veggieprice-tw',
  id          TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  sponsored   BOOLEAN NOT NULL DEFAULT FALSE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  cta_label   TEXT NOT NULL,
  url         TEXT NOT NULL,
  icon        TEXT,
  categories  TEXT[] NOT NULL DEFAULT ARRAY['all']::TEXT[],
  crops       TEXT[],
  priority    INTEGER NOT NULL DEFAULT 0,
  partner     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_name, id)
);

-- /api/affiliates 的唯一查詢型態（§6.2）：專案分區 + 啟用中 + priority/id 排序。
CREATE INDEX IF NOT EXISTS affiliates_project_enabled_idx
  ON affiliates (project_name, enabled, priority DESC, id ASC);

-- ── 本專案（鐵道查詢 / taiwanrail）初始資料 ────────────────────────────────
--
-- 這些檔位原本寫死在 src/components/AffiliateMarquee.tsx 裡；改為資料庫驅動後，
-- **必須在部署前寫入**，否則前端依規格 §6.4 不會顯示推廣區塊。
--
-- categories 為本專案字彙：all / train / hsr / metro / planner（見 src/lib/affiliates.ts）。
-- crops 為站名或路線關鍵字片段；此處全部留 NULL 表示不限特定路線。
-- sponsored = TRUE 表示付費推廣（顯示「贊助」）；FALSE 顯示「合作推薦」。
--   以下皆為聯盟分潤連結，屬付費推廣關係，故 sponsored = TRUE（§8）。
--
-- 使用 §5.2 的 upsert 格式，重複執行不會產生重複資料，也不會動到其他專案。

INSERT INTO affiliates (
  project_name, id, enabled, sponsored, title, description, cta_label, url,
  icon, categories, crops, priority, partner, updated_at
)
VALUES
  ('taiwanrail', 'klook', TRUE, TRUE,
   'KLOOK 客路',
   '旅遊體驗與票券',
   '前往 KLOOK',
   'https://onelink.one/s/cSkPl',
   'confirmation_number', ARRAY['all']::TEXT[], NULL, 90, 'KLOOK 客路', now()),

  ('taiwanrail', 'kkday', TRUE, TRUE,
   'KKday',
   '旅遊體驗平台',
   '前往 KKday',
   'https://afflink.one/s/YGj3a',
   'confirmation_number', ARRAY['all']::TEXT[], NULL, 85, 'KKday', now()),

  ('taiwanrail', 'agoda', TRUE, TRUE,
   'Agoda',
   '大中華區訂房',
   '查看住宿',
   'https://onelink.one/s/xA7ag',
   'hotel', ARRAY['all']::TEXT[], NULL, 80, 'Agoda', now()),

  ('taiwanrail', 'trip-com', TRUE, TRUE,
   'Trip.com',
   '旅宿與行程預訂',
   '查看住宿',
   'https://afflink.one/s/KuyA9',
   'hotel', ARRAY['all']::TEXT[], NULL, 75, 'Trip.com', now()),

  ('taiwanrail', 'lalalocker', TRUE, TRUE,
   'Lalalocker',
   '臺灣行李寄放',
   '找寄放點',
   'https://linkgo.one/s/wB02q',
   'luggage', ARRAY['all']::TEXT[], NULL, 70, 'Lalalocker', now()),

  ('taiwanrail', 'airalo', TRUE, TRUE,
   'Airalo',
   '旅遊 eSIM',
   '查看方案',
   'https://onelink.one/s/iwGsi',
   'sim_card', ARRAY['all']::TEXT[], NULL, 65, 'Airalo', now()),

  ('taiwanrail', 'taiwan-wifi', TRUE, TRUE,
   '台灣租借 WiFi',
   '行動網路分享器',
   '查看方案',
   'https://onelink.one/s/LKEV1',
   'wifi', ARRAY['all']::TEXT[], NULL, 60, '台灣租借 WiFi', now()),

  ('taiwanrail', 'asiayo', TRUE, TRUE,
   'AsiaYo',
   '旅宿預訂',
   '查看住宿',
   'https://onelink.one/s/QDzZS',
   'hotel', ARRAY['all']::TEXT[], NULL, 55, 'AsiaYo', now()),

  ('taiwanrail', 'easytravel', TRUE, TRUE,
   'Easytravel 四方通行',
   '臺灣旅宿',
   '查看住宿',
   'https://afflink.one/s/nTKoo',
   'hotel', ARRAY['all']::TEXT[], NULL, 50, 'Easytravel 四方通行', now()),

  -- ── 草稿：待補真實聯盟連結 ──────────────────────────────────────────────
  -- 下面 4 筆是本次新找的合作缺口，url 只是佔位符（example.com，不是真的連結），
  -- 所以先 enabled = FALSE，避免上線後連到假網址。
  -- 補上真實聯盟追蹤連結後，記得把該筆的 enabled 改回 TRUE 再重新執行本檔。
  --
  --   discovercars   租車比價 —— 現有 9 筆完全沒有「下車後租車/自駕」這個場景，
  --                  適合花蓮、台東、南部景點這類需要自駕的目的地；
  --                  categories 特意不含 metro（市內通勤用不到跨城市租車）。
  --   booking-com    訂房比價 —— 與既有 Agoda / Trip.com / AsiaYo / Easytravel
  --                  互補，International 訪客常先查 Booking.com。
  --   getyourguide   行程票券 —— 與 KLOOK / KKday 互補，部分行程只有 GYG 有賣。
  --   safetywing     旅遊醫療保險 —— 現有清單完全沒有保險類別；本站含英文版，
  --                  對海外旅客查台灣鐵路資訊時的保險需求是合理的空缺。
  --
  -- 這 4 個品牌是否真的簽了聯盟合作、實際聯盟連結是什麼，仍需自行確認並填入 url。

  ('taiwanrail', 'discovercars', FALSE, TRUE,
   'DiscoverCars 租車比價',
   '下車後接續自駕，比價全台租車方案',
   '比較租車價格',
   'https://REPLACE-WITH-AFFILIATE-LINK.example.com/discovercars',
   'car_rental', ARRAY['train', 'hsr', 'planner']::TEXT[], NULL, 45, 'DiscoverCars', now()),

  ('taiwanrail', 'booking-com', FALSE, TRUE,
   'Booking.com',
   '全球訂房比價',
   '查看住宿',
   'https://REPLACE-WITH-AFFILIATE-LINK.example.com/booking-com',
   'hotel', ARRAY['all']::TEXT[], NULL, 40, 'Booking.com', now()),

  ('taiwanrail', 'getyourguide', FALSE, TRUE,
   'GetYourGuide',
   '行程體驗與票券',
   '前往 GetYourGuide',
   'https://REPLACE-WITH-AFFILIATE-LINK.example.com/getyourguide',
   'confirmation_number', ARRAY['all']::TEXT[], NULL, 35, 'GetYourGuide', now()),

  ('taiwanrail', 'safetywing', FALSE, TRUE,
   'SafetyWing 旅遊保險',
   '旅遊醫療與意外保險',
   '查看方案',
   'https://REPLACE-WITH-AFFILIATE-LINK.example.com/safetywing',
   'health_and_safety', ARRAY['all']::TEXT[], NULL, 30, 'SafetyWing', now())

ON CONFLICT (project_name, id) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  sponsored = EXCLUDED.sponsored,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  cta_label = EXCLUDED.cta_label,
  url = EXCLUDED.url,
  icon = EXCLUDED.icon,
  categories = EXCLUDED.categories,
  crops = EXCLUDED.crops,
  priority = EXCLUDED.priority,
  partner = EXCLUDED.partner,
  updated_at = now();

-- ── 上線驗收（§10）────────────────────────────────────────────────────────
-- SELECT count(*) FROM affiliates WHERE project_name = 'taiwanrail' AND enabled = TRUE;
-- SELECT id FROM affiliates WHERE url !~ '^https?://';        -- 應為 0 筆
-- SELECT project_name, count(*) FROM affiliates GROUP BY 1;   -- 確認未污染其他專案
--
-- 下架（§5.3）：
-- UPDATE affiliates SET enabled = FALSE, updated_at = now()
--  WHERE project_name = 'taiwanrail' AND id = '<offer-id>';
--
-- 禁止：DELETE FROM affiliates（無條件）或整批 replace 同步 —— 會刪掉其他系統的資料。
