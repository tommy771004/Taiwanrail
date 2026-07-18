import React from 'react';
import { Clock, X } from 'lucide-react';
import type { RecentSearchEntry } from '../lib/recentSearches';

interface Props {
  entries: RecentSearchEntry[];
  language: string;
  onSelect: (entry: RecentSearchEntry) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
}

export default function RecentSearches({ entries, language, onSelect, onRemove, onClearAll }: Props) {
  if (!entries.length) return null;
  const isZh = language === 'zh-TW';

  return (
    <div className="w-full max-w-5xl mx-auto px-4 md:px-8 mt-4 sm:mt-6 mb-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between mb-3 px-1">
        <h3 className="text-base sm:text-lg font-black tracking-tight text-slate-900">
          {isZh ? '最近搜尋' : 'Recent searches'}
        </h3>
        <button
          type="button"
          onClick={onClearAll}
          className="text-xs sm:text-sm font-semibold text-slate-500 hover:text-slate-900 transition-colors"
        >
          {isZh ? '清除全部' : 'Clear all'}
        </button>
      </div>

      <ul className="flex overflow-x-auto gap-3 pb-2 soft-scrollbar snap-x snap-mandatory">
        {entries.map((entry) => (
          <li key={entry.id} className="shrink-0 w-fit max-w-[calc(100vw-2rem)] snap-start">
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelect(entry)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(entry);
                }
              }}
              className="group inline-flex w-fit max-w-full items-center gap-2.5 bg-white border border-slate-200/70 rounded-2xl px-3 py-1.5 shadow-sm hover:shadow-md hover:border-slate-300 transition-all cursor-pointer"
            >
              <div className="w-6 h-6 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0">
                <Clock className="w-3.5 h-3.5 text-slate-500" />
              </div>

              <div className="flex min-w-0 items-center gap-2">
                <span className="text-sm sm:text-base font-bold text-slate-900 truncate">
                  {entry.originName}
                </span>
                <span className="text-slate-400 text-sm shrink-0">→</span>
                <span className="text-sm sm:text-base font-bold text-slate-900 truncate">
                  {entry.destName}
                </span>
                {entry.tripType === 'round-trip' && (
                  <span className="ml-1 text-[0.625rem] font-bold tracking-widest uppercase text-sky-700 bg-sky-50 border border-sky-100 px-1.5 py-0.5 rounded-full shrink-0">
                    {isZh ? '來回' : 'RT'}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(entry.id);
                }}
                className="w-6 h-6 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors shrink-0"
                aria-label={isZh ? '移除此筆搜尋' : 'Remove this search'}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
