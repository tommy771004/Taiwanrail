/**
 * BottomTabBar — the six main tabs as a floating glass bar at the bottom of the screen.
 *
 * Translucent blurred fill with a bright top edge; the selected tab sits in a lighter
 * glass bubble that slides between tabs. Without backdrop-filter the fill is opaque.
 * Overlays (bottom sheets, the bus keypad, modals) use higher z-indexes and cover it.
 * It slides away while the rider scrolls down and returns on the first scroll up
 * (useHideOnScroll); keyboard focus inside it keeps it shown.
 * The page reserves its height through `--tabbar-space` (index.css).
 */
import { useState, type ComponentType, type CSSProperties } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useHideOnScroll } from '../lib/useHideOnScroll';
import { Bike, Bus, Compass, Train, TramFront, Zap } from 'lucide-react';

export type MainTab = 'train' | 'hsr' | 'metro' | 'bus' | 'bike' | 'plan';

interface Props {
  active: MainTab;
  onSelect: (tab: MainTab) => void;
  labels: Record<MainTab, string>;
  ariaLabel: string;
}

const TABS: { id: MainTab; Icon: ComponentType<{ className?: string }>; on: string }[] = [
  { id: 'train', Icon: Train, on: 'text-blue-600 dark:text-blue-300' },
  { id: 'hsr', Icon: Zap, on: 'text-orange-600 dark:text-orange-300' },
  { id: 'metro', Icon: TramFront, on: 'text-cyan-600 dark:text-cyan-300' },
  { id: 'bus', Icon: Bus, on: 'text-violet-700 dark:text-violet-300' },
  { id: 'bike', Icon: Bike, on: 'text-orange-700 dark:text-orange-300' },
  { id: 'plan', Icon: Compass, on: 'text-emerald-600 dark:text-emerald-300' },
];

export default function BottomTabBar({ active, onSelect, labels, ariaLabel }: Props) {
  const reduced = useReducedMotion();
  const [focused, setFocused] = useState(false);
  const hidden = useHideOnScroll(focused);
  // Coming back eases out like a sheet settling; leaving is quicker and eases in, so the
  // bar never lingers half-way over content the rider is scrolling to.
  const motionStyle: CSSProperties = reduced
    ? { opacity: hidden ? 0 : 1, transition: 'opacity 160ms linear' }
    : {
        transform: hidden ? 'translateY(calc(100% + 0.625rem + env(safe-area-inset-bottom, 0px) + 0.75rem))' : 'translateY(0)',
        opacity: hidden ? 0 : 1,
        transition: hidden
          ? 'transform 280ms cubic-bezier(0.4, 0, 0.7, 0.2), opacity 220ms ease-in 60ms'
          : 'transform 460ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease-out',
      };
  return (
    <nav
      aria-label={ariaLabel}
      style={motionStyle}
      // Only keyboard focus pins the bar: a tapped tab keeps focus in some browsers and
      // would otherwise stop the bar from ever hiding again.
      onFocus={(e) => { if ((e.target as HTMLElement).matches?.(':focus-visible')) setFocused(true); }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}
      className={`${hidden ? 'pointer-events-none' : ''} will-change-transform fixed z-[45] left-3 right-3 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-[30rem] bottom-[calc(env(safe-area-inset-bottom,0px)+0.625rem)] h-[3.75rem] p-1 rounded-full flex items-center
        border border-white/70 dark:border-white/15
        bg-white/95 dark:bg-slate-900/95 supports-[backdrop-filter]:bg-white/55 dark:supports-[backdrop-filter]:bg-slate-900/50
        backdrop-blur-xl backdrop-saturate-[1.8]
        shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(255,255,255,0.25),0_12px_32px_-10px_rgba(15,23,42,0.35)]
        dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-1px_0_rgba(255,255,255,0.05),0_12px_32px_-10px_rgba(0,0,0,0.7)]`}
    >
      {TABS.map(({ id, Icon, on }) => {
        const selected = id === active;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            aria-current={selected ? 'page' : undefined}
            className={`relative flex-1 h-full min-w-0 rounded-full flex flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
              selected ? on : 'text-slate-600 dark:text-slate-300/80 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {selected && (
              <motion.span
                layoutId="tabbar-bubble"
                transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 38 }}
                className="absolute inset-0 rounded-full bg-white/85 dark:bg-white/[0.14] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.6),0_2px_8px_-2px_rgba(15,23,42,0.18)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.45),inset_0_0_0_1px_rgba(255,255,255,0.12)]"
                aria-hidden="true"
              />
            )}
            <Icon className="relative w-5 h-5" />
            <span className="relative truncate max-w-full px-0.5">{labels[id]}</span>
          </button>
        );
      })}
    </nav>
  );
}
