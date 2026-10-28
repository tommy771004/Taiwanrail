import { useEffect, useState } from 'react';
import { taipeiNowMinutes } from '../lib/trainPosition';

// 所有車頭共用一個 15 秒計時器：列表上每張票券各開一個 interval 太浪費，
// 也讓同一畫面上的車頭同時移動。分頁在背景時不重算，回到前景立刻補一次。
const TICK_MS = 15_000;
const listeners = new Set<(now: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function emit() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  const now = taipeiNowMinutes();
  listeners.forEach(fn => fn(now));
}

function onVisible() {
  if (document.visibilityState === 'visible') emit();
}

function subscribe(fn: (now: number) => void) {
  listeners.add(fn);
  if (!timer) {
    timer = setInterval(emit, TICK_MS);
    document.addEventListener('visibilitychange', onVisible);
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
      document.removeEventListener('visibilitychange', onVisible);
    }
  };
}

/** 台北現在時間（分鐘，含秒的小數，凌晨 0~3 點為 24~27 點）；enabled 為 false 時不計時。 */
export function useTaipeiClock(enabled = true): number {
  const [now, setNow] = useState(() => taipeiNowMinutes());
  useEffect(() => {
    if (!enabled) return;
    setNow(taipeiNowMinutes());
    return subscribe(setNow);
  }, [enabled]);
  return now;
}
