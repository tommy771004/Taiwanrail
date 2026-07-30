# 聯盟／合作推廣跨系統整合規格

版本：`1.0`  
狀態：可實作  
適用範圍：所有需要共用聯盟、贊助、合作推薦連結的網站、管理後台與服務

本規格將 [affiliate-setup.md](./affiliate-setup.md) 的單一網站設定，整理成可供多個系統共同使用的資料契約。所有系統共用同一張 `affiliates` 資料表；各系統只負責維護自己擁有的資料，消費端統一讀取啟用中的資料。

## 1. 目標與非目標

### 1.1 目標

- 將不同系統的合作推廣資料集中到同一張 `affiliates` 表。
- 讓前端不再寫死商家、文案、連結、分類與排序。
- 讓外部維護系統可以新增、修改、停用推廣內容，不需要重新部署網站。
- 保留點擊與曝光統計所需的穩定識別碼。
- 讓不同消費端可以共用同一份資料契約與 SQL 寫入格式。

### 1.2 非目標

- 本表不是聯盟平台的訂單或轉換回傳表。
- 本表不保存資料庫密碼、API key 或第三方平台登入資訊。
- 本表不取代 Google AdSense 等自動廣告投放機制。
- 本版只負責提供推廣連結；交易、佣金結算與歸因由各聯盟平台負責。

## 2. 系統架構

```text
外部維護系統 A ─┐
外部維護系統 B ─┼─ 寫入 ─> SUP_DATABASE_URL ─> affiliates
外部維護系統 C ─┘                                  │
                                                    └─ 依 project_name + enabled 查詢
                                                         │
                                                   /api/affiliates
                                                         │
                                                    各網站前端

瀏覽器點擊／曝光 ─> 各網站 audit API ─> 各網站自己的 audit_log
```

### 2.1 連線責任

| 項目 | 規格 |
| --- | --- |
| 聯盟資料庫 | `SUP_DATABASE_URL` 指向的獨立 PostgreSQL |
| 本專案主資料庫 | `DATABASE_URL`，只供回饋與行為稽核等主系統資料使用 |
| 維護端 | 外部管理系統，可寫入 `affiliates` |
| 消費端 | 網站 API 或 Server 端查詢；瀏覽器不可直接連資料庫 |
| 查詢端點 | `/api/affiliates` |
| 查詢範圍 | 目前專案 `project_name = AFFILIATE_PROJECT_NAME` 且 `enabled = TRUE` 的資料 |

`SUP_DATABASE_URL` 絕對不可使用 `NEXT_PUBLIC_` 前綴，也不可送到瀏覽器。每個消費端都必須設定自己的 `AFFILIATE_PROJECT_NAME`，未設定時預設為該專案的正式名稱。未設定 `SUP_DATABASE_URL` 時，消費端應回傳空清單或不顯示推廣區塊，不得改用 `DATABASE_URL` 代替。

## 3. 資料表契約

正式 schema 位於 [db/affiliates.sql](../db/affiliates.sql)。

```sql
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
```

### 3.1 欄位規格

| 欄位 | 必填 | 型別 | 規則 |
| --- | --- | --- | --- |
| `project_name` | 是 | `TEXT` | 所屬專案名稱，作為查詢分區。例：`veggieprice-tw`、`farm-shop`。同一專案內必須穩定。 |
| `id` | 是 | `TEXT` | 同一 `project_name` 內唯一、永久穩定。不得因文案或 URL 修改而變更。 |
| `enabled` | 是 | `BOOLEAN` | `TRUE` 才能被查詢結果使用；下架以 `FALSE` 為優先，不直接刪除。 |
| `sponsored` | 是 | `BOOLEAN` | `TRUE` 顯示「贊助」；`FALSE` 顯示「合作推薦」。兩者都屬推廣內容。 |
| `title` | 是 | `TEXT` | 卡片標題，可使用 `{crop}`。不可放 HTML。 |
| `description` | 是 | `TEXT` | 卡片描述，可使用 `{crop}`。不可放 HTML。 |
| `cta_label` | 是 | `TEXT` | 行動按鈕文字，可使用 `{crop}`。不可放 HTML。 |
| `url` | 是 | `TEXT` | 只允許 `http://` 或 `https://`；可使用 `{crop}`。 |
| `icon` | 否 | `TEXT` | Material Symbols 名稱，例如 `shopping_cart`、`agriculture`。空值由前端使用預設圖示。 |
| `categories` | 是 | `TEXT[]` | 可用 `all`、`vegetable`、`fruit`、`flower`、`mushroom`、`meat`、`seafood`。 |
| `crops` | 否 | `TEXT[]` | 作物名稱片段清單；以「包含」比對，命中時提高排序。 |
| `priority` | 否 | `INTEGER` | 數字越大越前面；未填時為 `0`。 |
| `partner` | 否 | `TEXT` | 合作商家或品牌名稱，用於卡片揭露與統計。 |
| `created_at` | 系統 | `TIMESTAMPTZ` | 建立時間。 |
| `updated_at` | 系統 | `TIMESTAMPTZ` | 最後修改時間；維護系統更新資料時應同步更新。 |

