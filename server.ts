import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';

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

  // --- TDX Logic for Server ---
  let tdxToken: string | null = null;
  let tokenExpiration = 0;

  async function getTDXToken() {
    const clientId = process.env.TDX_CLIENT_ID;
    const clientSecret = process.env.TDX_CLIENT_SECRET;

    if (!clientId || !clientSecret) return null;
    if (tdxToken && Date.now() < tokenExpiration) return { token: tdxToken, expires_in: (tokenExpiration - Date.now()) / 1000 + 60 };

    try {
      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');
      params.append('client_id', clientId);
      params.append('client_secret', clientSecret);

      const response = await fetch('https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      if (!response.ok) return null;
      const data = await response.json() as any;
      tdxToken = data.access_token;
      tokenExpiration = Date.now() + (data.expires_in - 60) * 1000;
      return { token: tdxToken, expires_in: data.expires_in };
    } catch (e) {
      console.error('Server TDX Token Error:', e);
      return null;
    }
  }

  // --- Dynamic TDX Proxy for Local Dev (Mirroring Vercel Serverless Function) ---
  const localCache = new Map<string, { data: any, expires: number }>();

  async function fetchWithCache(url: string, prefix: string = '') {
    const now = Date.now();
    const cacheKey = `${prefix}:${url}`;
    const cached = localCache.get(cacheKey);

    if (cached && cached.expires > now) {
      return cached.data;
    }

    const tokenData = await getTDXToken();
    if (!tokenData) {
      throw new Error('MISSING_CREDENTIALS');
    }

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${tokenData.token}`,
        'Accept': 'application/json',
      },
    });

    let data: any = {};
    const text = await response.text();
    try {
      if (text) data = JSON.parse(text);
    } catch (e) {
      data = { message: text || 'Invalid JSON response from TDX' };
    }

    if (response.ok) {
      // 1 minute generic cache to save TDX limits
      localCache.set(cacheKey, { data, expires: now + 60000 });
    } else if (response.status === 429 && cached) {
      return cached.data;
    } else if (!response.ok) {
        throw { status: response.status, message: data.message || 'TDX Request Failed' };
    }

    return data;
  }

  app.get('/api/tdx/*', async (req, res) => {
    const rawPath = req.params[0] || req.path.replace(/^\/api\/tdx\//, '');
    const query = req.url.includes('?') ? req.url.split('?')[1] : '';
    
    let tdxPath = rawPath;
    if (rawPath.includes('TRA/Alert')) tdxPath = 'v3/Rail/TRA/Alert';
    if (rawPath.includes('THSR/Alert')) tdxPath = 'v2/Rail/THSR/Alert';

    const tdxUrl = `https://tdx.transportdata.tw/api/${tdxPath}${query ? `?${query}` : ''}`;
    
    try {
      const data = await fetchWithCache(tdxUrl, 'proxy');
      res.json(data);
    } catch (error: any) {
      if (error.message === 'MISSING_CREDENTIALS') {
        console.warn(`[Proxy] Missing TDX_CLIENT_ID or TDX_CLIENT_SECRET. Returning 401 fallback`);
        return res.status(401).json({ error: "Missing TDX credentials" });
      }
      
      if (error.status && error.status !== 500) {
         // Silently pass expected API returns like 404 (No alerts found)
         return res.status(error.status).json({ error: error.message });
      }
      
      console.error('[Proxy] Local Proxy Fatal Error:', error);
      res.status(error.status || 500).json({ error: error.message });
    }
  });

  async function fetchLiveBoard(stationId: string, type: 'hsr' | 'train') {
    try {
      const railType = type === 'hsr' ? 'THSR' : 'TRA';
      const url = `https://tdx.transportdata.tw/api/basic/v2/Rail/${railType}/LiveBoard/Station/${stationId}?$format=JSON`;
      return await fetchWithCache(url, 'liveboard');
    } catch (e) {
      console.error('fetchLiveBoard Error', e);
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
      if (req.path === '/' || req.path === '/index.html') {
        try {
          let html = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf-8');
          html = await vite.transformIndexHtml(req.url, html);
          const SITE_URL = process.env.APP_URL || 'https://taiwanrail.vercel.app';
          html = html.replace(/__APP_URL__/g, SITE_URL);
          if (req.query.lang === 'en') {
            html = html.replace(/<link rel="canonical" href="[^"]+" id="canonical-link" \/>/, `<link rel="canonical" href="${SITE_URL}/?lang=en" id="canonical-link" />`);
          }
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
      if (req.query.lang === 'en') {
        html = html.replace(/<link rel="canonical" href="[^"]+" id="canonical-link" \/>/, `<link rel="canonical" href="${SITE_URL}/?lang=en" id="canonical-link" />`);
      }
      res.send(html);
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
