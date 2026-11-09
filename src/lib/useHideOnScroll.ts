/**
 * Hide a bottom bar while the rider scrolls down, bring it back as soon as they scroll up —
 * the way Safari's own toolbar behaves.
 *
 * It does not flicker on small finger jitter: the page has to travel HIDE_AFTER px down
 * (or SHOW_AFTER px up) in one direction before the state changes, and a change of
 * direction resets the count. The bar always shows near the top of the page, at the very
 * end of the page (so the footer is reachable and the bar does not vanish on the iOS
 * rubber-band bounce), and while `force` is set. Scroll events are read once per frame.
 */
import { useEffect, useRef, useState } from 'react';

const TOP_ZONE = 64;
const BOTTOM_ZONE = 24;
const HIDE_AFTER = 28;
const SHOW_AFTER = 10;

export function useHideOnScroll(force: boolean): boolean {
  const [hidden, setHidden] = useState(false);
  const hiddenRef = useRef(false);

  useEffect(() => {
    if (force) {
      hiddenRef.current = false;
      setHidden(false);
    }
  }, [force]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let lastY = Math.max(0, window.scrollY);
    let travel = 0;
    let frame = 0;

    const set = (next: boolean) => {
      if (hiddenRef.current === next) return;
      hiddenRef.current = next;
      setHidden(next);
    };

    const read = () => {
      frame = 0;
      const doc = document.documentElement;
      const maxY = Math.max(0, doc.scrollHeight - window.innerHeight);
      // Clamp the rubber-band overscroll iOS reports past either end.
      const y = Math.min(Math.max(0, window.scrollY), maxY);
      const dy = y - lastY;
      lastY = y;
      if (force || y < TOP_ZONE || maxY - y < BOTTOM_ZONE) {
        travel = 0;
        set(false);
        return;
      }
      if (dy === 0) return;
      // A change of direction starts the count again.
      if ((dy > 0 && travel < 0) || (dy < 0 && travel > 0)) travel = 0;
      travel += dy;
      if (travel > HIDE_AFTER) set(true);
      else if (travel < -SHOW_AFTER) set(false);
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [force]);

  return hidden && !force;
}
