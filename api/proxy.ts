import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createTdxFetchTransport } from '../src/lib/tdxFetchTransport.js';
import { createTdxGateway } from '../src/lib/tdxGateway.js';
import { runTdxProxyHttp } from '../src/lib/tdxProxyHttp.js';
import { tryConsumeApiAbuseSlot } from '../src/lib/apiAbuseThrottleStore.js';

const gateway = createTdxGateway({
  tdx: createTdxFetchTransport(),
  credentials: () => ({
    clientId: process.env.TDX_CLIENT_ID,
    clientSecret: process.env.TDX_CLIENT_SECRET,
  }),
  logger: console,
});

function clientIp(req: VercelRequest): string {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length > 0) return xf.split(',')[0].trim();
  if (Array.isArray(xf) && xf[0]) return String(xf[0]).split(',')[0].trim();
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real) return real;
  return 'unknown';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = new URL(req.url || '', 'https://localhost');
  const result = await runTdxProxyHttp(
    {
      method: req.method || 'GET',
      origin: (req.headers.origin as string) || '',
      requestHost: (req.headers.host as string) || '',
      pathname: url.pathname,
      rawQuery: url.search,
      clientKey: clientIp(req),
    },
    gateway,
    { tryConsume: tryConsumeApiAbuseSlot },
  );

  for (const [name, value] of Object.entries(result.headers)) {
    res.setHeader(name, value);
  }
  if (result.status === 204) {
    return res.status(204).end();
  }
  return res.status(result.status).json(result.body);
}
