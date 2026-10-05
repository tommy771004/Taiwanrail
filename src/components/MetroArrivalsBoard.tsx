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
 * 「此時段通常」 — how full trains this way usually are in that hour, from historical ridership.
 * Deliberately not the per-car row's shape: a stepped meter plus a word, labelled 「歷史」 with
 * the month and hour it is based on, so it is never read as a live or per-car reading.
 */
function TypicalCrowdRow({ c, month, zh }: { c: TypicalCrowd; month: string | null; zh: boolean }) {
  const L = (z: string, e: string) => (zh ? z : e);
  const [y, m] = (month ?? '').split('-').map(Number);
  const basis = y && m
    ? L(`依 ${y} 年 ${m} 月${c.dayType === 'wd' ? '平日' : '假日'} ${c.hour} 時運量推估`,
        `Estimated from ${c.dayType === 'wd' ? 'weekday' : 'weekend'} ${String(c.hour).padStart(2, '0')}:00 ridership, ${new Date(Date.UTC(y, m - 1, 15)).toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`)
    : '';
  return (
    <div>
      <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-slate-400">
        <span>{L('此時段通常', 'Usually at this hour')}</span>
        <span className="normal-case tracking-normal px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[11px] font-black">
          {L('歷史', 'Typical')}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2.5">
        <span className="flex items-end gap-0.5 h-4" aria-hidden="true">
          {[1, 2, 3, 4].map((k) => (
            <span
              key={k}
              className={`w-1.5 rounded-sm ${k <= c.level ? CROWD_COLORS[c.level - 1] : 'bg-slate-200 dark:bg-slate-700'}`}
              style={{ height: `${k * 25}%` }}
            />
          ))}
        </span>
        <span className={`text-sm font-black ${TYPICAL_TEXT[c.level - 1]}`}>{L(TYPICAL_LABELS[c.level][0], TYPICAL_LABELS[c.level][1])}</span>
      </div>
      {basis && <p className="mt-1 text-[10px] font-semibold text-slate-400 dark:text-slate-500">{basis}</p>}
    </div>
  );
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

function DirectionCard({ d, line, zh, crowdMonth, onOpen }: { d: BoardDirection; line: ArrivalsBoardLine; zh: boolean; crowdMonth: string | null; onOpen?: () => void }) {
  const L = (z: string, e: string) => (zh ? z : e);
  const name = (n: { Zh_tw?: string; En?: string }) => (zh ? n.Zh_tw || n.En : n.En || n.Zh_tw) || '';
  const Arrow = d.dir === 'up' ? ArrowRight : ArrowLeft;
  const next = d.next;
  const arriving = next?.live && next.minutes <= 0;

  const body = (
    <>
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="w-8 h-8 shrink-0 rounded-full grid place-items-center" style={{ backgroundColor: line.color, color: line.ink }}>
          <Arrow className="w-4 h-4 stroke-[3]" />
        </span>
        <span className="text-lg font-black text-slate-900 dark:text-white truncate">
          {directionHeading(d, zh) ? L(`往 ${directionHeading(d, zh)}`, `To ${directionHeading(d, zh)}`) : L('終點站', 'Terminus')}
        </span>
        {zh && directionHeading(d, false) && (
          <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 truncate">To {directionHeading(d, false)}</span>
        )}
        {d.platform && (
          <span className="ml-auto shrink-0 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-black">
            {L(`${d.platform} 號月台`, `Platform ${d.platform}`)}
          </span>
        )}
      </div>

      {d.isLineEnd ? (
        <p className="text-sm font-semibold text-slate-500 dark:text-slate-400 py-2">{L('本站為終點站，請至對向月台搭車。', 'This is the terminus. Board on the opposite platform.')}</p>
      ) : d.noService ? (
        <p className="text-sm font-semibold text-slate-500 dark:text-slate-400 py-2">{L('此方向沒有列車行駛。', 'No trains run in this direction.')}</p>
      ) : !next ? (
        <p className="text-sm font-semibold text-slate-500 dark:text-slate-400 py-2">{L('目前沒有班次資訊。', 'No upcoming trains listed.')}</p>
      ) : (
        <div className="flex items-end justify-between gap-3">
          {arriving ? (
            <span className="px-4 py-2 rounded-2xl bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-2xl font-black tracking-widest animate-pulse">
              {L('進站中', 'Arriving')}
            </span>
          ) : (
            <span className="flex items-baseline gap-1 text-slate-900 dark:text-white">
              {!next.live && <span className="text-base font-black text-slate-400 dark:text-slate-500">{L('約', '~')}</span>}
              <span className="text-[3.5rem] font-black tracking-tighter tabular-nums leading-[0.9]">{next.minutes}</span>
              <span className="text-base font-black text-slate-500 dark:text-slate-400">{L('分', 'min')}</span>
            </span>
          )}
          <div className="flex flex-col items-end gap-1 min-w-0 text-right">
            <LivePill live={next.live} zh={zh} />
            {!d.terminusIds.includes(next.destId) && (
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 truncate max-w-full">
                {L(`本班 往 ${name(next.destName)}`, `This train to ${name(next.destName)}`)}
              </span>
            )}
            {d.following && (
              <span className="flex items-center gap-1.5 text-[13px] font-bold text-slate-700 dark:text-slate-200">
                {L('下一班', 'Next')} {minutesText(d.following, zh)}
                <LivePill live={d.following.live} zh={zh} />
              </span>
            )}
          </div>
        </div>
      )}

      {d.crowdedness && d.crowdedness.length > 0
        ? <CrowdRow cars={d.crowdedness} zh={zh} />
        : next && d.typicalCrowd && <TypicalCrowdRow c={d.typicalCrowd} month={crowdMonth} zh={zh} />}
    </>
  );

  // min-w-0: a long English heading (To Taipei Nangang Exhibition Center) must truncate, not widen the grid column.
  const cardCls = 'min-w-0 rounded-3xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4 flex flex-col gap-3';
  // Only a direction with trains opens 後續班次; a line end or a no-service direction has nothing to list.
  if (!onOpen || d.isLineEnd || d.noService || d.upcoming.length === 0) return <div className={cardCls}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={L(`往 ${directionHeading(d, true)}，查看後續班次`, `To ${directionHeading(d, false)} — upcoming trains`)}
      className={`${cardCls} w-full text-left hover:border-slate-200 dark:hover:border-slate-700 hover:shadow-md transition-all`}
    >
      {body}
      <span className="flex items-center justify-center gap-1 text-[0.625rem] font-bold text-slate-400 dark:text-slate-500">
        {L('後續班次', 'Upcoming trains')}
        <ChevronRight className="w-3.5 h-3.5" />
      </span>
    </button>
  );
}

