import React from 'react';
import { Heart, CalendarPlus, Share2, ChevronRight, Accessibility, Bike } from 'lucide-react';

/**
 * 票券式班次卡。手機版是「主體 + 票根」兩欄，桌面版（md+）在中間多一欄摘要。
 * 只負責畫，所有動作都由 App 傳進來；點擊票券主體 → onExpand，票根上的按鈕各自 stopPropagation。
 *
 * 配色沿用 App 的 getTrainColor 三組：
 *   orange = 自強／莒光  #d85e01 / #feebd6
 *   red    = 普悠瑪／太魯閣／高鐵  #cb171d / #ffebeb
 *   blue   = 區間  #1b5cb7 / #e0efff
 */
export type TicketColor = 'red' | 'orange' | 'blue';
export type TicketStatus = 'on-time' | 'delayed' | 'unknown';

export interface TrainTicketProps {
  trainId: string;
  /** HH:mm 表定出發 */
  dep: string;
  /** HH:mm 表定抵達 */
  arr: string;
  /** "1h42" / "48m" 之類已格式化的歷時 */
  durationLabel: string;
  typeName: string;
  color: TicketColor;
  transportType: 'train' | 'hsr';
  language: string;

  status: TicketStatus;
  delayMinutes?: number;
  isCancelled?: boolean;
  cancelNote?: string;
  /** 已發車（今天且表定時間已過） */
  isPast?: boolean;
  /** 今天且 0 < 剩餘分鐘 <= 30 時傳入，顯示「N 分鐘後發車」條 */
  minutesLeft?: number | null;
  /** 訂票鈕實心（true）或空心（false） */
  bookPrimary?: boolean;

  /** 中途停靠站數；undefined 時只顯示「停靠站」 */
  stopCount?: number;
  /** 「經停 N 站」入口的箭頭要不要閃 */
  pulseHint?: boolean;
  /** 只在「最便宜」排序時傳入，票根會多一行票價 */
  fareLabel?: string | null;

  tripLine?: number;
  isOvernight?: boolean;
  wheelchair?: boolean;
  bike?: boolean;
  /** 桌面版中欄用：起訖站 */
  startEndLabel?: string;
  /** 桌面版中欄右側：可放 ReliabilityBadge */
  midExtra?: React.ReactNode;
  /** 高鐵用：直達／各站停標籤文字（取代車種徽章） */
  hsrKindLabel?: string | null;
  hsrDirect?: boolean;

  isFavorite: boolean;
  isExpanded?: boolean;
  onExpand: () => void;
  onToggleFavorite: (e: React.MouseEvent) => void;
  onCalendar: (e: React.MouseEvent) => void;
  onShare: (e: React.MouseEvent) => void;
  onBook: (e: React.MouseEvent) => void;
  /** 長按等額外事件（PlatformMode） */
  extraHandlers?: React.HTMLAttributes<HTMLDivElement>;
}

const RAIL: Record<TicketColor, string> = {
  orange: 'bg-[#d85e01] dark:bg-orange-300',
  red: 'bg-[#cb171d] dark:bg-red-300',
  blue: 'bg-[#1b5cb7] dark:bg-blue-300',
};
const BADGE: Record<TicketColor, string> = {
  orange: 'bg-[#feebd6] text-[#d85e01] dark:bg-orange-500/15 dark:text-orange-300',
  red: 'bg-[#ffebeb] text-[#cb171d] dark:bg-red-500/15 dark:text-red-300',
  blue: 'bg-[#e0efff] text-[#1b5cb7] dark:bg-blue-500/15 dark:text-blue-300',
};

