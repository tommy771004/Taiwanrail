import React from 'react';
import { ArrowRightLeft } from 'lucide-react';
import type { BranchTransferPlan } from '../lib/traBranchTransfers';
import { BADGE, shortTrainTypeName, ticketColorOf } from './TrainTicket';

/**
 * 沒有直達車時的「轉乘一次」方案（臺北→十分、臺北→集集…）。取代原本的「未找到班次」。
 * 只負責畫；方案由 traBranchTransfers.planBranchTransfers 算好。今天的查詢只列還沒開的方案。
 */
interface Props {
  plans: BranchTransferPlan[];
  originName: string;
  destName: string;
  language: string;
  /** 今天的查詢傳入目前分鐘數（App 的 getTwMinutes），用來藏掉已發車的方案 */
  nowMinutes?: number | null;
}

const hhmm = (t: string | undefined) => (t ?? '').substring(0, 5) || '--:--';

function durationLabel(minutes: number, zh: boolean) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (zh) return h > 0 ? `${h} 小時 ${m} 分` : `${m} 分`;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}m`;
}

const Leg: React.FC<{ typeName: string; trainNo: string; from: string; dep: string; to: string; arr: string }> = ({ typeName, trainNo, from, dep, to, arr }) => {
  const name = shortTrainTypeName(typeName);
  return (
    <div className="flex items-center gap-2 min-w-0 text-[0.8rem]">
      <span className={`shrink-0 max-w-[6.5rem] truncate px-1.5 py-0.5 rounded-md text-[0.66rem] font-extrabold ${BADGE[ticketColorOf(typeName)]}`} title={typeName}>{name}</span>
      <span className="shrink-0 font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">{trainNo}</span>
      <span className="min-w-0 truncate font-semibold text-slate-600 dark:text-slate-300">
        {from} <span className="tabular-nums font-bold text-slate-900 dark:text-slate-100">{dep}</span>
        <span className="mx-1 text-slate-400">→</span>
        {to} <span className="tabular-nums font-bold text-slate-900 dark:text-slate-100">{arr}</span>
      </span>
    </div>
  );
};

const BranchTransferPlans: React.FC<Props> = ({ plans, originName, destName, language, nowMinutes = null }) => {
  const zh = language === 'zh-TW';
  const shown = nowMinutes === null ? plans : plans.filter(p => p.departMin >= nowMinutes);
  const minTransfer = Math.min(...plans.map(p => p.via.minTransferMinutes));

  return (
    <section className="flex flex-col gap-3" aria-label={zh ? '轉乘方案' : 'Transfer options'}>
      <div className="mx-3 sm:mx-0 rounded-[18px] border border-amber-200/80 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-4 py-3">
        <div className="flex items-center gap-2 text-[0.9rem] font-black text-amber-900 dark:text-amber-200">
          <ArrowRightLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
          {zh ? `${originName} → ${destName} 沒有直達車` : `No direct train from ${originName} to ${destName}`}
        </div>
        <p className="mt-1 text-[0.76rem] font-medium leading-relaxed text-amber-800/90 dark:text-amber-200/80">
          {zh
            ? `以下是在台鐵公布的轉乘站換一次車的走法，依時刻表推算，轉乘時間至少 ${minTransfer} 分鐘。`
            : `These options change trains once at a TRA transfer station, worked out from the timetable with at least ${minTransfer} min to transfer.`}
        </p>
      </div>

      {shown.length === 0 && (
        <div className="mx-3 sm:mx-0 rounded-[18px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-6 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">
          {zh ? '今天的轉乘班次都已發車，請改查其他日期。' : "Today's transfer options have all departed. Try another date."}
        </div>
      )}

      {shown.map(p => {
        const first = p.first;
        const second = p.second;
        const via = zh ? p.via.stationName : p.via.stationNameEn;
        return (
          <article
            key={`${first.DailyTrainInfo.TrainNo}-${second.DailyTrainInfo.TrainNo}`}
            className="relative mx-3 sm:mx-0 rounded-[18px] overflow-hidden border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-[0_6px_24px_-14px_rgba(15,23,42,0.14)] pl-[18px] pr-4 py-3"
          >
            <div className="absolute left-0 top-0 bottom-0 w-[5px] bg-amber-400 dark:bg-amber-300" aria-hidden="true" />
            <div className="flex items-baseline gap-2">
              <span className="text-[1.9rem] font-extrabold tracking-[-0.045em] leading-none tabular-nums text-slate-900 dark:text-slate-100">{hhmm(first.OriginStopTime.DepartureTime)}</span>
              <span className="flex-1 min-w-[40px] flex items-center gap-1.5 px-0.5 text-[0.7rem] font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap">
                <span className="flex-1 h-px bg-slate-300 dark:bg-slate-600" />
                {durationLabel(p.arriveMin - p.departMin, zh)}
                <span className="flex-1 h-px bg-slate-300 dark:bg-slate-600" />
              </span>
              <span className="text-[1.2rem] font-bold tracking-tight tabular-nums text-slate-700 dark:text-slate-300">{hhmm(second.DestinationStopTime.ArrivalTime)}</span>
            </div>

            <div className="mt-2.5 flex flex-col gap-1.5">
              <Leg
                typeName={first.DailyTrainInfo.TrainTypeName?.Zh_tw || ''}
                trainNo={first.DailyTrainInfo.TrainNo}
                from={originName}
                dep={hhmm(first.OriginStopTime.DepartureTime)}
                to={via}
                arr={hhmm(first.DestinationStopTime.ArrivalTime)}
              />
              <div className="flex items-start gap-2 pl-1 text-[0.72rem] font-bold text-amber-700 dark:text-amber-300">
                <span className="mt-0.5 h-3.5 border-l-2 border-dashed border-amber-400" aria-hidden="true" />
                <span className="min-w-0">
                  {zh ? `${via}轉乘 · 等 ${p.waitMinutes} 分鐘` : `Change at ${via} · ${p.waitMinutes} min wait`}
                  {zh && p.via.note && <span className="ml-1.5 font-semibold text-slate-500 dark:text-slate-400">（{p.via.note}）</span>}
                </span>
              </div>
              <Leg
                typeName={second.DailyTrainInfo.TrainTypeName?.Zh_tw || ''}
                trainNo={second.DailyTrainInfo.TrainNo}
                from={via}
                dep={hhmm(second.OriginStopTime.DepartureTime)}
                to={destName}
                arr={hhmm(second.DestinationStopTime.ArrivalTime)}
              />
            </div>
          </article>
        );
      })}
    </section>
  );
};

export default BranchTransferPlans;
