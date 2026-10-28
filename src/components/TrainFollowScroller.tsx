import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LocateFixed } from 'lucide-react';
import { trainPosition, type PositionStopInput } from '../lib/trainPosition';
import { useTaipeiClock } from '../hooks/useTaipeiClock';

/**
 * 手機版明細的站表捲動區：自動捲到列車所在的那一站（停靠中的站、或行駛中的下一站；
 * 還沒到起站時是起站，過了訖站是訖站）。乘客自己捲動後就不再搶捲軸，
 * 列車那一列不在畫面內時，底部出現「回到列車位置」。
 *
 * 站表的每一列要帶 `data-stop-id={StationID}`；找不到那一列（例如已過站被收合）就不捲。
 * 沒傳 stops（不是今天、或停駛）時只是一般的捲動區。
 */
interface Props {
  className: string;
  stops?: PositionStopInput[];
  originId?: string;
  destId?: string;
  delayMinutes?: number;
  zh: boolean;
  children: React.ReactNode;
}

export default function TrainFollowScroller({ className, stops, originId, destId, delayMinutes = 0, zh, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [offscreen, setOffscreen] = useState(false);
  const autoScrolling = useRef(false);
  const lastTarget = useRef<string | null>(null);

  const active = !!stops?.length && !!originId && !!destId;
  const now = useTaipeiClock(active);
  const pos = active ? trainPosition(stops, originId!, destId!, now, delayMinutes) : null;
  let targetIndex: number | null = null;
  if (pos) {
    if (pos.phase === 'approach') targetIndex = pos.originIndex;
    else if (pos.phase === 'arrived') targetIndex = pos.destIndex;
    else targetIndex = pos.nextIndex ?? pos.index;
  }
  const targetId = pos && targetIndex !== null ? pos.stops[targetIndex].id : null;

  const findRow = useCallback(() => {
    if (!targetId || !ref.current) return null;
    return ref.current.querySelector<HTMLElement>(`[data-stop-id="${CSS.escape(targetId)}"]`);
  }, [targetId]);

  // force = 乘客按了「回到列車位置」；否則那一列還在畫面上半部到四分之三之間就不動，免得站表一直跳
  const scrollToTrain = useCallback((smooth: boolean, force = false) => {
    const el = ref.current, row = findRow();
    if (!el || !row) return;
    const box = el.getBoundingClientRect(), r = row.getBoundingClientRect();
    if (!force && r.top >= box.top && r.bottom <= box.top + el.clientHeight * 0.75) return;
    const top = el.scrollTop + r.top - box.top - el.clientHeight * 0.3;
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    autoScrolling.current = true;
    el.scrollTo({ top: Math.max(0, top), behavior: smooth && !reduced ? 'smooth' : 'auto' });
    window.setTimeout(() => { autoScrolling.current = false; }, 700);
  }, [findRow]);

  const measure = useCallback(() => {
    const el = ref.current, row = findRow();
    if (!el || !row) { setOffscreen(false); return; }
    const box = el.getBoundingClientRect(), r = row.getBoundingClientRect();
    setOffscreen(r.bottom < box.top + 8 || r.top > box.bottom - 8);
  }, [findRow]);

  // 列車換到下一站時跟著捲；第一次（剛打開、停站剛載入）直接跳過去，不做捲動動畫
  useEffect(() => {
    if (!targetId) return;
    const first = lastTarget.current === null;
    if (targetId === lastTarget.current) return;
    lastTarget.current = targetId;
    if (following) requestAnimationFrame(() => scrollToTrain(!first));
  }, [targetId, following, scrollToTrain]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = () => { if (!autoScrolling.current) setFollowing(false); };
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) stop();
    };
    el.addEventListener('wheel', stop, { passive: true });
    el.addEventListener('touchmove', stop, { passive: true });
    el.addEventListener('keydown', onKey);
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      el.removeEventListener('wheel', stop);
      el.removeEventListener('touchmove', stop);
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('scroll', measure);
    };
  }, [measure]);

  useEffect(() => { measure(); }, [measure, now]);

  return (
    <div ref={ref} className={className}>
      {children}
      {targetId && !following && offscreen && (
        <div className="sticky bottom-3 z-30 flex justify-center pointer-events-none">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setFollowing(true); scrollToTrain(true, true); }}
            className="pointer-events-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-[0.78rem] font-extrabold shadow-[0_8px_20px_-8px_rgba(15,23,42,0.6)] active:scale-95 transition-transform"
          >
            <LocateFixed className="w-3.5 h-3.5" />
            {zh ? '回到列車位置' : 'Back to train'}
          </button>
        </div>
      )}
    </div>
  );
}
