import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, ChevronLeft, X } from 'lucide-react';
import type { LineTrain } from '../lib/metroBoard';

/**
 * 全線動態：一條線的全部車站由上到下排列（往線路末端的方向在上），路線色軌道上標出
 * TDX LivePosition 的列車（▲ 往上方終點、▼ 往下方終點）與各站可轉乘的路線。
 * 點任一站就把到站看板切到那一站。純顯示；資料與輪詢由 MetroSearch 負責。
 */

export interface LineMapTransfer { code: string; label: string; color: string; ink: string }

export interface LineMapStation {
  id: string;
  name: string;
  /** Name in the other language (English under zh, Chinese under en). */
  nameAlt: string;
  /** Other lines at a station of the same name (an interchange). */
  transfers: LineMapTransfer[];
}

export interface LineMapLine {
  code: string;
  label: string;
  color: string;
  ink: string;
  /** Running order: first terminus → last terminus. */
  stations: LineMapStation[];
}

interface MetroLineMapProps {
  zh: boolean;
  lines: LineMapLine[];
  activeCode: string;
  onSelectLine: (code: string) => void;
  /** Station ids of the board station (one per line) — highlighted and scrolled into view. */
  currentStationIds: string[];
  /** Name shown on the back button, i.e. the board station. */
  backLabel: string;
  trains: LineTrain[];
  onPickStation: (stationId: string) => void;
  onClose: () => void;
}

const ROW = 56;
const MARK = 26;

