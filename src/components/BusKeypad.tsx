/**
 * BusKeypad — the 公車 search's route keypad, a panel pinned to the bottom of the screen in
 * place of the phone keyboard (the input runs with inputMode="none" while it is open).
 *
 * Every key that is not a digit comes from the data (busKeypad in src/lib/busData.ts): the
 * word row (幹線、通勤、市民 …) and the coloured prefix keys (紅、藍、小、F …). A colour is a
 * display aid only — the key's own text is its label. Seven prefix keys fit the grid (colour
 * keys first, 紅 藍 綠 棕 橘 小); any more go to the front of the word row.
 */
import type { Ref } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Delete, Keyboard } from 'lucide-react';

interface Labels {
  pad: string;
  words: string;
  hide: string;
  keyboard: string;
  clear: string;
  backspace: string;
}

interface Props {
  keys: string[];
  words: string[];
  labels: Labels;
  onType: (text: string) => void;
  onWord: (word: string) => void;
  onClear: () => void;
  onBackspace: () => void;
  onKeyboard: () => void;
  onHide: () => void;
  panelRef: Ref<HTMLDivElement>;
}

const GRID_KEYS = 7;

const KEY_COLOR: Record<string, string> = {
  紅: 'text-red-600 dark:text-red-400',
  藍: 'text-blue-600 dark:text-blue-400',
  綠: 'text-green-700 dark:text-green-400',
  棕: 'text-[#7a4a24] dark:text-[#c8956a]',
  橘: 'text-orange-500 dark:text-orange-400',
  黃: 'text-yellow-600 dark:text-yellow-400',
  紫: 'text-purple-600 dark:text-purple-400',
};

/** Colour keys first, in the order riders know them; the rest as the data ranks them. */
const KEY_ORDER = ['紅', '藍', '綠', '棕', '橘', '黃', '紫', '小'];
const orderKeys = (keys: string[]) => {
  const rank = (k: string) => (KEY_ORDER.includes(k) ? KEY_ORDER.indexOf(k) : KEY_ORDER.length);
  return keys.map((k, i) => ({ k, i })).sort((a, b) => rank(a.k) - rank(b.k) || a.i - b.i).map((x) => x.k);
};

const keyShape =
  'h-[50px] rounded-full border border-slate-300 dark:border-white/15 bg-white dark:bg-white/10 inline-flex items-center justify-center font-medium active:bg-slate-200 dark:active:bg-white/20 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500';
const INK = 'text-slate-900 dark:text-white';
const keyBase = `${keyShape} text-[22px] ${INK}`;
const inkOf = (k: string) => KEY_COLOR[k] ?? INK;

export default function BusKeypad({ keys, words, labels, onType, onWord, onClear, onBackspace, onKeyboard, onHide, panelRef }: Props) {
  const ordered = orderKeys(keys);
  const gridKeys = ordered.slice(0, GRID_KEYS);
  const rowWords = [...ordered.slice(GRID_KEYS), ...words];
  const prefixKey = (i: number) => {
    const k = gridKeys[i];
    if (!k) return <span key={`blank-${i}`} aria-hidden="true" />;
    return (
      <button key={k} type="button" onClick={() => onType(k)} className={`${keyShape} text-[22px] font-bold ${inkOf(k)}`}>
        {k}
      </button>
    );
  };
  const digit = (d: string) => (
    <button key={d} type="button" onClick={() => onType(d)} className={keyBase}>
      {d}
    </button>
  );

  // Portaled to <body>: the tab's card is a containing block for position: fixed.
  return createPortal(
    <div
      ref={panelRef}
      role="group"
      aria-label={labels.pad}
      className="fixed inset-x-0 bottom-0 z-[80] border-t border-slate-300 dark:border-white/10 bg-slate-100 dark:bg-[#1a1626] shadow-[0_-12px_32px_-12px_rgba(15,23,42,0.25)]"
    >
      <div className="mx-auto max-w-md">
        <div className="flex items-stretch bg-white dark:bg-white/5 border-b border-slate-300 dark:border-white/10">
          <div role="group" aria-label={labels.words} className="flex-1 min-w-0 flex items-center overflow-x-auto soft-scrollbar">
            {rowWords.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => onWord(w)}
                className={`shrink-0 px-3.5 h-12 text-[17px] font-bold whitespace-nowrap active:bg-slate-100 dark:active:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 ${inkOf(w)}`}
              >
                {w}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onHide}
            aria-label={labels.hide}
            title={labels.hide}
            className="shrink-0 w-12 h-12 inline-flex items-center justify-center border-l border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500"
          >
            <ChevronDown className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <div className="grid grid-cols-5 gap-x-2 gap-y-2.5 px-3 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          {prefixKey(0)}{prefixKey(1)}{digit('1')}{digit('2')}{digit('3')}
          {prefixKey(2)}{prefixKey(3)}{digit('4')}{digit('5')}{digit('6')}
          {prefixKey(4)}{prefixKey(5)}{digit('7')}{digit('8')}{digit('9')}
          <button type="button" onClick={onKeyboard} aria-label={labels.keyboard} title={labels.keyboard} className={keyBase}>
            <Keyboard className="w-6 h-6" aria-hidden="true" />
          </button>
          {prefixKey(6)}
          <button type="button" onClick={onClear} className={`${keyShape} text-[16px] ${INK}`}>
            {labels.clear}
          </button>
          {digit('0')}
          <button type="button" onClick={onBackspace} aria-label={labels.backspace} title={labels.backspace} className={keyBase}>
            <Delete className="w-6 h-6" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
