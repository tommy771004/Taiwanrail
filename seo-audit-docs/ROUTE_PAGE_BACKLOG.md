# 路線頁待建清單 Route Page Backlog

更新日期：2026-08-18（第四批已建置；資料驅動展開告一段落）
資料來源：`public/data/tra-timetable.json`、`public/data/thsr-timetable.json`、
`public/data/thsr-fares.json`、`public/data/tra-fares/`（TDX 每週通用時刻表快照）

本文件記錄路線頁的建置進度與待建清單：

- 第 1 節：第一批 10 個長尾路線頁（**已建置**）
- 第 2 節：全站 metadata 稽核結果與修法（**已修復**）
- 第 3 節：第二批 20 組高流量路線對（**已建置**）
- 第 4 節：第三批 20 組回程與中段路線（**已建置**）
- 第 5 節：第四批 20 組高鐵城市對與新站（**已建置**）—— 資料驅動展開的最後一批
- 第 6 節：後續方向（改由 Search Console query 驅動）

目前路線頁共 210 條（台鐵 152、高鐵 58），連同兩個語系與 4 個 hub 頁，
sitemap 共 430 個 URL。

---

## 1. 第一批：10 個長尾路線頁（已建置）

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

## 3. 第二批：20 組高流量路線對（已建置）

排序依據是**編輯判斷 + 資料佐證**，不是單純的班次數。班次數最高的都是通勤短跳
（板橋→臺北 175 班、樹林→板橋 143 班），那是使用者早就背起來、不會去查的路線；
把它們做成頁面正是 Google 會判定為 thin / scaled content 的東西。因此下表的挑選
標準是「會有人打出這個字串去搜尋」，資料只用來確認**有沒有足夠班次撐起一張時刻
表**（`svc` 為每週通用時刻表中的直達班次數）。

> 待 Search Console 的實際 query 資料可用之後，這份清單應該改由 query 數據排序，
> 這也是 `generate-route-pages.mjs` 註解中已經記下的方向。

**建置狀態：20 組全數完成**，站點目錄已補上台鐵 `keelung` 0900、`songshan` 0990、
`miaoli` 3160、`chiayi` 4080、`fulong` 7290 與高鐵 `hsrMiaoli` 1035。下表的班次與
票價數字即為產出頁面上的實際數值。

### A. 高鐵反向與缺漏城市對（8 組）— 優先度最高

高鐵當時只有 12 條路線頁，是覆蓋率最低的模式，而反向頁面幾乎全缺。

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

排除的路線與理由見第 5 節末的清單。

---

## 4. 第三批：20 組回程與中段路線（已建置）

從當時剩餘的 1051 組有直達班次、但尚無頁面的 OD 中挑出。挑選標準與第 3 節相同：
先問「會不會有人打出這個字串」，班次數只用來確認撐得起一張時刻表。

第二批建完之後，最明顯的缺口變成**新建頁面自己的回程**（臺北→桃園有頁、桃園→
臺北沒有），以及高鐵嘉義、新竹兩個中段站的城市對。

**建置狀態：20 組全數完成**，不需新增任何站點。下表數字即為產出頁面上的實際數值。

### A. 高鐵回程與縱貫線城市對（8 組）

| # | 路線 | 建議 URL | svc（平日/假日） | 最快 | 標準座 | 備註 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 左營 → 南港 | `/routes/hsr/zuoying-to-nangang/` | 83 / 85 | 1 小時 45 分 | NT$1530 | 全線最長，既有頁的回程 |
| 2 | 左營 → 板橋 | `/routes/hsr/zuoying-to-banqiao/` | 77 / 77 | 1 小時 25 分 | NT$1460 | 第二批的回程 |
| 3 | 臺南 → 臺中 | `/routes/hsr/tainan-to-taichung/` | 71 / 73 | 35 分鐘 | NT$650 | 第二批的回程 |
| 4 | 桃園 → 臺北 | `/routes/hsr/taoyuan-to-taipei/` | 62 / 70 | 16 分鐘 | NT$160 | 第一批的回程 |
| 5 | 臺中 → 桃園 | `/routes/hsr/taichung-to-taoyuan/` | 62 / 70 | 30 分鐘 | NT$540 | 既有頁的回程 |
| 6 | 南港 → 臺南 | `/routes/hsr/nangang-to-tainan/` | 69 / 71 | 1 小時 32 分 | NT$1390 | 南港為北端起點 |
| 7 | 臺南 → 左營 | `/routes/hsr/tainan-to-zuoying/` | 71 / 73 | 11 分鐘 | NT$140 | 南部短程，轉乘台鐵新左營 |
| 8 | 左營 → 臺南 | `/routes/hsr/zuoying-to-tainan/` | 71 / 73 | 11 分鐘 | NT$140 | 同上回程 |

