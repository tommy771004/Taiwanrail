import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, X, Navigation } from 'lucide-react';
import { isMobileDevice } from '../lib/device';

interface ExternalLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  trainNo: string;
  transportType: 'train' | 'hsr';
  origin: string;
  destination: string;
  date: string;
  depTime: string;
  url: string;
  popupBlocked?: boolean;
  usedFallback?: boolean;
}

export default function ExternalLinkModal({
  isOpen,
  onClose,
  trainNo,
  transportType,
  origin,
  destination,
  date,
  depTime,
  url,
  popupBlocked = false,
  usedFallback = false,
}: ExternalLinkModalProps) {
  const { i18n } = useTranslation();
  // On mobile the deeplink must be a same-tab, user-tapped navigation so the
  // OS hands it to the T-EX / e訂通 app; target="_blank" would load the web
  // fallback in a new tab instead.
  const sameTab = isMobileDevice();

  useEffect(() => {
    // Keep the modal open on mobile: if the app handoff fails silently the
    // manual button is the user's only way to retry.
    if (!isOpen || popupBlocked || sameTab) return;
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [isOpen, onClose, popupBlocked, sameTab]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      <div className="relative bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in-95 duration-300">
        <button
          onClick={onClose}
          className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex flex-col items-center text-center mt-2">
          <div className="w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center mb-6 relative">
            <div className="absolute inset-0 bg-blue-400 rounded-full animate-ping opacity-20"></div>
            <ExternalLink className="w-8 h-8 text-blue-600 dark:text-blue-400" />
          </div>

          <h3 className="text-xl font-black text-slate-900 dark:text-white mb-2 tracking-tight">
            {i18n.language === 'zh-TW'
              ? (transportType === 'hsr'
                ? (usedFallback ? '改由高鐵官網繼續' : '即將開啟高鐵 T-EX')
                : usedFallback ? '改由臺鐵官網繼續' : '即將開啟台鐵 e 訂通')
              : (transportType === 'hsr'
                ? (usedFallback ? 'Continue on the HSR Website' : 'Opening the HSR T-EX App')
                : usedFallback ? 'Continue on the TRA Website' : 'Opening the TRA e-booking App')}
          </h3>

          <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl w-full mb-4 border border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between text-sm font-bold text-slate-600 dark:text-slate-300 mb-2">
              <span>{transportType === 'hsr' ? '高鐵' : '台鐵'} <span className="bg-white dark:bg-slate-700 px-1.5 py-0.5 rounded ml-1 border border-slate-200 dark:border-slate-600 text-blue-600">{trainNo}</span></span>
              <span className="text-blue-600 dark:text-blue-400 text-xs">{date} {depTime}</span>
            </div>
            <div className="flex items-center justify-center gap-2 text-lg font-black text-slate-900 dark:text-white tracking-widest mt-1">
              <span>{origin}</span>
              <Navigation className="w-4 h-4 text-slate-400" />
              <span>{destination}</span>
            </div>
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-xs px-3 py-2 rounded-xl mb-5 font-medium border border-blue-100 dark:border-blue-900/50">
            {i18n.language === 'zh-TW'
              ? (transportType === 'hsr'
                ? usedFallback
                  ? '目前無法取得 App 導訂連結，請在高鐵官網完成訂票。'
                  : '已帶入起訖站、乘車日期、時間與車次，可直接在 T-EX App 繼續訂票。'
                : usedFallback
                  ? '目前無法取得 App 導訂連結，請在臺鐵官網完成訂票。'
                  : '已帶入起訖站、乘車日期與車次，可直接在台鐵 e 訂通 App 繼續訂票。')
              : (transportType === 'hsr'
                ? usedFallback
                  ? 'The app link is unavailable. Please complete booking on the HSR website.'
                  : 'Stations, date, time, and train number are ready in the T-EX app.'
                : usedFallback
                  ? 'The app link is unavailable. Please complete booking on the TRA website.'
                  : 'Stations, date, and train number are ready in the TRA e-booking app.')}
          </div>

          {/* Fallback tap-to-open button — critical for iOS Safari popup blocker */}
          <a
            href={url}
            target={sameTab ? undefined : '_blank'}
            rel="noopener noreferrer"
            onClick={onClose}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-bold text-sm px-5 py-3 rounded-2xl transition-all shadow-lg shadow-blue-900/20 mb-3 no-underline"
          >
            <ExternalLink className="w-4 h-4 shrink-0" />
            {i18n.language === 'zh-TW'
              ? (!usedFallback
                ? (transportType === 'hsr' ? '開啟高鐵 T-EX' : '開啟台鐵 e 訂通')
                : '點此開啟官方訂票頁')
              : (!usedFallback
                ? (transportType === 'hsr' ? 'Open HSR T-EX' : 'Open TRA e-booking')
                : 'Open Booking Page')}
          </a>

          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            {popupBlocked ? (
              <>
                <span className="text-base">🚫</span>
                <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                  {i18n.language === 'zh-TW' ? '彈出視窗被瀏覽器封鎖，請點擊上方按鈕' : 'Popup blocked. Please tap the button above.'}
                </span>
              </>
            ) : (
              <>
                <div className="w-4 h-4 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {sameTab
                    ? (i18n.language === 'zh-TW' ? '正在為您開啟，若未跳轉請點擊上方按鈕' : 'Opening now. If nothing happens, tap the button above.')
                    : (i18n.language === 'zh-TW' ? '已在新分頁開啟，此提示將自動關閉' : 'Opened in new tab. This notice will close shortly.')}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
