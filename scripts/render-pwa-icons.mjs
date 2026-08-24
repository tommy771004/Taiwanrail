/**
 * Renders public/logo.svg into the PNG icons the manifest and og:image tags point at.
 *   node scripts/render-pwa-icons.mjs
 *
 * Why this exists: the committed pwa-*.png files were corrupt — 720KB each, byte-identical
 * to each other, and not PNGs at all but a JPEG that had been round-tripped through a UTF-8
 * text decode (the first bytes were U+FFFD replacement characters). Nothing rendered them,
 * so the install icon and every og:image/twitter:image preview was broken. Regenerate here
 * rather than hand-editing binaries.
 *
 * Two flavours, because they have different framing rules:
 *  - `any`: the artwork edge to edge, as designed.
 *  - `maskable`: Android crops an adaptive icon to an arbitrary shape (often a circle) and
 *    only guarantees the centre 80%. logo.svg draws the rail line from x=10 to x=54 of a
 *    64-unit canvas, i.e. right at the rim, so shipping the same file as "maskable" clips
 *    the end dots off. The maskable variant insets the art and fills the margin with the
 *    badge's own background colour so nothing lands in the crop zone.
 */
import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync('public/logo.svg', 'utf8');
// Darkest stop of the badge gradient, so the maskable padding reads as part of the art.
const BADGE_BG = '#0b1220';
// Fraction of the canvas the artwork occupies in the maskable variant (inside the 80% safe zone).
const MASKABLE_SCALE = 0.72;

const browser = await puppeteer.launch();
const page = await browser.newPage();

async function render(size, { maskable = false } = {}) {
  const art = maskable ? Math.round(size * MASKABLE_SCALE) : size;
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><style>
       html,body{margin:0;padding:0;width:${size}px;height:${size}px;
         ${maskable ? `background:${BADGE_BG};` : 'background:transparent;'}
         display:flex;align-items:center;justify-content:center}
       svg{display:block;width:${art}px;height:${art}px}
     </style>${svg}`,
    { waitUntil: 'load' },
  );
  const buf = await page.screenshot({ omitBackground: !maskable, type: 'png' });
  const name = maskable ? `public/pwa-maskable-${size}x${size}.png` : `public/pwa-${size}x${size}.png`;
  writeFileSync(name, buf);
  console.log(`wrote ${name} (${buf.length} bytes)`);
}

await render(192);
await render(512);
await render(512, { maskable: true });
await browser.close();
