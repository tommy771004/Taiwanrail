import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { createTdxFetchTransport } from './src/lib/tdxFetchTransport';
import { createTdxGateway } from './src/lib/tdxGateway';
import { runTdxProxyHttp } from './src/lib/tdxProxyHttp';
import { tryConsumeApiAbuseSlot } from './src/lib/apiAbuseThrottleStore';
import { runGateMintHttp } from './src/lib/gateHttp';
import { resolveGateSecret } from './src/lib/gateSecret';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);
  const io = new Server(server, {
    cors: {
      origin: ["http://localhost:3000", "https://taiwanrail.vercel.app"],
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // Same security headers as production (vercel.json) so local CSP matches.
  try {
    const vercelConfig = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'vercel.json'), 'utf8'),
    ) as {
      headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    };
    const globalHeaders =
      vercelConfig.headers?.find((h) => h.source === '/(.*)')?.headers ?? [];
    if (globalHeaders.length > 0) {
      app.use((_req, res, next) => {
        for (const { key, value } of globalHeaders) {
          res.setHeader(key, value);
        }
        next();
      });
    }
  } catch (error) {
    console.warn('[server] could not load security headers from vercel.json', error);
  }

  const tdxGateway = createTdxGateway({
    tdx: createTdxFetchTransport(),
    credentials: () => ({
      clientId: process.env.TDX_CLIENT_ID,
      clientSecret: process.env.TDX_CLIENT_SECRET,
    }),
    logger: console,
  });

  const clientKeyFrom = (req: express.Request): string => {
    const xf = req.headers['x-forwarded-for'];
    return (
      (typeof xf === 'string' && xf.split(',')[0].trim()) ||
      req.socket.remoteAddress ||
      'unknown'
    );
  };

  app.all('/api/gate', (req, res) => {
    const result = runGateMintHttp(
      {
        method: req.method || 'POST',
        origin: (req.headers.origin as string) || '',
        requestHost: (req.headers.host as string) || `localhost:${PORT}`,
        clientKey: clientKeyFrom(req),
        cookieHeader: (req.headers.cookie as string) || '',
        authorization: (req.headers.authorization as string) || '',
        ticketHeader: (req.headers['x-gate-ticket'] as string) || '',
      },
      {
        secret: resolveGateSecret(),
        secureCookie: false,
      },
    );
    for (const [name, value] of Object.entries(result.headers)) {
      res.setHeader(name, value);
    }
    if (result.status === 204) {
      return res.status(204).end();
    }
    return res.status(result.status).json(result.body);
  });

  app.all('/api/tdx/*', async (req, res) => {
    const queryIndex = req.url.indexOf('?');
    const rawQuery = queryIndex >= 0 ? req.url.slice(queryIndex) : '';
    const result = await runTdxProxyHttp(
      {
        method: req.method || 'GET',
        origin: (req.headers.origin as string) || '',
        requestHost: (req.headers.host as string) || `localhost:${PORT}`,
        pathname: req.path.startsWith('/api/tdx')
          ? req.path
          : `/api/tdx/${req.params[0] || ''}`,
        rawQuery,
        clientKey: clientKeyFrom(req),
        authorization: (req.headers.authorization as string) || '',
        cookieHeader: (req.headers.cookie as string) || '',
        ticketHeader: (req.headers['x-gate-ticket'] as string) || '',
      },
      tdxGateway,
      { tryConsume: tryConsumeApiAbuseSlot },
      { secret: resolveGateSecret() },
    );
    for (const [name, value] of Object.entries(result.headers)) {
      res.setHeader(name, value);
    }
    if (result.status === 204) {
      return res.status(204).end();
    }
    return res.status(result.status).json(result.body);
  });

  // TDX 沒有 THSR LiveBoard endpoint（v2/v3 皆 404），與 api.ts 的 getTHSRLiveBoard
  // 一致：高鐵沒有即時到離站資料可推播，訂閱一律不成立。
  const LIVEBOARD_TRANSPORTS = new Set(['train']);

  async function fetchLiveBoard(stationId: string, type: 'hsr' | 'train') {
    if (!LIVEBOARD_TRANSPORTS.has(type)) return null;
    try {
      const result = await tdxGateway.execute({
        path: `basic/v2/Rail/TRA/LiveBoard/Station/${stationId}`,
        rawQuery: '?$format=JSON',
      });
      return result.status >= 200 && result.status < 300 ? result.body : null;
    } catch (error) {
      console.error('fetchLiveBoard Error', error);
      return null;
    }
  }

  // --- Socket.IO Rooms & Polling ---
  //
  // Every distinct station in this map costs one TDX request every 30 seconds, and a
  // subscription is just an unauthenticated socket message — so without limits a single
  // client can pin arbitrarily many stations and turn this server into a quota-burning
  // amplifier against TDX. Three bounds close that:
  //   1. a station ID must look like a real TRA ID before it is ever put in a URL,
  //   2. each socket may hold only a handful of subscriptions (the app itself uses 2:
  //      origin + destination),
  //   3. the server polls a bounded number of distinct stations no matter how many
  //      clients connect.
  const MAX_STATIONS_PER_SOCKET = 4;
  const MAX_ACTIVE_STATIONS = 50;
  const TRA_STATION_ID = /^\d{3,4}$/;

  const activeStations = new Map<string, 'hsr' | 'train'>();

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    // Rooms alone cannot enforce a per-socket cap (a socket's room set also holds its
    // own id, and leaves are async), so track this socket's subscriptions explicitly.
    const subscriptions = new Set<string>();

    socket.on('subscribe-station', (payload: { stationId: string, type: 'hsr' | 'train' }) => {
      const stationId = String(payload?.stationId ?? '');
      const type = payload?.type;
      if (!type || !LIVEBOARD_TRANSPORTS.has(type)) {
        // 沒有可輪詢的即時資料來源，不建房間也不排入輪詢，避免每 30 秒燒一次配額
        return;
      }
      if (!TRA_STATION_ID.test(stationId)) {
        console.warn(`Socket ${socket.id} sent an invalid station id, ignoring`);
        return;
      }

      const key = `${type}:${stationId}`;
      if (subscriptions.has(key)) return;

      if (subscriptions.size >= MAX_STATIONS_PER_SOCKET) {
        console.warn(
          `Socket ${socket.id} hit the ${MAX_STATIONS_PER_SOCKET}-station subscription cap`,
        );
        return;
      }
      // A brand-new station is what actually adds polling load; joining one already
      // being polled for someone else is free, so only the former is capped globally.
      if (!activeStations.has(key) && activeStations.size >= MAX_ACTIVE_STATIONS) {
        console.warn(`Active station cap (${MAX_ACTIVE_STATIONS}) reached, refusing ${key}`);
        return;
      }

      console.log(`Socket ${socket.id} subscribed to ${type} station ${stationId}`);
      subscriptions.add(key);
      socket.join(`${type}:station:${stationId}`);
      activeStations.set(key, type);
    });

    socket.on('unsubscribe-station', (payload: { stationId: string, type: 'hsr' | 'train' }) => {
      const stationId = String(payload?.stationId ?? '');
      const type = payload?.type;
      if (!type) return;
      subscriptions.delete(`${type}:${stationId}`);
      socket.leave(`${type}:station:${stationId}`);
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      // Room membership is dropped by Socket.IO; the poll loop prunes activeStations
      // once a room empties. Clearing here keeps the cap honest if the id is reused.
      subscriptions.clear();
    });
  });

  // Polling loop. Guarded against re-entry: the fetches below are sequential, so a slow
  // TDX response could otherwise let a second tick start while the first is still in
  // flight and double the request rate exactly when TDX is already struggling.
  let pollInFlight = false;
  setInterval(async () => {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      for (const [key, type] of activeStations.entries()) {
        const stationId = key.split(':')[1];
        // Check if anyone is actually in the room
        const room = io.sockets.adapter.rooms.get(`${type}:station:${stationId}`);
        if (!room || room.size === 0) {
          activeStations.delete(key);
          continue;
        }

        const data = await fetchLiveBoard(stationId, type);
        if (data) {
          io.to(`${type}:station:${stationId}`).emit('delay-update', { stationId, type, data });
        }
      }
    } finally {
      pollInFlight = false;
    }
  }, 30000); // 30 seconds

  // --- Vite / Static Setup ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    // Serve the SPA shell in dev (Vite in middleware mode does not do this itself).
    // NOTE: this used to also run `html.replace(/__APP_URL__/g, SITE_URL)`. No such
    // placeholder has ever existed in index.html — the canonical URL is hardcoded there
    // and managed at runtime by react-helmet-async — so the substitution matched nothing.
    // APP_URL is still honoured where it is actually templated: robots.txt and sitemap.xml
    // below, and the SEO scripts.
    app.use(async (req, res, next) => {
      if (req.path === '/' || req.path === '/index.html' || req.path.startsWith('/en')) {
        try {
          let html = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf-8');
          html = await vite.transformIndexHtml(req.url, html);
          res.send(html);
          return;
        } catch (e) {
          next(e);
          return;
        }
      }
      next();
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    const SITE_URL = process.env.APP_URL || 'https://taiwanrail.vercel.app';
    
    app.get('/robots.txt', (req, res) => {
      res.type('text/plain');
      res.send(`User-agent: *
Allow: /
Disallow: /api/

# Large static data files — skip indexing but let the app fetch them
Disallow: /data/tra-timetable.json
Disallow: /data/thsr-timetable.json
Disallow: /data/tra-daily/
Disallow: /data/thsr-daily/

Sitemap: ${SITE_URL}/sitemap.xml
`);
    });

    app.get('/sitemap.xml', (req, res) => {
      if (fs.existsSync(path.join(distPath, 'sitemap.xml'))) {
        let sitemap = fs.readFileSync(path.join(distPath, 'sitemap.xml'), 'utf8');
        sitemap = sitemap.replace(/https:\/\/taiwanrail\.vercel\.app/g, SITE_URL);
        res.type('application/xml');
        res.send(sitemap);
      } else {
        res.status(404).end();
      }
    });
    
    app.use(express.static(distPath, { index: false }));
    
    app.get('*', (req, res) => {
      // See the dev branch above: index.html carries no __APP_URL__ placeholder, so the
      // replace that used to sit here was a no-op on every request.
      res.send(fs.readFileSync(path.join(distPath, 'index.html'), 'utf8'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
