/**
 * BusMap — the 公車 tab's stop map (Leaflet on 內政部國土測繪中心 EMAP tiles, like BikeMap),
 * lazy-loaded with BusSearch. Each pin is one place (same-named poles at an intersection)
 * and carries how many routes board there; its accessible name says the name and the count.
 * Pins come from the static snapshot only — the map costs no TDX call.
 */
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { haversineM } from '../lib/busData';

export interface BusMapView {
  lat: number;
  lon: number;
  zoom: number;
  /** Centre to the viewport's corner, metres. */
  radiusM: number;
}

export interface BusPin {
  id: string;
  lat: number;
  lon: number;
  count: number;
  label: string;
}

interface Props {
  pins: BusPin[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  me: { lat: number; lon: number } | null;
  /** Changing it re-frames the map on `fitTo` (a new position or region). */
  fitKey: string;
  fitTo: { lat: number; lon: number; zoom: number } | null;
  bottomInset: number;
  initialView: BusMapView | null;
  onViewSettled: (view: BusMapView) => void;
  ariaLabel: string;
}

const TILE_URL = 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}';
const TAIWAN_CENTER: L.LatLngTuple = [23.7, 120.95];

function viewOf(map: L.Map): BusMapView {
  const c = map.getCenter();
  const ne = map.getBounds().getNorthEast();
  return { lat: c.lat, lon: c.lng, zoom: map.getZoom(), radiusM: Math.round(haversineM(c.lat, c.lng, ne.lat, ne.lng)) };
}

export default function BusMap({ pins, selectedId, onSelect, me, fitKey, fitTo, bottomInset, initialView, onViewSettled, ariaLabel }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const meRef = useRef<L.CircleMarker | null>(null);
  const cbRef = useRef({ onSelect, onViewSettled });
  cbRef.current = { onSelect, onViewSettled };

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
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: '© 內政部國土測繪中心' }).addTo(map);
    L.control.zoom({ position: 'topright', zoomInTitle: '+', zoomOutTitle: '−' }).addTo(map);
    map.attributionControl.setPrefix(false);
    layerRef.current = L.layerGroup().addTo(map);
    if (initialView) map.setView([initialView.lat, initialView.lon], initialView.zoom, { animate: false });
    else if (fitTo) map.setView([fitTo.lat, fitTo.lon], fitTo.zoom, { animate: false });
    else if (me) map.setView([me.lat, me.lon], 16, { animate: false });
    else map.setView(TAIWAN_CENTER, 8, { animate: false });
    map.on('moveend', () => cbRef.current.onViewSettled(viewOf(map)));
    map.on('click', () => cbRef.current.onSelect(null));
    mapRef.current = map;
    // The first view is reported so the parent can place pins before any move.
    cbRef.current.onViewSettled(viewOf(map));
    // The parent sizes the map to the screen and resizes it when a banner appears above.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => map.invalidateSize({ pan: false })) : null;
    if (elRef.current) ro?.observe(elRef.current);
    return () => {
      ro?.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      meRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!me) { meRef.current?.remove(); meRef.current = null; return; }
    if (!meRef.current) {
      meRef.current = L.circleMarker([me.lat, me.lon], { radius: 8, color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1, interactive: false }).addTo(map);
    } else {
      meRef.current.setLatLng([me.lat, me.lon]);
    }
  }, [me?.lat, me?.lon]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const p of pins) {
      const selected = p.id === selectedId;
      const icon = L.divIcon({
        className: 'bus-pin-anchor',
        html: `<span class="bus-pin${selected ? ' is-selected' : ''}">${p.count}</span><span class="bus-pin__tail${selected ? ' is-selected' : ''}"></span>`,
        iconSize: [48, 38],
        iconAnchor: [24, 38],
      });
      const marker = L.marker([p.lat, p.lon], { icon, keyboard: true, title: p.label, riseOnHover: true, zIndexOffset: selected ? 1000 : 0 });
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        cbRef.current.onSelect(p.id);
      });
      marker.on('add', () => {
        const el = marker.getElement();
        if (el) {
          el.setAttribute('aria-label', p.label);
          el.setAttribute('aria-pressed', selected ? 'true' : 'false');
        }
      });
      marker.addTo(layer);
    }
  }, [pins, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitKey || !fitTo) return;
    map.setView([fitTo.lat, fitTo.lon], fitTo.zoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  useEffect(() => {
    const map = mapRef.current;
    const p = selectedId ? pins.find((x) => x.id === selectedId) : null;
    if (!map || !p) return;
    map.panInside([p.lat, p.lon], { paddingTopLeft: [40, 60], paddingBottomRight: [40, bottomInset + 40] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, bottomInset]);

  return <div ref={elRef} role="region" aria-label={ariaLabel} className="isolate absolute inset-0 z-0 bg-slate-100 dark:bg-slate-800" />;
}
