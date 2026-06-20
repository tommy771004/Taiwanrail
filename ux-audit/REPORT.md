# UX / 設計審計報告 — 鐵道查詢 Taiwanrail

> 審計日期：2026-06-20（本次重新驗證）· 環境：本機 dev server `tsx server.ts` → `http://localhost:3000`，TDX 即時資料（搜尋實測 南港→台南 有回傳真實班次）
> 方法：Puppeteer 逐頁截圖（1440 / 768 / 390 / 320）+ Canvas 正規化對比度量測（處理 Tailwind v4 OKLCH）+ 原始碼審查
> 截圖：[`ux-audit/screenshots/`](screenshots/)（本次全部重新拍攝）· 量測腳本：[`scripts/ux-audit-contrast.mjs`](../scripts/ux-audit-contrast.mjs)、[`scripts/ux-audit-shots.mjs`](../scripts/ux-audit-shots.mjs)
> 建置驗證：`npm run build` ✅ 通過（`✓ built in 4.29s`，2156 modules，僅有既有的 chunk > 500kB 警告，與本次修正無關）
>
> **更新（2026-06-20 第二輪）**：使用者指示「依序實作」，已將原本只建議的 #1~#12 全部實作完成。深色模式可讀性量測由 **25 項未達 AA → 9 項**（殘餘 9 項皆為品牌色 chip／裝飾小點／白字疊漸層按鈕的量測假陽性）。詳見下方「第二輪實作」。`tsc --noEmit` 殘留的 3 個錯誤屬既有 dead code（`src/components/ui/*` 未被引用、`@/lib/utils` 別名），與本次無關，vite build 不受影響。

這個網站是一個 **單頁 SPA**（[`src/App.tsx`](../src/App.tsx)，~3712 行）。所有「頁面」皆由 URL 路徑驅動同一份 UI（首頁 / `/en/` / `?transport=train` / `/timetable/...` 預填同一搜尋介面），因此審計涵蓋的「頁面狀態」為：首頁（高鐵/台鐵/中英/深色）、搜尋結果、展開停靠站、進站提示、行動版設定。斷點 320 / 390 / 768 / 1440 皆無水平溢出。

整體評價：**視覺成熟、RWD 紮實、互動回饋完整**。主要待解問題集中在 **深色模式對比**（最高優先）與 **若干 a11y 細節（鍵盤、emoji 圖示、reduced-motion）**。

---

## 嚴重度總覽

> 註：下表位置為**第二輪實作前**的行號參考；實作後因新增 import／包裹層／reduced-motion 守衛，行號整體下移約 10–25 行，請以檔案搜尋對照。

| # | 嚴重度 | 類別 | 問題 | 狀態 |
|---|--------|------|------|------|
| 1 | 🔴 High | 對比 | 深色模式根容器 50% 透明疊白 body → 正文/FAQ/footer 僅 **1.34:1** | ✅ **已實作** |
| 2 | 🔴 High | 對比/一致性 | 浮動搜尋卡 `bg-white/95` 無深色變體 → 深色仍亮白 | ✅ **已實作** |
| 3 | 🔴 High | 鍵盤 a11y | 行程類型 radio `hidden` → 鍵盤不可達 | ✅ **已實作** |
| 4 | 🟠 Med | a11y | 全站 0 個 `prefers-reduced-motion` | ✅ **已實作** |
| 5 | 🟠 Med | 圖示 | ⚙️/🚆/🕐 emoji 當 UI 圖示 | ✅ **已實作** |
| 6 | 🟠 Med | 對比 | 未選中切換鈕/行程類型 `text-slate-400` ≈ 2.5:1 | ✅ **已實作**（第一輪） |
| 7 | 🟠 Med | 對比 | 選中日期膠囊星期 `text-orange-200`/`blue-200` ≈ 2.6:1 | ✅ **已實作**（→ `text-white/90`，2.63→3.16） |
| 8 | 🟠 Med | 資訊層級 | 搜尋後仍渲染行銷內容（關於/FAQ/精選作品） | ✅ **已實作** |
| 9 | 🟢 Low | 對比 | 起訖站英文副標 `text-orange-400/70` ≈ 1.8:1 | ✅ **已實作** |
| 10 | 🟢 Low | RWD | 手機橫向捲動無提示 | ✅ **已實作** |
| 11 | 🟢 Low | 細節 | 字級三顆鈕都印同一個 'A' | ✅ **已實作** |
| 12 | 🟢 Low | 觸控 | 進站提示關閉鈕 32px < 44px（且無 aria-label） | ✅ **已實作** |
| F | ✅ 已修 | 對比/alt | Hero 圖 alt、logo、footer ©、結果卡 meta 等（第一輪） | ✅ |

