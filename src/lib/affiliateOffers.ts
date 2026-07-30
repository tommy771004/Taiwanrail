/**
 * affiliateOffers.ts
 * 前端取得 /api/affiliates 的資料（規格 docs/affiliate-integration-spec.md §6）。
 *
 * 每次載入頁面只打一次；跑馬燈與內容版位共用同一份結果，
 * 失敗一律當成「沒有推廣資料」，由版位自行不顯示（§6.4）。
 */

import { useEffect, useState } from 'react';
import { type AffiliateOffer, parseAffiliateOffers } from './affiliates';

let inflight: Promise<AffiliateOffer[]> | null = null;
let cached: AffiliateOffer[] | null = null;

async function fetchOffers(): Promise<AffiliateOffer[]> {
  try {
    const res = await fetch('/api/affiliates', { headers: { Accept: 'application/json' } });
    // 503（未設定 SUP_DATABASE_URL）與 500（查詢失敗）都回空清單，不需分別處理。
    if (!res.ok) return [];
    const body: unknown = await res.json();
    const offers = (body as { offers?: unknown } | null)?.offers;
    return parseAffiliateOffers(offers);
  } catch {
    return [];
  }
}

/**
 * 載入啟用中的推廣資料（跨元件共用同一個 promise）。
 * 空清單也會被快取：這一次載入就是沒有可顯示的推廣內容。
 */
export function loadAffiliateOffers(): Promise<AffiliateOffer[]> {
  if (cached !== null) return Promise.resolve(cached);
  if (inflight === null) {
    inflight = fetchOffers().then((offers) => {
      cached = offers;
      inflight = null;
      return offers;
    });
  }
  return inflight;
}

/** 測試／除錯用：丟掉快取，下次呼叫重新抓。 */
export function resetAffiliateOffersCache(): void {
  cached = null;
  inflight = null;
}

/**
 * 推廣資料的 React hook。
 * 未載入完成前回傳空陣列，版位因此在首次 render／prerender 時不佔位（避免版面跳動）。
 */
export function useAffiliateOffers(): { offers: AffiliateOffer[]; loaded: boolean } {
  const [offers, setOffers] = useState<AffiliateOffer[]>(() => cached ?? []);
  const [loaded, setLoaded] = useState<boolean>(cached !== null);

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
