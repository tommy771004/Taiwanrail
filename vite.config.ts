import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';

// Dev-only middleware so /api/youbike works under `vite dev` (Vercel functions don't run locally).
// Mirrors api/youbike.ts — returns the nearest Taipei YouBike2.0 station to lat/lon.
function youbikeDevApi(): Plugin {
  const FEED = 'https://tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json';
  const MAX_DISTANCE_M = 1500;
  let cache: { at: number; data: any[] } | null = null;

  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const haversineM = (aLat: number, aLon: number, bLat: number, bLon: number) => {
    const R = 6371000;
    const dLat = ((bLat - aLat) * Math.PI) / 180;
    const dLon = ((bLon - aLon) * Math.PI) / 180;
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  };

  return {
    name: 'youbike-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/youbike', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const lat = num(url.searchParams.get('lat'));
          const lon = num(url.searchParams.get('lon'));
          if (lat === null || lon === null) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'lat/lon required' }));
            return;
          }
          const now = Date.now();
          if (!cache || now - cache.at > 3000) {
            const r = await fetch(FEED);
            const j: any = await r.json();
            const arr = Array.isArray(j) ? j : j?.retVal ? Object.values(j.retVal) : [];
            cache = { at: now, data: arr as any[] };
          }
          let best: any = null;
          let bestD = Infinity;
          for (const it of cache.data) {
            const sLat = num(it.lat ?? it.latitude);
            const sLon = num(it.lng ?? it.longitude);
            if (sLat === null || sLon === null) continue;
            const d = haversineM(lat, lon, sLat, sLon);
            if (d < bestD) {
              bestD = d;
              best = it;
            }
          }
          if (!best || bestD > MAX_DISTANCE_M) {
            res.end(JSON.stringify({ station: null }));
            return;
          }
          const bikes = num(best.sbi ?? best.available_rent_bikes) ?? 0;
          const docks = num(best.bemp ?? best.available_return_bikes) ?? 0;
          const total = num(best.tot ?? best.total ?? best.Quantity) ?? bikes + docks;
          const name = String(best.sna ?? best.name_tw ?? '').replace(/^YouBike2?\.?0?_?/i, '');
          const nameEn = String(best.snaen ?? best.name_en ?? '').replace(/^YouBike2?\.?0?_?/i, '');
          res.end(
            JSON.stringify({
              station: {
                name,
                nameEn,
                lat: num(best.lat ?? best.latitude),
                lng: num(best.lng ?? best.longitude),
                bikes,
                docks,
                total,
                distance: Math.round(bestD),
                updateTime: best.mday ?? best.updateTime ?? best.srcUpdateTime ?? null,
                act: String(best.act ?? '1'),
              },
            }),
          );
        } catch (e) {
          res.statusCode = 200;
          res.end(JSON.stringify({ station: null, error: 'fetch_failed' }));
        }
      });
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), youbikeDevApi()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