### 3.2 專案分區規則

`project_name` 是跨系統查詢的主要分區欄位，資料庫 primary key 為：

```text
(project_name, id)
```

因此不同專案可以使用相同的 `id`，但同一專案內不得重複。規則如下：

- `project_name` 使用穩定的專案名稱，例如 `veggieprice-tw`、`farm-shop`、`recipe-app`。
- `project_name` 應與各專案的正式部署／產品名稱一致，不應使用暫時環境名稱。
- 專案名稱一旦投入正式環境，不要任意修改；若必須改名，應建立 migration 並同步修改 `AFFILIATE_PROJECT_NAME`。
- `id` 只需在自己的 `project_name` 內唯一，可使用 `kkday-farm`、`seasonal-box` 等簡短檔位 ID。
- 查詢端不得只用 `id` 查詢，必須同時帶入 `project_name`。

範例：

```text
(veggieprice-tw, kkday-farm)
(farm-shop, kkday-farm)
```

兩筆資料可以同時存在，彼此不會衝突。

## 4. 推廣內容與顯示規則

### 4.1 `{crop}` 套版

以下欄位支援 `{crop}`：

- `title`
- `description`
- `cta_label`
- `url`

文字欄位直接替換；URL 欄位的作物名稱必須先 URL encode。

例如：

```text
title: 想吃{crop}料理
url:   https://example.com/search?q={crop}
```

在「高麗菜」頁面會得到：

```text
想吃高麗菜料理
https://example.com/search?q=%E9%AB%98%E9%BA%97%E8%8F%9C
```

### 4.2 作物詳情版位

一筆資料符合以下條件時可顯示：

1. `enabled = TRUE`。
2. `categories` 包含目前作物分類，或包含 `all`。
3. 若有 `crops`：作物片段命中或分類命中。

排序順序：

1. `crops` 命中的資料優先。
2. `priority DESC`。
3. `id ASC` 作為穩定的最後排序。

### 4.3 首頁與搜尋頁跑馬燈

- 讀取所有 `enabled = TRUE` 的資料。
- 不套用特定作物條件。
- 依 `priority DESC`、`id ASC` 排序。
- 顯示 `partner`；沒有 `partner` 時顯示 `title`。

每個消費端只會取得自己的 `project_name` 資料。若要讓同一個專案合併多個來源的推廣內容，外部維護系統應將這些內容寫入同一個 `project_name`；若要讓不同專案各自管理，則使用不同的 `project_name`。

## 5. 外部系統寫入規格

### 5.1 初次建立

各系統只需在自己的資料庫維護工具執行以下格式；實際執行目標必須是 `SUP_DATABASE_URL` 指向的資料庫。

```sql
INSERT INTO affiliates (
  project_name,
  id,
  enabled,
  sponsored,
  title,
  description,
  cta_label,
  url,
  icon,
  categories,
  crops,
  priority,
  partner
)
VALUES (
  'farm-shop',
  'farm-shop-seasonal-box',
  TRUE,
  FALSE,
  '當季蔬果箱・產地直送',
  '嚴選當季蔬果配送到家。',
  '查看蔬果箱',
  'https://partner.example.com/seasonal-box',
  'local_shipping',
  ARRAY['vegetable', 'fruit'],
  NULL,
  5,
  '範例農場'
);
```

### 5.2 安全更新／同步

維護系統可使用 upsert，但只能更新自己擁有的 namespace ID：

