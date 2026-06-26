# P4 外部 SEO 監測 Runbook

更新日期：2026-06-26

本文件處理 `SEO_IMPROVEMENT_PLAN.md` 的 P4 外部監測項目。這些檢查需要線上部署與外部工具資料，不能只靠 repo 內測試完全證明；但每次部署後都應照此表紀錄結果。

## 監測目標 URL

| 類型 | URL | 目的 |
| --- | --- | --- |
| 首頁 | `https://taiwanrail.vercel.app/` | 驗證主站 indexability、FAQ schema、品牌與核心關鍵字曝光 |
| 英文首頁 | `https://taiwanrail.vercel.app/en/` | 驗證 hreflang、英文 canonical、英文搜尋結果摘要 |
| 台鐵路線 | `https://taiwanrail.vercel.app/routes/train/taipei-to-kaohsiung/` | 驗證 route landing page 可索引、WebPage/Breadcrumb schema |
| 高鐵路線 | `https://taiwanrail.vercel.app/routes/hsr/taipei-to-zuoying/` | 驗證高鐵 route landing page 可索引、schema、搜尋外觀 |
| Sitemap | `https://taiwanrail.vercel.app/sitemap.xml` | 驗證已提交、可讀、URL 數量與 lastmod |
| Robots | `https://taiwanrail.vercel.app/robots.txt` | 驗證不阻擋首頁、`/en/`、`/routes/` |

## 每次部署後必跑

1. 本地 gate：
   - `npm run seo:verify`
   - `npm run lint`
   - `npm run build`

2. Google Search Console：
   - Sitemap：提交或重新讀取 `https://taiwanrail.vercel.app/sitemap.xml`
   - URL Inspection：檢查首頁、英文首頁、台鐵路線、高鐵路線
   - Pages / Indexing：確認沒有 `noindex`、blocked by robots、duplicate without user-selected canonical
   - Performance：記錄最近 7/28 天 clicks、impressions、CTR、average position

3. PageSpeed Insights / Lighthouse：
   - 分別測首頁、台鐵 route、高鐵 route
   - Mobile 與 Desktop 都記錄
   - 通過條件：SEO category 100 或無 critical SEO audit failure
   - 觀察項：LCP、INP、CLS、render-blocking、JS bundle size

4. Rich Results Test：
   - 首頁：應解析 FAQPage、WebSite、WebApplication
   - Route page：應解析 WebPage、BreadcrumbList
   - 通過條件：無 invalid structured data；warning 可記錄但不阻擋

5. Analytics / Server logs：
   - 檢查 `/routes/` 是否有自然搜尋入口
   - 檢查 Googlebot / Bingbot 是否抓取 route pages 與 sitemap
   - 記錄 top landing pages、organic sessions、route page CTR

## 記錄格式

每次部署後新增一筆：

```md
## YYYY-MM-DD

- Build SHA / deployment:
- `npm run seo:verify`:
- Search Console sitemap status:
- URL Inspection:
  - `/`:
  - `/en/`:
  - `/routes/train/taipei-to-kaohsiung/`:
  - `/routes/hsr/taipei-to-zuoying/`:
- PageSpeed / Lighthouse:
  - `/` mobile / desktop:
  - train route mobile / desktop:
  - hsr route mobile / desktop:
- Rich Results:
  - `/`:
  - train route:
  - hsr route:
- Analytics / logs:
- Issues opened:
```

## 修復判斷

| 外部訊號 | 優先級 | 下一步 |
| --- | --- | --- |
| URL Inspection 顯示 blocked by robots | P0 | 立即檢查 `public/robots.txt` 與部署後 `/robots.txt` |
| URL Inspection 顯示 duplicate without selected canonical | P1 | 檢查 `canonical`、sitemap 是否指向同一 canonical URL |
| Sitemap submitted URL 少於 23 | P1 | 跑 `npm run generate-routes` 並確認部署包含 `public/sitemap.xml` |
| Rich Results invalid JSON-LD | P1 | 修正 `index.html` 或 `scripts/generate-route-pages.mjs` 的 JSON-LD |
| Lighthouse SEO 低於 100 | P2 | 逐項修正 meta、crawlability、tap targets、font-size、hreflang |
| Route pages impressions 低、但 indexed 正常 | P3 | 擴充 route page 文字、內部連結、更多熱門路線 |
| Organic sessions 有 `/data/` 或 `/api/` 入口 | P2 | 檢查 robots 與 sitemap 是否洩漏非 landing URL |
