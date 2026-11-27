/**
 * Renders brand/icon-source.jpeg (the master artwork, 2048×2048) into every icon the site serves.
 *   node scripts/render-pwa-icons.mjs        (npm run icons:render)
 *
 * Outputs — file names are load-bearing (index.html, manifest.webmanifest, the generated SEO
 * pages and AppDrawer reference them), so replace the master image, never rename the outputs:
 *  - public/logo.svg: the favicon (`<link rel="icon" type="image/svg+xml">` on every page) and
 *    the AppDrawer badge. The artwork is a raster, so this is an SVG wrapping a small embedded
 *    JPEG — keeps the file name every page already points at, and stays a few KB.
 *  - pwa-192x192.png / pwa-512x512.png: manifest `any` icons, og:image/twitter:image, JSON-LD logo.
 *  - pwa-maskable-512x512.png: Android crops adaptive icons to an arbitrary shape and only
 *    guarantees the centre 80% circle. The master's Taiwan outline touches that circle, so the
 *    art is scaled to MASKABLE_SCALE and padded with the master's background colour.
 *  - apple-touch-icon.png: 180×180, opaque (iOS fills transparency with black).
 *
 * Why this exists: the committed pwa-*.png files were once corrupt — a JPEG round-tripped through
 * a UTF-8 text decode and saved under a .png name — which silently broke the install icon and
 * every og:image preview. Regenerate here rather than hand-editing binaries.
 */
import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync } from 'node:fs';

const SOURCE = 'brand/icon-source.jpeg';
// Background colour of the master artwork, used to pad the maskable variant.
const BACKGROUND = '#EFF2F7';
// The master has ~20% empty margin on each side. Crop to this square (source pixels) so the
// artwork fills the icon with only a slim border: content spans x≈420–1510, y≈215–1815.
const CROP = { x: 115, y: 165, size: 1700 };
// Corner radius of the rounded icons, as a fraction of the side (close to iOS's ~22%).
const RADIUS = 0.22;
// Fraction of the canvas the cropped art occupies in the maskable variant. The Taiwan outline's
// tips sit ~0.485 of the side from centre, and Android only guarantees a 0.4 radius circle.
const MASKABLE_SCALE = 0.8;
// Pixel size of the JPEG embedded in logo.svg (favicon ≤32px, AppDrawer badge 44px @2x).
const SVG_EMBED_SIZE = 128;

const sourceUrl = `data:image/jpeg;base64,${readFileSync(SOURCE).toString('base64')}`;
const SOURCE_SIZE = 2048;

const browser = await puppeteer.launch();
const page = await browser.newPage();

// `rounded`: transparent rounded corners. Otherwise an opaque square in the art's background
// colour (for platforms that apply their own mask: Android maskable, iOS, and the JPEG in logo.svg).
async function rasterize(size, { scale = 1, rounded = false, type = 'png', quality } = {}) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  const inner = size * scale;
  const k = inner / CROP.size;
  await page.setContent(
    `<!doctype html><style>
       html,body{margin:0;padding:0;width:${size}px;height:${size}px;background:${rounded ? 'transparent' : BACKGROUND}}
       body{display:grid;place-items:center}
       div{width:${inner}px;height:${inner}px;background:url(${sourceUrl}) no-repeat;
           background-size:${SOURCE_SIZE * k}px;background-position:${-CROP.x * k}px ${-CROP.y * k}px;
           border-radius:${rounded ? RADIUS * 100 : 0}%}
     </style><div></div>`,
    { waitUntil: 'load' },
  );
  // Recent Puppeteer returns a Uint8Array, whose toString('base64') is a comma list — wrap it.
  return Buffer.from(await page.screenshot({ type, quality, omitBackground: rounded }));
}

async function writePng(size, name, opts) {
  const buf = await rasterize(size, opts);
  writeFileSync(`public/${name}`, buf);
  console.log(`wrote public/${name} (${buf.length} bytes)`);
}

await writePng(192, 'pwa-192x192.png', { rounded: true });
await writePng(512, 'pwa-512x512.png', { rounded: true });
// Must stay full-bleed and opaque: Android applies its own mask shape.
await writePng(512, 'pwa-maskable-512x512.png', { scale: MASKABLE_SCALE });
// Must stay opaque: iOS rounds it itself and paints transparent pixels black.
await writePng(180, 'apple-touch-icon.png');
// Older iOS and some crawlers ask for this name without any <link>; without the file the SPA
// rewrite answered it with index.html. Same bytes as apple-touch-icon.png.
writeFileSync('public/apple-touch-icon-precomposed.png', readFileSync('public/apple-touch-icon.png'));
console.log('wrote public/apple-touch-icon-precomposed.png (copy of apple-touch-icon.png)');

// favicon.ico: browsers and crawlers request /favicon.ico on their own, whatever <link rel="icon">
// says. An ICO may hold PNG images directly (every browser since IE Vista-era supports it).
{
  const sizes = [16, 32, 48];
  const images = [];
  for (const size of sizes) images.push(await rasterize(size, { rounded: true }));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size, entry); // width
    header.writeUInt8(size, entry + 1); // height
    header.writeUInt8(0, entry + 2); // palette colours
    header.writeUInt8(0, entry + 3); // reserved
    header.writeUInt16LE(1, entry + 4); // colour planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(images[i].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[i].length;
  });
  const ico = Buffer.concat([header, ...images]);
  writeFileSync('public/favicon.ico', ico);
  console.log(`wrote public/favicon.ico (${ico.length} bytes)`);
}

// JPEG has no alpha, so logo.svg rounds the corners with a clip path instead.
const embed = await rasterize(SVG_EMBED_SIZE, { type: 'jpeg', quality: 90 });
const r = SVG_EMBED_SIZE * RADIUS;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_EMBED_SIZE} ${SVG_EMBED_SIZE}" role="img" aria-label="鐵道查詢 Taiwanrail">
  <clipPath id="r"><rect width="${SVG_EMBED_SIZE}" height="${SVG_EMBED_SIZE}" rx="${r}"/></clipPath>
  <image width="${SVG_EMBED_SIZE}" height="${SVG_EMBED_SIZE}" clip-path="url(#r)" href="data:image/jpeg;base64,${embed.toString('base64')}"/>
</svg>
`;
writeFileSync('public/logo.svg', svg);
console.log(`wrote public/logo.svg (${svg.length} bytes)`);

await browser.close();
