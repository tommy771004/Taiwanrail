# 路線頁待建清單 Route Page Backlog

更新日期：2026-08-18
資料來源：`public/data/tra-timetable.json`、`public/data/thsr-timetable.json`、
`public/data/thsr-fares.json`、`public/data/tra-fares/`（TDX 每週通用時刻表快照）

本文件記錄三件事：本次新增的 10 個長尾路線頁、全站 metadata 稽核結果，以及
**下一批 20 個待建的高流量路線對**。

---

## 1. 本次新增的 10 個長尾路線頁

加在 `scripts/generate-route-pages.mjs` 的 `ROUTES_SEED`（seed 一定會產生，不受
`TRA_MIN_SERVICES` / `TRA_MIN_FASTEST_MIN` 門檻過濾）。每頁同時產生
`/routes/…/` 與 `/en/routes/…/` 兩個語系，共 20 個 URL。

| # | 路線 | URL | 直達班次（平日/假日） | 最快 | 票價（台鐵最低車種／高鐵標準座） |
| --- | --- | --- | --- | --- | --- |
| 1 | 臺北 → 臺東（台鐵） | `/routes/train/taipei-to-taitung/` | 21 / 18 | 3 小時 50 分 | NT$936 |
| 2 | 臺北 → 礁溪（台鐵） | `/routes/train/taipei-to-jiaoxi/` | 36 / 31 | 1 小時 6 分 | NT$181 |
| 3 | 臺北 → 羅東（台鐵） | `/routes/train/taipei-to-luodong/` | 52 / 46 | 1 小時 16 分 | NT$214 |
| 4 | 臺北 → 瑞芳（台鐵） | `/routes/train/taipei-to-ruifang/` | 46 / 40 | 32 分鐘 | NT$73 |
| 5 | 臺中 → 臺南（台鐵） | `/routes/train/taichung-to-tainan/` | 44 / 26 | 1 小時 35 分 | NT$314 |
| 6 | 臺南 → 高雄（台鐵） | `/routes/train/tainan-to-kaohsiung/` | 74 / 49 | 28 分鐘 | NT$102 |
| 7 | 左營 → 臺北（高鐵） | `/routes/hsr/zuoying-to-taipei/` | 84 / 86 | 1 小時 34 分 | NT$1490 |
| 8 | 臺中 → 臺北（高鐵） | `/routes/hsr/taichung-to-taipei/` | 93 / 101 | 43 分鐘 | NT$700 |
| 9 | 臺北 → 嘉義（高鐵） | `/routes/hsr/taipei-to-chiayi/` | 55 / 58 | 1 小時 13 分 | NT$1080 |
| 10 | 臺北 → 桃園（高鐵） | `/routes/hsr/taipei-to-taoyuan/` | 67 / 71 | 17 分鐘 | NT$160 |

**為什麼是這 10 條**：既有的路線清單由門檻自動展開（TRA 需 ≥25 班直達且最快
≥105 分鐘），而高鐵完全沒有自動展開，只有 8 條 seed。因此三類查詢量高的路線在
資料上完全看不到：

- **短程觀光線**被 105 分鐘門檻擋掉 —— 礁溪 66 分、羅東 76 分、瑞芳 32 分，
  但「台北到礁溪火車」「台北到九份怎麼去」是週末的高頻查詢。
- **臺北→臺東**過得了時間門檻，卻只有 22 班直達，差一點碰到 25 班的班次門檻。
  該門檻的用意是「有沒有足夠班次可以排成時刻表」，22 班綽綽有餘。
- **高鐵反向**：`台北→台中` 有頁面、`台中→台北` 沒有。這是兩個不同的查詢字串，
  時刻表也不同（反向班次數與首末班都不一樣），值得各自一頁。

> 註：題目舉例的「台北到宜蘭火車」`/routes/train/taipei-to-yilan/` 與
> 「台北到台南高鐵」`/routes/hsr/taipei-to-tainan/` **已經存在**，因此本次改以同
> 類型但尚未涵蓋的路線補齊。

---

## 2. Metadata 稽核結果

新增 `scripts/audit-page-meta.mjs`（`npm run seo:audit-meta`）掃描 `public/` 底下
所有產生的靜態頁，檢查 `<title>`、`meta description`、`og:title`、
`og:description`、`<h1>` 五個標籤的四類缺陷：`missing`（缺漏）、`duplicate`
（重複）、`overflow`（超出 SERP 可顯示長度）、`thin`（過短）。

稽核前（288 頁）：

| 類別 | 數量 |
| --- | --- |
| missing | 0 |
| duplicate | 0 |
| **overflow** | **428** |
| thin | 0 |

