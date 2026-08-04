/**
 * StationBikeMap — a dependency-free static map for the YouBike panel: the rail
 * station and its nearest YouBike dock, pinned and joined by a walking line.
 *
 * Rendered from raw slippy tiles (`<img>` per tile, absolutely positioned)
 * rather than a mapping library. The whole view is derived once from the two
 * points — no pan, no zoom, no gesture handling — so Leaflet's ~40 kB and its
 * own CSS would buy nothing here; users who want to move around tap through to
 * the walking-directions link instead.
 *
 * Tiles are plain https images, already covered by the site CSP's
 * `img-src 'self' data: https:` — no header change and no API key. If a tile
 * fails to load (upstream down, offline), the map degrades to the schematic
 * backdrop with both pins still in their true relative positions, so the panel
 * never renders a broken frame.
 */
import { useEffect, useRef, useState } from 'react';
import { Bike, Train, ExternalLink } from 'lucide-react';

const TILE_SIZE = 256;
const MIN_ZOOM = 12;
const MAX_ZOOM = 18;
/** Keep both pins clear of the frame (px); a pin is drawn above its anchor. */
const PADDING_X = 28;
const PADDING_TOP = 34;
const PADDING_BOTTOM = 14;

/**
 * OpenStreetMap's standard raster tiles: no key, no signup, and the attribution
 * below is what their tile usage policy asks for. Swapping in another XYZ
 * source (e.g. NLSC's 台灣通用電子地圖) is a one-line change here plus the
 * matching credit in `TILE_ATTRIBUTION`.
 */
const tileUrl = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const TILE_ATTRIBUTION = '© OpenStreetMap';

interface Point { lat: number; lon: number }

/** Web Mercator, in pixels at the given zoom (origin = top-left of the world). */
function project(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** zoom;
  const latRad = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * scale,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale,
  };
}

/** Largest zoom at which both points still sit inside the padded frame. */
function fitZoom(a: Point, b: Point, width: number, height: number): number {
  const usableW = Math.max(1, width - PADDING_X * 2);
  const usableH = Math.max(1, height - PADDING_TOP - PADDING_BOTTOM);
  for (let z = MAX_ZOOM; z > MIN_ZOOM; z--) {
    const pa = project(a.lat, a.lon, z);
    const pb = project(b.lat, b.lon, z);
    if (Math.abs(pa.x - pb.x) <= usableW && Math.abs(pa.y - pb.y) <= usableH) return z;
  }
  return MIN_ZOOM;
}

interface Props {
  station: Point;
  stationName: string;
  bike: Point;
  bikeName: string;
  /** Straight-line metres from the station, as reported by the YouBike feed. */
  distance: number;
  zh: boolean;
}

