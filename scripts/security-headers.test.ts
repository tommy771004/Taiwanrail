import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectInlineScriptHashes } from './csp-inline-hashes.mjs';

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

  // script-src must not carry 'unsafe-inline': it permits any injected <script>, which
  // is the exact class of attack a CSP exists to stop, so the rest of the policy is
  // close to decorative while it is there. Our own inline scripts are allow-listed by
  // hash instead (see the test below). style-src keeps 'unsafe-inline' on purpose —
  // that is a separate, far lower-severity tradeoff for inline styles.
  const scriptSrc = csp.match(/script-src([^;]*)/)?.[1] ?? '';
  assert.ok(scriptSrc.length > 0, 'script-src must be set');
  assert.doesNotMatch(
    scriptSrc,
    /'unsafe-inline'/,
    "script-src must allow-list inline scripts by hash, not 'unsafe-inline'",
  );
});

test('every inline script we ship is allow-listed by hash in script-src', async () => {
  const config = JSON.parse(
    await readFile(join(process.cwd(), 'vercel.json'), 'utf8'),
  ) as { headers?: RouteHeaders[] };
  const route = config.headers?.find((h) => h.source === '/(.*)');
  const csp = headerMap(route?.headers ?? []).get('content-security-policy') ?? '';
  const scriptSrc = csp.match(/script-src([^;]*)/)?.[1] ?? '';

  const found = await collectInlineScriptHashes(process.cwd());
  assert.ok(found.size > 0, 'expected to find inline scripts to hash');

  for (const [hash, files] of found) {
    assert.ok(
      scriptSrc.includes(hash),
      `inline script in ${files[0]} (and ${files.length - 1} other file(s)) is not ` +
        `allow-listed. Add ${hash} to script-src in vercel.json — ` +
        'run `npm run csp:hashes` to regenerate the list.',
    );
  }
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
