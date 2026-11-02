/**
 * affiliateOfferCache.ts
 * 推廣資料的分頁 session 快取（純邏輯；storage 由呼叫端注入，不碰 DOM 全域）。
 *
 * 同一個分頁第一次開啟時抓 /api/affiliates，之後重新整理都讀 sessionStorage，
 * 直到分頁關閉或超過 AFFILIATE_SESSION_TTL_MS 才重抓。上限是為了讓
 * `enabled = FALSE` 的下架在開著很久的分頁也會生效。
 *
 * 只有 HTTP 200 的結果會寫入（空清單也算）；503／500／網路錯誤不寫，
 * 否則一次短暫錯誤會讓整個 session 都看不到推廣。
 */

import { type AffiliateOffer, parseAffiliateOffers } from './affiliates';

export const AFFILIATE_SESSION_KEY = '_rl_aff_v1';
/** 與 api/affiliates.ts 的 CDN s-maxage 相同：12 小時。 */
export const AFFILIATE_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const VERSION = 1;

/** sessionStorage 需要的最小介面，方便測試注入。 */
export interface OfferStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * 讀取快取。過期、版本不符、JSON 損毀、時間在未來（時鐘被調過）都當成沒有快取。
 * storage 使用者改得到，所以內容一律重跑 parseAffiliateOffers（含 `<`/`>` 過濾）。
 */
export function readCachedOffers(
  storage: OfferStorage | null,
  now: number,
  ttlMs: number = AFFILIATE_SESSION_TTL_MS,
): AffiliateOffer[] | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(AFFILIATE_SESSION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let entry: unknown;
  try {
    entry = JSON.parse(raw);
  } catch {
    safeRemove(storage);
    return null;
  }
  const e = entry as { v?: unknown; fetchedAt?: unknown; offers?: unknown } | null;
  const fetchedAt = typeof e?.fetchedAt === 'number' ? e.fetchedAt : NaN;
  const fresh =
    e?.v === VERSION &&
    Array.isArray(e.offers) &&
    Number.isFinite(fetchedAt) &&
    fetchedAt <= now &&
    now - fetchedAt < ttlMs;
  if (!fresh) {
    safeRemove(storage);
    return null;
  }
  return parseAffiliateOffers(e!.offers);
}

/** 寫入快取；storage 滿了或被停用時靜默略過。 */
export function writeCachedOffers(
  storage: OfferStorage | null,
  offers: AffiliateOffer[],
  now: number,
): void {
  if (!storage) return;
  try {
    storage.setItem(AFFILIATE_SESSION_KEY, JSON.stringify({ v: VERSION, fetchedAt: now, offers }));
  } catch {
    /* quota / private mode — 只是少了快取 */
  }
}

function safeRemove(storage: OfferStorage): void {
  try {
    storage.removeItem(AFFILIATE_SESSION_KEY);
  } catch {
    /* ignore */
  }
}
