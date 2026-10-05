import React from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, ChevronRight, MapPin, Route, Search, Star, TramFront } from 'lucide-react';
import type { BoardDirection, BoardStripTrain, BoardTrain } from '../lib/metroBoard';
import type { MetroAlert } from '../lib/metro';
import type { TypicalCrowd } from '../lib/metroCrowd';

/**
 * 捷運到站看板（站到站旁的另一個分段）。純顯示：資料抓取、輪詢、收藏與路線切換都由
 * MetroSearch 負責，這裡只把 metroBoard.ts 算好的方向資料畫出來。
 *
 * 即時與表定一定分開標示：`BoardTrain.live` 為 false 的時間旁一律標「表定」並加「約」，
 * 不用翻牌或倒數把表定時間裝成即時。
 */

export interface ArrivalsBoardLine {
  code: string;
  stationId: string;
  label: string;
  color: string;
  ink: string;
  directions: BoardDirection[];
}

export interface ArrivalsBoardStrip {
  /** Station names for offsets -2 … +2 around the board station (null past a line end). */
  names: (string | null)[];
  trains: BoardStripTrain[];
  /** The line runs on past the window on that side (else the rail stops at the last named stop). */
  continuesDown: boolean;
  continuesUp: boolean;
}

interface MetroArrivalsBoardProps {
  zh: boolean;
  /** Empty when no station is chosen yet. */
  stationName: string;
  stationNameAlt: string;
  systemName: string;
  lines: ArrivalsBoardLine[];
  activeCode: string;
  onSelectLine: (code: string) => void;
  strip: ArrivalsBoardStrip | null;
  /** Distance to the auto-located station; null once the rider picked a station themselves. */
  nearestMeters: number | null;
  isFavourite: boolean;
  onToggleFavourite: () => void;
  favourites: { key: string; name: string; active: boolean }[];
  onPickFavourite: (key: string) => void;
  onFindStation: () => void;
  alerts: MetroAlert[];
  loading: boolean;
  updatedAt: Date | null;
  /** Ridership month behind the typical-crowding estimate ("YYYY-MM"); null without the file. */
  crowdMonth: string | null;
  /** The 到站看板 | 站到站 switch, drawn at the top of the station card. */
  modeTabs?: React.ReactNode;
  onPlanFrom: () => void;
  /** Opens 全線動態 for the active line. */
  onOpenLineMap: () => void;
  /** Opens 後續班次 for one direction of one line. */
  onOpenDirection: (code: string, dir: BoardDirection['dir']) => void;
}

const CROWD_COLORS = ['bg-emerald-500', 'bg-amber-400', 'bg-orange-500', 'bg-rose-500'];

/** 「即時」/「表定」 label — shared with the station-to-station cards so both views say the same thing. */
export function LivePill({ live, zh }: { live: boolean; zh: boolean }) {
  return live ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[11px] font-black">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
      {zh ? '即時' : 'Live'}
    </span>
  ) : (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[11px] font-black">
      {zh ? '表定' : 'Sched.'}
    </span>
  );
}

/** Per-car crowdedness (1–4), with the emptiest car called out when the cars differ. */
export function CrowdRow({ cars, zh }: { cars: number[]; zh: boolean }) {
  const L = (z: string, e: string) => (zh ? z : e);
  const quietest = cars.indexOf(Math.min(...cars));
  const varies = new Set(cars).size > 1;
  return (
    <div>
      <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-slate-400">
        <span>{L('車廂擁擠度', 'Crowdedness')}</span>
        {varies && (
          <span className="normal-case tracking-normal text-xs text-emerald-700 dark:text-emerald-400">
            {L(`第 ${quietest + 1} 車最空`, `Car ${quietest + 1} is emptiest`)}
          </span>
        )}
      </div>
      <div className="mt-1.5 flex gap-1">
        {cars.map((lv, i) => (
          <span
            key={i}
            title={L(`第 ${i + 1} 車`, `Car ${i + 1}`)}
            className={`flex-1 h-4 rounded ${CROWD_COLORS[Math.min(4, Math.max(1, lv)) - 1]} ${
              varies && i === quietest ? 'ring-2 ring-offset-1 ring-slate-900 dark:ring-white dark:ring-offset-slate-900' : ''
            }`}
          />
        ))}
      </div>
    </div>
  );
}

