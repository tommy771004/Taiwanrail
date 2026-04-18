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

function formatDate(dateStr: string, language: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return dateStr;
  const [, y, mo, d] = m;
  if (language === 'zh-TW') return `${y}年${mo}月${d}日`;
  const date = new Date(`${dateStr}T00:00:00`);
  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date);
}

export default function RecentSearches({ entries, language, onSelect, onRemove, onClearAll }: Props) {
  if (!entries.length) return null;
  const isZh = language === 'zh-TW';

  return (
    <div className="w-full max-w-5xl mx-auto px-4 md:px-8 mt-4 sm:mt-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
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

      <ul className="flex flex-col gap-2">
        {entries.map((entry) => (
          <li key={entry.id}>
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
              className="group flex items-center gap-3 bg-white border border-slate-200/70 rounded-2xl px-4 py-3 shadow-sm hover:shadow-md hover:border-slate-300 transition-all cursor-pointer"
            >
              <div className="w-8 h-8 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4 text-slate-500" />
              </div>

              <div className="flex-1 min-w-0 flex items-center gap-2">
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

              <span className="hidden sm:inline text-xs sm:text-sm text-slate-500 font-medium shrink-0">
                {formatDate(entry.date, language)}
              </span>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(entry.id);
                }}
                className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors shrink-0"
                aria-label={isZh ? '移除此筆搜尋' : 'Remove this search'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="sm:hidden px-2 pt-1 text-[0.6875rem] text-slate-500 font-medium">
              {formatDate(entry.date, language)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
