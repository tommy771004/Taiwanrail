import React, { useState, useEffect } from 'react';
import { TramFront } from 'lucide-react';

interface JourneyProgressBarProps {
  departureTime: string; // Format: "HH:MM"
  arrivalTime: string;   // Format: "HH:MM"
  zh: boolean;
  tripLine?: number;
  statusTags?: React.ReactNode;
  originName?: string;
  destName?: string;
}

export default function JourneyProgressBar({ departureTime, arrivalTime, zh, tripLine, statusTags, originName, destName }: JourneyProgressBarProps) {
  const L = (z: string, e: string) => (zh ? z : e);
  const tripLineLabel = tripLine !== undefined && tripLine !== 0
    ? tripLine === 1 ? '山線' : tripLine === 2 ? '海線' : '成追'
    : null;

  const [progress, setProgress] = useState<number>(0);
  const [statusText, setStatusText] = useState<string>('');
  const [remainingMinutes, setRemainingMinutes] = useState<number>(0);

  useEffect(() => {
    const updateProgress = () => {
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      const hhmmToMinutes = (hhmm: string): number => {
        const [h, m] = hhmm.split(':').map(Number);
        return (isNaN(h) || isNaN(m)) ? 0 : h * 60 + m;
      };

      const depMin = hhmmToMinutes(departureTime);
      let arrMin = hhmmToMinutes(arrivalTime);

      // Handle cross-midnight arrival (e.g. departure 23:50, arrival 00:20)
      if (arrMin < depMin) {
        arrMin += 24 * 60;
      }

      let curMin = currentMinutes;
      // Handle current time overnight context if the route crossed midnight
      if (curMin < depMin && (curMin + 24 * 60 - depMin < arrMin - depMin)) {
        curMin += 24 * 60;
      }

      const totalDuration = arrMin - depMin;

      if (curMin <= depMin) {
        setProgress(0);
        setStatusText(L('即將出發', 'Departing soon'));
        setRemainingMinutes(totalDuration);
      } else if (curMin >= arrMin) {
        setProgress(100);
        setStatusText(L('已抵達', 'Arrived'));
        setRemainingMinutes(0);
      } else {
        const elapsed = curMin - depMin;
        const pct = Math.min(99, Math.max(1, Math.round((elapsed / totalDuration) * 100)));
        setProgress(pct);
        setStatusText(L('行駛中', 'En Route'));
        setRemainingMinutes(arrMin - curMin);
      }
    };

    updateProgress();
    // Refresh progress state every 15 seconds
    const timer = setInterval(updateProgress, 15000);
    return () => clearInterval(timer);
  }, [departureTime, arrivalTime, zh]);

  return (
    <div id="journey-progress-container" className="w-full mt-2.5 px-3 py-2 bg-slate-50/70 dark:bg-slate-800/30 rounded-xl border border-slate-100 dark:border-slate-800/80 animate-in fade-in duration-300">
      {/* Header labels */}
      <div className="flex items-center justify-between gap-2 text-[11px] font-bold mb-2">
        <span className="flex items-center gap-1.5 min-w-0">
          {progress > 0 && progress < 100 && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-500"></span>
            </span>
          )}
          <span className={progress > 0 && progress < 100 ? 'text-cyan-600 dark:text-cyan-400' : progress === 100 ? 'text-slate-400 dark:text-slate-500' : 'text-slate-500 dark:text-slate-400'}>
            {statusText} {progress > 0 && progress < 100 && `(${progress}%)`}
          </span>
          {tripLineLabel && (
            <span className={`shrink-0 font-bold px-1.5 py-[1px] rounded-md text-[0.625rem] tracking-widest outline outline-1 ${
              tripLine === 1 ? 'bg-[#fef4cc] text-[#af7001] outline-[#fef4cc]/50 dark:outline-[#fef4cc]/20' :
              tripLine === 2 ? 'bg-[#e5ffff] text-[#017a86] outline-[#e5ffff]/50 dark:outline-[#e5ffff]/20' :
              'bg-[#eee5ff] text-[#6126a8] outline-transparent'
            }`}>
              {tripLineLabel}
            </span>
          )}
          {statusTags && (
            <span className="inline-flex items-center gap-1.5 flex-wrap shrink-0">
              {statusTags}
            </span>
          )}
        </span>
        <span className="shrink-0 text-slate-400 dark:text-slate-500 font-medium">
          {progress === 100 ? (
            L('已完成旅程', 'Journey completed')
          ) : progress === 0 ? (
            L(`全程約 ${remainingMinutes} 分鐘`, `Duration ~${remainingMinutes} min`)
          ) : (
            L(`剩餘約 ${remainingMinutes} 分鐘`, `~${remainingMinutes} min left`)
          )}
        </span>
      </div>

      {/* Progress track */}
      <div className="relative w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-visible">
        {/* Fill bar */}
        <div
          className={`h-full rounded-full transition-all duration-1000 ease-out relative overflow-hidden ${
            progress === 100
              ? 'bg-slate-300 dark:bg-slate-600'
              : progress === 0
                ? 'bg-transparent'
                : 'bg-gradient-to-r from-cyan-500 via-cyan-400 to-teal-500 shadow-[0_0_12px_rgba(6,182,212,0.6)]'
          }`}
          style={{ width: `${progress}%` }}
        >
          {/* Brighter pulsing active layer overlay */}
          {progress > 0 && progress < 100 && (
            <div className="absolute inset-0 bg-gradient-to-r from-cyan-300/40 via-white/50 to-transparent animate-pulse" />
          )}
        </div>

        {/* Animated sliding train head representing precise position along track */}
        {progress > 0 && progress < 100 && (
          <div
            className="absolute top-1/2 -translate-y-1/2 -ml-3 transition-all duration-1000 ease-out"
            style={{ left: `${progress}%` }}
          >
            <div className="w-5 h-5 rounded-full bg-cyan-500 dark:bg-cyan-400 flex items-center justify-center shadow-[0_2px_6px_rgba(6,182,212,0.4)] border border-white dark:border-slate-900 animate-pulse">
              <TramFront className="w-3 h-3 text-white dark:text-slate-950 stroke-[2.5]" />
            </div>
          </div>
        )}

        {/* Station origin-destination anchors */}
        <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full border border-white dark:border-slate-900 ${progress > 0 ? 'bg-cyan-500' : 'bg-slate-300 dark:bg-slate-700'}`} />
        <div className={`absolute right-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full border border-white dark:border-slate-900 ${progress === 100 ? 'bg-slate-400 dark:bg-slate-600' : 'bg-slate-300 dark:bg-slate-700'}`} />
      </div>

      {/* Station Names row */}
      {(originName || destName) && (
        <div className="flex justify-between items-center mt-2 px-0.5 text-[10px] sm:text-xs font-black text-slate-500 dark:text-slate-400 tracking-wide">
          <span className="truncate max-w-[45%] text-left">{originName}</span>
          <span className="truncate max-w-[45%] text-right">{destName}</span>
        </div>
      )}
    </div>
  );
}
