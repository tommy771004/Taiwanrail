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