> 深色模式量測：未達 AA 的文字樣式由 **25 → 9**。殘餘 9 項皆為：品牌色 chip（`高鐵`/`時間優先`/`今天` 白字疊 orange-600，受 brand 底色上限約束）、6px 裝飾小點、或白字疊漸層按鈕的量測假陽性（指令碼把漸層底當白底）。原本 1.34:1 的 FAQ/footer/正文已完全自失敗清單消失。

---

## 第二輪實作明細（使用者指示「依序實作」）

### P1 — 深色模式（#1 / #2）
- [`src/index.css`](../src/index.css)：新增 `@media (prefers-color-scheme: dark) { html,body { background-color:#0b1220 } }` 實心深底安全網。
- 根容器：`dark:bg-[#1a1205]/50` → `dark:bg-[#1a1205]`（移除 `/50` alpha，台鐵藍同步）。
- 搜尋卡：`bg-white/95` → 加 `dark:bg-slate-900/95 dark:border-slate-700/60`。
- 卡內元件補深色變體：切換膠囊底、未選中文字、日期膠囊（底/邊/星期/日期數字）、出發/回程區塊標題。

### P2 — a11y（#3 / #4）
- 行程類型 radio：`className="hidden"` → `peer sr-only`，並把 `<input>` 移到視覺圈之前，圈加 `peer-focus-visible:ring-2 ring-slate-500`（鍵盤可達＋可見焦點環＋SR 可讀），深色加 `dark:peer-focus-visible:ring-offset-slate-900`。
- reduced-motion：`index.css` 全域 `@media (prefers-reduced-motion: reduce)` 壓掉 animation/transition/scroll-behavior；視差捲動 `useEffect` 加 `matchMedia('(prefers-reduced-motion: reduce)')` 守衛，命中時 `setScrollY(0)` 且不掛 scroll listener。

### P3 — 圖示與資訊層級（#5 / #8）
- emoji → lucide：行動版設定鈕 ⚙️→`<Settings/>`、設定彈窗標題 ⚙️→`<Settings/>`、展開卡耗時 🕐→`<Clock/>`、進站提示 🚆→`<Train/>`（皆 `aria-hidden`）。import 補 `Settings, Clock`。（註：第 1286 行 🚆 屬瀏覽器 Notification 標題字串，emoji 於 OS 通知為適當用法，保留。）
- 結果頁行銷區（關於/FAQ + 精選作品兩個 `<section>`）：加 `${hasSearched ? 'hidden' : ''}`。初始/SSR（`hasSearched=false`）仍輸出完整內容供爬蟲，搜尋後隱藏，使用者不再捲過行銷。

### P4 — 細節（#7 / #9 / #10 / #11 / #12）
- #7 選中日期星期：`text-orange-200/blue-200` → `text-white/90`（出發＋回程）。
- #9 起訖站英文副標：`text-orange-400/70`(/`slate-400`) → `text-slate-500 dark:text-slate-400`（中性、去除 /70 over-fade）。
- #10 手機捲動提示：日期/回程膠囊容器加右側 `bg-gradient-to-l from-white dark:from-slate-900` 漸層遮罩（`sm:hidden`），暗示可橫向捲。
- #11 字級鈕：三顆 'A' 改 `text-xs / text-base / text-xl` 遞增字級表意（外層加 `aria-hidden`，下方仍有小/中/大文字）。
- #12 進站提示關閉鈕：`w-8 h-8`(32px) → `w-11 h-11`(44px)，並補 `aria-label`（原本只有 X 圖示、無可及名稱）。`absolute` 置中定位，放大不致 reflow。

### 第一輪直接修正（沿用，本次確認仍在）
| 項目 | 變更 |
|------|------|
| 未選中切換鈕/行程類型文字（#6） | `text-slate-400` → `text-slate-500`（量測「台鐵」2.5→4.49） |
| Hero 背景圖 / Logo | `alt=""` + `aria-hidden`（h1 文字提供可及名稱） |
| Footer © / 結果卡 meta / 查看詳情 / 直達 | `text-slate-400` → `text-slate-500 dark:text-slate-400` |

