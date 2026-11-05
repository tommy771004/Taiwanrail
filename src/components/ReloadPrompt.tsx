import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GATE_RELOAD_EVENT, isReloadRequired } from '../lib/gateTicketClient';

/** Shown when the gate stopped this page's live data; timetables keep working without a reload. */
export default function ReloadPrompt() {
  const [needed, setNeeded] = useState(isReloadRequired);
  const { i18n } = useTranslation();
  const zh = i18n.language === 'zh-TW';

  useEffect(() => {
    const onReloadRequired = () => setNeeded(true);
    window.addEventListener(GATE_RELOAD_EVENT, onReloadRequired);
    return () => window.removeEventListener(GATE_RELOAD_EVENT, onReloadRequired);
  }, []);

  if (!needed) return null;

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 w-max max-w-[calc(100vw-2rem)] animate-in fade-in slide-in-from-bottom-5 duration-500">
      <div role="status" className="bg-slate-900/90 backdrop-blur-md text-white pl-5 pr-2 py-2 rounded-full flex items-center gap-3 shadow-xl border border-slate-700">
        <p className="text-sm font-bold">
          {zh ? '即時資料已暫停' : 'Live updates paused'}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1.5 bg-white text-slate-900 text-sm font-bold px-4 py-2 rounded-full"
        >
          <RefreshCw size={14} aria-hidden="true" />
          {zh ? '重新整理' : 'Reload'}
        </button>
      </div>
    </div>
  );
}
