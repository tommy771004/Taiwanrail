/**
 * Shared client Query throttle UX.
 * `throttled` comes from the tab-wide session store (all modes stay in sync).
 */

import { useCallback, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  tryConsumeQuerySlot,
  isSessionQueryThrottled,
  subscribeSessionQueryThrottle,
} from '../lib/queryThrottleSession';

export function useQueryThrottle(): {
  throttled: boolean;
  /** @returns true if the search may proceed */
  tryConsume: () => boolean;
  message: string;
} {
  const { t } = useTranslation();

  const throttled = useSyncExternalStore(
    subscribeSessionQueryThrottle,
    () => isSessionQueryThrottled(),
    () => false,
  );

  const tryConsume = useCallback((): boolean => tryConsumeQuerySlot(), []);

  return {
    throttled,
    tryConsume,
    message: t('app.queryThrottle'),
  };
}