### B. 高鐵嘉義與新竹中段（4 組）

| # | 路線 | 建議 URL | svc（平日/假日） | 最快 | 標準座 |
| --- | --- | --- | --- | --- | --- |
| 9 | 臺中 → 嘉義 | `/routes/hsr/taichung-to-chiayi/` | 56 / 59 | 22 分鐘 | NT$380 |
| 10 | 嘉義 → 臺南 | `/routes/hsr/chiayi-to-tainan/` | 56 / 59 | 16 分鐘 | NT$280 |
| 11 | 新竹 → 左營 | `/routes/hsr/hsinchu-to-zuoying/` | 46 / 48 | 1 小時 23 分 | NT$1200 |
| 12 | 板橋 → 嘉義 | `/routes/hsr/banqiao-to-chiayi/` | 47 / 49 | 1 小時 5 分 | NT$1050 |

### C. 台鐵東部與觀光線回程（5 組）

| # | 路線 | 建議 URL | svc（平日/假日） | 最快 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 13 | 基隆 → 臺北 | `/routes/train/keelung-to-taipei/` | 60 / 51 | 36 分鐘 | 第二批的回程 |
| 14 | 宜蘭 → 臺北 | `/routes/train/yilan-to-taipei/` | 57 / 53 | 1 小時 10 分 | 既有頁的回程 |
| 15 | 宜蘭 → 花蓮 | `/routes/train/yilan-to-hualien/` | 45 / 39 | 1 小時 3 分 | 第二批 花蓮→宜蘭 的回程 |
| 16 | 瑞芳 → 臺北 | `/routes/train/ruifang-to-taipei/` | 46 / 39 | 31 分鐘 | 第一批的回程，九份下山 |
| 17 | 礁溪 → 臺北 | `/routes/train/jiaoxi-to-taipei/` | 39 / 33 | 1 小時 9 分 | 第一批的回程 |

### D. 台鐵西部與其他（3 組）

| # | 路線 | 建議 URL | svc（平日/假日） | 最快 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 18 | 高雄 → 嘉義 | `/routes/train/kaohsiung-to-chiayi/` | 67 / 52 | 1 小時 2 分 | 第二批的回程 |
| 19 | 松山 → 瑞芳 | `/routes/train/songshan-to-ruifang/` | 46 / 40 | 25 分鐘 | 東部幹線第二起點 |
| 20 | 臺南 → 臺中 | `/routes/train/tainan-to-taichung/` | 42 / 31 | 1 小時 34 分 | 第一批的回程 |

### 實作方式

全部加到 `ROUTES_SEED` 即可 —— seed 路線永遠會產生，不受
`TRA_MIN_SERVICES` / `TRA_MIN_FASTEST_MIN` 門檻過濾，並且會自動帶出時刻表、票價、
FAQ、JSON-LD、hreflang、sitemap 與 `INDEXABLE_ROUTE_PATHS` 對應。第三批沒有新增
任何站點，所有起訖站都已在 `S` 站點目錄內。

---

## 5. 第四批：20 組高鐵城市對與新站（已建置）

第三批之後剩下 1031 組無頁面的 OD，但**其中值得做成頁面的只剩高鐵**。台鐵剩下
的兩類都不該再無差別展開：

