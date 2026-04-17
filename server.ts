import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Allowed origins for CORS (socket.io + same-origin API).
// Defaults to same-origin only; override via ALLOWED_ORIGINS env (comma-separated).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// StationID validation: only alphanumeric, 3–6 chars covers TRA (e.g. "1020")
// and THSR (e.g. "0990") formats.
const STATION_ID_RE = /^[A-Za-z0-9]{3,6}$/;
const isValidStationId = (id: unknown): id is string =>
  typeof id === 'string' && STATION_ID_RE.test(id);
const isValidType = (t: unknown): t is 'hsr' | 'train' => t === 'hsr' || t === 'train';

async function startServer() {
  const app = express();

  // Security: trust reverse-proxy headers only if deployed behind one.
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  // Block fingerprinting header.
  app.disable('x-powered-by');

  // Request body size limit (defensive; token endpoint needs no body).
  app.use(express.json({ limit: '16kb' }));

  // Minimal security headers (helmet-equivalent subset) applied to all responses.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    // HSTS is only meaningful over HTTPS; safe to send (browsers ignore on http).
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // CSP tuned for Vite dev + production SPA; allow inline styles (Tailwind).
    const isDev = process.env.NODE_ENV !== 'production';
    const scriptSrc = isDev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self'";
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        `script-src ${scriptSrc}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "connect-src 'self' https://tdx.transportdata.tw ws: wss:",
        "frame-ancestors 'self'",
        "base-uri 'self'",
      ].join('; ')
    );
    next();
  });

  const server = createServer(app);
  const io = new Server(server, {
    cors: {
      origin: ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : false,
      methods: ['GET', 'POST'],
      credentials: false,
    },
    maxHttpBufferSize: 1e5, // 100 KB
    connectTimeout: 10_000,
  });

  const PORT = Number(process.env.PORT) || 3000;

  // --- TDX token (server-side cache, never exposed via request headers) ---
  let tdxToken: string | null = null;
  let tokenExpiration = 0;
  let tokenInFlight: Promise<{ token: string; expires_in: number } | null> | null = null;

  async function getTDXToken(): Promise<{ token: string; expires_in: number } | null> {
    const clientId = process.env.VITE_TDX_CLIENT_ID || process.env.TDX_CLIENT_ID;
    const clientSecret = process.env.VITE_TDX_CLIENT_SECRET || process.env.TDX_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    if (tdxToken && Date.now() < tokenExpiration) {
      return { token: tdxToken, expires_in: Math.floor((tokenExpiration - Date.now()) / 1000) };
    }
    if (tokenInFlight) return tokenInFlight;

    tokenInFlight = (async () => {
      try {
        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('client_id', clientId);
        params.append('client_secret', clientSecret);

        const response = await fetch(
          'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
          }
        );
        if (!response.ok) return null;
        const data = (await response.json()) as any;
        tdxToken = data.access_token;
        tokenExpiration = Date.now() + (data.expires_in - 60) * 1000;
        return { token: tdxToken as string, expires_in: data.expires_in };
      } catch (e) {
        // Intentionally avoid logging error body — may contain sensitive info.
        console.error('TDX token error');
        return null;
      } finally {
        tokenInFlight = null;
      }
    })();

    return tokenInFlight;
  }

  // --- Simple in-memory rate limit for /api/tdx/token ---
  const rateBuckets = new Map<string, { count: number; reset: number }>();
  const RATE_WINDOW_MS = 60_000;
  const RATE_MAX = 30; // 30 token fetches / minute / IP

  app.use('/api/tdx/token', (req, res, next) => {
    const ip = (req.ip || req.socket.remoteAddress || 'unknown').toString();
    const now = Date.now();
    const bucket = rateBuckets.get(ip);
    if (!bucket || bucket.reset < now) {
      rateBuckets.set(ip, { count: 1, reset: now + RATE_WINDOW_MS });
      return next();
    }
    if (bucket.count >= RATE_MAX) {
      res.setHeader('Retry-After', Math.ceil((bucket.reset - now) / 1000).toString());
      return res.status(429).json({ error: 'Too many requests' });
    }
    bucket.count += 1;
    next();
  });

  // Periodically prune stale rate-limit buckets.
  setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of rateBuckets) {
      if (bucket.reset < now) rateBuckets.delete(ip);
    }
  }, RATE_WINDOW_MS).unref?.();

  app.get('/api/tdx/token', async (_req, res) => {
    // Disable caching on token response.
    res.setHeader('Cache-Control', 'no-store');
    const tokenData = await getTDXToken();
    if (tokenData) {
      res.json(tokenData);
    } else {
      res.status(503).json({ error: 'Token unavailable' });
    }
  });

  async function fetchLiveBoard(stationId: string, type: 'hsr' | 'train') {
    if (!isValidStationId(stationId) || !isValidType(type)) return null;
    const tokenData = await getTDXToken();
    if (!tokenData) return null;
    const token = tokenData.token;
    try {
      const railType = type === 'hsr' ? 'THSR' : 'TRA';
      const url = `https://tdx.transportdata.tw/api/basic/v2/Rail/${railType}/LiveBoard/Station/${encodeURIComponent(stationId)}?$format=JSON`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (!response.ok) return null;
      return response.json();
    } catch {
      return null;
    }
  }

  // --- Socket.IO Rooms & Polling ---
  const activeStations = new Map<string, 'hsr' | 'train'>();

  io.on('connection', (socket) => {
    // Per-socket subscription cap to avoid abuse.
    const MAX_SUBS = 8;
    const subs = new Set<string>();

    socket.on('subscribe-station', (payload: unknown) => {
      const p = payload as { stationId?: unknown; type?: unknown } | null;
      if (!p || !isValidStationId(p.stationId) || !isValidType(p.type)) return;
      if (subs.size >= MAX_SUBS) return;
      const stationId = p.stationId;
      const type = p.type;
      const room = `${type}:station:${stationId}`;
      if (subs.has(room)) return;
      socket.join(room);
      subs.add(room);
      activeStations.set(`${type}:${stationId}`, type);
    });

    socket.on('unsubscribe-station', (payload: unknown) => {
      const p = payload as { stationId?: unknown; type?: unknown } | null;
      if (!p || !isValidStationId(p.stationId) || !isValidType(p.type)) return;
      const room = `${p.type}:station:${p.stationId}`;
      socket.leave(room);
      subs.delete(room);
    });

    socket.on('disconnect', () => {
      subs.clear();
    });
  });

  // Polling loop — only fetch rooms with actual subscribers.
  setInterval(async () => {
    for (const [key, type] of activeStations.entries()) {
      const stationId = key.split(':')[1];
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
  }, 30_000).unref?.();

  // --- Vite / Static Setup ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, { maxAge: '1h', index: false }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
