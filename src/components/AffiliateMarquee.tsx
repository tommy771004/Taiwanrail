/**
 * AffiliateMarquee.tsx
 * 首頁／搜尋結果下方的推廣跑馬燈 — 規格 docs/affiliate-integration-spec.md §4.3
 *
 * 資料完全來自 /api/affiliates（共用 affiliates 表），前端不寫死商家、文案、
 * 連結、分類與排序（§1.1）。沒有啟用資料或 API 失敗時整個區塊不顯示（§6.4），
 * 下架請用 `enabled = FALSE`（§5.3）—— 不要在這裡加寫死的備援清單，
 * 否則已停用的檔位會繼續曝光。
 *
 * 動畫與 reduced-motion 由 src/index.css 的 .affiliate-marquee-* 規則處理（§8）。
 */

import { ExternalLink } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import {
  AFFILIATE_LINK_REL,
  affiliateDisclosureLabel,
  affiliateDisplayName,
  selectMarqueeOffers,
  type RenderedAffiliateOffer,
} from '../lib/affiliates';
import { useAffiliateOffers } from '../lib/affiliateOffers';
import { trackAffiliateEvent } from '../lib/affiliateTracking';
import { affiliateIcon, affiliateIconTone } from './affiliateVisuals';

const PLACEMENT = 'marquee' as const;

type AffiliateMarqueeProps = {
  language?: string;
};

function PartnerLink({
  offer,
  isZh,
  duplicate = false,
  onImpression,
}: {
  offer: RenderedAffiliateOffer;
  isZh: boolean;
  duplicate?: boolean;
  onImpression?: (node: HTMLAnchorElement | null, offer: RenderedAffiliateOffer) => void;
}) {
  const Icon = affiliateIcon(offer.icon);
  // §4.3：顯示 partner，沒有 partner 時顯示 title。
  const name = affiliateDisplayName(offer);
  const disclosure = affiliateDisclosureLabel(offer, isZh);

  return (
    <a
      ref={duplicate ? undefined : (node) => onImpression?.(node, offer)}
      href={offer.url}
      target="_blank"
      rel={AFFILIATE_LINK_REL}
      tabIndex={duplicate ? -1 : undefined}
      onClick={
        duplicate
          ? undefined
          : () => trackAffiliateEvent({ action: 'affiliate_click', offer: offer.raw, placement: PLACEMENT })
      }
      className="group flex h-[68px] w-[260px] shrink-0 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3.5 text-left shadow-sm transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500 dark:hover:bg-slate-800"
      aria-label={`${name}：${offer.description}（${disclosure}）`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${affiliateIconTone(offer.id)}`}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-slate-900 dark:text-slate-100">
          {name}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          {/* §10：每張卡片都要有「贊助」或「合作推薦」標示。 */}
          <span className="shrink-0 rounded bg-slate-100 px-1 py-px text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {disclosure}
          </span>
          <span className="truncate text-xs text-slate-600 dark:text-slate-400">
            {offer.description}
          </span>
        </span>
      </span>
      <ExternalLink
        className="h-4 w-4 shrink-0 text-slate-400 transition-colors group-hover:text-slate-700 dark:group-hover:text-slate-200"
        aria-hidden="true"
      />
    </a>
  );
}

export default function AffiliateMarquee({ language = 'zh-TW' }: AffiliateMarqueeProps) {
  const isZh = language === 'zh-TW';
  const { offers } = useAffiliateOffers();
  const visible = useMemo(() => selectMarqueeOffers(offers), [offers]);

  // 曝光：卡片進入可視範圍才記一次（§7.1）。複製的那一組不觀察，避免重複。
  const observerRef = useRef<IntersectionObserver | null>(null);
  const trackedNodes = useRef(new WeakMap<Element, RenderedAffiliateOffer>());

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const offer = trackedNodes.current.get(entry.target);
          if (!offer) continue;
          trackAffiliateEvent({ action: 'affiliate_impression', offer: offer.raw, placement: PLACEMENT });
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.5 },
    );
    observerRef.current = observer;
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, []);

  const registerImpression = (node: HTMLAnchorElement | null, offer: RenderedAffiliateOffer) => {
    if (!node) return;
    trackedNodes.current.set(node, offer);
    observerRef.current?.observe(node);
  };

  // §6.4：沒有啟用資料就整塊不顯示（也涵蓋 API 失敗與尚未載入）。
  if (visible.length === 0) return null;

  return (
    <aside
      className="affiliate-marquee mx-4 mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100/80 py-3 dark:border-slate-700 dark:bg-slate-950/60 md:mx-0"
      aria-label={isZh ? '旅程服務合作連結' : 'Sponsored travel services'}
    >
      <div className="mb-3 flex items-center justify-between gap-4 px-4">
        <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
          {isZh ? '旅程服務' : 'Travel services'}
        </p>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          {isZh ? '合作連結' : 'Sponsored links'}
        </span>
      </div>

      <div className="affiliate-marquee-viewport soft-scrollbar overflow-hidden">
        <div className="affiliate-marquee-track">
          <div className="affiliate-marquee-group">
            {visible.map((offer) => (
              <PartnerLink
                key={offer.id}
                offer={offer}
                isZh={isZh}
                onImpression={registerImpression}
              />
            ))}
          </div>
          {/* 無縫接續用的複本；對輔助技術隱藏，也不重複計曝光。 */}
          <div className="affiliate-marquee-group" aria-hidden="true">
            {visible.map((offer) => (
              <PartnerLink key={`duplicate-${offer.id}`} offer={offer} isZh={isZh} duplicate />
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