- **通勤短跳**（北北基桃、高屏一帶）班次極多但沒有查詢意圖，見最下方排除清單。
- **支線與小站**（集集線、平溪線、南迴中間站）查詢意圖存在，但直達班次少到撐不
  起一張時刻表；這類比較適合做成「路線／支線」型頁面，而不是逐一 OD 展開。

高鐵則還剩兩個明確缺口：**臺南與嘉義的縱貫線城市對**（臺南↔南港／板橋／桃園
當時無頁），以及**彰化、雲林、苗栗三個新站完全沒有任何頁面** —— 班次少但競爭
也少，正是長尾該做的地方。因此第四批全部是高鐵。

**建置狀態：20 組全數完成**，站點目錄已補上 `hsrChanghua` 1043 與 `hsrYunlin` 1047
（`hsrMiaoli` 1035 於第二批補過）。下表數字即為產出頁面上的實際數值。

### A. 臺南與嘉義的縱貫線城市對（8 組）

| # | 路線 | 建議 URL | svc（平日/假日） | 最快 | 標準座 |
| --- | --- | --- | --- | --- | --- |
| 1 | 臺南 → 南港 | `/routes/hsr/tainan-to-nangang/` | 69 / 71 | 1 小時 36 分 | NT$1390 |
| 2 | 板橋 → 臺南 | `/routes/hsr/banqiao-to-tainan/` | 62 / 63 | 1 小時 14 分 | NT$1320 |
| 3 | 臺南 → 板橋 | `/routes/hsr/tainan-to-banqiao/` | 63 / 63 | 1 小時 17 分 | NT$1320 |
| 4 | 桃園 → 臺南 | `/routes/hsr/taoyuan-to-tainan/` | 54 / 57 | 1 小時 12 分 | NT$1190 |
| 5 | 臺南 → 桃園 | `/routes/hsr/tainan-to-taoyuan/` | 53 / 55 | 1 小時 21 分 | NT$1190 |
| 6 | 南港 → 嘉義 | `/routes/hsr/nangang-to-chiayi/` | 54 / 57 | 1 小時 24 分 | NT$1120 |
| 7 | 嘉義 → 南港 | `/routes/hsr/chiayi-to-nangang/` | 53 / 54 | 1 小時 18 分 | NT$1120 |
| 8 | 左營 → 桃園 | `/routes/hsr/zuoying-to-taoyuan/` | 53 / 55 | 1 小時 34 分 | NT$1330 |

### B. 嘉義與新竹中段補完（6 組）

| # | 路線 | 建議 URL | svc（平日/假日） | 最快 | 標準座 |
| --- | --- | --- | --- | --- | --- |
| 9 | 嘉義 → 臺中 | `/routes/hsr/chiayi-to-taichung/` | 55 / 56 | 22 分鐘 | NT$380 |
| 10 | 臺南 → 嘉義 | `/routes/hsr/tainan-to-chiayi/` | 55 / 56 | 17 分鐘 | NT$280 |
| 11 | 左營 → 嘉義 | `/routes/hsr/zuoying-to-chiayi/` | 55 / 56 | 30 分鐘 | NT$410 |
| 12 | 桃園 → 嘉義 | `/routes/hsr/taoyuan-to-chiayi/` | 54 / 57 | 54 分鐘 | NT$920 |
| 13 | 新竹 → 臺南 | `/routes/hsr/hsinchu-to-tainan/` | 46 / 48 | 1 小時 9 分 | NT$1060 |
| 14 | 嘉義 → 板橋 | `/routes/hsr/chiayi-to-banqiao/` | 47 / 46 | 1 小時 16 分 | NT$1050 |

### C. 彰化、雲林、苗栗新站（6 組）

三站目前**一個頁面都沒有**。班次是全線最少的一群，但相對地競爭也最少，
且都是有實際城際距離的行程（臺北→彰化 64 分鐘、臺北→雲林 75 分鐘）。

