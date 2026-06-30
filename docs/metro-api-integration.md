# 捷運 (Metro) TDX API 整合與 429 對策

> 對應任務：檢查 `src/components/MetroSearch.tsx` + TDX Metro API，修復轉乘邏輯，並決定哪些端點即時呼叫、哪些預先排程抓取以避開 429。

## 1. 現況資料流

`MetroSearch.tsx` → `src/lib/metro.ts` → `fetchTDXApi`（經 `/api/tdx` proxy）→ TDX。

搜尋一次會打：

| 呼叫 | 端點 | 時機 | 性質 |
| --- | --- | --- | --- |
| `getMetroStations` ×7 | `Station/{sys}` | **每次開頁**（定位掃描全部系統） | 幾乎不變 |
| `getMetroODFare` | `ODFare/{sys}`（filter OD） | 每次查詢 | 幾乎不變、回應小 |
| `getMetroS2STravelTime` | `S2STravelTime/{sys}` | 每次查詢 | 幾乎不變、整線回傳 |
| `getMetroLineTransfer` | `LineTransfer/{sys}` | 跨線查詢 | 幾乎不變、整系統回傳 |
| `getMetroLiveBoard` | `LiveBoard/{sys}` | 展開班次時 | **即時** |
| 站別時刻表 | （排程預抓）`StationTimeTable/{sys}` | 同線班次 | 每日更新 |

## 2. 轉乘邏輯壞掉的根因

跨線轉乘路線由 `computeMetroRoute()` 以 Dijkstra 計算，圖的兩種邊來自
**即時** 取得的 `S2STravelTime`（乘車邊）與 `LineTransfer`（轉乘邊）。

當 TDX 回 **429** 時，`fetchTDXApi` 會 fallback 到 `getMockData`：

- `S2STravelTime` 只有 1 條 BL 線的假資料；
- `LineTransfer` **完全沒有 mock**，回傳 `[]`。

結果：圖少了所有轉乘邊 → `computeMetroRoute` 回 `null` → 畫面顯示「查無路線」。
也就是說，**只要 TDX 限流，跨線轉乘就靜默失效**。同理 `Station` 在開頁時被打 7 次，
是 429 的主要來源之一。

## 3. 對策：靜態優先（static-first）+ 排程預抓

把「幾乎不變」的三個端點交給排程 `scripts/fetch-tdx-metro.ts` 每週抓成快照，
前端改為 **先讀靜態檔、抓不到才打即時 API**，讓轉乘所需資料離開限流路徑。

### 預抓（pre-fetch）

`scripts/fetch-tdx-metro.ts` 對每個系統輸出到 `public/data/metro_<SYS>/`：

| 檔案 | 來源端點 | 用途 |
| --- | --- | --- |
| `stations.json` | `Station/{sys}` | 站點清單、定位、起訖站名 |
| `s2s.json` | `S2STravelTime/{sys}` | 同線旅行時間 + 轉乘圖乘車邊 |
| `transfers.json` | `LineTransfer/{sys}` | 轉乘圖轉乘邊 |
| `<station>.json` | `StationTimeTable/{sys}` | 同線班次時刻（沿用既有切檔） |

`src/lib/metro.ts` 的 `loadMetroStatic()` 先讀這些檔；缺檔則回 `null`，呼叫端
透明 fallback 到 `fetchTDXApi`（與既有 `getTRAStations` 等做法一致）。
快照尚未產生時行為等同舊版，不會壞。

### 維持即時（live）

- **`LiveBoard`** — 進站倒數，本質即時，必須直連（仍受 proxy 1 分鐘快取保護）。
- **`ODFare`** — 以 OD filter 查詢、回應很小，且票價需精確；維持即時。
  （備註：429 時其 mock 會回錯誤票價，後續可考慮比照 `tra-fares` 改成
  `metro_<SYS>/fares/<originId>.json` 逐起點預抓；本次先不擴張範圍。）

## 4. 其他可整合但本次未納入的 TDX Metro 端點

| 端點 | 可能用途 | 建議 |
| --- | --- | --- |
| `StationOfLine` / `StationOfRoute` | 權威的路線站序（分支線更可靠） | 可預抓，作為 `S2STravelTime` 站序的後援 |
| `Frequency` | 尖離峰班距（無逐班時刻系統的估算） | 可預抓 |
| `FirstLastTimetable` | 首末班車 | 可預抓 |
| `StationExit` | 出入口資訊 | 可預抓 |
| `Line` / `Route` | 路線顏色、代碼 → 美化 leg 標籤 | 可預抓 |
| `Alert` | 營運通阻 | 即時（短快取） |

## 5. 防 429 的抓取面措施

`fetchTdxJson()` 對 429/403 退避 6 秒重試（最多 6 次），每個端點間 `sleep(800ms)`、
每個系統間 `sleep(1000ms)`，避免排程自身觸發限流。

