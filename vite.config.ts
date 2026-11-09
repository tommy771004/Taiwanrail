import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { denyUnlessLiveGatewayAllowed } from './src/lib/liveGatewayGuard';
import { resolveGateSecret } from './src/lib/gateSecret';
import { AFFILIATE_DEFAULT_PROJECT_NAME, parseAffiliateOffers } from './src/lib/affiliates';
import { answerYoubikeQuery, createDockSource } from './src/lib/youbikeFeed';

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
// Same contract as api/youbike.ts: both call answerYoubikeQuery in src/lib/youbikeFeed.ts.
function youbikeDevApi(): Plugin {
  const source = createDockSource({
    fetchJson: async (url) => {
      const r = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'taiwanrail-youbike/1.0' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) throw new Error(`upstream ${r.status}`);
      return r.json();
    },
  });

  return {
    name: 'youbike-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/youbike', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        if (enforceLiveGate(req, res)) return;
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const { status, body } = await answerYoubikeQuery(url.searchParams, source);
          res.statusCode = status;
          res.end(JSON.stringify(body));
        } catch {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: 'fetch_failed', docks: [] }));
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

// Dev-only middleware so /api/affiliates works under `vite dev`. Mirrors api/affiliates.ts —
// reads the shared affiliates table from SUP_DATABASE_URL, scoped to this project's partition.
// Keep the degradation behaviour (§6.4 of docs/affiliate-integration-spec.md) in sync with it.
function affiliatesDevApi(env: Record<string, string>): Plugin {
  return {
    name: 'affiliates-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/affiliates', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');

        const method = (req.method || 'GET').toUpperCase();
        if (method !== 'GET' && method !== 'HEAD') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed', offers: [] }));
          return;
        }

        const dbUrl = env.SUP_DATABASE_URL || process.env.SUP_DATABASE_URL || '';
        if (!dbUrl) {
          res.statusCode = 503;
          res.end(JSON.stringify({ offers: [] }));
          return;
        }

        const projectName =
          (env.AFFILIATE_PROJECT_NAME || process.env.AFFILIATE_PROJECT_NAME || '').trim() ||
          AFFILIATE_DEFAULT_PROJECT_NAME;

        try {
          const { neon } = await import('@neondatabase/serverless');
          const sql = neon(dbUrl);
          const rows = await sql`
            SELECT
              project_name AS "projectName",
              id, enabled, sponsored, title, description,
              cta_label AS "ctaLabel",
              url, icon, categories, crops, priority, partner
            FROM affiliates
            WHERE project_name = ${projectName}
              AND enabled = TRUE
            ORDER BY priority DESC, id ASC
          `;
          res.end(JSON.stringify({ offers: parseAffiliateOffers(rows) }));
        } catch (e) {
          console.error('[affiliates] dev query failed:', e instanceof Error ? e.message : String(e));
          res.statusCode = 500;
          res.end(JSON.stringify({ offers: [] }));
        }
      });
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), youbikeDevApi(), geocodeDevApi(), affiliatesDevApi(env)],
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
