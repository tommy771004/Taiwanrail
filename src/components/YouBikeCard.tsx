/**
 * YouBikeCard — nearest YouBike dock to one station (origin or destination),
 * shared by the TRA/THSR detail panel and the metro detail card.
 *
 * Light/dark aware: both hosts render it on their own surface. Availability is
 * never told by colour alone — every number is labelled, and an empty dock or a
 * full rack is spelled out in words.
 */
import { AlertTriangle, Bike } from 'lucide-react';
import type { YouBikeStation } from '../lib/api';
import RefreshButton from './RefreshButton';
import StationBikeMap from './StationBikeMap';

export interface YouBikeCardState {
  loading: boolean;
  data: YouBikeStation | null;
  /** The lookup failed (as opposed to: no dock nearby). */
  error?: boolean;
}

interface Props {
  roleLabel: string;
  stationName: string;
  /** The station's own position; enables the map and the refresh button. */
  stationPos: { lat: number; lon: number } | null;
  state: YouBikeCardState | undefined;
  onRefresh?: () => void;
  zh: boolean;
  /**
   * Frameless: no card surface, inset tiles or pills — the host's own panel is
   * the surface and only hairline dividers separate the parts (TRA/THSR detail).
   */
  flush?: boolean;
}

/** "2026-10-14 14:20:13" (or ISO) → "14:20". */
function clockOf(updateTime: string | null): string | null {
  const m = updateTime?.match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}