```sql
INSERT INTO affiliates (
  project_name,
  id, enabled, sponsored, title, description, cta_label, url,
  icon, categories, crops, priority, partner, updated_at
)
VALUES (
  'farm-shop',
  'farm-shop-seasonal-box', TRUE, FALSE, '當季蔬果箱・產地直送',
  '嚴選當季蔬果配送到家。', '查看蔬果箱',
  'https://partner.example.com/seasonal-box', 'local_shipping',
  ARRAY['vegetable', 'fruit'], NULL, 5, '範例農場', now()
)
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
```

不得使用無條件 `DELETE FROM affiliates` 或以整批 replace 方式同步，避免刪除其他系統的資料。

### 5.3 停用與復原

```sql
UPDATE affiliates
SET enabled = FALSE, updated_at = now()
WHERE project_name = 'farm-shop'
  AND id = 'farm-shop-seasonal-box';
```

復原時將 `enabled` 改回 `TRUE`。除非資料本身需要依法刪除，否則保留停用資料以維持歷史統計與 ID 穩定性。

## 6. 讀取 API 規格

### 6.1 Request

```http
GET /api/affiliates
```

不需要把 `SUP_DATABASE_URL` 或資料庫認證資訊放入 request。API 必須由 server 端查詢資料庫。

### 6.2 Server SQL

```sql
SELECT
  project_name AS "projectName",
  id,
  enabled,
  sponsored,
  title,
  description,
  cta_label AS "ctaLabel",
  url,
  icon,
  categories,
  crops,
  priority,
  partner
FROM affiliates
WHERE project_name = $1
  AND enabled = TRUE
ORDER BY priority DESC, id ASC;

-- $1 = AFFILIATE_PROJECT_NAME，例如 'veggieprice-tw'
```

### 6.3 Response

```json
{
  "offers": [
    {
      "projectName": "farm-shop",
      "id": "farm-shop-seasonal-box",
      "enabled": true,
      "sponsored": false,
      "title": "當季蔬果箱・產地直送",
      "description": "嚴選當季蔬果配送到家。",
      "ctaLabel": "查看蔬果箱",
      "url": "https://partner.example.com/seasonal-box",
      "icon": "local_shipping",
      "categories": ["vegetable", "fruit"],
      "priority": 5,
      "partner": "範例農場"
    }
  ]
}
```

### 6.4 錯誤與降級

| 情況 | API 行為 | 前端行為 |
| --- | --- | --- |
| 未設定 `SUP_DATABASE_URL` | `503`、`offers: []` | 不顯示推廣區塊 |
| 未設定或錯誤的 `AFFILIATE_PROJECT_NAME` | `200`、`offers: []` | 只顯示正確專案的資料，避免跨系統誤顯示 |
| 查詢失敗或資料表不存在 | `500`、`offers: []` | 不顯示推廣區塊，不阻塞主功能 |
| 單筆資料格式錯誤 | 忽略該筆，回傳其他合法資料 | 正常顯示其他檔位 |
| 沒有啟用資料 | `200`、`offers: []` | 不顯示推廣區塊 |

API 回應不可包含資料庫連線字串、維護端 token 或其他秘密欄位。

## 7. 點擊與曝光追蹤

### 7.1 事件

| action | 觸發時機 | target | 必要 metadata |
| --- | --- | --- | --- |
| `affiliate_impression` | 檔位進入可視範圍 | `affiliates.id` | `project_name`, `sponsored`, `partner`, `placement` |
| `affiliate_click` | 使用者點擊檔位 | `affiliates.id` | `project_name`, `sponsored`, `partner`, `placement` |

作物詳情版位另加 `crop`；首頁／搜尋頁不需加 `crop`。

### 7.2 ID 穩定性

統計的 `audit_log.target` 使用 `affiliates.id`，並在 metadata 保存 `project_name`，所以：

- 不得因 URL、商家文案或排序調整而改 ID。
- 下架用 `enabled = FALSE`，不要刪除資料。
- 若同一合作夥伴換成新活動，建立新 ID，舊活動停用。
- 跨系統分析應以 metadata 的 `project_name` 分組，不應依賴 ID 前綴猜測來源。

### 7.3 常用分析