**沒有任何一頁「真的」缺少 title 或 description** —— 每一頁都是同一個樣板產生
的，標籤一定存在，也一定唯一。真正的缺陷是**長度**：全部 288 頁的 meta
description 都超出 Google 的顯示長度（最長 264 字元，預算 158），160 頁的 title
也超出。超出的部分不是額外的關鍵字，而是搜尋者根本看不到的內容；description
過長時 Google 更傾向整段捨棄、改用它自己從內文抓的片段。

嚴重度排序的前 10 名（即已修復的項目）：

| # | 頁面 | 標籤 | 長度 / 預算 |
| --- | --- | --- | --- |
| 1 | `/en/routes/train/yuanlin-to-zhongli-taoyuan/` | meta description | 264 / 158 |
| 2 | `/en/routes/train/zhongli-taoyuan-to-yuanlin/` | meta description | 264 / 158 |
| 3 | `/en/routes/train/chiayi-to-zhongli-taoyuan/` | meta description | 263 / 158 |
| 4 | `/en/routes/train/douliu-to-zhongli-taoyuan/` | meta description | 263 / 158 |
| 5 | `/en/routes/train/zhongli-taoyuan-to-chiayi/` | meta description | 263 / 158 |
| 6 | `/en/routes/train/zhongli-taoyuan-to-douliu/` | meta description | 263 / 158 |
| 7 | `/en/routes/train/changhua-to-xinzuoying/` | meta description | 260 / 158 |
| 8 | `/en/routes/train/songshan-to-xinzuoying/` | meta description | 260 / 158 |
| 9 | `/en/routes/train/xinzuoying-to-changhua/` | meta description | 260 / 158 |
| 10 | `/en/routes/train/xinzuoying-to-songshan/` | meta description | 260 / 158 |

### 修法

這 10 頁沒有各自的原始檔，全部由 `generate-route-pages.mjs` 的同一組樣板產生，
所以修的是樣板本身 —— 修好前 10 名的同時，其餘 298 頁一起修好：

1. **每個語系的 metadata 只寫該語系。** 中文頁的 description 原本結尾附上一整句
   英文重述（`Real-time TRA timetable, fares and delays from X to Y.`），等於用掉
   將近一半的中文摘要預算，去重複 `/en/` 頁面本來就在鎖定的字串。
2. **數字放前面。** 路線頁在 SERP 上要跟業者官網競爭，唯一能在摘要裡給出的優勢
   就是直接把答案寫出來（最快車程、平日/假日班次、首末班、最低票價）。
3. **長版文案沒有刪掉，只是搬家。** 原本的長描述改成 `intro`，也就是頁面上可見的
   導言段落，那裡沒有任何長度預算。Hub 頁同樣拆成 `desc`（meta）與 `lead`（可見）。

修完後 308 頁全數在預算內，`overflow` 歸零。預算同時寫進 `verify-seo.mjs`，並在
`generate-route-pages.mjs` 產生階段就擋下 —— 任何超出預算的頁面會讓 build 失敗，
且在寫入任何檔案之前就失敗，不會留下半套結果。

---

## 3. 待建清單：20 組高流量路線對

排序依據是**編輯判斷 + 資料佐證**，不是單純的班次數。班次數最高的都是通勤短跳
（板橋→臺北 175 班、樹林→板橋 143 班），那是使用者早就背起來、不會去查的路線；
把它們做成頁面正是 Google 會判定為 thin / scaled content 的東西。因此下表的挑選
標準是「會有人打出這個字串去搜尋」，資料只用來確認**有沒有足夠班次撐起一張時刻
表**（`svc` 為每週通用時刻表中的直達班次數）。

> 待 Search Console 的實際 query 資料可用之後，這份清單應該改由 query 數據排序，
> 這也是 `generate-route-pages.mjs` 註解中已經記下的方向。

### A. 高鐵反向與缺漏城市對（8 組）— 優先度最高

高鐵目前只有 12 條路線頁，是覆蓋率最低的模式，而反向頁面幾乎全缺。

