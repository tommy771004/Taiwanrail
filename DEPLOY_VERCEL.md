# 🚀 部署至 Vercel 完整指南

這份文件說明如何透過 **GitHub 匯入** 將「鐵道查詢 App」部署到 Vercel 平台。

> **架構說明 (方案 C — 伺服器端代理)**
>
> 本專案使用 Vercel Serverless Function (`api/tdx/[...path].ts`) 作為 TDX API 的代理層。
> - TDX 的 Client ID / Secret **只存在 Vercel 的環境變數中，永不打包進前端 JS**。
> - 瀏覽器發送 `/api/tdx/...` 相對路徑請求，由伺服器端取得 token 並轉發至 TDX，再將結果返回。
> - Vercel Edge Cache 會依 `Cache-Control` Header 自動快取靜態資料（車站列表 24h、時刻表 90s 等）。

---

## 🛠️ 第一階段：準備 GitHub 儲存庫

1. 在 GitHub 建立新的 Repository，並將程式碼推送：
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/您的帳號/您的專案名稱.git
   git branch -M main
   git push -u origin main
   ```

---

## 🌐 第二階段：在 Vercel 匯入 GitHub 專案

1. 前往 [vercel.com](https://vercel.com/) 並登入（建議用 GitHub 帳號）。
2. 點擊 **「Add New... → Project」**。
3. 找到您的 GitHub 專案，點擊 **「Import」**。

---

## ⚙️ 第三階段：環境變數設定與部署

### 1. 確認框架設定

| 項目 | 值 |
| :--- | :--- |
| **Framework Preset** | `Vite` |
| **Build Command** | `npm run build`（預設即可）|
| **Output Directory** | `dist`（預設即可）|
| **Install Command** | `npm install`（預設即可）|

### 2. 設定環境變數

展開「**Environment Variables**」區塊，新增以下兩個變數：

| Name（變數名稱） | Value（變數值） | 說明 |
| :--- | :--- | :--- |
| `TDX_CLIENT_ID` | 您的 TDX Client ID | 從 [TDX 官網](https://tdx.transportdata.tw/) 取得 |
| `TDX_CLIENT_SECRET` | 您的 TDX Client Secret | 從 TDX 官網取得 |

> ⚠️ **注意事項**
> - 請勿使用舊版的 `VITE_TDX_CLIENT_ID` / `VITE_TDX_CLIENT_SECRET`（包含 `VITE_` 前綴的變數會被打包進前端 JS，造成 **金鑰外洩**）。
> - 直接貼入金鑰，**不要**加引號或前後空白。
> - 填完一個後按 **「Add」**，再填下一個。

### 3. 開始部署

確認環境變數都已 Add 完成後，點擊 **「Deploy」** 按鈕。等待約 1–2 分鐘。

🎉 看到紙片慶祝畫面代表部署成功！

---

## 💡 後續維護

### 如何更新網站？
只需 `git push` 到 `main` 分支，Vercel 會自動重新部署。

### 更新環境變數後如何生效？
前往 Vercel **Deployments** 分頁 → 最新部署旁點擊 `...` → **「Redeploy」**。

### 部署後白畫面或抓不到資料？
1. 前往 Vercel **Settings → Environment Variables**，確認 `TDX_CLIENT_ID` 與 `TDX_CLIENT_SECRET` 正確設定。
2. 前往 **Functions** 分佈確認 `api/tdx/[...path]` 已被識別（Vercel 應自動偵測 `api/` 資料夾）。
3. 開啟瀏覽器 DevTools → Network，確認 `/api/tdx/...` 請求是否收到 200 回應。

---

## 🖥️ 本機開發

```bash
# 1. 複製環境變數範本
cp .env.example .env

# 2. 填入您的 TDX 金鑰 (只需設定這兩個)
#    TDX_CLIENT_ID=您的ID
#    TDX_CLIENT_SECRET=您的Secret

# 3. 啟動開發伺服器 (Express + Vite HMR)
npm run dev
```

本機的 `server.ts` 已設定 `/api/tdx/*` 代理路由，行為與 Vercel 上完全一致，無需額外設定。

---

## 📁 相關檔案

| 檔案 | 說明 |
| :--- | :--- |
| `api/tdx/[...path].ts` | Vercel Serverless Function — TDX API 代理 |
| `vercel.json` | Vercel 路由設定（確保 `/api/**` 不被 SPA 吃掉）|
| `server.ts` | 本機 Express 開發伺服器（含 `/api/tdx/*` 代理）|
| `src/lib/api.ts` | 前端 API 客戶端（使用相對路徑，無 token 邏輯）|
