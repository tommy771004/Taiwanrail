import React, { useState, useEffect, useRef } from 'react';
import { WifiOff, Wifi } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function NetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [justReconnected, setJustReconnected] = useState(false);
  const { i18n } = useTranslation();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setJustReconnected(true);
      window.dispatchEvent(new Event('network-reconnected'));
      
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setJustReconnected(false);
      }, 4000);
    };
    const handleOffline = () => {
      setIsOnline(false);
      setJustReconnected(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  if (isOnline && !justReconnected) return null;

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-5 duration-500">
      <div className={`backdrop-blur-md text-white px-5 py-3 rounded-full flex items-center gap-3 shadow-xl border ${!isOnline ? 'bg-slate-900/90 border-white/10' : 'bg-emerald-600/90 border-emerald-400/30'}`}>
        {!isOnline ? (
          <div className="bg-red-500 w-8 h-8 rounded-full flex items-center justify-center shrink-0">
            <WifiOff size={16} className="text-white" />
          </div>
        ) : (
          <div className="bg-emerald-500 w-8 h-8 rounded-full flex items-center justify-center shrink-0">
            <Wifi size={16} className="text-white" />
          </div>
        )}
        <div className="text-sm">
          {!isOnline ? (
            <>
              <p className="font-bold">
                {i18n.language === 'zh-TW' ? '您目前處於離線狀態' : 'You are currently offline'}
              </p>
              <p className="text-slate-300 text-xs mt-0.5">
                {i18n.language === 'zh-TW' ? '僅能查詢歷史快取時刻表，無法載入即時誤點資訊' : 'Only cached timetables are available, live delays cannot be loaded'}
              </p>
            </>
          ) : (
            <>
              <p className="font-bold">
                {i18n.language === 'zh-TW' ? '網路已恢復連線' : 'Back Online'}
              </p>
              <p className="text-emerald-100 text-xs mt-0.5">
                {i18n.language === 'zh-TW' ? '已自動為您更新最新資訊' : 'Automatically refreshed to latest info'}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