function LineStrip({ strip, line, zh }: { strip: ArrivalsBoardStrip; line: ArrivalsBoardLine; zh: boolean }) {
  const L = (z: string, e: string) => (zh ? z : e);
  const pos = (offset: number) => `${50 + offset * 18}%`;
  const firstIdx = strip.names.findIndex((n) => n !== null);
  const lastIdx = strip.names.length - 1 - [...strip.names].reverse().findIndex((n) => n !== null);
  const down = line.directions.find((x) => x.dir === 'down');
  const up = line.directions.find((x) => x.dir === 'up');

  return (
    <div className="rounded-3xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 pt-3 pb-2">
      <div className="flex justify-between items-center text-[11px] font-black text-slate-400 dark:text-slate-500">
        <span>{down && directionHeading(down, zh) ? `← ${L(`往 ${directionHeading(down, zh)}`, `To ${directionHeading(down, zh)}`)}` : ''}</span>
        {strip.trains.length > 0 && (
          <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {L('即時列車位置', 'Live positions')}
          </span>
        )}
        <span>{up && directionHeading(up, zh) ? `${L(`往 ${directionHeading(up, zh)}`, `To ${directionHeading(up, zh)}`)} →` : ''}</span>
      </div>
      <div className="relative h-24 overflow-hidden" aria-hidden="true">
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

  const favouritesRow = (
    <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
      {props.favourites.length > 0 && (
        <span className="shrink-0 text-[10px] font-black uppercase tracking-widest text-slate-400 mr-1">{L('收藏', 'Saved')}</span>
      )}
      {props.favourites.map((f) => (
        <button
          key={f.key}
          type="button"
          onClick={() => props.onPickFavourite(f.key)}
          className={`shrink-0 px-3 py-1.5 rounded-full text-[13px] font-bold transition-colors ${
            f.active
              ? 'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-300'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
          }`}
        >
          {f.name}
        </button>
      ))}
      <button
        type="button"
        onClick={props.onFindStation}
        className="shrink-0 flex items-center gap-1 px-2 py-1.5 text-[13px] font-black text-cyan-700 dark:text-cyan-400 hover:text-cyan-600"
      >
        <Search className="w-3.5 h-3.5 stroke-[3]" />
        {L('找車站', 'Find station')}
      </button>
    </div>
  );

  if (!props.stationName || !line) {
    return (
      <div className="w-full max-w-3xl flex flex-col gap-3">
        <div className="rounded-[1.75rem] border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col items-start gap-3">
          <p className="text-base font-black text-slate-800 dark:text-slate-100">{L('選一個車站，看即時到站', 'Pick a station to see live arrivals')}</p>
          <button
            type="button"
            onClick={props.onFindStation}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-cyan-600 to-teal-600 text-white font-bold"
          >
            <Search className="w-4 h-4" />
            {L('找車站', 'Find station')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl flex flex-col gap-3">
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

      {/* Station header */}
      <div className="rounded-[1.75rem] border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_12px_32px_-20px_rgba(8,145,178,0.45)] p-4 sm:p-5">
        <div className="flex items-center gap-2">
          {props.nearestMeters !== null && (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 text-xs font-black">
              <MapPin className="w-3.5 h-3.5" />
              {props.nearestMeters < 1000
                ? L(`離你最近 · 約 ${props.nearestMeters} 公尺`, `Nearest · ~${props.nearestMeters} m`)
                : L(`離你最近 · 約 ${(props.nearestMeters / 1000).toFixed(1)} 公里`, `Nearest · ~${(props.nearestMeters / 1000).toFixed(1)} km`)}
            </span>
          )}
          <button
            type="button"
            onClick={props.onOpenLineMap}
            aria-label={L('全線動態', 'Line status')}
            title={L('全線動態', 'Line status')}
            className="ml-auto w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 grid place-items-center hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            <Route className="w-5 h-5 text-slate-600 dark:text-slate-300" />
          </button>
          <button
            type="button"
            onClick={props.onToggleFavourite}
            aria-pressed={props.isFavourite}
            aria-label={props.isFavourite ? L('取消收藏車站', 'Remove saved station') : L('收藏車站', 'Save station')}
            className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 grid place-items-center hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            <Star className={`w-5 h-5 ${props.isFavourite ? 'fill-amber-400 text-amber-400' : 'text-slate-500 dark:text-slate-400'}`} />
          </button>
        </div>
        <h2 className="mt-1 text-3xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white">{props.stationName}</h2>
        <p className="mt-0.5 text-sm font-medium text-slate-500 dark:text-slate-400">
          {props.stationNameAlt}{props.stationNameAlt && props.systemName ? ' · ' : ''}{props.systemName}
        </p>
        <div role="tablist" aria-label={L('路線', 'Line')} className="mt-3.5 flex flex-wrap gap-2">
          {lines.map((l) => {
            const active = l === line;
            return (
              <button
                key={l.code}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => props.onSelectLine(l.code)}
                className={`flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[13px] font-black transition-colors ${
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
        <div className="mt-3.5 pt-3 border-t border-slate-100 dark:border-slate-800">{favouritesRow}</div>
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
        <div className="grid sm:grid-cols-2 gap-3">
          {[0, 1].map((k) => <div key={k} className="h-40 rounded-3xl bg-slate-100 dark:bg-slate-800/60 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {/* 往 the line's far end first (往淡水 above 往象山), as on the A/B mock-ups */}
          {[...line.directions].sort((a, b) => (a.dir === b.dir ? 0 : a.dir === 'up' ? -1 : 1)).map((d) => (
            <DirectionCard key={d.dir} d={d} line={line} zh={zh} crowdMonth={props.crowdMonth} onOpen={() => props.onOpenDirection(line.code, d.dir)} />
          ))}
        </div>
      )}

      {others.length > 0 && (
        <div className="rounded-3xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">{L('本站轉乘', 'Transfers here')}</div>
          <div className="mt-1 flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
            {others.map((o) => (
              <button
                key={o.code}
                type="button"
                onClick={() => props.onSelectLine(o.code)}
                className="flex items-center gap-3 py-2.5 text-left"
              >
                <span className="shrink-0 px-2.5 py-1 rounded-full text-xs font-black" style={{ backgroundColor: o.color, color: o.ink }}>
                  {o.stationId} {o.label}
                </span>
                <span className="flex flex-col text-[13px] leading-relaxed text-slate-500 dark:text-slate-400 min-w-0">
                  {o.directions.filter((d) => d.next).map((d) => (
                    <span key={d.dir} className="truncate">
                      {L('往', 'To ')}{directionHeading(d, zh)}{' '}
                      <b className="text-slate-900 dark:text-white">{d.next!.live && d.next!.minutes <= 0 ? L('進站中', 'arriving') : minutesText(d.next!, zh)}</b>
                      {!d.next!.live && <span className="ml-1 text-[11px]">{L('表定', 'sched.')}</span>}
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
        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-gradient-to-r from-cyan-600 to-teal-600 text-white font-bold ring-1 ring-inset ring-white/15 shadow-[0_10px_34px_-8px_rgba(8,145,178,0.5)] hover:from-cyan-500 hover:to-teal-500 transition-all"
      >
        {L(`從${props.stationName}出發，查站到站`, `Plan a trip from ${props.stationName}`)}
        <ArrowRight className="w-4 h-4" />
      </button>

      <p className="text-center text-[11px] font-semibold text-slate-400 dark:text-slate-500">
        {anyLive
          ? L(`TDX 即時看板${props.updatedAt ? ` · ${props.updatedAt.toLocaleTimeString('zh-TW', { hour12: false })} 更新` : ''}`,
              `TDX live board${props.updatedAt ? ` · updated ${props.updatedAt.toLocaleTimeString('en-GB')}` : ''}`)
          : L('目前沒有即時資料，以上為表定時間', 'No live data right now — times above are scheduled')}
      </p>
    </div>
  );
}
