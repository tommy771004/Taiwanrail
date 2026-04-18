/**
 * Prerender routes to static HTML so social-card crawlers (LINE, FB, X) and
 * non-JS indexers see the rendered content. Uses Puppeteer against a local
 * `vite preview` server, which is already the production bundle.
 *
 * Usage (wire as a postbuild step):
 *   npm run build && npm run prerender
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import puppeteer from 'puppeteer';

const DIST_DIR = resolve(process.cwd(), 'dist');
const PREVIEW_PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PREVIEW_PORT}`;

// Pages that should be prerendered. Add more as needed.
// Each entry maps a URL path → filesystem output relative to dist/.
const ROUTES: Array<{ url: string; out: string }> = [
  { url: '/',                   out: 'index.html' },
  { url: '/?transport=train',   out: 'transport-train/index.html' },
  { url: '/?transport=hsr',     out: 'transport-hsr/index.html' },
];

// How long to wait for the SPA to settle. Bump if you add heavy queries.
const SETTLE_MS = 1500;
// Selector that must exist before we consider a page rendered.
const READY_SELECTOR = 'h1';

async function waitForServer(url: string, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`vite preview did not come up at ${url}`);
}

async function main() {
  // Spawn `vite preview` in the background.
  const preview = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort'],
    { stdio: ['ignore', 'inherit', 'inherit'] }
  );
  const cleanup = () => { try { preview.kill('SIGTERM'); } catch {} };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(1); });

  try {
    await waitForServer(BASE_URL);

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const originalIndex = await readFile(join(DIST_DIR, 'index.html'), 'utf8');

    for (const { url, out } of ROUTES) {
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Prerender Bot) Taiwanrail/1.0');
      await page.setViewport({ width: 1280, height: 900 });

      console.log(`→ prerendering ${url}`);
      await page.goto(BASE_URL + url, { waitUntil: 'networkidle2', timeout: 30_000 });
      await page.waitForSelector(READY_SELECTOR, { timeout: 15_000 });
      await new Promise(r => setTimeout(r, SETTLE_MS));

      // Strip <script type="module" src="/src/main.tsx"> — Vite already
      // inlined the real prod bundle via <script type="module" crossorigin>.
      const html = await page.content();

      // Inject <base href="/"> so relative links inside sub-directories still
      // resolve to the root SPA bundle.
      const patched = html.replace(
        '<head>',
        '<head>\n    <base href="/" />'
      );

      const outPath = join(DIST_DIR, out);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, patched, 'utf8');
      console.log(`  ✓ wrote ${out} (${(patched.length / 1024).toFixed(1)} kB)`);

      await page.close();
    }

    await browser.close();

    // Safety: ensure the root index.html still works for the SPA fallback.
    // We overwrote it with the rendered home above, which is exactly what we want.
    void originalIndex;
  } finally {
    cleanup();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
