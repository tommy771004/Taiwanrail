/**
 * BikeMap — the 單車 tab's pannable dock map (Leaflet), lazy-loaded with BikeSearch.
 *
 * Each dock is a pill marker carrying the number the rider is deciding on — bikes to
 * rent, or free docks to return — and its level is told by the number and a
 * fill/outline/grey style together, never by colour alone. The marker's accessible
 * name spells both counts out; the list view is the full non-visual path.
 *
 * Tiles: 內政部國土測繪中心 台灣通用電子地圖 (EMAP, no key; `img-src https:` already
 * covers it). OpenStreetMap's public tiles are not used here: their usage policy rules
 * out an app's main map. The map sits in its own stacking context (`isolate`), or
 * Leaflet's panes (z-index 400–1000) would draw over the app's fixed header.
 */
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTranslation } from 'react-i18next';
import type { BikeDockWithDistance } from '../lib/api';
import { haversineM } from '../lib/youbikeFeed';

export type BikeMode = 'rent' | 'return';

export interface MapView {
  lat: number;
  lon: number;
  zoom: number;
  /** Centre to the viewport's corner, metres — the radius "search this area" asks for. */
  radiusM: number;
}

interface Props {
  docks: BikeDockWithDistance[];
  mode: BikeMode;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** The rider's position (blue dot); null when unknown. */
  me: { lat: number; lon: number } | null;
  /** Changing this re-frames the map on the current docks (new place, new search). */
  fitKey: string;
  /** Pixels the bottom sheet covers, kept clear when framing or panning to a dock. */
  bottomInset: number;
  /** Where the map was last left, so switching back from the list keeps the view. */
  initialView: MapView | null;
  /** Fired after the rider pans or zooms (not after programmatic moves). */
  onUserMove: (view: MapView) => void;
  /** Fired after any move, so the parent can remember the view. */
  onViewSettled: (view: MapView) => void;
}

const TILE_URL = 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}';
const TAIWAN_CENTER: L.LatLngTuple = [23.7, 120.95];
const FIT_NEAREST = 10;
const FIT_WITH_ME_M = 3000;

export function dockLevel(n: number, suspended: boolean): 'off' | 'none' | 'low' | 'ok' {
  if (suspended) return 'off';
  if (n >= 3) return 'ok';
  if (n >= 1) return 'low';
  return 'none';
}

function viewOf(map: L.Map): MapView {
  const c = map.getCenter();
  const ne = map.getBounds().getNorthEast();
  return {
    lat: c.lat,
    lon: c.lng,
    zoom: map.getZoom(),
    radiusM: Math.round(haversineM(c.lat, c.lng, ne.lat, ne.lng)),
  };
}

