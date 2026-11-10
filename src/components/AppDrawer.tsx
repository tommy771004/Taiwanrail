/**
 * AppDrawer — the side menu behind the header's hamburger button.
 *
 * Holds what used to crowd the header: the brand, the settings, feedback,
 * 「更多工具服務」 (the owner's other sites) and, last, 「功能更新記錄」. It is presentational: App owns every setting
 * and handler. Every row is icon · label · control, so the settings read as one list.
 * Rendered into <body> so no ancestor's transform or overflow clips it.
 */
import { useEffect, useRef, type ComponentType, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Bell, ChevronRight, Compass, ExternalLink, Globe, History, Home, Leaf, MessageCircle, Moon, Train, Type, X } from 'lucide-react';
import { FEATURED_TOOLS, type FeaturedToolIcon } from '../lib/featuredTools';
import { ThemeSwitch } from './ui/animated-theme-toggler';

type Transport = 'train' | 'hsr' | 'metro';
type TextSize = 'small' | 'medium' | 'large';

interface Props {
  open: boolean;
  onClose: () => void;
  zh: boolean;
  /** Tapping the brand: back to an empty search at the top of the page. */
  onBrand: () => void;
  onSetLanguage: (lang: 'zh-TW' | 'en') => void;
  textSize: TextSize;
  onSetTextSize: (size: TextSize) => void;
  preferredTransport: Transport;
  onSetPreferredTransport: (mode: Transport) => void;
  notificationPermission: NotificationPermission | 'unsupported';
  onRequestNotifications: () => void;
  feedbackOpen: boolean;
  onToggleFeedback: () => void;
  /** The feedback form, shown under its row while open. */
  feedback: ReactNode;
  /** 功能更新記錄: App closes this menu and opens the changelog dialog. */
  onOpenChangelog: () => void;
}

const TOOL_ICON: Record<FeaturedToolIcon, ComponentType<{ className?: string }>> = {
  leaf: Leaf,
  globe: Globe,
  home: Home,
  compass: Compass,
};

