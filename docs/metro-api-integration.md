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

## 7. 第 3 點：三個端點能否補進詳情卡片

| 端點 | 內容 | 能否補進詳情卡片 | 處置 |
| --- | --- | --- | --- |
| `StationTransfer` (2112) | 站內跨線轉乘：`FromLineID`/`ToLineID`、轉乘時間、文字說明、（部分）步行距離 | **可**，可在換乘站顯示「往 X 線・步行約 N 分」 | 目前已用既有 `LineTransfer` 資料標示「轉乘」徽章達成基本效果；若要顯示步行時間/說明，建議預抓本端點補強（靜態、低頻變動） |
| `TransferStations` (2113, GIST/GIS) | 轉乘站 GIS 清單（含座標） | **價值低**：與 `LineTransfer`/`StationTransfer` 重疊，卡片不需座標 | 不納入卡片；僅未來做轉乘地圖時才有用 |
| `StationPlatform` (2111) | 車站月台層級資訊（哪個月台往哪個方向/路線） | **可**，可在詳情頭部顯示「搭乘月台 X」 | 建議預抓後整合；本次未上線，因無法在此環境連到 TDX 驗證實際欄位名稱，避免把未驗證的猜測欄位直接送上線 |

**結論**：
- `StationTransfer` 的核心效益（標出換乘站）已用現有資料達成；其「步行時間／說明」可作為下一步預抓補強。
- `StationPlatform` 最值得補（月台資訊與台鐵詳情一致），建議納入排程預抓 + 靜態優先，欄位需先以一次性 probe 對齊後再上線。
- `TransferStations`（GIS）對詳情卡片幫助有限，暫不納入。

> 註：本次無法於此環境抓取 TDX Swagger 規格（egress 政策封鎖 `tdx.transportdata.tw`，CONNECT 403），
> 故 `LivePosition` 等欄位採防禦式解析，並建議 `StationPlatform` 上線前先以 probe 對齊欄位。
