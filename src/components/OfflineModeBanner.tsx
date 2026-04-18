import React from 'react';
import { CloudOff, Train, WifiOff } from 'lucide-react';
import type { OfflineCountdown } from '../lib/offlineSnapshot';

type Stage = 'weak' | 'switching' | 'active';

interface Props {
  language: string;
  savedAt: number;
  countdown: OfflineCountdown | null;
  stage?: Stage;
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

// Radial progress ring used during the weak/switching stages so the handoff feels gradual.
function ProgressRing({ progress }: { progress: number }) {
  const size = 36;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = Math.max(0, Math.min(1, progress)) * c;
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(217,119,6,0.2)" strokeWidth={stroke} fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke="rgb(217,119,6)"
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray 1s linear' }}
      />
    </svg>
  );
}

export default function OfflineModeBanner({ language, savedAt, countdown, stage = 'active', onDismiss }: Props) {
  const isZh = language === 'zh-TW';

  const progress = stage === 'weak' ? 0.35 : stage === 'switching' ? 0.75 : 1;

  const title =
    stage === 'weak'
      ? isZh ? '偵測到訊號微弱…' : 'Weak signal detected…'
      : stage === 'switching'
        ? isZh ? '正在切換離線估算模式' : 'Switching to offline mode'
        : isZh ? '離線估算模式' : 'Offline estimation mode';

  const chipLabel =
    stage === 'weak'
      ? isZh ? '等待重連' : 'Retrying'
      : stage === 'switching'
        ? isZh ? '載入快取' : 'Loading cache'
        : isZh ? '本地時鐘倒數' : 'Local clock';

  const description =
    stage === 'weak'
      ? isZh ? '可能即將進入隧道或地下段，暫時降低更新頻率。' : 'Possibly entering a tunnel / underground section. Slowing updates.'
      : stage === 'switching'
        ? isZh ? `正在載入最近一次快取的時刻表…` : 'Loading most recent cached schedule…'
        : isZh
          ? `偵測不到網路（可能位於隧道或地下段），改用 ${formatSavedAt(savedAt, language)} 的快取時刻表。`
          : `No network detected (tunnel/underground). Showing cached schedule from ${formatSavedAt(savedAt, language)}.`;

  return (
    <div
      className={`mx-3 sm:mx-0 my-3 rounded-2xl border shadow-sm p-3 sm:p-4 flex items-start gap-3 transition-colors duration-700 ${
        stage === 'active'
          ? 'border-amber-200 bg-gradient-to-br from-amber-50 to-white'
          : 'border-amber-100 bg-gradient-to-br from-amber-50/60 to-white'
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="shrink-0 w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 relative">
        {stage === 'active' ? (
          <CloudOff className="w-4 h-4" />
        ) : (
          <>
            <div className="absolute inset-0 flex items-center justify-center">
              <ProgressRing progress={progress} />
            </div>
            <WifiOff className="w-4 h-4 z-10 animate-pulse" />
          </>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-amber-900 text-sm">{title}</span>
          <span className="text-[0.625rem] uppercase tracking-widest font-bold text-amber-700 bg-amber-100/80 border border-amber-200 px-1.5 py-0.5 rounded-full">
            {chipLabel}
          </span>
        </div>
        <p className="text-xs text-slate-600 mt-1 leading-snug">{description}</p>
        {stage === 'active' && countdown && (
          <div className="mt-2 flex items-center gap-2 bg-white/80 border border-amber-100 rounded-xl px-3 py-2 animate-in fade-in duration-500">
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
      {stage === 'active' && onDismiss && (
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
