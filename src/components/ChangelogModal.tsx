/**
 * ChangelogModal — 「功能更新記錄」, opened from the side menu.
 *
 * A card listing what was added, changed and removed, grouped by day, newest first.
 * The entries live in `src/lib/changelog.ts`; this file only draws them. Lazy-loaded
 * by App, so neither the list nor this dialog is in the entry chunk.
 *
 * Every string goes through i18next: the labels are `changelog.*` in `src/i18n.ts`,
 * the entries are the `CHANGELOG_NS` namespace registered below when this chunk
 * loads, and dates are formatted by `Intl` in the current language.
 * Rendered into <body> so no ancestor's transform or overflow clips it.
 */
import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import i18n from '../i18n';
import { CHANGELOG, CHANGELOG_LANGS, CHANGELOG_NS, changeKey, changelogBundle, type ChangeKind, type ChangelogLang } from '../lib/changelog';

for (const lang of Object.keys(CHANGELOG_LANGS) as ChangelogLang[]) {
  if (!i18n.hasResourceBundle(lang, CHANGELOG_NS)) i18n.addResourceBundle(lang, CHANGELOG_NS, changelogBundle(lang));
}

interface Props {
  onClose: () => void;
}

const KIND_CLASS: Record<ChangeKind, string> = {
  added: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/20',
  changed: 'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-400/10 dark:text-blue-300 dark:ring-blue-400/20',
  removed: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-400/10 dark:text-rose-300 dark:ring-rose-400/20',
};

/** "2026-11-09" as a Date at UTC midnight; formatted with timeZone 'UTC' so no timezone can shift the day. */
const utcDay = (date: string) => new Date(`${date}T00:00:00Z`);

export default function ChangelogModal({ onClose }: Props) {
  const { t, i18n: { language } } = useTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // Focus stays inside the dialog: Tab moves between the close button and the
      // list. The list takes focus so the arrow keys and Page Down can scroll it.
      if (e.key === 'Tab') {
        e.preventDefault();
        if (document.activeElement === listRef.current) closeRef.current?.focus();
        else listRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // 「11月9日週一」 / "Mon, Nov 9" for a day; 「2026年10月10日 – 2026年11月10日」 /
  // "Oct 10, 2026 – Nov 10, 2026" for the span. Not `formatRange`: Chrome renders a
  // zh-TW range as 2026/10/10至2026/11/10 whatever month style is asked for.
  const { dayFormat, range } = useMemo(() => {
    const day = new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', weekday: 'short', timeZone: 'UTC' });
    const full = new Intl.DateTimeFormat(language, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
    const newest = CHANGELOG[0]?.date;
    const oldest = CHANGELOG[CHANGELOG.length - 1]?.date;
    const span = newest && oldest ? `${full.format(utcDay(oldest))} – ${full.format(utcDay(newest))}` : '';
    return { dayFormat: day, range: span };
  }, [language]);

  if (typeof document === 'undefined') return null;

  // The English labels differ in length; one width keeps the text column straight.
  const kindWidth = language.startsWith('zh') ? '' : 'min-w-[4.25rem]';

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-[2px] animate-in fade-in duration-200" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="changelog-title"
        className="relative w-full max-w-md max-h-full flex flex-col rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 shadow-2xl animate-in fade-in zoom-in-95 duration-200 overflow-hidden"
      >
        <header className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-slate-100 dark:border-white/5">
          <div className="flex-1 min-w-0">
            <h2 id="changelog-title" className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">{t('changelog.title')}</h2>
            {range && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{range}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('changelog.close')}
            className="-mr-1.5 -mt-1 w-9 h-9 shrink-0 rounded-full grid place-items-center text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </header>

        <div
          ref={listRef}
          tabIndex={0}
          role="group"
          aria-label={t('changelog.listLabel')}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-5 soft-scrollbar focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
        >
          {CHANGELOG.map((day) => (
            <section key={day.date} aria-labelledby={`changelog-${day.date}`}>
              <h3
                id={`changelog-${day.date}`}
                className="sticky top-0 -mx-5 px-5 pt-4 pb-2 bg-white/95 dark:bg-slate-900/95 backdrop-blur text-[0.8125rem] font-bold text-slate-900 dark:text-slate-100 tabular-nums"
              >
                <time dateTime={day.date}>{dayFormat.format(utcDay(day.date))}</time>
              </h3>
              <ul className="space-y-2.5">
                {day.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className={`mt-px shrink-0 rounded-md px-1.5 py-0.5 text-center text-[0.6875rem] font-bold leading-4 ring-1 ring-inset ${kindWidth} ${KIND_CLASS[item.kind]}`}>
                      {t(`changelog.kind.${item.kind}`)}
                    </span>
                    <span className="min-w-0 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                      {t(changeKey(day.date, i), { ns: CHANGELOG_NS })}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
