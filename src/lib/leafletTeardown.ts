import type { Map as LeafletMap } from 'leaflet';

/**
 * Remove a Leaflet map that may be mid-animation (a tab switch unmounts 單車／公車 at any moment).
 *
 * Leaflet 1.9 finishes a zoom animation from `setTimeout(_onZoomTransitionEnd, 250)`. If the map is
 * removed inside that window, the callback runs on a map whose panes are gone and throws
 * "Cannot read properties of undefined (reading '_leaflet_pos')". The callback returns at once when
 * `_animatingZoom` is false, so the zoom animation is ended (and any pan / flyTo stopped) first.
 */
export function removeLeafletMap(map: LeafletMap): void {
  map.stop();
  (map as unknown as { _animatingZoom?: boolean })._animatingZoom = false;
  map.remove();
}
