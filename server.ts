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

  async function fetchLiveBoard(stationId: string, type: 'hsr' | 'train') {
    try {
      const railType = type === 'hsr' ? 'THSR' : 'TRA';
      const result = await tdxGateway.execute({
        path: `basic/v2/Rail/${railType}/LiveBoard/Station/${stationId}`,
        rawQuery: '?$format=JSON',
      });
      return result.status >= 200 && result.status < 300 ? result.body : null;
    } catch (error) {
      console.error('fetchLiveBoard Error', error);
      return null;
    }
  }

  // --- Socket.IO Rooms & Polling ---
  const activeStations = new Map<string, 'hsr' | 'train'>();

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('subscribe-station', (payload: { stationId: string, type: 'hsr' | 'train' }) => {
      const { stationId, type } = payload;
      console.log(`Socket ${socket.id} subscribed to ${type} station ${stationId}`);
      socket.join(`${type}:station:${stationId}`);
      activeStations.set(`${type}:${stationId}`, type);
    });

    socket.on('unsubscribe-station', (payload: { stationId: string, type: 'hsr' | 'train' }) => {
      const { stationId, type } = payload;
      socket.leave(`${type}:station:${stationId}`);
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  // Polling loop
  setInterval(async () => {
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
  }, 30000); // 30 seconds

  // --- Vite / Static Setup ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    // Add middleware to inject APP_URL in dev mode
    app.use(async (req, res, next) => {
      if (req.path === '/' || req.path === '/index.html' || req.path.startsWith('/en')) {
        try {
          let html = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf-8');
          html = await vite.transformIndexHtml(req.url, html);
          const SITE_URL = process.env.APP_URL || 'https://taiwanrail.vercel.app';
          html = html.replace(/__APP_URL__/g, SITE_URL);
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
      let html = fs.readFileSync(path.join(distPath, 'index.html'), 'utf8');
      html = html.replace(/__APP_URL__/g, SITE_URL);
      res.send(html);
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
