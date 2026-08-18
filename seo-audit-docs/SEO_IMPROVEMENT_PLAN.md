# Taiwanrail SEO 改善分析計畫

更新日期：2026-06-26

## 文件來源盤點

本計畫分析 `SEODoc-main/*.md` 共 9 個 Markdown 檔：

| 檔案 | 主題 | 對 Taiwanrail 的決策 |
| --- | --- | --- |
| `SEO1.md` | SEO starter guide：可被發現、URL、重複內容、title/snippet、圖片、連結 | 維持首頁與 route landing pages 的唯一 title/description/canonical；補強首頁到熱門路線的 crawlable `<a>` 連結 |
| `SEO2.md` | Google Search 三階段：crawling、indexing、serving | 將「可抓取」列為第一優先：robots、sitemap、靜態 HTML、Search Console 驗證 |
| `SEO3.md` | helpful, reliable, people-first content | 將首頁 FAQ、路線說明、資料來源說明列為內容品質基準 |
| `SEO4.md` | 與 `SEO3.md` 相同 | 視為重複來源，不重複建立工作項 |
| `SEO5.md` | 生成式 AI 內容準則 | 若未來新增 AI 產生文案，必須標示審核責任、資料來源與更新流程 |
| `SEO6.md` | technical SEO：crawl/index、sitemap、國際化、UX、Search Console | 補 sitemap `lastmod`；持續檢查 hreflang、mobile、Core Web Vitals |
| `SEO7.md` | developer guide：Google 如何看到 JS app、連結、metadata、structured data | 保留靜態 route pages 與 noscript；首頁新增可抓取的熱門路線連結 |
| `SEOSEARCH_Main.md` | crawling/indexing topic map | 建立技術 SEO 檢查清單：robots、canonical、sitemap、metadata、JS rendering |
| `SEOSEARCH_Main2.md` | Search appearance 與 structured data | 維持 WebSite/WebApplication/FAQ/Breadcrumb schema；route pages 補 WebPage schema |

## 現況評估

已具備：

- 首頁有 title、meta description、canonical、OG/Twitter、hreflang、FAQ JSON-LD、WebSite/WebApplication JSON-LD。
- `public/robots.txt` 允許主要頁面抓取並阻擋大型資料檔與 `/api/`。
- `scripts/generate-route-pages.mjs` 已產生熱門 TRA/THSR 路線 landing pages。
- `public/sitemap.xml` 已列出首頁、語言入口、交通模式入口與 route pages。
- SPA 會依起訖站動態更新 title/description/canonical。

此次已實作：

- `scripts/generate-route-pages.mjs`：sitemap URL 增加 `<lastmod>`，並以 `SITEMAP_LASTMOD` env 或 build date 控制。
- `scripts/generate-route-pages.mjs`：route landing pages 的 JSON-LD 從單一 `TravelAction` 升級為 `WebPage`，並以 `mainEntity` 指向 route 的 travel action。
- `src/App.tsx`：首頁 SEO 內容區新增熱門路線 crawlable `<a>` 連結，讓重要 landing pages 不只靠 sitemap 被發現。

後續依序已實作：

- P2 重複內容控制：`src/App.tsx` 會將已生成熱門 route 的 `/?transport=...&fromId=...&toId=...` deep-link canonical 到對應 `/routes/<transport>/<from>-to-<to>/` 或 `/en/routes/<transport>/<from>-to-<to>/`，避免 station query URL 與 route landing page 競爭。
- P4 監測基礎：新增 `scripts/verify-seo.mjs` 與 `npm run seo:verify`，自動檢查 `SEODoc-main` 來源文件涵蓋、robots/sitemap、route page title/description/canonical、WebPage/Breadcrumb JSON-LD、FAQ 可見內容與 JSON-LD 問題一致性。
- P4 外部監測：新增 `seo-audit-docs/P4_EXTERNAL_MONITORING.md` 與 `npm run seo:external-targets`，固定 Search Console、PageSpeed/Lighthouse、Rich Results Test、Analytics/logs 的檢查 URL、通過條件與記錄格式。

## 優先級計畫

### P0：可抓取與可索引

- 保持 `robots.txt` 不阻擋 `/routes/`、首頁、`/en/`。
- sitemap 必須只包含 canonical、indexable URL。
- 每次 route pages 內容更新時，以 `SITEMAP_LASTMOD=YYYY-MM-DD npm run generate-routes` 明確標示更新日期。
- 使用 Google Search Console 檢查 `/`, `/routes/train/taipei-to-kaohsiung/`, `/routes/hsr/taipei-to-zuoying/` 是否可檢索、可轉譯、無 `noindex`。