export default function MetroLineMap(props: MetroLineMapProps) {
  const { zh, lines } = props;
  const L = (z: string, e: string) => (zh ? z : e);
  const line = lines.find((l) => l.code === props.activeCode) ?? lines[0];
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Escape closes, like the station picker's backdrop tap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.onClose]);

  const n = line?.stations.length ?? 0;
  // Top of the list is the line's last station, so trains toward it (`up`) travel upward.
  const rowOf = (index: number) => n - 1 - index;
  const currentIdx = line ? line.stations.findIndex((s) => props.currentStationIds.includes(s.id)) : -1;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || currentIdx < 0) return;
    el.scrollTop = Math.max(0, rowOf(currentIdx) * ROW - el.clientHeight / 2 + ROW / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line?.code, currentIdx]);

  if (!line) return null;
  const top = line.stations[n - 1];
  const bottom = line.stations[0];

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm sm:p-6" onClick={props.onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={L(`全線動態：${line.label}`, `Line status: ${line.label}`)}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg h-[100dvh] sm:h-[85dvh] flex flex-col bg-slate-50 dark:bg-[#0b1220] sm:rounded-[1.75rem] overflow-hidden shadow-2xl animate-in slide-in-from-bottom-4 fade-in duration-300"
      >
        {/* Header */}
        <div className="flex items-center gap-1 px-2 pt-2 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={props.onClose}
            className="h-11 flex items-center gap-1 px-2 rounded-full text-[15px] font-black text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ChevronLeft className="w-5 h-5" />
            <span className="truncate max-w-[10rem]">{props.backLabel}</span>
          </button>
          <span className="ml-auto mr-1 text-base font-black text-slate-900 dark:text-white">{L('全線動態', 'Line status')}</span>
          <button
            type="button"
            onClick={props.onClose}
            aria-label={L('關閉', 'Close')}
            className="w-11 h-11 grid place-items-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-white dark:bg-slate-900 px-4 pb-3 pt-2 border-b border-slate-100 dark:border-slate-800">
          <div role="tablist" aria-label={L('選擇路線', 'Choose line')} className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
            {lines.map((l) => {
              const active = l === line;
              return (
                <button
                  key={l.code}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => props.onSelectLine(l.code)}
                  className={`shrink-0 flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[13px] font-black transition-colors ${
                    active ? '' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                  style={active ? { backgroundColor: l.color, color: l.ink } : undefined}
                >
                  {!active && <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: l.color }} />}
                  {l.label}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-end justify-between gap-3">
            <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white truncate">{line.label}</h2>
            <div className="shrink-0 flex flex-col items-end gap-1 text-xs font-black text-slate-500 dark:text-slate-400">
              {props.trains.length > 0 ? (
                <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {L('即時列車位置', 'Live positions')}
                </span>
              ) : (
                <span>{L('列車位置暫無資料', 'No live positions')}</span>
              )}
              <span className="flex items-center gap-2">
                <span className="flex items-center gap-0.5"><ArrowUp className="w-3 h-3" />{L(`往${top?.name ?? ''}`, `to ${top?.name ?? ''}`)}</span>
                <span className="flex items-center gap-0.5"><ArrowDown className="w-3 h-3" />{L(`往${bottom?.name ?? ''}`, `to ${bottom?.name ?? ''}`)}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Line diagram */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="relative my-3" style={{ height: n * ROW }}>
            <div
              aria-hidden="true"
              className="absolute w-2 rounded-full"
              style={{ left: 52, top: ROW / 2, height: Math.max(0, (n - 1) * ROW), backgroundColor: line.color }}
            />
            {[...line.stations].reverse().map((s, r) => {
              const isCurrent = props.currentStationIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => props.onPickStation(s.id)}
                  aria-current={isCurrent ? 'location' : undefined}
                  className={`absolute inset-x-0 flex items-center gap-2 pl-[104px] pr-4 text-left transition-colors ${
                    isCurrent ? 'bg-slate-200/70 dark:bg-slate-800' : 'hover:bg-white dark:hover:bg-slate-900'
                  }`}
                  style={{ top: r * ROW, height: ROW }}
                >
                  <span
                    aria-hidden="true"
                    className={`absolute rounded-full bg-white dark:bg-slate-900 ${isCurrent ? 'border-[5px] border-slate-900 dark:border-white' : 'border-[3.5px]'}`}
                    style={isCurrent
                      ? { left: 44, top: ROW / 2 - 12, width: 24, height: 24 }
                      : { left: 49, top: ROW / 2 - 7, width: 14, height: 14, borderColor: line.color }}
                  />
                  <span className="w-12 shrink-0 text-xs font-black tabular-nums text-slate-400 dark:text-slate-500">{s.id}</span>
                  <span className="min-w-0 flex flex-col">
                    <span className={`truncate text-slate-900 dark:text-white ${isCurrent ? 'text-lg font-black' : 'text-[15px] font-bold'}`}>{s.name}</span>
                    {s.nameAlt && <span className="truncate text-[11px] font-semibold text-slate-400 dark:text-slate-500">{s.nameAlt}</span>}
                  </span>
                  {s.transfers.length > 0 && (
                    <span className="ml-auto shrink-0 flex gap-1">
                      {s.transfers.map((t) => (
                        <span key={t.code} title={t.label} className="px-2 py-0.5 rounded-full text-[11px] font-black" style={{ backgroundColor: t.color, color: t.ink }}>
                          {t.code}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
            {props.trains.map((t, k) => (
              <span
                key={k}
                role="img"
                aria-label={t.dir === 'up' ? L(`往${top?.name ?? ''}列車`, `Train to ${top?.name ?? ''}`) : L(`往${bottom?.name ?? ''}列車`, `Train to ${bottom?.name ?? ''}`)}
                className="pointer-events-none absolute grid place-items-center rounded-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow"
                style={{
                  width: MARK,
                  height: MARK,
                  left: t.dir === 'up' ? 14 : 70,
                  top: rowOf(t.index) * ROW + ROW / 2 - MARK / 2,
                }}
              >
                {t.dir === 'up' ? <ArrowUp className="w-3.5 h-3.5 stroke-[3]" /> : <ArrowDown className="w-3.5 h-3.5 stroke-[3]" />}
              </span>
            ))}
          </div>
          <p className="px-4 pb-6 text-center text-[11px] font-semibold text-slate-400 dark:text-slate-500">
            {L('列車位置來自 TDX 即時位置，只精確到車站；點車站可切換到站看板。', 'Positions from TDX LivePosition, station-level only. Tap a station to show its arrivals.')}
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
