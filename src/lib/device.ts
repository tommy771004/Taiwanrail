/**
 * True on phones/tablets where the TRA e訂通 / THSR T-EX apps can be installed.
 *
 * Booking deeplinks are universal/app links: the OS only hands them to the
 * native app on a user-initiated top-level navigation, so on mobile the link
 * must be tapped in place (same tab, no popup, no scripted redirect) rather
 * than opened by us (see handleBooking / openRailBooking).
 */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
    // iPadOS 13+ masquerades as Macintosh but exposes multi-touch
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
}
