import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runGateMintHttp } from '../src/lib/gateHttp.js';
import { resolveGateSecret } from '../src/lib/gateSecret.js';

function clientIp(req: VercelRequest): string {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length > 0) return xf.split(',')[0].trim();
  if (Array.isArray(xf) && xf[0]) return String(xf[0]).split(',')[0].trim();
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real) return real;
  return 'unknown';
}

function header(req: VercelRequest, name: string): string {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0] || '';
  return (v as string) || '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const result = runGateMintHttp(
    {
      method: req.method || 'POST',
      origin: header(req, 'origin'),
      requestHost: header(req, 'host'),
      clientKey: clientIp(req),
      cookieHeader: header(req, 'cookie'),
      authorization: header(req, 'authorization'),
      ticketHeader: header(req, 'x-gate-ticket'),
    },
    {
      secret: resolveGateSecret(),
      secureCookie: true,
    },
  );

  for (const [name, value] of Object.entries(result.headers)) {
    res.setHeader(name, value);
  }
  if (result.status === 204) {
    return res.status(204).end();
  }
  return res.status(result.status).json(result.body);
}
