import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createTdxFetchTransport } from '../src/lib/tdxFetchTransport.js';
import { createTdxGateway } from '../src/lib/tdxGateway.js';

const gateway = createTdxGateway({
  tdx: createTdxFetchTransport(),
  credentials: () => ({
    clientId: process.env.TDX_CLIENT_ID,
    clientSecret: process.env.TDX_CLIENT_SECRET,
  }),
  logger: console,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || '';
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      const selfHost = (req.headers.host as string) || '';
      const allowed =
        originHost === selfHost ||
        /^(?:localhost(?::\d+)?|[\w-]+\.vercel\.app)$/.test(originHost);
      if (!allowed) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    } catch {
      // Malformed Origin values remain fail-open to avoid blocking direct users.
    }
  }

  const url = new URL(req.url || '', 'https://localhost');
  const path = (
    url.pathname.startsWith('/api/tdx/')
      ? url.pathname.substring(9)
      : url.pathname.replace(/^\/api\/proxy\//, '')
  ).replace(/^\/+/, '');
  if (!path) {
    return res.status(400).json({ error: 'Missing path' });
  }

  try {
    const result = await gateway.execute({ path, rawQuery: url.search });
    for (const [name, value] of Object.entries(result.headers)) {
      res.setHeader(name, value);
    }
    return res.status(result.status).json(result.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
}