---

## 6. 詳情卡片改版（與台鐵 UI/UX 一致 + 垂直站序 + 即時車位）

### 6.1 卡片與詳情一致化

捷運同線班次的展開詳情，停靠站由「水平卷軸」改為**垂直時間軸**，沿用台鐵詳情的設計語彙
（左側時間軸圓點＋連線、右側站名＋時刻），改為 cyan 主題。每一站顯示：

- **到站時刻** = 該班次發車時刻 + 累積站間時間（`SameLineJourney.stopOffsetsSec[i]`）。
- **起點 / 終點** amber 標籤。
- **轉乘** 標籤：該站若是換乘站（來自已抓取的 `LineTransfer`）即標示。
- **列車** 高亮：若 `LivePosition` 顯示有列車在該站（同線），圓點放大脈動 + cyan 底色。

`computeSameLineJourney` 因此新增 `stopIds`、`stopOffsetsSec`（與 `stopNames` 平行）。

### 6.2 即時車位（LivePosition）

新增 `getMetroLivePosition(system)`（`/v2/Rail/Metro/LivePosition/{Operator}`，
`MetroApi_LivePosition_2109`）。展開班次卡時與 `LiveBoard` 一併抓取，用 `StationID`
對應到該班次站序以高亮目前車位。**屬即時資料，不預抓**；部分業者未提供（404）或限流（429）
時回 `[]`，時間軸照常顯示、僅少了高亮（刻意不造假，故 `api.ts` 不放 LivePosition mock）。
欄位未公開於 OAS，採多別名防禦式解析。

## 7. 第 3 點：三個端點能否補進詳情卡片（已改為靜態預抓）

| 端點 | 內容 | 補進卡片 | 是否靜態化 | 處置（本次） |
| --- | --- | --- | --- | --- |
| `StationTransfer` (2112) | 站內跨線轉乘：`FromLineID`/`ToLineID`、轉乘時間、文字說明 | ✅ 換乘站「轉乘 X 線 · 約 N 分」徽章 + 說明 tooltip | ✅ **預抓** `stationtransfer.json` | `getMetroStationTransfer` static-first；與 `LineTransfer` 合併建表，無 live 呼叫 |
| `StationPlatform` (2111) | 車站月台（哪個月台往哪方向/路線） | ✅ 起點站「月台 X」標籤 | ✅ **預抓** `platforms.json` | `getMetroStationPlatform` static-first；依路線/方向擇一月台，解析不到則不顯示 |
| `TransferStations` (2113, GIST/GIS) | 轉乘站 GIS 清單（含座標） | ❌ 價值低（與上兩者重疊、卡片不需座標） | （可靜態，但不需要） | 不納入；僅未來轉乘地圖才有用 |

**作法**：兩端點都加入排程 `saveSystemStatic()` 的清單，輸出到
`public/data/metro_<sys>/{stationtransfer,platforms}.json`；前端 `metro.ts` 以
`loadMetroStatic()` **靜態優先**讀取，缺檔才退回 live，再退回 `[]`。因此這兩個原本可能
LIVE select 的資料，**現在完全走排程靜態檔，不在查詢時打 TDX**。

## 8. 靜態 vs 即時 一覽（最終）

| 端點 | 變動頻率 | 取得方式 |
| --- | --- | --- |
| `Station` | 極低 | **靜態預抓** |
| `S2STravelTime` | 極低 | **靜態預抓** |
| `LineTransfer` | 極低 | **靜態預抓** |
| `StationTransfer` (2112) | 極低 | **靜態預抓**（本次新增） |
| `StationPlatform` (2111) | 極低 | **靜態預抓**（本次新增） |
| `StationTimeTable` | 每日 | **靜態預抓**（站別切檔） |
| `ODFare` | 低 | 即時（filter 後回應小）；可改逐起點預抓 |
| `LiveBoard` | 即時 | **必為 live** |
| `LivePosition` (2109) | 即時 | **必為 live**（列車當前位置） |

> 結論：除了本質即時的 `LiveBoard` / `LivePosition`（與回應很小的 `ODFare`）之外，
> 捷運查詢與詳情卡片所需資料均可、且已改為透過排程 `fetch-tdx-metro.ts` 靜態預抓，
> 查詢時不再 LIVE select，從根本降低 429 風險。

> 註：本環境無法抓取 TDX Swagger 規格（egress 政策封鎖 `tdx.transportdata.tw`，CONNECT 403），
> 故 `LivePosition` / `StationTransfer` / `StationPlatform` 欄位採多別名防禦式解析，
> 解析不到即不顯示（不造假）。排程首次產生快照後即為真實欄位；若欄位與別名不符，
> 建議以一次性 probe 對齊後補進別名清單。