| # | 路線 | 建議 URL | svc（平日/假日） | 最快 | 標準座 |
| --- | --- | --- | --- | --- | --- |
| 15 | 臺北 → 彰化 | `/routes/hsr/taipei-to-changhua/` | 23 / 24 | 1 小時 4 分 | NT$820 |
| 16 | 彰化 → 臺北 | `/routes/hsr/changhua-to-taipei/` | 22 / 25 | 1 小時 | NT$820 |
| 17 | 臺北 → 雲林 | `/routes/hsr/taipei-to-yunlin/` | 23 / 24 | 1 小時 15 分 | NT$930 |
| 18 | 雲林 → 臺北 | `/routes/hsr/yunlin-to-taipei/` | 22 / 25 | 1 小時 10 分 | NT$930 |
| 19 | 南港 → 彰化 | `/routes/hsr/nangang-to-changhua/` | 23 / 24 | 1 小時 15 分 | NT$870 |
| 20 | 板橋 → 苗栗 | `/routes/hsr/banqiao-to-miaoli/` | 28 / 29 | 34 分鐘 | NT$400 |

---

## 6. 後續方向：改由 Search Console query 驅動

四批做完，**能從已提交資料集看出來的缺口已經處理完畢**。剩下 1011 組沒有頁面
的 OD，分佈是：

| 類別 | 數量 | 為什麼不做 |
| --- | --- | --- |
| 台鐵通勤短跳 | 大宗 | 班次極多但沒有查詢意圖，見下方排除清單 |
| 台鐵支線與小站 | 其次 | 集集線、平溪線、南迴中間站 —— 有意圖，但直達班次少到撐不起時刻表 |
| 高鐵短跳 | 49 | 車程 45 分鐘以內，多為 7–30 分鐘的鄰站移動 |
| 高鐵剩餘城際對 | 28 | 多為苗栗／彰化／雲林彼此之間，或與新竹／嘉義的組合，每組僅 16–32 班 |

高鐵剩下的 28 組城際對（例如 苗栗→左營 16 班、彰化→左營 28 班）**在資料上仍然
成立**，將來要補並不難，但它們的差異已經小到無法用資料分辨誰值得做 —— 這正是
`generate-route-pages.mjs` 中 `TRA_HUB_STATION_NAMES` 註解記下的問題：

> Search Console query data would be a better selector and should replace this list
> once it is available.

因此**下一批不該再從時刻表資料挑**，而是：

1. 在 Search Console 的「成效」報表中，用 `/routes/` 篩選網頁，看哪些既有頁面已經
   取得曝光；
2. 看「查詢」分頁中有曝光但**沒有對應頁面**的字串（例如某個站名組合），那才是下
   一批該建的路線；
3. 同時檢查已建頁面的 CTR 與排名 —— CTR 偏低的頁面該改的是 `<title>` 與
   description（第 2 節的長度預算已經到位，接下來調的是措辭），而不是再多建頁面。

繼續無差別展開只會產生 Google 判定為 thin / scaled content 的頁面，反過來拖累
已經在排名的那些。

### 已排除的路線與原因

| 路線 | svc | 排除原因 |
| --- | --- | --- |
| 板橋 → 臺北（台鐵） | 175 | 8 分鐘通勤跳站，沒有查詢意圖 |
| 樹林 → 板橋（台鐵） | 143 | 同上，5 分鐘 |
| 汐止 → 松山（台鐵） | 123 | 同上，8 分鐘 |
| 南港 → 臺北（高鐵） | 104 | 7 分鐘、NT$40，實務上沒人搭 |
| 臺北 → 板橋（高鐵） | 96 | 同上，7 分鐘 |
| 宜蘭 → 羅東（台鐵） | 73 | 6 分鐘，同站群移動 |
| 臺中 → 花蓮（台鐵） | 5 | 班次太少，撐不起一張時刻表 |

### 共用的驗證指令

每批建完後跑：

```bash
node scripts/generate-route-pages.mjs
npm run seo:verify        # metadata 長度預算、時刻表自洽、JSON-LD、hreflang
npm run seo:audit-meta    # missing / duplicate / overflow / thin
npm run lint && npm run build
```
