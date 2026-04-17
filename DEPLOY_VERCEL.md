# 🚀 部署至 Vercel 完整指南 (透過 GitHub 手動匯入)

這份文件將引導您將這個基於 React + Vite 開發的「鐵道查詢 App」順利部署到 Vercel 平台上。Vercel 是目前對於 Vite/React 前端專案支援度最佳、最易用的免費雲端託管平台之一。

---

## 🛠️ 第一階段：準備您的 GitHub 儲存庫 (Repository)

如果您是從 AI Studio 匯出專案：
1. 點擊 AI Studio 介面上的 **Export** 按鈕，選擇 **Download ZIP** (下載壓縮檔) 或 **Export to GitHub**。
2. 如果下載 ZIP，請解壓縮後在本地端初始化 Git：
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   ```
3. 在 GitHub 上建立一個新的公開或私有 Repository。
4. 將本地端程式碼推送到 GitHub：
   ```bash
   git remote add origin https://github.com/您的帳號/您的專案名稱.git
   git branch -M main
   git push -u origin main
   ```

---

## 🌐 第二階段：在 Vercel 匯入 GitHub 專案

1. 前往 [Vercel 官網](https://vercel.com/) 並登入 (建議直接使用 GitHub 帳號登入，或是在 Vercel 設定中綁定 GitHub)。
2. 在 Vercel Dashboard (儀表板) 右上方，點擊黑色的 **「Add New...」** 按鈕，然後選擇 **「Project」**。
3. 在左側的「Import Git Repository」區塊，您會看到您 GitHub 上的專案列表。
4. 找到您剛剛上傳的鐵道 APP 專案，點擊專案旁邊的 **「Import」** 按鈕。

---

## ⚙️ 第三階段：環境參數設定與部署 (Environment Variables)

這是確保能抓到 TDX 真實資料的**最關鍵步驟**。

在點擊 Import 後，您會進入「Configure Project」(設定專案) 畫面。請依照以下步驟設定：

### 1. 確認框架設定 (Framework Preset)
Vercel 通常會聰明地自動偵測您的架構。請確認：
*   **Framework Preset**: `Vite`
*   **Build Command**: `npm run build` 或 `tsc && vite build` (維持預設即可)
*   **Output Directory**: `dist` (維持預設即可)
*   **Install Command**: `npm install` (維持預設即可)

### 2. 設定環境變數 (Environment Variables)
點擊展開 **「Environment Variables」** 區塊。我們需要將您的 TDX 交通部 API 金鑰設定進去，讓正式上線的網站可以抓取到真實的列車動態。

請依次新增以下變數 (Name / Value)：

| Name (變數名稱) | Value (變數值) | 說明 |
| :--- | :--- | :--- |
| `TDX_CLIENT_ID` | `您的 TDX Client ID` | 從 TDX 官網取得的應用程式 ID。 |
| `TDX_CLIENT_SECRET` | `您的 TDX Client Secret` | 從 TDX 官網取得的應用程式密鑰。 |

**⚠️ 填寫注意事項：**
* **重要更新**：現在已全面升級為 Server-side Proxy 模式，安全性更高。金鑰名稱已由 `VITE_TDX_*` 改為 `TDX_*`。
* 完全不需要輸入雙引號（例如：直接貼入 `1234abcd-xxxx`，**不要**寫成 `"1234abcd-xxxx"`）。
* 確認開頭或結尾沒有多餘的空白字元。
* 填寫完一個後，點擊 **「Add」** 按鈕，然後再填寫下一個。

### 3. 開始部署 (Deploy)
確認環境變數都已 Add 完成後，點擊最下方的藍色 **「Deploy」** 按鈕。

等待大約 1 到 2 分鐘，Vercel 會自動進行依賴安裝與生產環境建置 (Build)...

🎉 **恭喜！** 當您看到滿天紙片飛舞的慶祝畫面，代表您的專案已經成功發布到全球 CDN 上了。您可以點擊縮圖前往專屬的 Vercel 網址，並隨時將網址分享給朋友！

---

## 💡 後續維護與常見問題

### 如何更新網站內容？
Vercel 內建了 CI/CD (持續整合/持續部署)。未來您只需要將修改後的程式碼 **`git push`** 到 GitHub 的 `main` 分支，Vercel 就會自動觸發並部署全新的版本，您完全不需要再進 Vercel 點擊任何按鈕。

### 部署後遇到白畫面或抓不到資料？
這通常是因為環境變數缺少或錯誤。
1. 在 Vercel 專案首頁，前往 **Settings -> Environment Variables**。
2. 檢查 `TDX_CLIENT_ID` 與 `TDX_CLIENT_SECRET` 是否正確設定（是否有大小寫錯誤或多出空白）。
3. 如果修改了環境變數，請記得去 **Deployments** 分頁，找到最新一次的部署紀錄，點擊右側點點點 (`...`) 選擇 **「Redeploy」**，新的環境變數才會生效！
