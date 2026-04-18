import React, { useEffect, useState } from 'react';
import { ArrowLeft, Train, MapPin, AlertTriangle, Clock } from 'lucide-react';
import type { DailyTimetableOD } from '../lib/api';
import type { ReliabilityScore } from '../lib/delayReliability';

interface Props {
  train: DailyTimetableOD;
  delayMinutes: number | undefined;
  platform: string | undefined;
  reliability: ReliabilityScore | null;
  transportType: 'hsr' | 'train';
  language: string;
  originName: string;
  destinationName: string;
  onClose: () => void;
}

function parseHHMM(time: string | undefined | null): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function nowMinutesTaipei(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Taipei',
  })
    .format(new Date())
    .split(':');
  return (
    parseInt(parts[0], 10) * 60 +
    parseInt(parts[1], 10) +
    parseInt(parts[2] || '0', 10) / 60
  );
}

export default function PlatformMode({
  train,
  delayMinutes,
  platform,
  reliability,
  transportType,
  language,
  originName,
  destinationName,
  onClose,
}: Props) {
  const isZh = language === 'zh-TW';
  const [now, setNow] = useState(() => nowMinutesTaipei());

  useEffect(() => {
    const id = setInterval(() => setNow(nowMinutesTaipei()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dep = train.OriginStopTime?.DepartureTime?.substring(0, 5) || '--:--';
  const arr = train.DestinationStopTime?.ArrivalTime?.substring(0, 5) || '--:--';
  const trainNo = train.DailyTrainInfo?.TrainNo || '---';
  const typeName = transportType === 'hsr'
    ? (isZh ? '高鐵' : 'THSR')
    : (train.DailyTrainInfo?.TrainTypeName?.Zh_tw || (isZh ? '列車' : 'Train'));

  const depMin = parseHHMM(dep);
  const effectiveDelay = delayMinutes || 0;
  const actualDepMin = depMin == null ? null : depMin + effectiveDelay;
  const diff = actualDepMin == null ? null : actualDepMin - now;

  const minutesLeft = diff == null ? null : Math.floor(diff);
  const secondsLeft = diff == null ? null : Math.max(0, Math.round((diff - Math.floor(diff)) * 60));

  // Sunlight readability: very high contrast. Tint by urgency.
  const urgency = minutesLeft == null ? 'unknown'
    : minutesLeft < 0 ? 'departed'
    : minutesLeft <= 1 ? 'boarding'
    : minutesLeft <= 5 ? 'hurry'
    : minutesLeft <= 15 ? 'soon'
    : 'later';

  const bgByUrgency: Record<string, string> = {
    unknown: 'from-slate-900 via-slate-800 to-slate-900',
    departed: 'from-slate-950 via-slate-900 to-slate-950',
    boarding: 'from-red-700 via-red-600 to-rose-700',
    hurry: 'from-amber-600 via-orange-500 to-amber-600',
    soon: 'from-emerald-700 via-emerald-600 to-emerald-700',
    later: 'from-sky-800 via-blue-700 to-indigo-800',
  };

  const minutesDisplay =
    minutesLeft == null ? '--' : minutesLeft < 0 ? Math.abs(minutesLeft).toString() : minutesLeft.toString();

  const secDisplay = secondsLeft == null ? '--' : secondsLeft.toString().padStart(2, '0');

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col bg-gradient-to-br ${bgByUrgency[urgency]} text-white animate-in fade-in duration-300`}
      role="dialog"
      aria-modal="true"
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-4 sm:px-6 sm:py-5 border-b border-white/10 backdrop-blur-sm">
        <button
          onClick={onClose}
          className="flex items-center gap-2 text-white/90 hover:text-white bg-white/10 hover:bg-white/20 rounded-full px-4 py-2 font-bold text-sm transition-colors"
          aria-label={isZh ? '返回' : 'Back'}
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{isZh ? '返回' : 'Back'}</span>
        </button>
        <div className="text-xs sm:text-sm font-black uppercase tracking-[0.3em] text-white/80">
          {isZh ? '月台模式' : 'Platform Mode'}
        </div>
        <div className="w-[72px]" aria-hidden />
      </div>

      {/* Route header */}
      <div className="px-5 sm:px-10 pt-4">
        <div className="flex items-center justify-center gap-3 text-xl sm:text-3xl font-black tracking-tight">
          <span className="truncate max-w-[40%]">{originName || (isZh ? '起站' : 'Origin')}</span>
          <Train className="w-5 h-5 sm:w-7 sm:h-7 opacity-80 shrink-0" />
          <span className="truncate max-w-[40%]">{destinationName || (isZh ? '終站' : 'Dest')}</span>
        </div>
        <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
          <span className="px-3 py-1 rounded-full bg-white/15 border border-white/20 text-sm sm:text-base font-bold backdrop-blur-sm">
            {typeName}
          </span>
          <span className="px-3 py-1 rounded-full bg-white/15 border border-white/20 text-sm sm:text-base font-black tracking-wider">
            #{trainNo}
          </span>
          {effectiveDelay > 0 && (
            <span className="px-3 py-1 rounded-full bg-black/30 border border-white/30 text-sm font-black">
              {isZh ? `誤點 ${effectiveDelay} 分` : `+${effectiveDelay} min late`}
            </span>
          )}
          {effectiveDelay === 0 && delayMinutes === 0 && (
            <span className="px-3 py-1 rounded-full bg-emerald-500/30 border border-emerald-200/40 text-sm font-black">
              {isZh ? '準點' : 'On time'}
            </span>
          )}
        </div>
      </div>

      {/* Countdown — the whole point of this view */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 text-center">
        <div className="text-sm sm:text-base font-black uppercase tracking-[0.4em] text-white/70 mb-4">
          {urgency === 'departed'
            ? isZh ? '已發車' : 'Departed'
            : urgency === 'boarding'
              ? isZh ? '即將發車' : 'Boarding now'
              : isZh ? '預計發車倒數' : 'Departs in'}
        </div>

        <div className="flex items-end justify-center gap-2 sm:gap-4 leading-none">
          <span
            className="font-black tracking-tighter tabular-nums drop-shadow-[0_4px_16px_rgba(0,0,0,0.35)]"
            style={{ fontSize: 'clamp(7rem, 38vw, 18rem)' }}
          >
            {minutesDisplay}
          </span>
          <div className="flex flex-col items-start pb-4 sm:pb-10 gap-1">
            <span className="text-lg sm:text-3xl font-black uppercase tracking-widest text-white/80">
              {isZh ? '分' : 'min'}
            </span>
            <span className="text-2xl sm:text-4xl font-black tabular-nums text-white/90">:{secDisplay}</span>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-4 flex-wrap text-sm sm:text-lg font-bold text-white/90">
          <span className="bg-white/15 border border-white/20 rounded-full px-4 py-2 backdrop-blur-sm">
            {isZh ? `發車 ${dep}` : `Dep ${dep}`}
          </span>
          <span className="bg-white/15 border border-white/20 rounded-full px-4 py-2 backdrop-blur-sm">
            {isZh ? `抵達 ${arr}` : `Arr ${arr}`}
          </span>
        </div>
      </div>

      {/* Bottom info row: platform + reliability */}
      <div className="px-5 sm:px-10 pb-8 sm:pb-10 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <div className="bg-black/25 border border-white/15 rounded-3xl px-5 py-4 backdrop-blur-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
            <MapPin className="w-6 h-6" />
          </div>
          <div>
            <div className="text-[10px] sm:text-xs font-black uppercase tracking-[0.3em] text-white/60">
              {isZh ? '月台' : 'Platform'}
            </div>
            <div className="text-3xl sm:text-4xl font-black tracking-tight">
              {platform && platform !== '--' ? platform : (isZh ? '現場公告' : 'TBA')}
            </div>
          </div>
        </div>

        <div className="bg-black/25 border border-white/15 rounded-3xl px-5 py-4 backdrop-blur-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
            {reliability && (reliability.level === 'caution' || reliability.level === 'frequent') ? (
              <AlertTriangle className="w-6 h-6" />
            ) : (
              <Clock className="w-6 h-6" />
            )}
          </div>
          <div className="min-w-0">
            <div className="text-[10px] sm:text-xs font-black uppercase tracking-[0.3em] text-white/60">
              {isZh ? '準點評分' : 'Reliability'}
            </div>
            {reliability ? (
              <>
                <div className="text-2xl sm:text-3xl font-black tracking-tight">
                  {reliability.score}
                  <span className="text-base sm:text-lg font-bold text-white/70 ml-1">/100</span>
                </div>
                {reliability.expectedDelayMin > 0 && (
                  <div className="text-xs sm:text-sm text-white/80 font-bold truncate">
                    {isZh
                      ? `近期常態誤點 ~${reliability.expectedDelayMin} 分`
                      : `Often ~${reliability.expectedDelayMin} min late`}
                  </div>
                )}
              </>
            ) : (
              <div className="text-lg sm:text-xl font-black text-white/80">
                {isZh ? '資料不足' : 'Not enough data'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
