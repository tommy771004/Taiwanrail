import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, X, Navigation } from 'lucide-react';

interface ExternalLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  trainNo: string;
  transportType: 'train' | 'hsr';
  origin: string;
  originId: string;
  destination: string;
  destId: string;
  date: string;
  searchDate: string;
  depTime: string;
}

export default function ExternalLinkModal({ 
  isOpen, 
  onClose, 
  trainNo, 
  transportType, 
  origin, 
  originId,
  destination,
  destId,
  date,
  searchDate,
  depTime
}: ExternalLinkModalProps) {
  const { i18n } = useTranslation();

  useEffect(() => {
    if (!isOpen) return;

    const timer = setTimeout(() => {
      let baseUrl = '';

      if (transportType === 'hsr') {
        // 高鐵這幾年改成防機器人機制較強的 SPA，GET params 無法順利帶入，會導致 404 或失效。因此跳轉到官方售票首頁，並利用剪貼簿功能輔助。
        baseUrl = 'https://irs.thsrc.com.tw/IMINT/?locale=tw';
      } else {
        const traO = encodeURIComponent(origin);
        const traD = encodeURIComponent(destination);
        // TRA 4.0 'tip112' allows prepopulating the fast gobytime schedule UI
        baseUrl = `https://tip.railway.gov.tw/tra-tip-web/tip/tip001/tip112/querybytime?startStation=${originId}-${traO}&endStation=${destId}-${traD}&rideDate=${searchDate}`;
      }

      // Automatically copy train number to clipboard as a fallback for the official booking form CAPTCHAs
      try {
        navigator.clipboard.writeText(trainNo).catch(() => {});
      } catch (e) {
        // clipboard write fallback
      }

      window.open(baseUrl, '_blank', 'noopener,noreferrer');
      onClose(); // close modal after redirect
    }, 2500);

    return () => clearTimeout(timer);
  }, [isOpen, onClose, transportType, origin, originId, destination, destId, searchDate, depTime, trainNo]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div 
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" 
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
              ? (transportType === 'hsr' ? '即將為您導向官方訂票' : '查詢參數已帶入') 
              : (transportType === 'hsr' ? 'Redirecting to Official Booking' : 'Parameters Pre-filled')}
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

          <div className="bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-xs px-3 py-2 rounded-xl mb-6 font-medium border border-blue-100 dark:border-blue-900/50">
             {i18n.language === 'zh-TW' 
                ? (transportType === 'hsr' 
                  ? '已自動複製車次號碼至剪貼簿。由於高鐵官方系統限制，請於開啟的網頁中手動填寫。' 
                  : '由於官方安全驗證(CAPTCHA)限制，我們已將「起訖站與日期」直接帶入官網查詢頁。')
                : (transportType === 'hsr'
                  ? 'Train number copied. Due to THSR restrictions, please fill the official form manually.'
                  : 'Due to CAPTCHA policies, we have pre-filled the Station & Date on the official site.')}
          </div>
          
          <div className="flex flex-col items-center gap-2 text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
              <span className="text-sm font-bold text-slate-700 dark:text-slate-300">
                {i18n.language === 'zh-TW' ? '正在為您開啓官方網頁...' : 'Redirecting you now...'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
