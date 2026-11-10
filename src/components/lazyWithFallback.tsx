import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, X } from 'lucide-react';

interface FallbackProps {
  isOpen?: boolean;
  onClose?: () => void;
}

/**
 * Stands in for a lazily loaded component whose chunk could not be fetched: offline,
 * or a tab opened before a deploy asking for a chunk the new deployment no longer has.
 * Reloading fixes both (a fresh page names the current chunks), so that is the action.
 * It keeps the props contract of the modals it replaces: nothing while `isOpen` is
 * false, and a close button when there is an `onClose`.
 */
function LoadFailed({ isOpen, onClose }: FallbackProps) {
  const { t } = useTranslation();
  if (isOpen === false) return null;
  return (
    <div
      role="alert"
      className="fixed bottom-[calc(var(--tabbar-space)+0.5rem)] left-1/2 z-[120] w-[calc(100%-2rem)] max-w-md -translate-x-1/2"
    >
      <div className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900 py-2.5 pl-4 pr-2 text-white">
        <AlertCircle className="h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" />
        <span className="flex-1 text-sm font-medium">{t('app.toasts.loadFailed')}</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-9 shrink-0 rounded-lg px-3 text-sm font-bold text-amber-200 hover:bg-white/10"
        >
          {t('app.toasts.reload')}
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('app.toasts.dismiss')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * React.lazy, except a failed chunk download renders `LoadFailed` instead of throwing.
 * The app has no error boundary, so a plain lazy component that fails to load takes
 * the whole tree down to a blank page.
 */
export function lazyWithFallback<T extends React.ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return React.lazy(() =>
    load().catch((error: unknown) => {
      console.warn('Lazy chunk failed to load', error);
      return { default: LoadFailed as unknown as T };
    }),
  );
}
