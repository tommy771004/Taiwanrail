/**
 * affiliateTracking.ts
 * 推廣檔位的曝光／點擊追蹤（fire-and-forget）— 規格 docs/affiliate-integration-spec.md §7
 *
 * 全部非阻塞：任何失敗都靜默吞掉，絕不影響時刻表查詢或版位顯示。
 * 事件送到 /api/affiliate-event，寫入本專案主資料庫的 Rail_Audit_log。
 */

import type { AffiliateAction, AffiliateOffer } from './affiliates';
import { getSessionId } from './sessionId';

/** 版位識別；點擊統計靠這個區分來源（§10）。 */
export type AffiliatePlacement = 'marquee' | 'results';

export interface AffiliateEventInput {
  action: AffiliateAction;
  /** 必須是**未套版**的原始檔位：target 要用穩定的 affiliates.id（§7.2）。 */
  offer: AffiliateOffer;
  placement: AffiliatePlacement;
  /** 內容版位的套版關鍵字；跑馬燈不帶（§7.1）。 */
  crop?: string | null;
}

interface QueuedEvent {
  action: AffiliateAction;
  target: string;
  metadata: {
    project_name: string;
    placement: string;
    sponsored: boolean;
    partner: string | null;
    crop: string | null;
  };
}

/** 曝光只算第一次；卡片在跑馬燈裡反覆進出視窗不重複計數。 */
const seenImpressions = new Set<string>();

const queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let listenersBound = false;

/** 與 api/affiliate-event.ts 的 MAX_EVENTS_PER_REQUEST 對齊。 */
const MAX_BATCH = 24;
/** 曝光合併視窗：一次捲動通常會露出多張卡片，合成一個請求送出。 */
const FLUSH_DELAY_MS = 1200;

function send(events: QueuedEvent[]): void {
  if (events.length === 0) return;
  try {
    fetch('/api/affiliate-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: getSessionId(), events }),
      // 點擊後頁面常會馬上跳走，keepalive 確保請求仍送出。
      keepalive: true,
    }).catch(() => { /* 靜默忽略 */ });
  } catch {
    /* 靜默忽略 */
  }
}

function flush(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  while (queue.length > 0) {
    send(queue.splice(0, MAX_BATCH));
  }
}

function bindFlushListeners(): void {
  if (listenersBound || typeof window === 'undefined') return;
  listenersBound = true;
  // 使用者離開頁面前把還沒送出的曝光補送。
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

/**
 * 記錄一筆推廣事件。
 * - `affiliate_impression`：同一個 (版位, 檔位, 關鍵字) 每次載入只記一次，延遲合併送出。
 * - `affiliate_click`：立即送出，不等合併視窗。
 */
export function trackAffiliateEvent({ action, offer, placement, crop = null }: AffiliateEventInput): void {
  if (typeof window === 'undefined') return; // SSR / prerender guard

  const key = `${action}:${placement}:${offer.projectName}:${offer.id}:${crop ?? ''}`;
  if (action === 'affiliate_impression') {
    if (seenImpressions.has(key)) return;
    seenImpressions.add(key);
  }

  queue.push({
    action,
    target: offer.id,
    metadata: {
      project_name: offer.projectName,
      placement,
      sponsored: offer.sponsored,
      partner: offer.partner,
      crop,
    },
  });

  bindFlushListeners();

  if (action === 'affiliate_click' || queue.length >= MAX_BATCH) {
    flush();
    return;
  }
  if (flushTimer === null) {
    flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
  }
}

/** 測試／除錯用：清掉曝光去重狀態與待送佇列。 */
export function resetAffiliateTracking(): void {
  seenImpressions.clear();
  queue.length = 0;
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}