const ICON = 'w-5 h-5 shrink-0 text-slate-400 dark:text-slate-400';
const ROW = 'px-5 py-3 flex items-center gap-4 min-h-[3.25rem]';
const LABEL = 'flex-1 min-w-0 text-[0.9375rem] font-medium text-slate-800 dark:text-slate-100';

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; text: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 p-0.5 rounded-xl bg-slate-100 dark:bg-slate-800">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => { if (!on) onChange(o.id); }}
            className={`min-w-[2.25rem] px-2.5 py-1 rounded-[0.625rem] text-sm font-bold transition-colors ${
              on ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            {o.text}
          </button>
        );
      })}
    </div>
  );
}

export default function AppDrawer({
  open, onClose, zh, onBrand, onSetLanguage, textSize, onSetTextSize, preferredTransport, onSetPreferredTransport,
  notificationPermission, onRequestNotifications, feedbackOpen, onToggleFeedback, feedback, onOpenChangelog,
}: Props) {
  const { t } = useTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const sectionLabel = 'px-5 pt-5 pb-1 text-xs font-bold tracking-[0.12em] text-slate-400 dark:text-slate-500';
  const transportName: Record<Transport, string> = zh
    ? { train: '台鐵', hsr: '高鐵', metro: '捷運' }
    : { train: 'TRA', hsr: 'HSR', metro: 'Metro' };
  const valueText = 'text-sm text-slate-500 dark:text-slate-400';

  let notifyControl: ReactNode;
  if (notificationPermission === 'default') {
    notifyControl = (
      <button type="button" onClick={onRequestNotifications} className={`${valueText} flex items-center gap-0.5 hover:text-slate-800 dark:hover:text-white`}>
        {zh ? '開啟' : 'Turn on'}<ChevronRight className="w-4 h-4" />
      </button>
    );
  } else if (notificationPermission === 'granted') {
    notifyControl = <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{zh ? '已開啟' : 'On'}</span>;
  } else if (notificationPermission === 'denied') {
    notifyControl = <span className={valueText}>{zh ? '已封鎖' : 'Blocked'}</span>;
  } else {
    notifyControl = <span className={valueText}>{zh ? '不支援' : 'Not supported'}</span>;
  }

  return createPortal(
    <div className="fixed inset-0 z-[96]">
      <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px] animate-in fade-in duration-200" onClick={onClose} aria-hidden="true" />
      <nav
        role="dialog"
        aria-modal="true"
        aria-label={zh ? '選單' : 'Menu'}
        className="absolute inset-y-0 left-0 w-[86vw] max-w-[360px] flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-white/10 shadow-2xl animate-in slide-in-from-left duration-300 overflow-y-auto overscroll-contain"
      >
        <div className="relative px-5 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-5 bg-gradient-to-br from-blue-600 to-blue-900 text-white">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={zh ? '關閉選單' : 'Close menu'}
            className="absolute right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] w-9 h-9 rounded-full grid place-items-center text-white/80 hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <X className="w-5 h-5" />
          </button>
          <button type="button" onClick={() => { onBrand(); onClose(); }} className="flex items-center gap-3 text-left">
            <img src="/logo.svg" alt="" aria-hidden="true" width="44" height="44" className="w-11 h-11 rounded-xl shadow-[0_4px_14px_-4px_rgba(15,23,42,0.5)]" draggable={false} />
            <span className="flex flex-col">
              <span className="text-2xl font-black tracking-tighter leading-none">鐵道查詢</span>
              <span className="mt-1.5 text-[0.5625rem] font-black tracking-[0.2em] uppercase text-blue-100/80">Taiwan · Rail · Tracker</span>
            </span>
          </button>
          <p className="mt-3 text-xs leading-relaxed text-blue-50/90">
            {zh ? '台鐵、高鐵、捷運、公車、YouBike 時刻與即時資訊' : 'TRA, THSR, metro, bus and YouBike timetables and live data'}
          </p>
        </div>

        <section className="pb-2 border-b border-slate-100 dark:border-white/5">
          <h2 className={sectionLabel}>{zh ? '設定' : 'Settings'}</h2>
          <div className={ROW}>
            <Globe className={ICON} />
            <span className={LABEL}>{zh ? '語言' : 'Language'}</span>
            <Segmented
              label={zh ? '語言' : 'Language'}
              value={zh ? 'zh-TW' : 'en'}
              options={[{ id: 'zh-TW', text: '中文' }, { id: 'en', text: 'EN' }]}
              onChange={onSetLanguage}
            />
          </div>
          <div className={ROW}>
            <Moon className={ICON} />
            <span className={LABEL}>{zh ? '深色模式' : 'Dark mode'}</span>
            <ThemeSwitch label={zh ? '深色模式' : 'Dark mode'} />
          </div>
          <div className={ROW}>
            <Type className={ICON} />
            <span className={LABEL}>{zh ? '文字大小' : 'Text size'}</span>
            <Segmented
              label={zh ? '文字大小' : 'Text size'}
              value={textSize}
              options={[
                { id: 'small', text: zh ? '小' : 'S' },
                { id: 'medium', text: zh ? '中' : 'M' },
                { id: 'large', text: zh ? '大' : 'L' },
              ]}
              onChange={onSetTextSize}
            />
          </div>
          <label className={`${ROW} cursor-pointer`}>
            <Train className={ICON} />
            <span className={LABEL}>{zh ? '首選交通工具' : 'Default transport'}</span>
            <span className={`relative ${valueText} flex items-center gap-0.5`}>
              {transportName[preferredTransport]}<ChevronRight className="w-4 h-4" />
              {/* Native picker: the platform's own sheet on phones. */}
              <select
                value={preferredTransport}
                onChange={(e) => onSetPreferredTransport(e.target.value as Transport)}
                aria-label={zh ? '首選交通工具' : 'Default transport'}
                className="absolute inset-0 opacity-0 cursor-pointer"
              >
                {(['train', 'hsr', 'metro'] as const).map((m) => <option key={m} value={m}>{transportName[m]}</option>)}
              </select>
            </span>
          </label>
          <div className={ROW}>
            <Bell className={ICON} />
            <span className={LABEL}>
              {zh ? '列車提醒通知' : 'Train alerts'}
              {notificationPermission === 'denied' && (
                <span className="block text-xs font-normal text-slate-500 dark:text-slate-400 mt-0.5">
                  {zh ? '請在瀏覽器的網站設定中解除封鎖' : 'Unblock it in the browser’s site settings'}
                </span>
              )}
            </span>
            {notifyControl}
          </div>
        </section>

        <section className="py-1 border-b border-slate-100 dark:border-white/5">
          <button
            type="button"
            onClick={onToggleFeedback}
            aria-expanded={feedbackOpen}
            className={`w-full ${ROW} text-left hover:bg-slate-50 dark:hover:bg-white/5`}
          >
            <MessageCircle className={ICON} />
            <span className={LABEL}>{zh ? '意見回饋' : 'Feedback'}</span>
            <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${feedbackOpen ? 'rotate-90' : ''}`} />
          </button>
          {feedbackOpen && <div className="px-5 pb-4">{feedback}</div>}
        </section>

        <section className="pb-2 border-b border-slate-100 dark:border-white/5">
          <h2 className={sectionLabel}>{zh ? '更多工具服務' : 'More tools'}</h2>
          <ul>
            {FEATURED_TOOLS.map((tool) => {
              const Icon = TOOL_ICON[tool.icon];
              return (
                <li key={tool.url}>
                  <a href={tool.url} target="_blank" rel="noopener noreferrer" className={`${ROW} hover:bg-slate-50 dark:hover:bg-white/5`}>
                    <Icon className={ICON} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[0.9375rem] font-medium text-slate-800 dark:text-slate-100">{zh ? tool.title.zh : tool.title.en}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">{zh ? tool.desc.zh : tool.desc.en}</span>
                    </span>
                    <ExternalLink className="w-4 h-4 shrink-0 text-slate-400" />
                  </a>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="py-1">
          <button
            type="button"
            onClick={onOpenChangelog}
            aria-haspopup="dialog"
            className={`w-full ${ROW} text-left hover:bg-slate-50 dark:hover:bg-white/5`}
          >
            <History className={ICON} />
            <span className={LABEL}>{t('changelog.title')}</span>
            <ChevronRight className="w-4 h-4 text-slate-400" />
          </button>
        </section>

        <p className="mt-auto px-5 pt-2 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] text-[0.6875rem] leading-relaxed text-slate-400 dark:text-slate-500">
          {zh ? '資料來源：交通部 TDX 運輸資料流通服務' : 'Data: MOTC TDX Transport Data eXchange'}
        </p>
      </nav>
    </div>,
    document.body,
  );
}
