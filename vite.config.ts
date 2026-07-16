import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { denyUnlessLiveGatewayAllowed } from './src/lib/liveGatewayGuard';
import { resolveGateSecret } from './src/lib/gateSecret';

function readHeader(
  headers: IncomingMessage['headers'],
  name: string,
): string {
  const v = headers[name];
  if (Array.isArray(v)) return v[0] || '';
  return (v as string) || '';
}

function enforceLiveGate(req: IncomingMessage, res: ServerResponse): boolean {
  const deny = denyUnlessLiveGatewayAllowed({
    method: req.method || 'GET',
    origin: readHeader(req.headers, 'origin'),
    requestHost: readHeader(req.headers, 'host') || 'localhost',
    authorization: readHeader(req.headers, 'authorization'),
    cookieHeader: readHeader(req.headers, 'cookie'),
    ticketHeader: readHeader(req.headers, 'x-gate-ticket'),
    clientKey: 'dev-local',
    secret: resolveGateSecret(),
    abuseThrottle: false,
  });
  if (!deny) return false;
  res.statusCode = deny.status;
  res.setHeader('Content-Type', 'application/json');
  for (const [k, v] of Object.entries(deny.headers)) res.setHeader(k, v);
  res.end(JSON.stringify(deny.body));
  return true;
}

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
        if (enforceLiveGate(req, res)) return;
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

// Dev-only middleware so /api/geocode works under `vite dev`. Mirrors api/geocode.ts —
// resolves a place name to coordinates via OpenStreetMap Nominatim for the trip planner.
function geocodeDevApi(): Plugin {
  const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
  const UA = 'Taiwanrail/1.0 (+https://taiwanrail.vercel.app)';
  const cache = new Map<string, { at: number; data: any }>();
  const TTL = 60 * 60 * 1000;

  return {
    name: 'geocode-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/geocode', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (enforceLiveGate(req, res)) return;
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const q = (url.searchParams.get('q') || '').trim();
          const lang = (url.searchParams.get('lang') || 'zh-TW').slice(0, 10);
          if (q.length < 2) { res.end(JSON.stringify({ results: [] })); return; }

          const key = `${lang}:${q.toLowerCase()}`;
          const now = Date.now();
          const hit = cache.get(key);
          if (hit && now - hit.at < TTL) { res.end(JSON.stringify(hit.data)); return; }

          const u = new URL(NOMINATIM);
          u.searchParams.set('q', q);
          u.searchParams.set('format', 'jsonv2');
          u.searchParams.set('countrycodes', 'tw');
          u.searchParams.set('limit', '5');
          u.searchParams.set('accept-language', lang);
          const r = await fetch(u.toString(), { headers: { 'User-Agent': UA, Accept: 'application/json' } });
          if (!r.ok) { res.end(JSON.stringify({ results: [] })); return; }
          const arr: any = await r.json();
          const results = (Array.isArray(arr) ? arr : [])
            .map((it: any) => ({
              name: it.name || String(it.display_name || '').split(',')[0],
              detail: it.display_name,
              lat: Number(it.lat),
              lon: Number(it.lon),
            }))
            .filter((p: any) => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon));
          const data = { results };
          cache.set(key, { at: now, data });
          res.end(JSON.stringify(data));
        } catch {
          res.statusCode = 200;
          res.end(JSON.stringify({ results: [] }));
        }
      });
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), youbikeDevApi(), geocodeDevApi()],
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
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            const moduleId = id.replace(/\\/g, '/');
            if (moduleId.includes('/src/components/TransferMapModal.tsx')) return 'transfer-map';
            if (!moduleId.includes('/node_modules/')) return undefined;
            if (/\/(react|react-dom|react-helmet-async|scheduler)\//.test(moduleId)) return 'react-vendor';
            if (/\/(i18next|i18next-browser-languagedetector|react-i18next)\//.test(moduleId)) return 'i18n-vendor';
            if (moduleId.includes('/motion-dom/') || moduleId.includes('/motion-utils/') || moduleId.includes('/motion/')) return 'animation-vendor';
            if (moduleId.includes('/lucide-react/')) return 'icons-vendor';
            if (moduleId.includes('/socket.io-client/') || moduleId.includes('/engine.io-client/')) return 'realtime-vendor';
            return undefined;
          },
        },
      },
    },
  };
});
