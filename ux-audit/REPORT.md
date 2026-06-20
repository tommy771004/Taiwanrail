# UX / 設計審計報告 — 鐵道查詢 Taiwanrail

> 審計日期：2026-06-20 · 環境：本機 Vite dev (`http://localhost:5180`)，靜態 `/data` 後援資料
> 方法：Puppeteer 逐頁截圖（1440 / 768 / 390 / 320）+ Canvas 正規化對比度量測（處理 Tailwind v4 OKLCH）+ 原始碼審查
> 截圖：[`ux-audit/screenshots/`](screenshots/) · 量測腳本：[`scripts/ux-audit-contrast.mjs`](../scripts/ux-audit-contrast.mjs)、[`scripts/ux-audit-shots.mjs`](../scripts/ux-audit-shots.mjs)

這個網站是一個 **單頁 SPA**（`src/App.tsx`，3711 行）。所有「頁面」皆由 URL 路徑驅動同一份 UI（首頁 / `/en/` / `?transport=train` / `/timetable/...` 預填同一搜尋介面），因此審計涵蓋的「頁面狀態」為：首頁（高鐵/台鐵/中英/深色）、搜尋結果、展開停靠站、回饋彈窗、行動版設定。

整體評價：**視覺成熟、RWD 紮實、互動回饋完整**。主要問題集中在 **深色模式對比** 與 **若干 a11y 細節（鍵盤、emoji 圖示、reduced-motion）**。

---

## 嚴重度總覽

| # | 嚴重度 | 類別 | 問題 | 位置 | 狀態 |
|---|--------|------|------|------|------|
| 1 | 🔴 High | 對比 | 深色模式背景用 50% 透明度疊在白色 `<body>` 上 → 變成濁灰中間調，正文/FAQ/footer 量測僅 **1.34:1** | `App.tsx:1459-1461` | 建議 |
| 2 | 🔴 High | 對比/一致性 | 浮動搜尋卡 `bg-white/95` 無深色變體 → 深色模式下整張卡仍是亮白 | `App.tsx:1849` | 建議 |
| 3 | 🔴 High | 鍵盤 a11y | 行程類型 radio 用 `className="hidden"`（`display:none`）→ 無法 Tab 聚焦、SR 讀不到狀態 | `App.tsx:1911,1918` | 建議 |
| 4 | 🟠 Med | a11y | 完全沒有 `prefers-reduced-motion` 支援，但動畫密集（視差、framer-motion、pulse、700ms 轉場） | 全站 / `index.css` | 建議 |
| 5 | 🟠 Med | 圖示 | ⚙️ emoji 當設定圖示（既有 lucide 仍用 emoji），跨平台渲染不一致 | `App.tsx:1646,1658` | 建議 |
| 6 | 🟠 Med | 對比 | 未選中的切換鈕/單選文字 `text-slate-400` ≈ 2.5:1 | `App.tsx:1877,1897,1912,1919` | 建議 |
| 7 | 🟠 Med | 對比 | 選中日期膠囊的星期標籤 `text-orange-200` on orange-600 ≈ 2.6:1 | `App.tsx:2037` | 建議 |
| 8 | 🟠 Med | 資訊層級 | 搜尋結果下方仍渲染整段行銷內容（關於/FAQ/精選作品）→ 結果後超長捲動 | `App.tsx:3429,3438,3476` | 建議 |
| 9 | 🟢 Low | 對比 | 起訖站英文副標 `text-orange-400/70` ≈ 1.8:1 | `App.tsx:1954,2003` | 建議 |
| 10 | 🟢 Low | RWD | 日期/篩選膠囊在手機需橫向捲動，但 `SCROLL →` 提示 `hidden sm:block` → 手機無捲動暗示 | `App.tsx:2022` | 建議 |
| 11 | 🟢 Low | 圖示 | 🚆 / 🕐 / ⚡ emoji 當結構圖示 | `App.tsx:3590,2881,1327` | 建議 |
| 12 | 🟢 Low | 觸控 | 進站提示關閉鈕 32px（`w-8 h-8`）< 44px | `App.tsx:3625` | 建議 |
| 13 | 🟢 Low | 細節 | 字級按鈕三顆都印同一個 "A"，無大小視覺差 | `App.tsx:1688` | 建議 |
| F | ✅ 已修 | 對比/alt | footer ©、日期區塊標題、結果路線 meta、查看詳情連結、直達、Hero 背景圖 alt | 見下 | **已修正** |

---

## 已直接修正（安全、明確、低風險）

全部為單一 class / 屬性替換，無版面位移、無邏輯變動。修正後對比度由量測腳本確認 ≥ 4.5:1。