function Stat({ label, value, dot, warning, flush }: { label: string; value: number; dot: string; warning: string | null; flush?: boolean }) {
  return (
    <div className={flush ? 'py-1 first:pr-3 last:pl-4' : 'rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200/80 dark:bg-white/[0.04] dark:ring-white/10'}>
      <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400">
        <span className={`size-2 rounded-full ${dot}`} aria-hidden="true" />
        {label}
      </div>
      <div className={`mt-1 text-[1.75rem] font-black leading-none tabular-nums ${warning ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>
        {value}
      </div>
      {warning && <div className="mt-1 text-[11px] font-bold text-amber-700 dark:text-amber-300">{warning}</div>}
    </div>
  );
}

export default function YouBikeCard({ roleLabel, stationName, stationPos, state, onRefresh, zh, flush = false }: Props) {
  const data = state?.data ?? null;
  const loading = !state || (state.loading && !data);
  const dockName = data ? (zh ? data.name : (data.nameEn || data.name)) : '';
  const clock = data ? clockOf(data.updateTime) : null;
  const total = data ? Math.max(data.total, data.bikes + data.docks) : 0;
  const pct = (n: number) => (total > 0 ? `${(n / total) * 100}%` : '0%');
  const paused = data ? data.act !== '1' : false;
  const canMap =
    !!stationPos && typeof data?.lat === 'number' && typeof data?.lng === 'number';

  return (
    <section className={flush ? '' : 'overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-white/[0.04]'}>
      <header className={`flex items-center gap-3 pb-3 ${flush ? 'pt-1' : 'px-4 pt-3.5'}`}>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300">
          <Bike className="size-[18px]" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{roleLabel}</p>
          <h3 className="truncate text-base font-black text-slate-900 dark:text-slate-50">{stationName}</h3>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400">
          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
          {zh ? '即時' : 'Live'}
        </span>
        {onRefresh && (
          <RefreshButton
            onRefresh={onRefresh}
            refreshing={!!state?.loading}
            label={zh ? `重新整理${stationName} YouBike` : `Refresh YouBike near ${stationName}`}
            className="-my-1.5 -mr-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-slate-100"
          />
        )}
      </header>

      <div className={flush ? '' : 'px-4 pb-4'}>
        {loading ? (
          <div className="animate-pulse border-t border-slate-100 pt-3 dark:border-white/10" aria-label={zh ? '搜尋最近站點' : 'Finding nearest dock'}>
            <div className="h-4 w-2/3 rounded bg-slate-200 dark:bg-white/10" />
            <div className={`mt-3 grid grid-cols-2 ${flush ? 'gap-4' : 'gap-2'}`}>
              <div className="h-[70px] rounded-xl bg-slate-200/70 dark:bg-white/10" />
              <div className="h-[70px] rounded-xl bg-slate-200/70 dark:bg-white/10" />
            </div>
          </div>
        ) : !data ? (
          <div className={flush ? 'border-t border-slate-200 py-6 text-center dark:border-white/10' : 'rounded-xl border border-dashed border-slate-300 px-4 py-5 text-center dark:border-white/15'}>
            <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
              {state?.error
                ? (zh ? '暫時無法取得 YouBike 資料' : 'YouBike data is unavailable right now')
                : (zh ? '附近沒有 YouBike 站點' : 'No YouBike dock nearby')}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {state?.error
                ? (zh ? '可點右上角重新整理' : 'Use the refresh button to try again')
                : (zh ? '目前僅涵蓋臺北市，1.5 公里內' : 'Taipei City only, within 1.5 km')}
            </p>
          </div>
        ) : (
          <>
            {/* Sits on the card's own surface: a hairline under the header, no inset panel. */}
            <div className={`border-t pt-3 ${flush ? 'border-slate-200 dark:border-white/10' : 'border-slate-100 dark:border-white/10'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{zh ? '最近站點' : 'Nearest dock'}</p>
                  <p className="mt-0.5 truncate text-sm font-black text-slate-800 dark:text-slate-100">{dockName}</p>
                </div>
                <span className={`mt-0.5 shrink-0 text-[11px] font-bold tabular-nums text-slate-600 dark:text-slate-200 ${flush ? '' : 'rounded-full bg-white px-2 py-0.5 ring-1 ring-slate-200 dark:bg-white/10 dark:ring-white/10'}`}>
                  {zh ? `步行 ${data.distance}m` : `${data.distance} m walk`}
                </span>
              </div>

              {paused && (
                <p className={`mt-2.5 flex items-center gap-1.5 text-xs font-bold ${flush ? '' : 'rounded-lg bg-amber-50 px-2.5 py-1.5 dark:bg-amber-400/10'} text-amber-800 dark:text-amber-300`}>
                  <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                  {zh ? '此站目前暫停營運' : 'This dock is out of service'}
                </p>
              )}

              <div className={`mt-3 grid grid-cols-2 ${flush ? 'divide-x divide-slate-200 dark:divide-white/10' : 'gap-2'}`}>
                <Stat
                  label={zh ? '可借車輛' : 'Bikes'}
                  value={data.bikes}
                  dot="bg-emerald-500"
                  warning={data.bikes === 0 ? (zh ? '目前無車可借' : 'None to rent') : null}
                  flush={flush}
                />
                <Stat
                  label={zh ? '可還空位' : 'Docks'}
                  value={data.docks}
                  dot="bg-sky-500"
                  warning={data.docks === 0 ? (zh ? '車位已滿' : 'Rack full') : null}
                  flush={flush}
                />
              </div>

              {/* Share of the rack: bikes, free docks, and (grey) whatever is out of service. */}
              <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10" aria-hidden="true">
                <span className="bg-emerald-500" style={{ width: pct(data.bikes) }} />
                <span className="bg-sky-500" style={{ width: pct(data.docks) }} />
              </div>
              <p className="mt-1.5 flex justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span>{zh ? `共 ${total} 個車位` : `${total} docks in total`}</span>
                {clock && <span className="tabular-nums">{zh ? `資料時間 ${clock}` : `Updated ${clock}`}</span>}
              </p>
            </div>

            {canMap && (
              <StationBikeMap
                station={stationPos!}
                stationName={stationName}
                bike={{ lat: data.lat as number, lon: data.lng as number }}
                bikeName={dockName}
                zh={zh}
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}

export type YouBikeSide = 'origin' | 'dest';

/**
 * 起站 / 到站 switch above the YouBike card: one station at a time, so the
 * arrival side (the usual question — "can I ride on from where I get off?")
 * no longer sits below the fold. Hosts default it to 'dest'.
 */
export function YouBikeSideTabs({ side, onChange, originName, destName, zh, flush = false }: {
  side: YouBikeSide;
  onChange: (side: YouBikeSide) => void;
  originName: string;
  destName: string;
  zh: boolean;
  /** Underline switch on a hairline instead of a filled segmented control. */
  flush?: boolean;
}) {
  const options: { id: YouBikeSide; label: string; name: string }[] = [
    { id: 'origin', label: zh ? '起站' : 'From', name: originName },
    { id: 'dest', label: zh ? '到站' : 'To', name: destName },
  ];
  return (
    <div className={flush ? 'grid grid-cols-2 border-b border-slate-200 dark:border-white/10' : 'grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-white/5'}>
      {options.map(({ id, label, name }) => {
        const on = side === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange(id); }}
            className={`flex min-w-0 items-center justify-center gap-1.5 px-3 py-2 text-sm transition-colors ${
              flush ? '-mb-px border-b-2' : 'rounded-lg'
            } ${
              on
                ? `font-black text-amber-700 dark:text-amber-300 ${flush ? 'border-current' : 'bg-white shadow-sm dark:bg-white/15'}`
                : `font-bold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 ${flush ? 'border-transparent' : ''}`
            }`}
          >
            <span className="shrink-0">{label}</span>
            {name && <span className="truncate opacity-80">{name}</span>}
          </button>
        );
      })}
    </div>
  );
}
