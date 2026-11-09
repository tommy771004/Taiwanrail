/**
 * Height for a panel (the 單車 / 公車 maps) that ends at the bottom of the screen when the
 * page is at the top, so whatever sits on the panel's lower edge — the nearby sheet — is on
 * the first screen. It is measured from the panel's position in the document, so it does not
 * change while the page scrolls.
 *
 * `100svh` is the viewport with the phone browser's toolbars showing: it does not grow when
 * Safari hides them mid-scroll, so the map is not resized under the rider's finger. A
 * browser without svh drops the declaration and keeps the element's own height class.
 */
import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

export function useFillViewport(ref: RefObject<HTMLElement | null>, enabled: boolean, opts: { min: number; max: number; gap?: number }): CSSProperties | undefined {
  const [top, setTop] = useState<number | null>(null);
  const gap = opts.gap ?? 8;

  // Every render: what sits above the panel (a banner, an error line) may have moved it.
  useLayoutEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    const t = Math.round(el.getBoundingClientRect().top + window.scrollY);
    setTop((p) => (p !== null && Math.abs(p - t) < 2 ? p : t));
  });

  useLayoutEffect(() => {
    if (!enabled) return;
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const t = Math.round(el.getBoundingClientRect().top + window.scrollY);
      setTop((p) => (p !== null && Math.abs(p - t) < 2 ? p : t));
    };
    window.addEventListener('resize', measure);
    // Layout changes outside this component (the app hero compacting) move it too.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(document.documentElement);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, [enabled, ref]);

  if (!enabled || top === null) return undefined;
  return { height: `clamp(${opts.min}px, calc(100svh - ${top + gap}px), ${opts.max}px)` };
}
