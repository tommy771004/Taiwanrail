/**
 * AffiliateSlot.tsx
 * 內容版位的推廣卡片 — 規格 docs/affiliate-integration-spec.md §4.2
 *
 * 與跑馬燈（§4.3）的差別：這裡會套用版位脈絡。
 *   - `category` → affiliates.categories（本專案字彙：train / hsr / metro / planner / all）
 *   - `keyword`  → affiliates.crops 的「包含」比對，同時作為 `{crop}` 套版值
 *     （搜尋結果版位帶目的地站名，例如「花蓮」→ 住宿類檔位可用 `{crop}住宿`）
 *
 * 排序：crops 命中優先 → priority DESC → id ASC，由 selectContextOffers 實作。
 * 沒有符合的資料就整塊不顯示（§6.4）。
 */

import { ArrowUpRight } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import {
  AFFILIATE_LINK_REL,
  affiliateDisclosureLabel,
  selectContextOffers,
  type RenderedAffiliateOffer,
} from '../lib/affiliates';
import { useAffiliateOffers } from '../lib/affiliateOffers';
import { trackAffiliateEvent, type AffiliatePlacement } from '../lib/affiliateTracking';
import { affiliateIcon, affiliateIconTone } from './affiliateVisuals';

type AffiliateSlotProps = {
  /** affiliates.categories 的比對值，例如 `train`、`hsr`、`metro`、`planner`。 */
  category: string;
  /** crops 比對與 `{crop}` 套版用的關鍵字（結果頁傳目的地站名）。 */
  keyword?: string | null;
  language?: string;
  /** 最多顯示幾張卡片。 */
  limit?: number;
  placement?: AffiliatePlacement;
  className?: string;
};

export default function AffiliateSlot({
  category,
  keyword = null,
  language = 'zh-TW',
  limit = 2,
  placement = 'results',
  className = '',
}: AffiliateSlotProps) {
  const isZh = language === 'zh-TW';
  const { offers } = useAffiliateOffers();

  const visible = useMemo(
    () => selectContextOffers(offers, { category, keyword, limit }),
    [offers, category, keyword, limit],
  );

  // 曝光：進入可視範圍才記一次，metadata 帶 crop（§7.1）。
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
          trackAffiliateEvent({
            action: 'affiliate_impression',
            offer: offer.raw,
            placement,
            crop: keyword,
          });
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
    // keyword 改變代表換了脈絡，曝光要重新計算。
  }, [placement, keyword]);

  const registerImpression = (node: HTMLAnchorElement | null, offer: RenderedAffiliateOffer) => {
    if (!node) return;
    trackedNodes.current.set(node, offer);
    observerRef.current?.observe(node);
  };

  if (visible.length === 0) return null;

  return (
    <aside
      className={`mx-4 mt-8 rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-900/50 md:mx-0 ${className}`}
      aria-label={isZh ? '旅程服務合作推薦' : 'Recommended travel services'}
    >
      <div className="mb-3 flex items-center justify-between gap-4">
        <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
          {isZh ? '行程準備' : 'Plan your trip'}
        </p>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          {isZh ? '合作連結' : 'Sponsored links'}
        </span>
      </div>

      <ul className="grid gap-3 md:grid-cols-2">
        {visible.map((offer) => {
          const Icon = affiliateIcon(offer.icon);
          const disclosure = affiliateDisclosureLabel(offer, isZh);
          return (
            <li key={offer.id}>
              <a
                ref={(node) => registerImpression(node, offer)}
                href={offer.url}
                target="_blank"
                rel={AFFILIATE_LINK_REL}
                onClick={() =>
                  trackAffiliateEvent({
                    action: 'affiliate_click',
                    offer: offer.raw,
                    placement,
                    crop: keyword,
                  })
                }
                className="group flex h-full items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500 dark:hover:bg-slate-800"
              >
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${affiliateIconTone(offer.id)}`}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">
                      {offer.title}
                    </span>
                    {/* §10：推廣內容必須標示「贊助」或「合作推薦」。 */}
                    <span className="shrink-0 rounded bg-slate-100 px-1 py-px text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {disclosure}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    {offer.description}
                  </span>
                  <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 group-hover:underline dark:text-blue-300">
                    {offer.ctaLabel}
                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  {/* §7.1 / §10：揭露實際合作商家。 */}
                  {offer.partner && offer.partner !== offer.title && (
                    <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-500">
                      {isZh ? '合作夥伴：' : 'Partner: '}
                      {offer.partner}
                    </span>
                  )}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
