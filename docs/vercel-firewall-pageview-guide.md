# 阻擋 `/api/log-pageview` 的 Vercel Firewall 設定指南

更新日期：2026-07-16

## 目的與結論

本設定只封鎖舊的 Page View API，不會封鎖首頁、靜態檔案、時刻表搜尋或 `/api/log` Query Log。即使外部程式繼續直接呼叫 `/api/log-pageview`，Vercel WAF 也會先回覆 `403 Forbidden`，不讓請求進入該 Vercel Function。

Vercel 官方目前說明：

- Hobby 方案可以使用 WAF Custom Rules，每個專案最多 3 條。[Vercel WAF limits](https://vercel.com/docs/vercel-firewall/vercel-waf#limits)
- `Deny` 會封鎖請求並停止評估後續規則。[Rule Configuration Reference](https://vercel.com/docs/vercel-firewall/vercel-waf/rule-configuration#actions)
- WAF 位於部署處理之前；只有未被 WAF 封鎖的請求才會交給 deployment 處理。[Firewall concepts](https://vercel.com/docs/vercel-firewall/firewall-concepts#how-vercel-secures-requests)
- WAF deny／challenge／rate-limit 的流量不計 CDN Requests 與 Fast Data Transfer。[Vercel WAF Usage & Pricing](https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing#free-features-usage)

因此，依官方請求處理順序可判斷，被 `Deny` 的請求不會啟動 `/api/log-pageview` Function，也不會使用該 Function 的 CPU。Vercel 的免費流量聲明明列的是 CDN Requests 與 Fast Data Transfer，沒有逐字列出 Function Active CPU；所以仍應依下方方式用實際 Runtime Logs 與 Usage 驗證。

## Dashboard 設定步驟

1. 登入 [Vercel Dashboard](https://vercel.com/dashboard)，進入 `Taiwanrail` 專案。
2. 在專案左側選擇 **Firewall**。
3. 右上角選擇 **⋯ → Configure**。
4. 選擇 **Add New... → Rule**（部分新版介面可能顯示 **+ New Rule**）。
5. 規則名稱填入：`Deny retired pageview endpoint`。
6. 在 **If** 條件設定：
   - Parameter：**Request Path**
   - Operator：**Equals**
   - Value：`/api/log-pageview`
7. 在 **Then** 動作選擇：**Deny**。
8. 選擇 **Save Rule**。
9. 選擇右上角 **Review Changes**，確認後按 **Publish**。

`Request Path` 是完整的 incoming request path，`Equals` 是精確字串比對；兩者均為官方支援的條件。[Rule parameters and operators](https://vercel.com/docs/vercel-firewall/vercel-waf/rule-configuration#parameters)

此處刻意不要加 `Method = POST`，讓任何 HTTP 方法對該廢止端點都被封鎖。也不要改用 **Route**：官方特別註明 Route 條件在 Middleware 之後才執行，可能已產生 Middleware 費用；本需求應直接使用 **Request Path**。[Rule Configuration Reference](https://vercel.com/docs/vercel-firewall/vercel-waf/rule-configuration#parameters)

> Vercel 會逐步更新 Dashboard，因此按鈕可能顯示 `Configure`、`+ New Rule`、`Review Changes` 或近似文字；以上名稱依 2026-01-22 更新的官方操作文件整理。核心設定不變：`Request Path` `Equals` `/api/log-pageview` → `Deny`。[WAF Custom Rules](https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules#get-started)

## 規則順序

Vercel 的整體執行順序是 DDoS mitigation → IP blocking → Custom Rules → Managed Rulesets；多條 Custom Rule 可自行調整先後。[Vercel Firewall rule execution order](https://vercel.com/docs/vercel-firewall#rule-execution-order)

請把這條 `Deny retired pageview endpoint` 放在其他 Custom Rule 的 **Bypass** 規則之前，最好放在 Custom Rules 最上方。原因是：

- `Deny` 命中後會立即停止，不再評估後續規則。
- `Bypass` 命中後會略過其後的 Custom／Managed Rules；若 Bypass 排在前面，可能讓 Page View 請求穿過 Deny。[Rule actions](https://vercel.com/docs/vercel-firewall/vercel-waf/rule-configuration#actions)

Hobby 不提供 Pro／Enterprise 的 Persistent Actions，但此處不需要：精確路徑規則會逐次封鎖每一個 `/api/log-pageview` 請求，不必封鎖該 IP 的其他正常請求。[WAF Custom Rules — Persistent actions](https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules#persistent-actions)

## 驗證方法

### 1. 手動確認 403

規則 Publish 後執行：

```bash
curl -i -X POST 'https://taiwanrail.vercel.app/api/log-pageview' \
  -H 'content-type: application/json' \
  --data '{}'
```

預期回應為 `HTTP ... 403`。首頁 `https://taiwanrail.vercel.app/` 與正常搜尋仍應可用。

### 2. 在 Firewall 確認命中

進入 **Project → Firewall**：

1. 將時間範圍切到 **Live 10 minutes**。
2. 在 Traffic／Overview 以規則 `Deny retired pageview endpoint` 或 action `Deny` 篩選。
3. 也可以用 **Request Paths** 分組，確認 `/api/log-pageview` 有 Denied 事件。

Firewall 頁面支援依 rule、action 與 Request Paths 觀察流量。[Firewall Observability](https://vercel.com/docs/vercel-firewall/firewall-observability#traffic)

### 3. 在 Runtime Logs 確認 Function 沒被呼叫

進入 **Project → Logs**，開啟 Live mode，設定：

- Request Path：`/api/log-pageview`
- Resource：**Vercel Functions**
- Request Method：`POST`

再次執行上面的 `curl`。正確結果是 Firewall 看得到 Deny，但 Runtime Logs 不應新增 `/api/log-pageview` 的 Function invocation。Runtime Logs 記錄 Function invocation，並可依 Request Path、Resource、Method 過濾；Hobby 保留時間為 1 小時。[Runtime Logs](https://vercel.com/docs/logs/runtime)

### 4. 在 Usage／Observability 確認 CPU 與 invocation 趨勢

1. 先記下規則啟用時間（台灣時間與 Vercel Logs 顯示的 UTC 要換算；台灣時間為 UTC+8）。
2. 進入 **Project → Observability → Vercel Functions**。
3. 比較啟用前後 `/api/log-pageview` 的 invocations 與 Active CPU；規則後該 route 應停止增加。
4. 再到 Team／Account 的 **Usage** 檢查 Function Active CPU 與 invocation 總量是否趨緩。

Observability 適用所有方案，Vercel Functions 視圖可查看各 Function 的使用與效能資料。[Observability](https://vercel.com/docs/observability#using-observability)；Function 指標的官方入口也是 **Observability → Vercel Functions**。[Vercel Functions metrics](https://vercel.com/docs/functions#viewing-vercel-function-metrics)

Usage 與圖表可能不是即時結算，所以不要只看總量；應以規則 Publish 的時間為界，比對 route 趨勢，並以 Live Runtime Logs 做立即驗證。

## 回復方式

若誤封鎖，可到 **Firewall → Configure** 停用或刪除該規則，再 **Review Changes → Publish**。Custom Rule 的儲存、停用與刪除會立即生效且不需重新部署；Firewall 也可從 Audit Log 回復先前設定。[WAF Custom Rules](https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules#custom-rule-configuration)、[Instant rollback](https://vercel.com/docs/vercel-firewall/vercel-waf#instant-rollback)
