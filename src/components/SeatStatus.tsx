import React from 'react';
import type { SeatLevel, TrainSeatStatus } from '../lib/thsrSeats';

/**
 * 高鐵對號座剩餘座位的文字標示。顏色只是輔助，一定配文字（有位／有限／售完），
 * 沒有讀數的艙等不顯示，不猜。
 */
const LEVEL_CLASS: Record<SeatLevel, string> = {
  available: 'text-emerald-600 dark:text-emerald-400',
  limited: 'text-amber-600 dark:text-amber-400',
  full: 'text-red-600 dark:text-red-400',
};

export function seatLevelLabel(level: SeatLevel, zh: boolean): string {
  if (level === 'available') return zh ? '有位' : 'Available';
  if (level === 'limited') return zh ? '有限' : 'Limited';
  return zh ? '售完' : 'Sold out';
}

export const SeatLevelText: React.FC<{ level: SeatLevel; zh: boolean }> = ({ level, zh }) => (
  <span className={`inline-flex items-center gap-1 font-extrabold ${LEVEL_CLASS[level]}`}>
    <span className="w-[6px] h-[6px] rounded-full bg-current" aria-hidden="true" />
    {seatLevelLabel(level, zh)}
  </span>
);

/** 票券主體下方的一行：「座位 標準 ●有位　商務 ●售完」 */
export const SeatStatusRow: React.FC<{ seats: TrainSeatStatus; zh: boolean }> = ({ seats, zh }) => {
  const classes = ([
    ['standard', zh ? '標準' : 'Standard'],
    ['business', zh ? '商務' : 'Business'],
  ] as const).filter(([key]) => seats[key]);
  if (classes.length === 0) return null;
  return (
    <div className="flex items-center gap-3 mt-1.5 text-[0.7rem] font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">
      <span className="text-[0.62rem] tracking-[0.08em] font-bold text-slate-400 dark:text-slate-500">{zh ? '對號座' : 'Reserved'}</span>
      {classes.map(([key, label]) => (
        <span key={key} className="inline-flex items-center gap-1">
          {label}
          <SeatLevelText level={seats[key]!} zh={zh} />
        </span>
      ))}
    </div>
  );
};