const TYPICAL_LABELS: Record<TypicalCrowd['level'], [string, string]> = {
  1: ['寬鬆', 'Quiet'],
  2: ['普通', 'Moderate'],
  3: ['稍擠', 'Busy'],
  4: ['擁擠', 'Crowded'],
};
const TYPICAL_TEXT = ['text-emerald-700 dark:text-emerald-400', 'text-amber-600 dark:text-amber-400', 'text-orange-600 dark:text-orange-400', 'text-rose-600 dark:text-rose-400'];

/**
 * 「通常 普通」 — how full trains this way usually are in that hour, from historical ridership.
 * Deliberately not the per-car row's shape: a stepped meter plus a word, labelled 「歷史」, so it
 * is never read as a live or per-car reading. The month/hour it is based on is the board's
 * footnote (`typicalCrowdBasis`), said once rather than in every card.
 */
function TypicalCrowdRow({ c, zh }: { c: TypicalCrowd; zh: boolean }) {
  const L = (z: string, e: string) => (zh ? z : e);
  const word = L(TYPICAL_LABELS[c.level][0], TYPICAL_LABELS[c.level][1]);
  return (
    <div
      className="flex items-center gap-1.5 min-w-0"
      title={L(`此時段通常${word}（歷史運量推估，${c.hour} 時）`, `Usually ${word.toLowerCase()} at ${String(c.hour).padStart(2, '0')}:00 (historical ridership)`)}
    >
      <span className="flex items-end gap-0.5 h-3.5 shrink-0" aria-hidden="true">
        {[1, 2, 3, 4].map((k) => (
          <span
            key={k}
            className={`w-1 rounded-sm ${k <= c.level ? CROWD_COLORS[c.level - 1] : 'bg-slate-200 dark:bg-slate-700'}`}
            style={{ height: `${k * 25}%` }}
          />
        ))}
      </span>
      <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 shrink-0">{L('通常', 'Usually')}</span>
      <span className={`text-[13px] font-black truncate ${TYPICAL_TEXT[c.level - 1]}`}>{word}</span>
      <span className="ml-auto shrink-0 px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[10px] font-black">
        {L('歷史', 'Typical')}
      </span>
    </div>
  );
}

/** Footnote for the 「歷史」 rows: one month, and the hour when every card shares it. */
function typicalCrowdBasis(directions: BoardDirection[], month: string | null, zh: boolean): string {
  const shown = directions.map((d) => (d.crowdedness?.length || !d.next ? null : d.typicalCrowd)).filter((c): c is TypicalCrowd => Boolean(c));
  const [y, m] = (month ?? '').split('-').map(Number);
  if (shown.length === 0 || !y || !m) return '';
  const day = shown.every((c) => c.dayType === 'wd') ? 'wd' : shown.every((c) => c.dayType === 'we') ? 'we' : null;
  const hour = shown.every((c) => c.hour === shown[0].hour) ? shown[0].hour : null;
  if (zh) {
    return `「歷史」擁擠度依 ${y} 年 ${m} 月${day === 'wd' ? '平日' : day === 'we' ? '假日' : ''}${hour !== null ? ` ${hour} 時` : '各時段'}運量推估`;
  }
  const mon = new Date(Date.UTC(y, m - 1, 15)).toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `"Typical" crowding estimated from ${day === 'wd' ? 'weekday ' : day === 'we' ? 'weekend ' : ''}${hour !== null ? `${String(hour).padStart(2, '0')}:00 ` : ''}ridership, ${mon}`;
}

/**
 * Platform-sign heading for a direction: every line end it leads to, so a fork reads
 * 「往 迴龍／蘆洲」. Empty at a line end (nothing runs that way).
 */
export function directionHeading(d: BoardDirection, zh: boolean): string {
  const names = d.terminusNames.map((n) => (zh ? n.Zh_tw || n.En : n.En || n.Zh_tw) || '').filter(Boolean);
  return names.join(zh ? '／' : ' / ');
}

function minutesText(t: BoardTrain, zh: boolean): string {
  return `${t.live ? '' : zh ? '約 ' : '~'}${t.minutes} ${zh ? '分' : 'min'}`;
}

