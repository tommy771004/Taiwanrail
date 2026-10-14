import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BUS_FAVORITES_EVENT,
  BUS_FAVORITES_KEY,
  loadBusFavorites,
  saveBusFavorites,
  toggleFavorite,
} from '../lib/busRoutes';

/**
 * Favourite bus routes, shared by every 轉乘公車 panel on the page and by other
 * tabs (via the `storage` event).
 */
export function useBusFavorites() {
  const [favorites, setFavorites] = useState<string[]>(loadBusFavorites);

  useEffect(() => {
    const reload = () => setFavorites(loadBusFavorites());
    const onStorage = (e: StorageEvent) => { if (e.key === BUS_FAVORITES_KEY) reload(); };
    window.addEventListener(BUS_FAVORITES_EVENT, reload);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(BUS_FAVORITES_EVENT, reload);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const toggle = useCallback((key: string) => {
    saveBusFavorites(toggleFavorite(loadBusFavorites(), key));
  }, []);

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  return { favoriteSet, toggle };
}
