import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import type { BoardDirection, BoardTrain } from '../lib/metroBoard';
import { CrowdRow, LivePill } from './MetroArrivalsBoard';

/**
 * 後續班次：點到站看板的月台卡後打開。列出這個方向接下來的班次（即時在前、表定在後，
 * 每班都標示）、本班車廂擁擠度、今日首末班，以及帶這站去站到站查詢的兩個按鈕。
 * 純顯示；資料來自 metroBoard.ts 的 BoardDirection。
 */

interface MetroDepartureSheetProps {
  zh: boolean;
  stationName: string;
  line: { label: string; color: string; ink: string };
  direction: BoardDirection;
  onClose: () => void;
  /** 設為起站：station-to-station with this station as origin. */
  onPlanFrom: () => void;
  /** 設為迄站：station-to-station with this station as destination. */
  onPlanTo: () => void;
}

const nameOf = (n: { Zh_tw?: string; En?: string }, zh: boolean) => (zh ? n.Zh_tw || n.En : n.En || n.Zh_tw) || '';

export default function MetroDepartureSheet(props: MetroDepartureSheetProps) {
  const { zh, direction: d, line } = props;
  const L = (z: string, e: string) => (zh ? z : e);
  const Arrow = d.dir === 'up' ? ArrowRight : ArrowLeft;
  const hasLive = d.upcoming.some((t) => t.live);
  const hasScheduled = d.upcoming.some((t) => !t.live);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.onClose]);

  const minutesCell = (t: BoardTrain) =>
    t.live && t.minutes <= 0 ? (
      <span className="px-2.5 py-0.5 rounded-full bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-sm font-black animate-pulse">
        {L('進站中', 'Arriving')}
      </span>
    ) : (
      <span className="flex items-baseline gap-1 text-slate-900 dark:text-white">
        {!t.live && <span className="text-xs font-black text-slate-400 dark:text-slate-500">{L('約', '~')}</span>}
        <span className="text-2xl font-black tabular-nums leading-none">{t.minutes}</span>
        <span className="text-xs font-black text-slate-500 dark:text-slate-400">{L('分', 'min')}</span>
      </span>
    );

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm sm:p-6" onClick={props.onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={L(`${props.stationName} 往${nameOf(d.terminusName, true)} 後續班次`, `${props.stationName} to ${nameOf(d.terminusName, false)}: upcoming trains`)}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[88dvh] flex flex-col bg-slate-50 dark:bg-[#0b1220] rounded-t-[1.75rem] sm:rounded-[1.75rem] overflow-hidden shadow-2xl animate-in slide-in-from-bottom-4 fade-in duration-300"
      >
        <div className="sm:hidden flex justify-center pt-2.5" aria-hidden="true">
          <span className="w-10 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>

        {/* Heading — same as the direction card it was opened from */}
        <div className="px-4 pt-3 pb-3 bg-slate-50 dark:bg-[#0b1220]">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 shrink-0 rounded-full grid place-items-center" style={{ backgroundColor: line.color, color: line.ink }}>
              <Arrow className="w-4 h-4 stroke-[3]" />
            </span>
            <div className="min-w-0 flex flex-col">
              <span className="text-xl font-black text-slate-900 dark:text-white truncate">
                {L(`往 ${nameOf(d.terminusName, true)}`, `To ${nameOf(d.terminusName, false)}`)}
              </span>
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 truncate">
                {props.stationName} · {line.label}
              </span>
            </div>
            {d.platform && (
              <span className="ml-auto shrink-0 px-2.5 py-1 rounded-full bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-black">
                {L(`${d.platform} 號月台`, `Platform ${d.platform}`)}
              </span>
            )}
            <button
              type="button"
              onClick={props.onClose}
              aria-label={L('關閉', 'Close')}
              className={`${d.platform ? '' : 'ml-auto'} w-10 h-10 shrink-0 grid place-items-center rounded-full bg-slate-200/70 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-3">
          <div className="rounded-3xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">{L('接下來的班次', 'Upcoming trains')}</div>
            {d.upcoming.length === 0 ? (
              <p className="py-4 text-sm font-semibold text-slate-500 dark:text-slate-400">{L('目前沒有班次資訊。', 'No upcoming trains listed.')}</p>
            ) : (
              <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-800">
                {d.upcoming.map((t, k) => (
                  <li key={k} className="flex items-center gap-3 py-2.5">
                    <span className="w-20 shrink-0">{minutesCell(t)}</span>
                    <span className="min-w-0 flex flex-col">
                      <span className="text-[15px] font-bold text-slate-800 dark:text-slate-100 truncate">
                        {L(`往 ${nameOf(t.destName, true)}`, `To ${nameOf(t.destName, false)}`)}
                      </span>
                      {t.time && <span className="text-xs font-semibold tabular-nums text-slate-400 dark:text-slate-500">{L(`${t.time} 發車`, `Departs ${t.time}`)}</span>}
                    </span>
                    <span className="ml-auto shrink-0"><LivePill live={t.live} zh={zh} /></span>
                  </li>
                ))}
              </ul>
            )}
            {hasLive && hasScheduled && (
              <p className="mt-1 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                {L('即時看板只提供最近的列車；之後的班次由時刻表推算。', 'The live board covers only the nearest trains; later ones come from the timetable.')}
              </p>
            )}
          </div>

          {d.crowdedness && d.crowdedness.length > 0 && (
            <div className="rounded-3xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3">
              <CrowdRow cars={d.crowdedness} zh={zh} />
              <div className="mt-1 flex gap-1 text-center text-[11px] font-bold text-slate-400 dark:text-slate-500">
                {d.crowdedness.map((_, i) => <span key={i} className="flex-1">{i + 1}</span>)}
              </div>
            </div>
          )}

          {d.firstTrain && d.lastTrain && (
            <div className="rounded-3xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 flex items-center gap-4">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{L('今日表定', "Today's timetable")}</span>
              <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                {L('首班', 'First')} <b className="tabular-nums text-slate-900 dark:text-white">{d.firstTrain}</b>
              </span>
              <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                {L('末班', 'Last')} <b className="tabular-nums text-slate-900 dark:text-white">{d.lastTrain}</b>
              </span>
            </div>
          )}
        </div>

        <div className="px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] grid grid-cols-2 gap-2.5 bg-slate-50 dark:bg-[#0b1220] border-t border-slate-200/70 dark:border-slate-800">
          <button
            type="button"
            onClick={props.onPlanFrom}
            className="h-12 rounded-2xl bg-gradient-to-r from-cyan-600 to-teal-600 text-white text-sm font-bold hover:from-cyan-500 hover:to-teal-500 transition-colors"
          >
            {L('設為起站查站到站', 'Plan from here')}
          </button>
          <button
            type="button"
            onClick={props.onPlanTo}
            className="h-12 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-cyan-700 dark:text-cyan-400 text-sm font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            {L('設為迄站', 'Plan to here')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