export default function StationBikeMap({ station, stationName, bike, bikeName, distance, zh }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [tilesBroken, setTilesBroken] = useState(false);
  const height = 180;

  // Tile coverage depends on the rendered width, which varies with the card.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const apply = () => setWidth(el.clientWidth);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A new tile set deserves a fresh chance to load.
  useEffect(() => { setTilesBroken(false); }, [station.lat, station.lon, bike.lat, bike.lon]);

  const zoom = width > 0 ? fitZoom(station, bike, width, height) : MIN_ZOOM;
  const ps = project(station.lat, station.lon, zoom);
  const pb = project(bike.lat, bike.lon, zoom);
  // Centre on the midpoint, then bias down a little so the pins' labels, which
  // sit above each pin, stay inside the frame.
  const centerX = (ps.x + pb.x) / 2;
  const centerY = (ps.y + pb.y) / 2 - (PADDING_TOP - PADDING_BOTTOM) / 2;
  const left = centerX - width / 2;
  const top = centerY - height / 2;

  const tiles: { key: string; src: string; x: number; y: number }[] = [];
  if (width > 0 && !tilesBroken) {
    const n = 2 ** zoom;
    for (let tx = Math.floor(left / TILE_SIZE); tx <= Math.floor((left + width) / TILE_SIZE); tx++) {
      for (let ty = Math.floor(top / TILE_SIZE); ty <= Math.floor((top + height) / TILE_SIZE); ty++) {
        if (ty < 0 || ty >= n) continue;
        const wrappedX = ((tx % n) + n) % n; // the world repeats east–west
        tiles.push({
          key: `${zoom}/${tx}/${ty}`,
          src: tileUrl(zoom, wrappedX, ty),
          x: tx * TILE_SIZE - left,
          y: ty * TILE_SIZE - top,
        });
      }
    }
  }

  const sx = ps.x - left;
  const sy = ps.y - top;
  const bx = pb.x - left;
  const by = pb.y - top;

  // Walking directions, station → dock. Opens the user's map app on mobile.
  const directionsUrl =
    `https://www.google.com/maps/dir/?api=1&origin=${station.lat},${station.lon}` +
    `&destination=${bike.lat},${bike.lon}&travelmode=walking`;

  /**
   * Pins carry no floating name label: at this size the two points are often
   * only a few dozen pixels apart, so labels would overlap each other and clip
   * against the frame. Both names are already spelled out in the card above,
   * and the legend under the map decodes the two colours.
   */
  const pin = (x: number, y: number, tone: 'station' | 'bike') => {
    const color = tone === 'bike' ? 'bg-amber-400 text-slate-900' : 'bg-sky-400 text-slate-900';
    const Icon = tone === 'bike' ? Bike : Train;
    return (
      <div className="absolute z-20 flex flex-col items-center -translate-x-1/2 -translate-y-full" style={{ left: x, top: y }}>
        <span className={`flex size-7 items-center justify-center rounded-full ring-2 ring-white/90 shadow-md ${color}`}>
          <Icon className="size-4" />
        </span>
        <span className="-mt-1 size-2 rotate-45 bg-white/90" />
      </div>
    );
  };

  return (
    <div className="mt-3">
      <div
        ref={boxRef}
        className="relative overflow-hidden rounded-2xl border border-slate-700/50 bg-slate-700/30"
        style={{ height }}
      >
        {tiles.map(t => (
          <img
            key={t.key}
            src={t.src}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setTilesBroken(true)}
            className="pointer-events-none absolute select-none"
            style={{ left: t.x, top: t.y, width: TILE_SIZE, height: TILE_SIZE }}
          />
        ))}

        {/* Walking line + distance, drawn over the tiles */}
        {width > 0 && (
          <svg className="pointer-events-none absolute inset-0 z-10" width={width} height={height}>
            <line
              x1={sx} y1={sy} x2={bx} y2={by}
              stroke="#0f172a" strokeOpacity="0.35" strokeWidth="5" strokeLinecap="round"
            />
            <line
              x1={sx} y1={sy} x2={bx} y2={by}
              stroke="#fbbf24" strokeWidth="2.5" strokeDasharray="6 5" strokeLinecap="round"
            />
          </svg>
        )}

        {width > 0 && pin(sx, sy, 'station')}
        {width > 0 && pin(bx, by, 'bike')}

        <span className="absolute bottom-1 left-1.5 z-20 rounded bg-slate-900/70 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">
          {zh ? `步行約 ${distance} 公尺` : `${distance} m walk`}
        </span>
        <span className="absolute bottom-1 right-1.5 z-20 rounded bg-slate-900/60 px-1 py-0.5 text-[8px] text-slate-300">
          {tilesBroken ? (zh ? '地圖圖磚載入失敗' : 'Map tiles unavailable') : TILE_ATTRIBUTION}
        </span>
      </div>

      {/* Legend: which pin is which, named so the map reads on its own. */}
      <div className="mt-1.5 flex items-center gap-3 px-0.5 text-[10px] text-slate-400">
        <span className="flex min-w-0 items-center gap-1">
          <span className="size-2 shrink-0 rounded-full bg-sky-400" />
          <span className="truncate">{stationName}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1">
          <span className="size-2 shrink-0 rounded-full bg-amber-400" />
          <span className="truncate">{bikeName}</span>
        </span>
      </div>

      <a
        href={directionsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 flex items-center justify-center gap-1.5 rounded-xl border border-slate-700/50 bg-slate-800/60 py-2 text-xs font-bold text-slate-300 transition hover:bg-slate-700/60 hover:text-white"
      >
        {zh ? '開啟步行導航' : 'Walking directions'}
        <ExternalLink className="size-3.5" />
      </a>
    </div>
  );
}