function DirectionCard({ d, line, zh, onOpen }: { d: BoardDirection; line: ArrivalsBoardLine; zh: boolean; onOpen?: () => void }) {
  const L = (z: string, e: string) => (zh ? z : e);
  const name = (n: { Zh_tw?: string; En?: string }) => (zh ? n.Zh_tw || n.En : n.En || n.Zh_tw) || '';
  const Arrow = d.dir === 'up' ? ArrowRight : ArrowLeft;
  const next = d.next;
  const arriving = next?.live && next.minutes <= 0;
  const heading = directionHeading(d, zh);
  // Only a direction with trains opens 後續班次; a line end or a no-service direction has nothing to list.
  const openable = Boolean(onOpen) && !d.isLineEnd && !d.noService && d.upcoming.length > 0;
  const running = next && !d.isLineEnd && !d.noService;

  const body = (
    <>
      <div className="flex items-start gap-1.5 min-w-0">
        <span className="w-6 h-6 sm:w-8 sm:h-8 shrink-0 rounded-full grid place-items-center" style={{ backgroundColor: line.color, color: line.ink }}>
          <Arrow className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[3]" />
        </span>
        {/* Wraps to a second line rather than truncating: at a fork the cut-off part is a branch (往 淡水／新北投). */}
        <span className="flex-1 min-w-0 pt-px sm:pt-0.5 text-[15px] sm:text-lg leading-tight font-black text-slate-900 dark:text-white line-clamp-2 break-words">
          {heading ? L(`往 ${heading}`, `To ${heading}`) : L('終點站', 'Terminus')}
        </span>
        {openable && <ChevronRight className="w-4 h-4 mt-1 shrink-0 text-slate-400" aria-hidden="true" />}
      </div>
      {zh && directionHeading(d, false) && (
        <span className="hidden sm:block -mt-1 text-xs font-semibold text-slate-400 dark:text-slate-500 truncate">To {directionHeading(d, false)}</span>
      )}
      {(d.platform || running) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {d.platform && (
            <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[11px] font-black">
              {L(`${d.platform} 號月台`, `Platform ${d.platform}`)}
            </span>
          )}
          {running && <LivePill live={next!.live} zh={zh} />}
        </div>
      )}

      {d.isLineEnd ? (
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{L('本站為終點站，請至對向月台搭車。', 'This is the terminus. Board on the opposite platform.')}</p>
      ) : d.noService ? (
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{L('此方向沒有列車行駛。', 'No trains run in this direction.')}</p>
      ) : !next ? (
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{L('目前沒有班次資訊。', 'No upcoming trains listed.')}</p>
      ) : (
        <div className="flex flex-col gap-0.5 min-w-0">
          {arriving ? (
            <span className="self-start px-3 py-1 rounded-xl bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xl font-black tracking-widest animate-pulse">
              {L('進站中', 'Arriving')}
            </span>
          ) : (
            <span className="flex items-baseline gap-1 text-slate-900 dark:text-white">
              {!next.live && <span className="text-sm font-black text-slate-400 dark:text-slate-500">{L('約', '~')}</span>}
              <span className="text-[2.75rem] sm:text-[3.5rem] font-black tracking-tighter tabular-nums leading-none">{next.minutes}</span>
              <span className="text-sm font-black text-slate-500 dark:text-slate-400">{L('分', 'min')}</span>
            </span>
          )}
          {!d.terminusIds.includes(next.destId) && (
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate">
              {L(`本班 往 ${name(next.destName)}`, `This train to ${name(next.destName)}`)}
            </span>
          )}
          {d.following && (
            <span className="flex items-center gap-1 text-xs font-bold text-slate-700 dark:text-slate-200 min-w-0">
              <span className="truncate">{L('下一班', 'Next')} {minutesText(d.following, zh)}</span>
              {/* The pill above already labels both when they match; only a live next train
                  followed by a scheduled one needs its own 「表定」 here. */}
              {d.following.live !== next.live && <LivePill live={d.following.live} zh={zh} />}
            </span>
          )}
        </div>
      )}

      {d.crowdedness && d.crowdedness.length > 0
        ? <CrowdRow cars={d.crowdedness} zh={zh} />
        : next && d.typicalCrowd && <TypicalCrowdRow c={d.typicalCrowd} zh={zh} />}
    </>
  );

  // min-w-0: a long heading (往 南港展覽館) must truncate, not widen its half of the grid.
  const cardCls = 'min-w-0 rounded-3xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-3 sm:p-4 flex flex-col gap-2';
  if (!openable) return <div className={cardCls}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={L(`往 ${directionHeading(d, true)}，查看後續班次`, `To ${directionHeading(d, false)} — upcoming trains`)}
      className={`${cardCls} w-full text-left hover:border-slate-200 dark:hover:border-slate-700 hover:shadow-md transition-all`}
    >
      {body}
    </button>
  );
}

