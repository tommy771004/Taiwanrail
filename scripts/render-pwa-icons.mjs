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
 * Three flavours, because they have different framing rules:
 *  - `any` (pwa-192/512): the badge as designed — rounded, transparent corners.
 *  - `maskable`: Android crops an adaptive icon to an arbitrary shape (often a circle) and
 *    only guarantees the centre 80%. logo.svg's end dots sit at x=8..56 of a 64-unit canvas,
 *    so the same file as "maskable" would clip them, and its rounded badge would show as an
 *    inset tile. The maskable variant paints the badge background full bleed and scales the
 *    artwork (`<g id="tr-art">`) into the safe zone.
 *  - `apple-touch-icon`: iOS applies its own rounded mask and fills transparency with black,
 *    so the rounded `any` PNG gets dark corner slivers. Same full-bleed background, art at
 *    full size.
 */
import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync('public/logo.svg', 'utf8');
// Fraction of the canvas the artwork occupies in the maskable variant (inside the 80% safe zone).
const MASKABLE_SCALE = 0.8;

const defs = svg.match(/<defs>[\s\S]*?<\/defs>/)?.[0];
const art = svg.match(/<g id="tr-art">([\s\S]*?)<\/g>/)?.[1];
if (!defs || !art) throw new Error('logo.svg must contain <defs> and <g id="tr-art"> for the full-bleed variants');

// Full-bleed square: badge gradient + sheen edge to edge, artwork scaled about the centre.
function fullBleed(scale) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${defs}
    <rect width="64" height="64" fill="url(#tr-bg)"/><rect width="64" height="64" fill="url(#tr-sheen)"/>
    <g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${art}</g></svg>`;
}

const browser = await puppeteer.launch();
const page = await browser.newPage();

async function render(size, name, markup, { opaque = false } = {}) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><style>
       html,body{margin:0;padding:0;width:${size}px;height:${size}px;background:transparent}
       svg{display:block;width:${size}px;height:${size}px}
     </style>${markup}`,
    { waitUntil: 'load' },
  );
  const buf = await page.screenshot({ omitBackground: !opaque, type: 'png' });
  writeFileSync(`public/${name}`, buf);
  console.log(`wrote public/${name} (${buf.length} bytes)`);
}

await render(192, 'pwa-192x192.png', svg);
await render(512, 'pwa-512x512.png', svg);
await render(512, 'pwa-maskable-512x512.png', fullBleed(MASKABLE_SCALE), { opaque: true });
await render(180, 'apple-touch-icon.png', fullBleed(1), { opaque: true });
await browser.close();
