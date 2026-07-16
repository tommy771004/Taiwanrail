# Shared TDX gateway 實作清單

只有通過自動化測試與必要整合檢查的項目才標記為 `[X]`。

## 01. 公開契約與端點修正

- [X] Gateway 以 raw path/query 接收請求，回傳 status/body/headers
- [X] OData `$` query 原樣送往 TDX
- [X] TRA Alert 修正為 v3 endpoint
- [X] TRA LiveBoard 修正為 v2 endpoint（集合與 station）
- [X] Bus Station/NearBy 修正為 advanced tier
- [X] Alert 的 404、429、5xx 與 transport exception 降級為 `200 []`
- [X] Alert 無效 JSON/content 降級為 `200 []`

## 02. 快取與 booking 規則

- [X] Cache key 與 outbound raw query 分離，query key 排序正規化
- [X] 成功的新鮮回應標記 `X-Cache: MISS`
- [X] Fresh cache hit 標記 `X-Cache: HIT`
- [X] 依 endpoint 分類套用 production TTL
- [X] Booking request 不進 response cache
- [X] Booking request 不共用 in-flight response
- [X] Booking response 標記 `Cache-Control: no-store`

## 03. 韌性與並行去重

- [X] 相同 cache key 的並行請求只執行一次 upstream operation
- [X] 過期 cache 保留為 stale candidate
- [X] Upstream 429 有 stale 時回 `X-Cache: STALE`
- [X] Upstream 5xx 有 stale 時回 `X-Cache: STALE`
- [X] Token 暫時不可用且有 stale 時回 `X-Cache: STALE`
- [X] 無 fallback 時保留 upstream status/body

## 04. TDX 認證

- [X] Trim server-side credentials，且不暴露 credential value
- [X] 有效 token 在到期前重用
- [X] 並行冷啟動只執行一次 token operation
- [X] Token 失敗使用 production retry/backoff policy
- [X] 缺少 credentials 且無 fallback 時回 `503` 與 `Retry-After`
- [X] 認證失敗且無 fallback 時回 `503` 與 `Retry-After`

## 05. Vercel adapter

- [X] `api/proxy.ts` 僅保留 origin 與 request/response translation
- [X] Vercel adapter 使用 shared gateway，不保留獨立 token/cache/rewrite/fallback policy
- [X] 原始 query string 能由 Vercel request 傳入 shared gateway

## 06. Express adapter 與 LiveBoard polling

- [X] Express `/api/tdx/*` 僅保留 request/response translation
- [X] Express adapter 使用 shared gateway，不保留獨立 token/cache/rewrite/fallback policy
- [X] Socket.IO LiveBoard polling 使用 shared gateway
- [X] Local 與 Vercel 的 missing-credential/status/header 行為一致

## 07. 回歸驗證

- [X] Focused gateway suite 全綠
- [X] `npm run lint` 全綠
- [X] `npm run test:data-integrity` 全綠
- [X] `npm run verify:data` 全綠
- [X] `git diff --check` 全綠
- [X] Static-data-first 與 browser-facing getter interfaces 未改變