const TrainTicket: React.FC<TrainTicketProps> = ({
  trainId, dep, arr, durationLabel, typeName, color, transportType, language,
  status, delayMinutes = 0, isCancelled = false, cancelNote, isPast = false, minutesLeft = null, bookPrimary = true,
  stopCount, pulseHint = false, fareLabel = null,
  tripLine, isOvernight, wheelchair, bike, startEndLabel, midExtra, hsrKindLabel, hsrDirect,
  isFavorite, isExpanded = false,
  onExpand, onToggleFavorite, onCalendar, onShare, onBook, extraHandlers,
}) => {
  const zh = language === 'zh-TW';
  const isSoon = !isCancelled && minutesLeft !== null && minutesLeft > 0 && minutesLeft <= 30;
  const isLate = !isCancelled && status === 'delayed' && delayMinutes > 0;

  const predictedDep = (() => {
    if (!isLate) return dep;
    const [h, m] = dep.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return dep;
    const total = (h * 60 + m + delayMinutes) % (24 * 60);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  })();

  const depClass = isCancelled
    ? 'text-slate-400 dark:text-slate-500 line-through'
    : isSoon ? 'text-emerald-600 dark:text-emerald-400'
    : isLate ? 'text-red-600 dark:text-red-400'
    : isExpanded ? 'text-blue-600 dark:text-blue-400'
    : 'text-slate-900 dark:text-slate-100';

  // 票根兩端的撕口要填頁面底色（root 的 blue-50/50 或 orange-50/50，深色 #050f1a / #1a1205）
  const notchBg = transportType === 'hsr'
    ? 'bg-[#fffbf6] dark:bg-[#1a1205]'
    : 'bg-[#f7faff] dark:bg-[#050f1a]';

  const stopsLabel = stopCount === undefined
    ? (zh ? '停靠站' : 'Stops')
    : zh ? `經停 ${stopCount} 站` : `${stopCount} stop${stopCount === 1 ? '' : 's'}`;

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const iconBtn = 'w-[26px] h-6 inline-flex items-center justify-center text-slate-500 dark:text-slate-400 transition-colors hover:text-slate-900 dark:hover:text-white';

  return (
    <div
      id={`train-card-${trainId}`}
      role={isCancelled ? undefined : 'button'}
      tabIndex={isCancelled ? -1 : 0}
      onClick={isCancelled ? undefined : onExpand}
      onKeyDown={isCancelled ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onExpand(); } }}
      {...(isCancelled ? {} : extraHandlers)}
      className={`group relative grid grid-cols-[minmax(0,1fr)_92px] md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_168px] mx-3 sm:mx-0 rounded-[18px] overflow-hidden border transition-colors duration-200 select-none ${
        isExpanded ? 'md:rounded-b-none' : ''
      } ${
        isCancelled
          ? 'bg-white/70 dark:bg-slate-800/60 border-slate-200/60 dark:border-slate-700/60 opacity-60 cursor-not-allowed'
          : `bg-white dark:bg-slate-800 border-slate-200/80 dark:border-slate-700 shadow-[0_6px_24px_-14px_rgba(15,23,42,0.14)] cursor-pointer active:bg-[#F8F9FA] dark:active:bg-slate-700 md:hover:border-blue-400/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${isPast ? 'opacity-60' : ''}`
      }`}
    >
      {/* 左側車種色條 */}
      <div className={`absolute left-0 top-0 bottom-0 w-[5px] ${isCancelled ? 'bg-slate-300 dark:bg-slate-600' : RAIL[color]}`} aria-hidden="true" />

      {/* ── 主體 ── */}
      <div className="min-w-0 pl-[18px] pr-3 py-3">
        {isSoon && (
          <div className="flex items-center gap-2.5 mb-2 text-[0.7rem] font-extrabold text-emerald-600 dark:text-emerald-400">
            <span className="whitespace-nowrap">{zh ? `${minutesLeft} 分鐘後發車` : `Departs in ${minutesLeft} min`}</span>
            <span className="flex-1 h-[3px] rounded-full bg-emerald-100 dark:bg-emerald-500/15 overflow-hidden">
              <span
                className="block h-full rounded-full bg-emerald-500 dark:bg-emerald-400 transition-[width] duration-1000"
                style={{ width: `${Math.max(6, Math.round((1 - (minutesLeft as number) / 30) * 100))}%` }}
              />
            </span>
          </div>
        )}

        <div className="flex items-baseline gap-2">
          <span className={`text-[2.1rem] font-extrabold tracking-[-0.045em] leading-none tabular-nums ${depClass}`}>
            {predictedDep}
          </span>
          {isLate && (
            <span className="text-[0.7rem] text-slate-500 dark:text-slate-400 line-through tabular-nums" aria-label={zh ? '表定時間' : 'Scheduled'}>
              {dep}
            </span>
          )}
          <span className="flex-1 min-w-[40px] flex items-center gap-1.5 px-0.5 text-[0.7rem] font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap">
            <span className="flex-1 h-px bg-slate-300 dark:bg-slate-600" />
            {durationLabel}
            <span className="flex-1 h-px bg-slate-300 dark:bg-slate-600" />
          </span>
          <span className={`text-[1.2rem] font-bold tracking-tight tabular-nums ${isCancelled ? 'text-slate-400 dark:text-slate-500 line-through' : 'text-slate-700 dark:text-slate-300'}`}>
            {arr}
          </span>
        </div>

        <div className="flex items-center gap-1.5 mt-2 text-[0.74rem] font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap min-w-0">
          {transportType === 'hsr' && hsrKindLabel ? (
            <span className={`shrink-0 inline-flex px-1.5 py-0.5 rounded-md text-[0.68rem] font-extrabold ${
              hsrDirect ? BADGE.red : 'bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400'
            }`}>{hsrKindLabel}</span>
          ) : (
            <span className={`min-w-0 truncate inline-block px-1.5 py-0.5 rounded-md text-[0.68rem] font-extrabold ${isCancelled ? 'bg-slate-200 text-slate-400 dark:bg-slate-700 dark:text-slate-500' : BADGE[color]}`} title={typeName}>
              {typeName}
            </span>
          )}
          <span className="shrink-0 font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">{trainId}</span>
          {transportType === 'train' && tripLine === 1 && (
            <span className="shrink-0 px-1.5 rounded text-[0.66rem] font-extrabold bg-[#fef4cc] text-[#af7001] dark:bg-yellow-500/15 dark:text-yellow-200">山線</span>
          )}
          {transportType === 'train' && tripLine === 2 && (
            <span className="shrink-0 px-1.5 rounded text-[0.66rem] font-extrabold bg-[#e5ffff] text-[#017a86] dark:bg-teal-500/15 dark:text-teal-200">海線</span>
          )}
          {isOvernight && (
            <span className="shrink-0 px-1.5 rounded text-[0.66rem] font-extrabold bg-[#e0e4ff] text-[#2b388f] dark:bg-indigo-500/15 dark:text-indigo-200">跨夜</span>
          )}
          {isCancelled ? (
            cancelNote ? <span className="min-w-0 truncate">{cancelNote}</span> : null
          ) : status === 'on-time' ? (
            <span className="shrink-0 inline-flex items-center gap-1 font-extrabold text-emerald-600 dark:text-emerald-400">
              <span className="w-[7px] h-[7px] rounded-full bg-current" />{zh ? '準點' : 'On time'}
            </span>
          ) : isLate ? (
            <span className="shrink-0 inline-flex items-center gap-1 font-extrabold text-red-600 dark:text-red-400">
              <span className="w-[7px] h-[7px] rounded-full bg-current" />{zh ? `誤點 ${delayMinutes} 分` : `${delayMinutes} min late`}
            </span>
          ) : null}

          {!isCancelled && (
            <span className="ml-auto shrink-0 inline-flex items-center gap-1.5 pl-2 pr-[3px] py-[3px] rounded-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[0.7rem] font-extrabold text-slate-700 dark:text-slate-300 group-active:bg-blue-50 group-active:text-blue-700 dark:group-active:bg-blue-500/15 dark:group-active:text-blue-300">
              {stopsLabel}
              <span className="relative w-[18px] h-[18px] rounded-full bg-blue-600 dark:bg-blue-400 flex items-center justify-center shrink-0">
                {pulseHint && <span className="absolute inset-0 rounded-full bg-blue-600 dark:bg-blue-400 opacity-60 animate-ping" aria-hidden="true" />}
                <ChevronRight className={`relative w-[11px] h-[11px] text-white dark:text-slate-900 stroke-[3] ml-px transition-transform ${isExpanded ? 'md:rotate-90' : ''}`} />
              </span>
            </span>
          )}
        </div>
      </div>

      {/* ── 桌面版中欄：起訖站在上，準點徽章與設施圖示在下 ── */}
      <div className="hidden md:flex flex-col justify-center gap-1.5 px-5 py-3 border-l border-slate-200 dark:border-slate-700 text-[0.76rem] text-slate-500 dark:text-slate-400 min-w-0">
        {startEndLabel && (
          <div className="text-[0.85rem] font-bold text-slate-900 dark:text-slate-100 truncate">{startEndLabel}</div>
        )}
        {(midExtra || wheelchair || bike) && (
          <div className="flex items-center gap-2.5 min-w-0">
            {midExtra}
            {(wheelchair || bike) && (
              <span className="inline-flex gap-1.5 text-slate-400 dark:text-slate-500 shrink-0">
                {wheelchair && <Accessibility className="w-4 h-4" aria-label={zh ? '無障礙座位' : 'Wheelchair'} />}
                {bike && <Bike className="w-4 h-4" aria-label={zh ? '自行車車廂' : 'Bike'} />}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── 票根 ── */}
      <div className="relative flex flex-col items-center justify-center gap-[7px] px-1.5 py-2.5 border-l-2 border-dashed border-slate-300 dark:border-slate-600 md:flex-row md:gap-3 md:px-4">
        <span className={`absolute -left-[9px] -top-[9px] w-4 h-4 rounded-full border border-slate-200/80 dark:border-slate-700 ${notchBg}`} aria-hidden="true" />
        <span className={`absolute -left-[9px] -bottom-[9px] w-4 h-4 rounded-full border border-slate-200/80 dark:border-slate-700 ${notchBg}`} aria-hidden="true" />

        {isCancelled ? (
          <span className="text-[0.8rem] font-extrabold text-red-600 dark:text-red-400">{zh ? '今日停駛' : 'Cancelled'}</span>
        ) : (
          <>
            {fareLabel && (
              <span className="flex flex-col items-center leading-none md:mr-1">
                <span className="text-[0.6rem] tracking-[0.1em] font-bold text-slate-500 dark:text-slate-400">{zh ? '全票' : 'FARE'}</span>
                <span className="mt-0.5 text-base font-extrabold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">{fareLabel}</span>
              </span>
            )}
            <span className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 overflow-hidden divide-x divide-slate-200 dark:divide-slate-700" onClick={stop}>
              <button
                type="button"
                onClick={onToggleFavorite}
                aria-label={isFavorite ? (zh ? '取消收藏' : 'Remove favorite') : (zh ? '收藏' : 'Add favorite')}
                aria-pressed={isFavorite}
                className={`${iconBtn} ${isFavorite ? '!text-[#cb171d] bg-[#ffebeb] dark:!text-red-300 dark:bg-red-500/15' : ''}`}
              >
                <Heart className={`w-[13px] h-[13px] ${isFavorite ? 'fill-current' : ''}`} />
              </button>
              <button type="button" onClick={onCalendar} aria-label={zh ? '加入行事曆' : 'Add to calendar'} className={iconBtn}>
                <CalendarPlus className="w-[13px] h-[13px]" />
              </button>
              <button type="button" onClick={onShare} aria-label={zh ? '分享' : 'Share'} className={iconBtn}>
                <Share2 className="w-[13px] h-[13px]" />
              </button>
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onBook(e); }}
              className={`px-3.5 py-[7px] rounded-[9px] text-[0.74rem] font-extrabold whitespace-nowrap transition-transform active:scale-95 ${
                bookPrimary
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-lg shadow-slate-900/10'
                  : 'bg-transparent border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300'
              }`}
            >
              {zh ? '訂票' : 'Book'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default TrainTicket;
