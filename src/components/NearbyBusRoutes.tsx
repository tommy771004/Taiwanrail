/**
 * Route list of the selected nearby bus stop, shared by the TRA/THSR and metro
 * 轉乘公車 panels: favourite routes (♥, saved on this device) are pinned to the
 * top, and 「更多公車路線」 reveals the routes only other nearby stops serve,
 * each with the stop to walk to. Everything comes from the NearBy response the
 * panel already holds, so it costs no extra request.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Heart } from 'lucide-react';
import type { BusRoute, BusStation } from '../lib/api';
import { busRouteKey, collectOtherStopRoutes, orderFavoritesFirst } from '../lib/busRoutes';
import { useBusFavorites } from '../hooks/useBusFavorites';

interface Props {
  stations: BusStation[];
  selected: BusStation;
  onSelectStation: (stationId: string) => void;
  zh: boolean;
  /** Text colour of the 更多公車路線 toggle, matching the host panel's mode. */
  accentClass: string;
  /** Smaller route names for the metro card. */
  compact?: boolean;
  /** No side inset: rows start at the host panel's edge (frameless TRA/THSR detail). */
  flush?: boolean;
}

export default function NearbyBusRoutes({ stations, selected, onSelectStation, zh, accentClass, compact = false, flush = false }: Props) {
  const { favoriteSet, toggle } = useBusFavorites();
  const [showOthers, setShowOthers] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setShowOthers(false); }, [selected.StationID]);

  const routes = orderFavoritesFirst(selected.Stops ?? [], favoriteSet);
  const others = collectOtherStopRoutes(stations, selected.StationID);
  const nameClass = compact ? 'text-sm' : 'text-lg';
  const divider = `border-t ${flush ? 'border-slate-200' : 'border-slate-100'} dark:border-white/10`;
  const inset = flush ? 'pl-0' : 'pl-4';

  const heart = (route: BusRoute) => {
    const key = busRouteKey(route);
    const on = favoriteSet.has(key);
    const name = route.RouteName.Zh_tw;
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); toggle(key); }}
        aria-pressed={on}
        aria-label={on ? (zh ? `取消收藏 ${name}` : `Unfavourite ${name}`) : (zh ? `收藏 ${name}` : `Favourite ${name}`)}
        className={`flex size-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-red-500/10 ${
          on ? 'text-red-500 dark:text-red-400' : 'text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400'
        }`}
      >
        <Heart className={`size-5 ${on ? 'fill-current' : ''}`} aria-hidden="true" />
      </button>
    );
  };

  const pickStation = (stationId: string) => {
    onSelectStation(stationId);
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    rootRef.current?.parentElement?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <div ref={rootRef}>
      <div className="flex flex-col">
        {routes.map((route) => (
          <div key={busRouteKey(route)} className={`flex items-center justify-between gap-3 py-2 ${flush ? '' : 'pr-2'} ${inset} ${divider}`}>
            <span className={`flex min-w-0 items-center gap-2 font-bold text-slate-800 dark:text-slate-100 ${nameClass}`}>
              <span className="truncate">{route.RouteName.Zh_tw}</span>
              {favoriteSet.has(busRouteKey(route)) && (
                <span className="shrink-0 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-black text-red-600 dark:text-red-300">
                  {zh ? '已收藏' : 'Saved'}
                </span>
              )}
            </span>
            {heart(route)}
          </div>
        ))}
        {routes.length === 0 && (
          <div className={`p-6 text-center text-sm text-slate-500 ${divider}`}>
            {zh ? '此站牌目前無路線資訊' : 'No routes data'}
          </div>
        )}
      </div>

      {others.length > 0 && (
        <div className={divider}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowOthers((v) => !v); }}
            aria-expanded={showOthers}
            className={`flex w-full items-center justify-center gap-1.5 p-4 text-sm font-bold transition-colors ${accentClass}`}
          >
            {showOthers
              ? (zh ? '收合其他站牌路線' : 'Hide other stops’ routes')
              : (zh ? `更多公車路線（${others.length}）` : `More bus routes (${others.length})`)}
            <ChevronDown className={`size-4 transition-transform ${showOthers ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>

          {showOthers && (
            <div>
              <p className={`pb-2 text-xs ${flush ? '' : 'px-4'} text-slate-500 dark:text-slate-400`}>
                {zh ? '以下路線不停靠目前站牌，需步行到附近其他站牌搭乘；點一下即切換到該站牌。' : 'These routes stop elsewhere nearby. Tap one to switch to its stop.'}
              </p>
              {others.map(({ route, station }) => (
                <div key={busRouteKey(route)} className={`flex items-center gap-2 ${flush ? '' : 'pr-2'} ${divider}`}>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); pickStation(station.StationID); }}
                    className={`flex min-w-0 flex-1 flex-col items-start gap-0.5 py-2.5 ${inset} text-left transition-colors hover:bg-slate-50 dark:hover:bg-white/5`}
                  >
                    <span className={`flex max-w-full items-center gap-2 font-bold text-slate-800 dark:text-slate-100 ${nameClass}`}>
                      <span className="truncate">{route.RouteName.Zh_tw}</span>
                      {favoriteSet.has(busRouteKey(route)) && (
                        <span className="shrink-0 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-black text-red-600 dark:text-red-300">
                          {zh ? '已收藏' : 'Saved'}
                        </span>
                      )}
                    </span>
                    <span className="max-w-full truncate text-xs text-slate-500 dark:text-slate-400">
                      {zh ? `於「${station.StationName.Zh_tw}」搭乘` : `Board at ${station.StationName.En || station.StationName.Zh_tw}`}
                      {station.Distance !== undefined ? ` · ${Math.round(station.Distance)}m` : ''}
                    </span>
                  </button>
                  {heart(route)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
