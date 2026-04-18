import React from 'react';
import { CloudOff, Train } from 'lucide-react';
import type { OfflineCountdown } from '../lib/offlineSnapshot';

interface Props {
  language: string;
  savedAt: number;
  countdown: OfflineCountdown | null;
  onDismiss?: () => void;
}

function formatSavedAt(savedAt: number, language: string): string {
  const d = new Date(savedAt);
  const fmt = new Intl.DateTimeFormat(language === 'zh-TW' ? 'zh-TW' : 'en-GB', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Taipei',
  });
  return fmt.format(d);
}

export default function OfflineModeBanner({ language, savedAt, countdown, onDismiss }: Props) {
  const isZh = language === 'zh-TW';
  return (
    <div className="mx-3 sm:mx-0 my-3 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white shadow-sm p-3 sm:p-4 flex items-start gap-3">
      <div className="shrink-0 w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center text-amber-700">
        <CloudOff className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-amber-900 text-sm">
            {isZh ? '離線估算模式' : 'Offline estimation mode'}
          </span>
          <span className="text-[0.625rem] uppercase tracking-widest font-bold text-amber-700 bg-amber-100/80 border border-amber-200 px-1.5 py-0.5 rounded-full">
            {isZh ? '本地時鐘倒數' : 'Local clock'}
          </span>
        </div>
        <p className="text-xs text-slate-600 mt-1 leading-snug">
          {isZh
            ? `偵測不到網路（可能位於隧道或地下段），改用 ${formatSavedAt(savedAt, language)} 的快取時刻表。`
            : `No network detected (tunnel/underground). Showing cached schedule from ${formatSavedAt(savedAt, language)}.`}
        </p>
        {countdown && (
          <div className="mt-2 flex items-center gap-2 bg-white/80 border border-amber-100 rounded-xl px-3 py-2">
            <Train className="w-4 h-4 text-amber-700 shrink-0" />
            <div className="text-xs text-slate-700 leading-tight">
              <div className="font-bold text-slate-900">
                {isZh ? '下一班' : 'Next'} {countdown.trainNo && `#${countdown.trainNo}`} · {countdown.depTime}
              </div>
              <div className="text-amber-800">
                {countdown.status === 'departed'
                  ? isZh ? '應已發車（依本地時鐘）' : 'Should have departed (per local clock)'
                  : countdown.status === 'boarding'
                    ? isZh ? `即將發車（約 ${Math.max(0, countdown.minutesUntilDeparture)} 分鐘）` : `Boarding now (~${Math.max(0, countdown.minutesUntilDeparture)} min)`
                    : isZh
                      ? `預計 ${countdown.minutesUntilDeparture} 分鐘後發車`
                      : `Departs in ~${countdown.minutesUntilDeparture} min`}
              </div>
            </div>
          </div>
        )}
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-amber-700 hover:text-amber-900 text-xs font-semibold shrink-0"
        >
          {isZh ? '關閉' : 'Dismiss'}
        </button>
      )}
    </div>
  );
}
