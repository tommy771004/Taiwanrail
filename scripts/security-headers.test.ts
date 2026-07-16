import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

type Header = { key: string; value: string };
type RouteHeaders = { source: string; headers: Header[] };

function headerMap(headers: Header[]): Map<string, string> {
  return new Map(headers.map((h) => [h.key.toLowerCase(), h.value]));
}

test('vercel.json declares security headers for all routes', async () => {
  const config = JSON.parse(
    await readFile(join(process.cwd(), 'vercel.json'), 'utf8'),
  ) as { headers?: RouteHeaders[] };

  assert.ok(Array.isArray(config.headers) && config.headers.length > 0);

  const route =
    config.headers.find((h) => h.source === '/(.*)') ??
    config.headers.find((h) => h.source === '/:path*') ??
    config.headers[0];

  assert.ok(route, 'expected a headers route entry');
  const map = headerMap(route.headers);

  assert.equal(map.get('x-content-type-options'), 'nosniff');
  assert.equal(map.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(map.get('x-frame-options'), 'DENY');

  const permissions = map.get('permissions-policy') ?? '';
  assert.match(permissions, /geolocation=\(self\)/);
  assert.match(permissions, /camera=\(\)/);
  assert.match(permissions, /microphone=\(\)/);

  const csp = map.get('content-security-policy') ?? '';
  assert.ok(csp.length > 0, 'Content-Security-Policy must be set');
  assert.match(csp, /default-src\s+'self'/);
  assert.match(csp, /connect-src[^;]*'self'/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.match(csp, /frame-ancestors\s+'none'/);
});

test('index.html does not declare a CSP meta tag (vercel.json headers are canonical)', async () => {
  const html = await readFile(join(process.cwd(), 'index.html'), 'utf8');
  // Dual CSP (meta + header) intersects in the browser and historically reintroduced
  // 'unsafe-eval' via the looser meta. Keep one source of truth on the response header.
  assert.doesNotMatch(
    html,
    /http-equiv\s*=\s*["']Content-Security-Policy["']/i,
  );
  assert.doesNotMatch(html, /unsafe-eval/i);
});