| 項目 | 位置 | 變更 | 修正前→後對比 |
|------|------|------|----------|
| Hero 背景大圖（模糊裝飾圖）的 alt | [`App.tsx:1782`](../src/App.tsx#L1782) | `alt="Modern Train Landscape"` → `alt=""` + `aria-hidden="true"` | 裝飾圖不再被 SR 唸出英文描述 |
| 出發日期區塊標題 | [`App.tsx:2015`](../src/App.tsx#L2015) | `text-slate-400` → `text-slate-500` | 2.63 → 4.8 ✅ |
| Footer 版權列 | [`App.tsx:3574`](../src/App.tsx#L3574) | `text-slate-400` → `text-slate-500 dark:text-slate-400` | 2.55 → 4.8 ✅ |
| 結果卡片路線 meta（起→終/方向） | [`App.tsx:2741`](../src/App.tsx#L2741) | `text-slate-400` → `text-slate-500` | 2.63 → 4.8 ✅ |
| 結果卡片「查看詳情 / Details」連結 | [`App.tsx:2861`](../src/App.tsx#L2861) | `text-slate-400` → `text-slate-500` | 2.63 → 4.8 ✅ |
| 結果卡片「直達 / Direct」 | [`App.tsx:2894`](../src/App.tsx#L2894) | `text-slate-400` → `text-slate-500` | 2.63 → 4.8 ✅ |
| `TrainCard` 元件同類文字（duration / Details / Direct） | [`train-card.tsx:142,171,176`](../src/components/ui/train-card.tsx#L142) | `text-slate-400` → `text-slate-500` | 一併修正（註：此元件目前未被結果列表使用，見下方 Note） |

> **Note（非阻斷）**：結果列表的卡片是 **直接寫在 `App.tsx` 內**（約 `2561-2900`），`src/components/ui/train-card.tsx` 這支元件實際上**未被使用**（dead code）。對比修正已同時套用在「真正渲染的內聯版」與這支元件，但建議後續決定是否移除/收斂重複實作。

---

## 詳細發現

### 🔴 #1 — 深色模式背景濁化（最高優先）
量測：深色模式下「關於」「FAQ」「精選作品」「footer」正文全部 **1.34:1**（遠低於 4.5）。
根因：根容器用半透明深色 `dark:bg-[#1a1205]/50` / `dark:bg-[#050f1a]/50`（[`App.tsx:1459-1461`](../src/App.tsx#L1459)），而 `<body>` 沒有任何深色底色（[`index.html:143`](../index.html#L143)）。50% alpha 疊在預設白色 body 上 → 合成出濁灰棕中間調，不是深色。
證據：[`screenshots/home-zh-dark-desktop.png`](screenshots/home-zh-dark-desktop.png)（整頁呈灰棕、文字幾乎糊在背景裡）。
建議：給 `body`（或 `html.dark body`）一個實心深底（例如 `#0b1220`），並移除根層 `/50` alpha。修正後 slate-400 正文在深底上自然回到 ~7:1。
> 未自動修：屬「全站主題色」變動，會牽動 Hero 漸層收尾色（`App.tsx:1791-1795`），需你目視確認，故僅建議。

### 🔴 #2 — 搜尋卡在深色模式仍是亮白
[`App.tsx:1849`](../src/App.tsx#L1849) `bg-white/95 backdrop-blur-sm`（無 `dark:` 變體）。深色截圖可見頂部搜尋卡刺眼亮白、與其餘介面割裂。建議補 `dark:bg-slate-900/90` 並檢查內部 slate 文字在深底的對比。

### 🔴 #3 — 行程類型 radio 鍵盤不可達
[`App.tsx:1911`](../src/App.tsx#L1911)、[`1918`](../src/App.tsx#L1918) `<input type="radio" className="hidden" …>`。`hidden` = `display:none`，元素被移出焦點順序與 a11y tree：鍵盤使用者無法用 Tab/方向鍵切換單程/來回，螢幕報讀器也讀不到選取狀態。
建議：把 `hidden` 換成 `sr-only`（視覺隱藏但保留可聚焦與語意），自訂視覺圈用 `peer-focus-visible` 加焦點環。

### 🟠 #4 — 無 reduced-motion
全專案 grep `prefers-reduced-motion` = 0 命中；`index.css` 僅 `@import "tailwindcss"`。動畫來源：Hero 視差捲動（[`App.tsx:1786`](../src/App.tsx#L1786) 依 `scrollY` 變 transform）、framer-motion 卡片入場、`animate-pulse`、700ms 主題轉場。建議在全域 CSS 加：
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
}
```
並對視差捲動加 JS 層 `matchMedia('(prefers-reduced-motion: reduce)')` 判斷略過。

### 🟠 #5 — emoji 當圖示
[`App.tsx:1646`](../src/App.tsx#L1646)、[`1658`](../src/App.tsx#L1658) 用 ⚙️ 當行動版設定鈕／標題圖示。專案已大量使用 lucide-react，建議改 `<Settings className="w-5 h-5" />` 以求跨平台一致與可主題化。同類：🚆（[`3590`](../src/App.tsx#L3590)）、🕐（[`2881`](../src/App.tsx#L2881)）、⚡（[`1327`](../src/App.tsx#L1327)）。
> 未自動修：屬視覺/設計替換（非列舉的 typo/對比/間距/alt 範圍），低風險但留給你定奪。

### 🟠 #6 / #7 / #9 — 其餘對比（設計取捨）
- 未選中切換鈕「台鐵/高鐵」與單選「來回」`text-slate-400` ≈ 2.48–2.63:1（[`App.tsx:1877`](../src/App.tsx#L1877),[`1897`](../src/App.tsx#L1897),[`1912`](../src/App.tsx#L1912)）。WCAG 要求即使非作用態的可讀文字也需 4.5:1。建議未選中態改 `text-slate-500`（仍與作用態的彩色/加粗有層級差）。
- 選中日期膠囊星期標籤 `text-orange-200`/`text-blue-200` 疊在 orange-600/blue-600 ≈ 2.6:1（[`App.tsx:2037`](../src/App.tsx#L2037)）。建議改 `text-orange-100` 或 `text-white/90`。
- 起訖站英文副標 `text-orange-400/70` ≈ 1.8:1（[`App.tsx:1954`](../src/App.tsx#L1954),[`2003`](../src/App.tsx#L2003)）。建議改中性 `text-slate-500`。
> 這幾項涉及主題彩度/層級表達，屬設計取捨，未自動動手。

### 🟠 #8 — 結果頁資訊層級
搜尋出結果後，下方仍完整渲染「關於鐵道查詢」([3429](../src/App.tsx#L3429))、「常見問題 FAQ」([3438](../src/App.tsx#L3438))、「精選作品推薦」([3476](../src/App.tsx#L3476))。使用者拿到班次後要捲過一長段行銷文案。見 [`screenshots/results-zh-desktop.png`](screenshots/results-zh-desktop.png)。建議 `hasSearched` 為真時收合或隱藏這些區塊（保留 FAQ 對 SEO 的價值可改放結果列表之下且預設收合）。另：「精選作品」推銷的是不相關外部 App（蔬果價格/AI 股票/AI 行程），對鐵道工具的信任感有疑慮，建議重新評估。

### 🟢 #10 — 手機橫向捲動無提示
日期膠囊與篩選膠囊在手機是橫向捲動，但 `SCROLL →` 提示是 `hidden sm:block`（[`App.tsx:2022`](../src/App.tsx#L2022)）→ 手機看不到。建議在手機端加右側漸層遮罩或可見 scrollbar 暗示可捲。

### 🟢 #12 / #13 — 觸控與細節
- 進站提示關閉鈕 `w-8 h-8`（32px）< 44px 觸控標準（[`App.tsx:3625`](../src/App.tsx#L3625)）；建議加 `hitSlop`/padding 擴大命中區。
- 字級切換三顆鈕都印同一個 `'A'`（[`App.tsx:1688`](../src/App.tsx#L1688) `size==='small'?'A':size==='medium'?'A':'A'`），缺少大小視覺差；建議三顆 A 用遞增 font-size 表意。

---

## 做得好的地方（保留）
- **RWD 紮實**：mobile-first、`min-h-dvh`、`env(safe-area-inset-*)`、`max-w-7xl` 容器；320/390/768/1440 皆無水平溢出。
- **互動回饋完整**：按鈕 hover/active scale、`isLoading` 載入態、toast（3s 自動消失）、回饋送出 disabled+送出中文案、Esc 關閉彈窗、click-outside。
- **主題切換**：高鐵橘 / 台鐵藍語意一致（見 train vs hsr 截圖），切換有 700ms 平滑轉場。
- **a11y 基礎**：圖示鈕多有 `aria-label`、彈窗有 `role="dialog"`+`aria-label`、全域警示 div 有鍵盤 handler、H1 語意正確、`viewport` 未鎖縮放。
- **i18n**：中英資源齊全，未見字串錯字。

---

## 後續建議優先序
1. 修 **#1 深色背景 alpha** + **#2 搜尋卡深色變體**（一次解掉深色模式整體可讀性）。
2. 修 **#3 radio 鍵盤** + **#4 reduced-motion**（兩個低風險但影響合規的 a11y）。
3. 收斂 **#5 emoji 圖示** 與 **#8 結果頁行銷區**。
4. 其餘對比/觸控細節（#6/#7/#9/#10/#12/#13）批次處理。