function LineStrip({ strip, line, zh }: { strip: ArrivalsBoardStrip; line: ArrivalsBoardLine; zh: boolean }) {
  const L = (z: string, e: string) => (zh ? z : e);
  const pos = (offset: number) => `${50 + offset * 18}%`;
  const firstIdx = strip.names.findIndex((n) => n !== null);
  const lastIdx = strip.names.length - 1 - [...strip.names].reverse().findIndex((n) => n !== null);

  return (
    <div className="relative rounded-3xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 pt-3 pb-1">
      {/* The direction cards right below name both ends (← left, → right), so only the live tag stays. */}
      {strip.trains.length > 0 && (
        <span className="absolute z-10 top-1.5 left-1/2 -translate-x-1/2 flex items-center gap-1 text-[10px] font-black text-emerald-700 dark:text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          {L('即時列車位置', 'Live positions')}
        </span>
      )}
      {/* 5.25rem: the down-bound train markers (top 58px + 18px) and the station names are the lowest things drawn. */}
      <div className="relative h-[5.25rem] overflow-hidden" aria-hidden="true">
        <div
          className="absolute top-[42px] h-2 rounded-full"
          style={{
            backgroundColor: line.color,
            left: strip.continuesDown ? '-4%' : pos(firstIdx - 2),
            right: strip.continuesUp ? '-4%' : `calc(100% - ${pos(lastIdx - 2)})`,
          }}
        />
        {strip.names.map((n, k) => n === null ? null : (
          <div key={k} className="absolute top-0 -translate-x-1/2 flex flex-col items-center" style={{ left: pos(k - 2) }}>
            <span
              className={`mt-[36px] rounded-full bg-white dark:bg-slate-900 ${k === 2 ? 'w-5 h-5 border-[5px] border-slate-900 dark:border-white' : 'w-3.5 h-3.5 border-[3.5px]'}`}
              style={k === 2 ? undefined : { borderColor: line.color }}
            />
            <span className={`mt-2 whitespace-nowrap text-[11px] ${k === 2 ? 'font-black text-slate-900 dark:text-white text-xs' : 'font-bold text-slate-500 dark:text-slate-400'}`}>
              {n}
            </span>
          </div>
        ))}
        {strip.trains.map((t, k) => (
          <span
            key={k}
            className={`absolute -translate-x-1/2 flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 ${t.dir === 'up' ? 'top-[14px]' : 'top-[58px]'}`}
            style={{ left: pos(t.offset) }}
          >
            {t.dir === 'down' && <ArrowLeft className="w-3 h-3 stroke-[3]" />}
            <TramFront className="w-3.5 h-3.5" />
            {t.dir === 'up' && <ArrowRight className="w-3 h-3 stroke-[3]" />}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function MetroArrivalsBoard(props: MetroArrivalsBoardProps) {
  const { zh, lines, activeCode } = props;
  const L = (z: string, e: string) => (zh ? z : e);
  const line = lines.find((l) => l.code === activeCode) ?? lines[0];
  const others = lines.filter((l) => l !== line);
  const anyLive = lines.some((l) => l.directions.some((d) => d.next?.live));
  const hasTrains = line?.directions.some((d) => d.next);
  const transferAllScheduled = others.flatMap((o) => o.directions).every((d) => !d.next?.live);

  const favouritesRow = (
    <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
      <span className="shrink-0 text-[10px] font-black uppercase tracking-widest text-slate-400 mr-1">{L('收藏', 'Saved')}</span>
      {props.favourites.map((f) => (
        <button
          key={f.key}
          type="button"
          onClick={() => props.onPickFavourite(f.key)}
          className={`shrink-0 px-3 py-1 rounded-full text-[13px] font-bold transition-colors ${
            f.active
              ? 'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-300'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
          }`}
        >
          {f.name}
        </button>
      ))}
    </div>
  );
  const iconBtn = 'w-9 h-9 sm:w-10 sm:h-10 shrink-0 rounded-full bg-slate-100 dark:bg-slate-800 grid place-items-center hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors';
  const basis = line ? typicalCrowdBasis(line.directions, props.crowdMonth, zh) : '';

  if (!props.stationName || !line) {
    return (
      <div className="w-full max-w-3xl flex flex-col gap-3">
        <div className="rounded-[1.75rem] border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 flex flex-col items-stretch gap-3">
          {props.modeTabs}
          <p className="text-base font-black text-slate-800 dark:text-slate-100">{L('選一個車站，看即時到站', 'Pick a station to see live arrivals')}</p>
          <button
            type="button"
            onClick={props.onFindStation}
            className="self-start flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-cyan-600 to-teal-600 text-white font-bold"
          >
            <Search className="w-4 h-4" />
            {L('找車站', 'Find station')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl flex flex-col gap-2.5 sm:gap-3">
      {props.alerts.length > 0 && (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/15 p-3.5">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-black text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {L('營運通阻', 'Service alerts')}
          </div>
          <ul className="mt-1.5 flex flex-col gap-1">
            {props.alerts.slice(0, 3).map((a, i) => (
              <li key={i} className="text-sm text-amber-800/90 dark:text-amber-300/90 leading-snug">{a.title || a.description}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Station header — name, distance and actions on one row so the whole board fits a phone screen */}
      <div className="rounded-[1.75rem] border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_12px_32px_-20px_rgba(8,145,178,0.45)] p-4 sm:p-5">
        {props.modeTabs}
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white truncate">{props.stationName}</h2>
            <p className="mt-0.5 flex items-center gap-1.5 min-w-0 text-xs sm:text-sm font-medium text-slate-500 dark:text-slate-400">
              <span className="truncate">{props.stationNameAlt}{props.stationNameAlt && props.systemName ? ' · ' : ''}{props.systemName}</span>
              {props.nearestMeters !== null && (
                <span
                  className="shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 text-[11px] font-black"
                  title={L('離你最近的車站', 'Nearest station')}
                >
                  <MapPin className="w-3 h-3" />
                  {props.nearestMeters < 1000
                    ? L(`約 ${props.nearestMeters} 公尺`, `~${props.nearestMeters} m`)
                    : L(`約 ${(props.nearestMeters / 1000).toFixed(1)} 公里`, `~${(props.nearestMeters / 1000).toFixed(1)} km`)}
                </span>
              )}
            </p>
          </div>
          <button type="button" onClick={props.onFindStation} aria-label={L('找車站', 'Find station')} title={L('找車站', 'Find station')} className={iconBtn}>
            <Search className="w-[18px] h-[18px] text-slate-600 dark:text-slate-300 stroke-[2.5]" />
          </button>
          <button type="button" onClick={props.onOpenLineMap} aria-label={L('全線動態', 'Line status')} title={L('全線動態', 'Line status')} className={iconBtn}>
            <Route className="w-[18px] h-[18px] text-slate-600 dark:text-slate-300" />
          </button>
          <button
            type="button"
            onClick={props.onToggleFavourite}
            aria-pressed={props.isFavourite}
            aria-label={props.isFavourite ? L('取消收藏車站', 'Remove saved station') : L('收藏車站', 'Save station')}
            className={iconBtn}
          >
            <Star className={`w-[18px] h-[18px] ${props.isFavourite ? 'fill-amber-400 text-amber-400' : 'text-slate-500 dark:text-slate-400'}`} />
          </button>
        </div>
        <div role="tablist" aria-label={L('路線', 'Line')} className="mt-3 flex flex-wrap gap-1.5">
          {lines.map((l) => {
            const active = l === line;
            return (
              <button
                key={l.code}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => props.onSelectLine(l.code)}
                className={`flex items-center gap-1.5 h-8 sm:h-9 px-3 sm:px-3.5 rounded-full text-[13px] font-black transition-colors ${
                  active ? '' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
                style={active ? { backgroundColor: l.color, color: l.ink } : undefined}
              >
                {!active && <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: l.color }} />}
                <span>{l.stationId}</span>
                <span className="font-bold">{l.label}</span>
              </button>
            );
          })}
        </div>
        {props.favourites.length > 0 && (
          <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800">{favouritesRow}</div>
        )}
      </div>

      {props.strip && (
        <button
          type="button"
          onClick={props.onOpenLineMap}
          aria-label={L(`開啟${line.label}全線動態`, `Open ${line.label} line status`)}
          className="block w-full text-left rounded-3xl hover:ring-2 hover:ring-slate-200 dark:hover:ring-slate-700 transition-shadow"
        >
          <LineStrip strip={props.strip} line={line} zh={zh} />
        </button>
      )}

      {props.loading && !hasTrains ? (
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
          {[0, 1].map((k) => <div key={k} className="h-36 rounded-3xl bg-slate-100 dark:bg-slate-800/60 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
          {/* Side by side, laid out like the strip above: ← (toward the low-numbered end) left, → right */}
          {[...line.directions].sort((a, b) => (a.dir === b.dir ? 0 : a.dir === 'down' ? -1 : 1)).map((d) => (
            <DirectionCard key={d.dir} d={d} line={line} zh={zh} onOpen={() => props.onOpenDirection(line.code, d.dir)} />
          ))}
        </div>
      )}

      {others.length > 0 && (
        <div className="rounded-3xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2.5">
          <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-slate-400">
            <span>{L('本站轉乘', 'Transfers here')}</span>
            {/* One label for the card when every time in it is scheduled; per row only when they mix. */}
            {transferAllScheduled && <span className="normal-case tracking-normal"><LivePill live={false} zh={zh} /></span>}
          </div>
          <div className="mt-1 flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
            {others.map((o) => (
              <button
                key={o.code}
                type="button"
                onClick={() => props.onSelectLine(o.code)}
                className="flex items-center gap-3 py-1.5 text-left"
              >
                <span className="shrink-0 px-2.5 py-1 rounded-full text-xs font-black" style={{ backgroundColor: o.color, color: o.ink }}>
                  {o.stationId} {o.label}
                </span>
                <span className="flex flex-col text-[13px] leading-snug text-slate-500 dark:text-slate-400 min-w-0">
                  {o.directions.filter((d) => d.next).map((d) => (
                    <span key={d.dir} className="truncate">
                      {L('往', 'To ')}{directionHeading(d, zh)}{' '}
                      <b className="text-slate-900 dark:text-white">{d.next!.live && d.next!.minutes <= 0 ? L('進站中', 'arriving') : minutesText(d.next!, zh)}</b>
                      {!d.next!.live && !transferAllScheduled && <span className="ml-1 text-[11px]">{L('表定', 'sched.')}</span>}
                    </span>
                  ))}
                </span>
                <ChevronRight className="ml-auto w-4 h-4 shrink-0 text-slate-400" />
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={props.onPlanFrom}
        className="w-full flex items-center justify-center gap-2 py-3 sm:py-3.5 rounded-2xl bg-gradient-to-r from-cyan-600 to-teal-600 text-white font-bold ring-1 ring-inset ring-white/15 shadow-[0_10px_34px_-8px_rgba(8,145,178,0.5)] hover:from-cyan-500 hover:to-teal-500 transition-all"
      >
        {L(`從${props.stationName}出發，查站到站`, `Plan a trip from ${props.stationName}`)}
        <ArrowRight className="w-4 h-4" />
      </button>

      <p className="text-center text-[11px] font-semibold leading-snug text-slate-400 dark:text-slate-500">
        {basis && <>{basis}<br /></>}
        {anyLive
          ? L(`TDX 即時看板${props.updatedAt ? ` · ${props.updatedAt.toLocaleTimeString('zh-TW', { hour12: false })} 更新` : ''}`,
              `TDX live board${props.updatedAt ? ` · updated ${props.updatedAt.toLocaleTimeString('en-GB')}` : ''}`)
          : L('目前沒有即時資料，以上為表定時間', 'No live data right now — times above are scheduled')}
      </p>
    </div>
  );
}