### P1：內容與搜尋結果外觀

- 每個重要 route page 保持唯一 title、description、H1、canonical。
- 新增路線時，同步擴充 `ROUTES`、sitemap 與首頁熱門路線清單。
- Route page 文字要直接回答使用者意圖：起點、終點、交通類型、可查項目、資料來源。
- 首頁 FAQ 與 JSON-LD FAQ 內容要一致，避免 structured data 與可見內容不匹配。

### P2：重複內容與 URL 策略

- [x] 將 `/routes/<transport>/<from>-to-<to>/` 視為可索引 canonical landing page。
- [x] 將 `/?transport=...&fromId=...&toId=...` 視為互動 App 狀態，不主動放入 sitemap。
- [x] 已生成的熱門 route deep-link query canonical 到對應 route path；未生成的任意站對仍保留互動 App URL。

### P3：Helpful content / E-E-A-T

- 在首頁與 route pages 保持資料來源說明：TDX API、即時誤點、票價來源。
- 若新增 AI 產生的旅遊建議或摘要，必須有人工審核、更新日期、資料來源與錯誤回報機制。
- 不追逐字數或 keyword stuffing；以「查時刻、票價、誤點、停靠站、轉乘」的實際任務完成度為主。

### P4：監測

- [x] 本地 gate：每次 SEO 變更後跑 `npm run seo:verify`，檢查 sitemap、robots、route schema 與來源文件涵蓋。
- [x] 外部監測 runbook：依 `seo-audit-docs/P4_EXTERNAL_MONITORING.md` 執行，並用 `npm run seo:external-targets` 產生待測 URL。
- [ ] Search Console：每週檢查 indexing、sitemap submitted URL、query CTR、route page impressions，結果記錄在 runbook 格式中。
- [ ] Lighthouse：每次重要 UI/SEO 變更後跑 SEO 與 Performance，結果記錄在 runbook 格式中。
- [ ] Rich Results Test：抽測首頁 FAQ schema 與 route Breadcrumb/WebPage schema，結果記錄在 runbook 格式中。
- [ ] Server logs 或 Vercel analytics：觀察 `/routes/` 是否有 Googlebot 抓取與自然搜尋入口，結果記錄在 runbook 格式中。

### P5：內容擴充與 metadata 品質（2026-08）

- [x] 新增 10 個長尾路線頁（台鐵 6 + 高鐵 4），涵蓋短程觀光線、班次數略低於門檻的
      臺北→臺東，以及先前完全缺漏的高鐵反向路線。清單與挑選理由見
      `seo-audit-docs/ROUTE_PAGE_BACKLOG.md`。
- [x] 全站 metadata 稽核：新增 `scripts/audit-page-meta.mjs`（`npm run seo:audit-meta`），
      檢查所有產生頁的 title / description / og / h1 是否缺漏、重複、超長或過短。
- [x] 修復稽核結果：稽核前 428 筆 overflow（288 頁的 description 全部超出 SERP 可顯示
      長度），修樣板後歸零。`verify-seo.mjs` 已加上長度預算斷言，
      `generate-route-pages.mjs` 在寫檔前就會擋下超出預算的頁面。
- [x] 第二批 20 組高流量路線對已建置（高鐵反向與缺漏城市對 8、高鐵中段與新站 3、
      台鐵東部觀光 5、台鐵西部南迴 4），路線頁累計 170 條、sitemap 350 個 URL。
- [ ] 第三批 20 組待建候選已列於 `seo-audit-docs/ROUTE_PAGE_BACKLOG.md` 第 4 節；
      該批做完後應停止依賴資料展開，改由 Search Console 實際 query 報表決定。

## 驗收標準

- `npm run generate-routes` 可產生含 `<lastmod>` 的 `public/sitemap.xml`。
- Route landing page HTML 含唯一 title、description、canonical、WebPage JSON-LD、Breadcrumb JSON-LD。
- 首頁 HTML/React render 中有可抓取的熱門 route `<a href="/routes/.../">` 連結。
- `npm run seo:verify` 通過，確認 sitemap、route pages、FAQ 與來源文件覆蓋。
- `npm run seo:audit-meta` 通過，且 overflow / thin 為 0。
- `npm run seo:external-targets` 可輸出 Search Console、PageSpeed、Rich Results 的固定目標 URL。
- `npm run lint` 與 `npm run build` 通過。