```sql
SELECT
  metadata->>'project_name' AS project_name,
  target AS offer_id,
  count(*) FILTER (WHERE action = 'affiliate_impression') AS impressions,
  count(*) FILTER (WHERE action = 'affiliate_click') AS clicks,
  ROUND(
    100.0 * count(*) FILTER (WHERE action = 'affiliate_click') /
    NULLIF(count(*) FILTER (WHERE action = 'affiliate_impression'), 0),
    2
  ) AS ctr_pct
FROM audit_log
WHERE action IN ('affiliate_impression', 'affiliate_click')
GROUP BY metadata->>'project_name', target
ORDER BY clicks DESC;
```

## 8. 安全、品質與內容檢核

寫入資料庫前，維護系統必須檢查：

- `id` 不含空白，且符合 namespace 規則。
- `title`、`description`、`cta_label` 不含 HTML、script 或未經處理的模板語法。
- `url` 只允許 `http`、`https`；不可使用 `javascript:`、`data:` 或 `vbscript:`。
- `categories` 至少有一個合法值。
- `priority` 使用整數，避免超大值壟斷所有版位。
- URL 中的追蹤參數確實屬於對應系統或合作平台。
- `sponsored` 標示符合實際商業關係，不得以 `FALSE` 隱藏付費推廣。
- 合作連結經過人工點擊測試，確認不會導向錯誤、過期或與文案不符的頁面。

前端必須：

- 對外連結使用 `rel="sponsored nofollow noopener noreferrer"`。
- 不把資料表內容當作 HTML 注入 DOM。
- 對 URL 進行協定檢查與必要的 encode。
- 尊重使用者的 reduced-motion 設定。
- 資料庫失敗時不影響菜價查詢、搜尋與其他主要功能。

## 9. 維護權限與資料所有權

建議每個外部系統只持有自己的寫入權限或透過維護 API 寫入。若資料庫權限無法細分，至少以以下流程控管：

1. 每個系統登記自己的 `system-key`。
2. 每個系統只能新增或更新自己 namespace 的 ID。
3. 修改其他系統資料前，必須由資料擁有者確認。
4. 停用操作要留下操作者、原因與時間的維護紀錄。
5. 不允許任一系統執行全表刪除或無條件批次覆寫。

## 10. 上線驗收清單

### 資料庫

- [ ] 已在 `SUP_DATABASE_URL` 指向的資料庫執行 [db/affiliates.sql](../db/affiliates.sql)。
- [ ] 每筆資料都有正確的 `project_name`。
- [ ] 同一 `project_name` 內沒有重複 ID。
- [ ] `SELECT count(*) FROM affiliates WHERE enabled = TRUE` 結果符合預期。
- [ ] 所有 URL 都是 `http` 或 `https`。
- [ ] 不同系統沒有重複 ID。

### API 與前端

- [ ] `GET /api/affiliates` 只回傳目前 `AFFILIATE_PROJECT_NAME` 的資料。
- [ ] 不同專案使用相同 ID 時，仍能各自正確查詢。
- [ ] 停用一筆資料後，該筆不再出現在 API。
- [ ] 新增一筆其他系統資料後，不需重新部署即可出現在版位。
- [ ] API 失敗時網站主要功能仍可使用。
- [ ] 推廣連結不會暴露任何資料庫秘密。

### 追蹤與法遵

- [ ] 曝光事件的 `target` 使用穩定 `id`。
- [ ] 點擊事件能依 `placement` 區分來源。
- [ ] 推廣內容有「贊助」或「合作推薦」標示。
- [ ] 外連結包含 `sponsored`、`nofollow` 與 `noopener`。
- [ ] `/privacy#disclosure` 已說明聯盟／合作推廣關係。

## 11. 相關實作檔案

| 用途 | 檔案 |
| --- | --- |
| 共用資料表與初始匯入資料 | [db/affiliates.sql](../db/affiliates.sql) |
| Server 端獨立資料庫連線 | [src/lib/server/db.ts](../src/lib/server/db.ts) |
| 聯盟資料 API | [src/app/api/affiliates/route.ts](../src/app/api/affiliates/route.ts) |
| 前端資料驗證與顯示規則 | [src/lib/affiliates.ts](../src/lib/affiliates.ts) |
| 跑馬燈元件 | [src/components/affiliate/AffiliateMarquee.tsx](../src/components/affiliate/AffiliateMarquee.tsx) |
| 輪播元件 | [src/components/affiliate/AffiliateSlot.tsx](../src/components/affiliate/AffiliateSlot.tsx) |
| 初始設定與聯盟平台說明 | [docs/affiliate-setup.md](./affiliate-setup.md) |