export default function BikeMap({ docks, mode, selectedId, onSelect, me, fitKey, bottomInset, initialView, onUserMove, onViewSettled }: Props) {
  const { t } = useTranslation();
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const meRef = useRef<L.CircleMarker | null>(null);
  const programmaticRef = useRef(false);
  const resizingRef = useRef(false);
  // Framing a place can settle in more than one moveend on a short map (fitBounds with a
  // tall sheet padding), so the moves for a while after it all count as the app's own.
  const settleUntilRef = useRef(0);
  const cbRef = useRef({ onSelect, onUserMove, onViewSettled });
  cbRef.current = { onSelect, onUserMove, onViewSettled };

  // Create once; StrictMode's double mount gets a clean remove() in between.
  useEffect(() => {
    if (!elRef.current) return;
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const map = L.map(elRef.current, {
      zoomControl: false,
      minZoom: 7,
      maxZoom: 19,
      zoomAnimation: !reduced,
      fadeAnimation: !reduced,
      markerZoomAnimation: !reduced,
      inertia: !reduced,
    });
    L.tileLayer(TILE_URL, {
      maxZoom: 19,
      attribution: '© 內政部國土測繪中心',
    }).addTo(map);
    L.control.zoom({ position: 'topright', zoomInTitle: '+', zoomOutTitle: '−' }).addTo(map);
    map.attributionControl.setPrefix(false);
    markersRef.current = L.layerGroup().addTo(map);

    programmaticRef.current = true;
    if (initialView) map.setView([initialView.lat, initialView.lon], initialView.zoom, { animate: false });
    else if (me) map.setView([me.lat, me.lon], 16, { animate: false });
    else map.setView(TAIWAN_CENTER, 8, { animate: false });

    map.on('moveend', () => {
      const view = viewOf(map);
      cbRef.current.onViewSettled(view);
      // A resize mid-way through a framing animation must not use up its flag.
      if (resizingRef.current) return;
      if (programmaticRef.current || performance.now() < settleUntilRef.current) {
        programmaticRef.current = false;
        return;
      }
      cbRef.current.onUserMove(view);
    });
    map.on('click', () => cbRef.current.onSelect(null));
    mapRef.current = map;
    // The parent sizes the map to the screen and resizes it when a banner appears above.
    // A resize is not the rider moving the map, so it never offers 「搜尋這個區域」.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
      const el = map.getContainer();
      const size = map.getSize();
      if (el.clientWidth === size.x && el.clientHeight === size.y) return;
      resizingRef.current = true;
      try { map.invalidateSize({ pan: false }); } finally { resizingRef.current = false; }
    }) : null;
    if (elRef.current) ro?.observe(elRef.current);
    return () => {
      ro?.disconnect();
      map.remove();
      mapRef.current = null;
      markersRef.current = null;
      meRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Blue dot for the rider.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!me) {
      meRef.current?.remove();
      meRef.current = null;
      return;
    }
    if (!meRef.current) {
      meRef.current = L.circleMarker([me.lat, me.lon], {
        radius: 8, color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1, interactive: false,
      }).addTo(map);
    } else {
      meRef.current.setLatLng([me.lat, me.lon]);
    }
  }, [me?.lat, me?.lon]);

  // Markers: rebuilt when the docks, the mode or the selection change.
  useEffect(() => {
    const layer = markersRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const d of docks) {
      const n = mode === 'rent' ? d.bikes : d.docks;
      const level = dockLevel(n, d.suspended);
      const selected = d.id === selectedId;
      const label = d.suspended
        ? t('bike.markerSuspendedAria', { name: d.name })
        : t('bike.markerAria', { name: d.name, bikes: d.bikes, docks: d.docks });
      const text = d.suspended ? '×' : String(n);
      const icon = L.divIcon({
        className: 'bike-pin-anchor',
        html: `<span class="bike-pin bike-pin--${level}${selected ? ' is-selected' : ''}${mode === 'return' ? ' is-return' : ''}"><span class="bike-pin__n">${text}</span></span><span class="bike-pin__tail bike-pin__tail--${level}${selected ? ' is-selected' : ''}"></span>`,
        iconSize: [60, 40],
        iconAnchor: [30, 40],
      });
      const marker = L.marker([d.lat, d.lng], {
        icon,
        keyboard: true,
        title: label,
        riseOnHover: true,
        zIndexOffset: selected ? 1000 : level === 'ok' ? 100 : 0,
      });
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        cbRef.current.onSelect(d.id);
      });
      marker.on('add', () => {
        const el = marker.getElement();
        if (el) {
          el.setAttribute('aria-label', label);
          el.setAttribute('aria-pressed', selected ? 'true' : 'false');
        }
      });
      marker.addTo(layer);
    }
  }, [docks, mode, selectedId, t]);

  // Frame a new place / search: every dock plus the rider, clear of the sheet.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitKey) return;
    // Nearby results arrive nearest first: framing all 30 zooms out until the pins pile
    // up, so frame the closest ones and let the rest sit at the edges. The rider is only
    // framed when they are near the results — a search can match docks in another city.
    const near = docks.length && docks[0].distance !== null;
    const framed = near ? docks.slice(0, FIT_NEAREST) : docks;
    const pts: L.LatLngTuple[] = framed.map(d => [d.lat, d.lng]);
    if (me && near && (docks[0].distance ?? Infinity) <= FIT_WITH_ME_M) pts.push([me.lat, me.lon]);
    programmaticRef.current = true;
    settleUntilRef.current = performance.now() + 1000;
    if (pts.length >= 2) {
      map.fitBounds(L.latLngBounds(pts), {
        paddingTopLeft: [32, 48],
        paddingBottomRight: [32, bottomInset + 24],
        maxZoom: 17,
      });
    } else if (pts.length === 1) {
      map.setView(pts[0], 17);
    } else if (me) {
      map.setView([me.lat, me.lon], 16);
    } else {
      programmaticRef.current = false;
    }
    // Only a new fitKey re-frames; later polls keep the rider's view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  // Keep the selected dock visible above the sheet.
  useEffect(() => {
    const map = mapRef.current;
    const d = selectedId ? docks.find(x => x.id === selectedId) : null;
    if (!map || !d) return;
    programmaticRef.current = true;
    const before = map.getCenter();
    map.panInside([d.lat, d.lng], { paddingTopLeft: [40, 60], paddingBottomRight: [40, bottomInset + 40] });
    const after = map.getCenter();
    if (before.lat === after.lat && before.lng === after.lng) programmaticRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, bottomInset]);

  return (
    <div
      ref={elRef}
      role="region"
      aria-label={t('bike.mapLabel')}
      className="isolate absolute inset-0 z-0 bg-slate-100 dark:bg-slate-800"
    />
  );
}