### 先前已修正（沿用，本次確認仍在）
| 項目 | 位置 | 變更 |
|------|------|------|
| Hero 背景大圖 alt | [`App.tsx:1782`](../src/App.tsx#L1782) | `alt=""` + `aria-hidden="true"`（裝飾圖不再被 SR 唸英文） |
| Logo 圖片 | [`App.tsx:1500`](../src/App.tsx#L1500) | `alt=""` + `aria-hidden`（h1 內 "鐵道查詢" 文字已提供可及名稱，正確） |
| Footer 版權列 | [`App.tsx:3574`](../src/App.tsx#L3574) | `text-slate-500 dark:text-slate-400`（2.55 → 4.8） |
| 結果卡路線 meta / 查看詳情 / 直達 | App.tsx 結果卡內聯版 | `text-slate-400` → `text-slate-500` |

---

## 詳細發現（仍待你定奪）

### 🔴 #1 — 深色模式背景濁化（最高優先）
量測：深色模式下「選擇起訖站…」「關於」「FAQ」「精選作品」「footer」正文全部 **1.34:1**（遠低於 4.5）；起訖站大字「南港」`text-orange` 在濁底也只剩 1.58:1。
根因：根容器用半透明深色 `bg-orange-50/50 dark:bg-[#1a1205]/50` / `dark:bg-[#050f1a]/50`（[`App.tsx:1460`](../src/App.tsx#L1460)），而 `<body>` 沒有深色底色。50% alpha 疊在預設白色 body 上 → 合成濁灰棕中間調，不是深色。
證據：[`screenshots/home-zh-dark-desktop.png`](screenshots/home-zh-dark-desktop.png)（整頁灰棕、文字幾乎糊在背景）。
建議：給 `body`（或 `html.dark body`）一個實心深底（例如 `#0b1220`），並移除根層 `/50` alpha。修正後 slate-400 正文在深底上自然回到 ~7:1。
> 未自動修：屬「全站主題色」變動，會牽動 Hero 漸層收尾色，需目視確認，故僅建議。

### 🔴 #2 — 搜尋卡深色模式仍亮白
[`App.tsx:1850`](../src/App.tsx#L1850) `bg-white/95 backdrop-blur-sm`（無 `dark:` 變體）。深色截圖可見頂部搜尋卡刺眼亮白、與其餘介面割裂。建議補 `dark:bg-slate-900/90` 並檢查內部 slate 文字於深底的對比。

### 🔴 #3 — 行程類型 radio 鍵盤不可達
[`App.tsx:1912`](../src/App.tsx#L1912)、[`1919`](../src/App.tsx#L1919) `<input type="radio" className="hidden" …>`。`hidden` = `display:none`，移出焦點順序與 a11y tree：鍵盤無法 Tab/方向鍵切換單程/來回，SR 讀不到選取狀態。
建議：`hidden` 換 `sr-only`（視覺隱藏但保留可聚焦與語意），並對自訂視覺圈加 `peer-focus-visible` 焦點環（需把 input 移到圈之前以利 peer 選擇器）。
> 未自動修：單純 `hidden→sr-only` 會讓焦點不可見（另一個 a11y 缺陷），需一併加焦點環＝結構改動，超出「單一 class 安全替換」範圍，故建議。

### 🟠 #4 — 無 reduced-motion
全專案 grep `prefers-reduced-motion` = 0 命中。動畫來源：Hero 視差捲動（依 `scrollY` 變 transform）、framer-motion 卡片入場、`animate-pulse`、700ms 主題轉場。建議全域 CSS：
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
}
```
並對視差捲動加 `matchMedia('(prefers-reduced-motion: reduce)')` 判斷略過。

### 🟠 #5 — emoji 當圖示
⚙️（[`1646`](../src/App.tsx#L1646)、[`1658`](../src/App.tsx#L1658)）、🚆（[`1286`](../src/App.tsx#L1286)、[`3591`](../src/App.tsx#L3591)）、🕐（[`2881`](../src/App.tsx#L2881)）。專案已大量使用 lucide-react，建議改 `<Settings/>` / `<Train/>` / `<Clock/>` 以求跨平台一致與可主題化。
> 未自動修：屬視覺/設計替換（非 typo/對比/間距/alt 範圍），低風險但留給你定奪。

### 🟠 #7 / #9 — 品牌色對比（設計取捨）
- 選中日期膠囊星期標籤 `text-orange-200`/`text-blue-200` 疊 orange/blue-600 ≈ 2.6:1（[`2038`](../src/App.tsx#L2038),[`2075`](../src/App.tsx#L2075)）。建議改 `text-white/90`。
- 起訖站英文副標 `text-orange-400/70` ≈ 1.8:1（[`1955`](../src/App.tsx#L1955),[`2004`](../src/App.tsx#L2004)）。建議改中性 `text-slate-500` 或加深 `text-orange-600`。
> 涉及主題彩度/品牌識別，屬設計取捨，未自動動手。

### 🟠 #8 — 結果頁資訊層級
搜尋出結果後下方仍完整渲染「關於」「FAQ」「精選作品推薦」。使用者拿到班次後要捲過一長段行銷文案，見 [`screenshots/results-zh-desktop.png`](screenshots/results-zh-desktop.png)、[`results-expanded-mobile.png`](screenshots/results-expanded-mobile.png)。建議 `hasSearched` 為真時收合（FAQ 對 SEO 的價值可改放結果之下且預設收合）。另：「精選作品」推銷不相關外部 App（蔬果價格/AI 股票/AI 行程），對鐵道工具的信任感有疑慮，建議重新評估。

### 🟢 #10 / #11 / #12 — RWD / 細節 / 觸控
- 日期與篩選膠囊手機橫向捲動，`SCROLL →` 提示 `hidden sm:block` → 手機看不到；建議手機端加右側漸層遮罩暗示可捲。
- 字級切換三顆鈕都印同一個 'A'（[`1688`](../src/App.tsx#L1688)）；建議三顆 A 用遞增 font-size 表意。
- 進站提示關閉鈕 `w-8 h-8`（32px）< 44px（[`3626`](../src/App.tsx#L3626)）；建議加 padding 擴大命中區（此鈕為 `absolute` 置中定位，放大不致 reflow，但會改變可見圓圈大小，故留你定奪）。

---

## 做得好的地方（保留）
- **RWD 紮實**：mobile-first、`min-h-dvh`、`env(safe-area-inset-*)`、`max-w-7xl`；320/390/768/1440 皆無水平溢出。
- **互動回饋完整**：按鈕 hover/active scale、`isLoading` 載入態、toast（3s 自動消失）、回饋送出 disabled+送出中文案、Esc 關閉彈窗、click-outside、展開卡片 `vibrate(25)` 觸覺回饋。
- **主題切換**：高鐵橘 / 台鐵藍語意一致，700ms 平滑轉場。
- **離線 UX**：weak→switching→active 漸進轉場＋快照後援，工程細膩。
- **a11y 基礎**：圖示鈕多有 `aria-label`、彈窗 `role="dialog"`、H1 語意正確、`viewport` 未鎖縮放。
- **i18n**：中英資源齊全，未見字串錯字。

---

## 完成狀態
**#1–#12 全部已實作**（見「第二輪實作明細」）。`npm run build` ✅ 通過。深色模式未達 AA 文字 25→9（殘餘為品牌色 chip／裝飾小點／量測假陽性）。上方「詳細發現」各節保留原始問題描述作為背景，標註的「未自動修／建議」狀態已被第二輪實作取代。

### 殘留的設計取捨（已實作但仍受底色上限約束，供未來定奪）
- 選中態 chip 文字（`高鐵`/`時間優先`/`今天`）疊 orange-600 品牌底，純白也僅 ~3.5:1。若要過 4.5，需把選中底色加深（如 orange-700）或改用深字，屬品牌視覺決策。
- `起點站/終點站` micro-label `text-orange-500/70`（2.1:1 light）為品牌裝飾性小標，未列入本次數值修正範圍。

### 已知非阻斷
- `tsc --noEmit` 殘留 3 個錯誤皆在未被引用的 `src/components/ui/*`（`@/lib/utils` 別名無法解析）；vite build 不打包 → 不影響執行與部署。建議後續移除這批 dead code。
