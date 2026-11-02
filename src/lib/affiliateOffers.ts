/**
 * affiliateOffers.ts
 * 前端取得 /api/affiliates 的資料（規格 docs/affiliate-integration-spec.md §6）。
 *
 * 每個分頁 session 只打一次：結果存在 sessionStorage（affiliateOfferCache.ts），
 * 重新整理直接沿用，分頁關閉或滿 12 小時才重抓。跑馬燈與內容版位共用同一份結果，
 * 失敗一律當成「沒有推廣資料」，由版位自行不顯示（§6.4），且失敗不寫入快取。
 */

import { useEffect, useState } from 'react';
import { type AffiliateOffer, parseAffiliateOffers } from './affiliates';
import {
  AFFILIATE_SESSION_KEY,
  type OfferStorage,
  readCachedOffers,
  writeCachedOffers,
} from './affiliateOfferCache';

let inflight: Promise<AffiliateOffer[]> | null = null;
let cached: AffiliateOffer[] | null = null;

function sessionStore(): OfferStorage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null; // 部分瀏覽器停用 storage 時連存取屬性都會丟錯
  }
}

/** 記憶體 → sessionStorage；兩者都沒有回傳 null。 */
function peekOffers(): AffiliateOffer[] | null {
  if (cached === null) cached = readCachedOffers(sessionStore(), Date.now());
  return cached;
}

async function fetchOffers(): Promise<{ ok: boolean; offers: AffiliateOffer[] }> {
  try {
    const res = await fetch('/api/affiliates', { headers: { Accept: 'application/json' } });
    // 503（未設定 SUP_DATABASE_URL）與 500（查詢失敗）都回空清單，不需分別處理。
    if (!res.ok) return { ok: false, offers: [] };
    const body: unknown = await res.json();
    const offers = (body as { offers?: unknown } | null)?.offers;
    return { ok: true, offers: parseAffiliateOffers(offers) };
  } catch {
    return { ok: false, offers: [] };
  }
}

/**
 * 載入啟用中的推廣資料（跨元件共用同一個 promise）。
 * 成功的結果（含空清單）在記憶體與 sessionStorage 都快取；失敗只在本次載入內
 * 當成空清單，下次載入頁面會重試。
 */
export function loadAffiliateOffers(): Promise<AffiliateOffer[]> {
  const hit = peekOffers();
  if (hit !== null) return Promise.resolve(hit);
  if (inflight === null) {
    inflight = fetchOffers().then(({ ok, offers }) => {
      cached = offers;
      inflight = null;
      if (ok) writeCachedOffers(sessionStore(), offers, Date.now());
      return offers;
    });
  }
  return inflight;
}

/** 測試／除錯用：丟掉快取（含 sessionStorage），下次呼叫重新抓。 */
export function resetAffiliateOffersCache(): void {
  cached = null;
  inflight = null;
  try {
    sessionStore()?.removeItem(AFFILIATE_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * 推廣資料的 React hook。
 * 有 session 快取時第一次 render 就有資料（重新整理不跳版）；否則未載入完成前回傳
 * 空陣列，版位因此在首次 render／prerender 時不佔位（避免版面跳動）。
 */
export function useAffiliateOffers(): { offers: AffiliateOffer[]; loaded: boolean } {
  const [offers, setOffers] = useState<AffiliateOffer[]>(() => peekOffers() ?? []);
  const [loaded, setLoaded] = useState<boolean>(() => cached !== null);

  useEffect(() => {
    if (cached !== null) {
      setOffers(cached);
      setLoaded(true);
      return;
    }
    let active = true;
    void loadAffiliateOffers().then((next) => {
      if (!active) return;
      setOffers(next);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  return { offers, loaded };
}
