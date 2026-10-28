import React from 'react';
import { TrainFront } from 'lucide-react';
import {
  describeTrainPosition,
  formatServiceTime,
  roundUpMinutes,
  scheduleFraction,
  trainPosition,
  type PositionStopInput,
} from '../lib/trainPosition';
import { useTaipeiClock } from '../hooks/useTaipeiClock';

/**
 * 明細頂端的列車位置縮圖：起站到訖站一條水平線，每個停靠站一個刻度（間距依行車時間），
 * 車頭依現在時間停在線上。站表很長時（基隆 → 屏東 24 站），這裡永遠看得到列車在哪。
 * 只在今天的班次出現；推算不出來（缺停站時刻、起訖站不在這班車上）就不畫。
 */
interface Props {
  stops: PositionStopInput[];
  originId: string;
  destId: string;
  delayMinutes: number;
  /** 誤點來自即時資料；否則標「依時刻表推算」 */
  liveDelay: boolean;
  isHsr: boolean;
  zh: boolean;
  className?: string;
}

export default function TrainPositionStrip({ stops, originId, destId, delayMinutes, liveDelay, isHsr, zh, className = '' }: Props) {
  const now = useTaipeiClock(true);
  const pos = trainPosition(stops, originId, destId, now, delayMinutes);
  if (!pos) return null;

  const { stops: s, originIndex: o, destIndex: d, motion, index, phase } = pos;
  const name = (i: number) => (zh ? s[i].zh : s[i].en);
  const tone = isHsr
    ? { box: 'bg-orange-500/10 dark:bg-orange-500/15', text: 'text-orange-700 dark:text-orange-300', solid: 'bg-orange-500 dark:bg-orange-400', soft: 'bg-orange-500/25', tick: 'border-orange-400/60', tickNext: 'border-orange-500 dark:border-orange-400', ring: 'ring-[#FFF8F3] dark:ring-[#4E342E]' }
    : { box: 'bg-blue-500/10 dark:bg-blue-500/15', text: 'text-blue-700 dark:text-blue-300', solid: 'bg-blue-600 dark:bg-blue-400', soft: 'bg-blue-500/25', tick: 'border-blue-400/60', tickNext: 'border-blue-600 dark:border-blue-400', ring: 'ring-slate-50 dark:ring-slate-800' };

  let label: string, place: string, detail: string;
  if (phase === 'arrived') {
    label = zh ? '已抵達' : 'Arrived';
    place = name(d);
    detail = `${formatServiceTime(s[d].arr)}${zh ? ' 到' : ''}`;
  } else if (phase === 'atOrigin') {
    label = zh ? '停靠本站' : 'At your station';
    place = name(o);
    detail = zh ? `${formatServiceTime(s[o].dep)} 開` : `Leaves ${formatServiceTime(s[o].dep)}`;
  } else if (phase === 'approach') {
    label = motion === 'waiting' ? (zh ? '尚未發車' : 'Not yet departed') : (zh ? '列車進站倒數' : 'Approaching');
    place = motion === 'waiting' ? name(0) : name(o);
    detail = describeTrainPosition(pos, now, zh);
  } else if (motion === 'dwell') {
    label = zh ? '停靠中' : 'At station';
    place = name(index);
    detail = zh ? `${formatServiceTime(s[index].dep)} 開` : `Leaves ${formatServiceTime(s[index].dep)}`;
  } else {
    label = zh ? '下一站' : 'Next stop';
    place = name(index + 1);
    const eta = roundUpMinutes(s[index + 1].arr - now);
    detail = zh ? `${formatServiceTime(s[index + 1].arr)} 到 · 約 ${eta} 分` : `Arrives ${formatServiceTime(s[index + 1].arr)} · ~${eta} min`;
  }

  const ticks: number[] = [];
  for (let k = o; k <= d; k++) ticks.push(k);
  const at = index + pos.fraction;
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  const source = liveDelay
    ? (zh ? '依即時誤點推算' : 'Estimated from live delay')
    : (zh ? '依時刻表推算' : 'Estimated from timetable');

  return (
    <div className={`mt-3 rounded-2xl px-3.5 pt-2.5 pb-2 ${tone.box} ${className}`}>
      <div className="flex items-baseline gap-2 flex-wrap min-w-0">
        <span className={`text-[11px] font-black ${tone.text}`}>{label}</span>
        <span className="text-lg font-black tracking-tight text-slate-900 dark:text-white">{place}</span>
        <span className="min-w-0 text-[12px] font-bold tabular-nums text-slate-600 dark:text-slate-300">{detail}</span>
      </div>
      <div className="relative h-[26px] mx-2.5 mt-1" aria-hidden="true">
        <span className={`absolute inset-x-0 top-3 h-[3px] rounded-full ${tone.soft}`} />
        <span
          className={`absolute left-0 top-3 h-[3px] rounded-full transition-[width] duration-1000 ease-out motion-reduce:transition-none ${tone.solid}`}
          style={{ width: pct(pos.progress) }}
        />
        {ticks.map(k => {
          const passed = at > k + 1e-6 && !(motion === 'dwell' && index === k);
          const next = pos.nextIndex === k && k > o;
          return (
            <span
              key={`${s[k].id}-${k}`}
              className={`absolute -translate-x-1/2 rounded-full border-2 ${
                next ? `top-[7px] w-3 h-3 bg-white dark:bg-slate-800 ${tone.tickNext}`
                : passed ? `top-[9px] w-[9px] h-[9px] border-transparent ${tone.solid}`
                : `top-[9px] w-[9px] h-[9px] bg-white dark:bg-slate-800 ${tone.tick}`
              }`}
              style={{ left: pct(scheduleFraction(pos, k)) }}
            />
          );
        })}
        <span
          className={`absolute top-[13.5px] w-[22px] h-[22px] -translate-x-1/2 -translate-y-1/2 rounded-[7px] flex items-center justify-center ring-2 ${tone.ring} transition-[left] duration-1000 ease-out motion-reduce:transition-none ${
            phase === 'approach' ? `bg-white dark:bg-slate-800 border-2 border-current ${tone.text}` : `${tone.solid} text-white dark:text-slate-900`
          }`}
          style={{ left: pct(pos.progress) }}
        >
          <TrainFront className="w-3.5 h-3.5 stroke-[2.5]" />
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 text-[10.5px] font-bold tabular-nums text-slate-500 dark:text-slate-400">
        <span className="truncate">{name(o)} {formatServiceTime(s[o].dep)}</span>
        <span className="shrink-0 opacity-80">{source}</span>
        <span className="truncate text-right">{name(d)} {formatServiceTime(s[d].arr)}</span>
      </div>
    </div>
  );
}