| # | 路線 | 建議 URL | svc（平日/假日） | 最快 | 標準座 |
| --- | --- | --- | --- | --- | --- |
| 1 | 臺南 → 臺北 | `/routes/hsr/tainan-to-taipei/` | 70 / 72 | 1 小時 25 分 | NT$1350 |
| 2 | 臺中 → 南港 | `/routes/hsr/taichung-to-nangang/` | 92 / 100 | 54 分鐘 | NT$750 |
| 3 | 左營 → 臺中 | `/routes/hsr/zuoying-to-taichung/` | 85 / 87 | 42 分鐘 | NT$790 |
| 4 | 板橋 → 左營 | `/routes/hsr/banqiao-to-zuoying/` | 77 / 78 | 1 小時 26 分 | NT$1460 |
| 5 | 臺中 → 臺南 | `/routes/hsr/taichung-to-tainan/` | 70 / 73 | 36 分鐘 | NT$650 |
| 6 | 新竹 → 臺北 | `/routes/hsr/hsinchu-to-taipei/` | 56 / 61 | 31 分鐘 | NT$290 |
| 7 | 嘉義 → 臺北 | `/routes/hsr/chiayi-to-taipei/` | 54 / 55 | 1 小時 7 分 | NT$1080 |
| 8 | 桃園 → 左營 | `/routes/hsr/taoyuan-to-zuoying/` | 54 / 57 | 1 小時 24 分 | NT$1330 |

### B. 高鐵中段與新站長尾（3 組）

| # | 路線 | 建議 URL | svc（平日/假日） | 最快 | 標準座 |
| --- | --- | --- | --- | --- | --- |
| 9 | 新竹 → 臺中 | `/routes/hsr/hsinchu-to-taichung/` | 59 / 62 | 24 分鐘 | NT$410 |
| 10 | 嘉義 → 左營 | `/routes/hsr/chiayi-to-zuoying/` | 56 / 59 | 29 分鐘 | NT$410 |
| 11 | 臺北 → 苗栗 | `/routes/hsr/taipei-to-miaoli/` | 28 / 29 | 42 分鐘 | NT$430 |

苗栗、彰化、雲林三個新站沒有任何頁面，班次少但競爭也少，是典型的長尾。

### C. 台鐵東部與觀光線（5 組）

| # | 路線 | 建議 URL | svc（平日/假日） | 最快 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 12 | 羅東 → 臺北 | `/routes/train/luodong-to-taipei/` | 55 / 51 | 1 小時 20 分 | 本次新增頁的回程 |
| 13 | 松山 → 宜蘭 | `/routes/train/songshan-to-yilan/` | 53 / 46 | 1 小時 1 分 | 東部幹線第二起點 |
| 14 | 花蓮 → 宜蘭 | `/routes/train/hualien-to-yilan/` | 44 / 41 | 1 小時 1 分 | 東部縣際 |
| 15 | 臺北 → 福隆 | `/routes/train/taipei-to-fulong/` | 30 / 25 | 1 小時 | 假日觀光，週末查詢集中 |
| 16 | 臺東 → 臺北 | `/routes/train/taitung-to-taipei/` | 22 / 22 | 3 小時 50 分 | 本次新增頁的回程 |

### D. 台鐵西部與南迴（4 組）

| # | 路線 | 建議 URL | svc（平日/假日） | 最快 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 17 | 嘉義 → 高雄 | `/routes/train/chiayi-to-kaohsiung/` | 68 / 45 | 1 小時 3 分 | 縣際，非通勤 |
| 18 | 臺北 → 基隆 | `/routes/train/taipei-to-keelung/` | 58 / 52 | 38 分鐘 | 跨縣市，班次充足 |
| 19 | 臺北 → 苗栗 | `/routes/train/taipei-to-miaoli/` | 49 / 40 | 1 小時 19 分 | 與高鐵苗栗互補 |
| 20 | 高雄 → 臺東 | `/routes/train/kaohsiung-to-taitung/` | 16 / 13 | 1 小時 45 分 | 南迴線，替代路線少 |

### 實作方式

全部加到 `ROUTES_SEED` 即可 —— seed 路線永遠會產生，不受門檻過濾，並且會自動
帶出時刻表、票價、FAQ、JSON-LD、hreflang、sitemap 與 `INDEXABLE_ROUTE_PATHS`
對應。需要先在 `S` 站點目錄補上尚未列出的站：台鐵 `keelung` 0900、`fulong` 7290、
`miaoli` 3160；高鐵 `hsrMiaoli` 1035。

加完後跑：

```bash
node scripts/generate-route-pages.mjs
npm run seo:verify        # metadata 預算、時刻表自洽、JSON-LD、hreflang
npm run seo:audit-meta    # missing / duplicate / overflow / thin
```

### 已排除的路線與原因

| 路線 | svc | 排除原因 |
| --- | --- | --- |
| 板橋 → 臺北（台鐵） | 175 | 8 分鐘通勤跳站，沒有查詢意圖 |
| 樹林 → 板橋（台鐵） | 143 | 同上，5 分鐘 |
| 汐止 → 松山（台鐵） | 123 | 同上，8 分鐘 |
| 臺北 → 板橋（高鐵） | 96 | 7 分鐘、NT$40，實務上沒人搭 |
| 臺中 → 花蓮（台鐵） | 5 | 班次太少，撐不起一張時刻表 |
