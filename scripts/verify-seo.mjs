import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const ROOT = process.cwd();
const SITE = 'https://taiwanrail.vercel.app';

const failures = [];

function read(path) {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function walkIndexPages(dir) {
  if (!existsSync(dir)) return [];
  const pages = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      pages.push(...walkIndexPages(fullPath));
    } else if (entry.isFile() && entry.name === 'index.html') {
      pages.push(fullPath);
    }
  }
  return pages;
}

function routePathForFile(filePath) {
  const publicRoot = resolve(ROOT, 'public');
  const rel = relative(publicRoot, filePath).split(sep).join('/');
  return `/${rel.replace(/index\.html$/, '')}`;
}

function extractJsonLdTypes(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((match) => {
      try {
        return JSON.parse(match[1]);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .map((data) => data['@type']);
}

const seoDocs = [
  'SEO1.md',
  'SEO2.md',
  'SEO3.md',
  'SEO4.md',
  'SEO5.md',
  'SEO6.md',
  'SEO7.md',
  'SEOSEARCH_Main.md',
  'SEOSEARCH_Main2.md',
];

const plan = read('seo-audit-docs/SEO_IMPROVEMENT_PLAN.md');
for (const doc of seoDocs) {
  assert(plan.includes(`\`${doc}\``), `SEO plan does not reference ${doc}`);
}

const robots = read('public/robots.txt');
assert(/User-agent:\s*\*/i.test(robots), 'robots.txt must declare User-agent: *');
assert(/Allow:\s*\/\s*$/im.test(robots), 'robots.txt must allow the root path');
assert(!/Disallow:\s*\/routes\b/im.test(robots), 'robots.txt must not block /routes/');
assert(!/Disallow:\s*\/en\b/im.test(robots), 'robots.txt must not block /en/');
assert(/Sitemap:\s*https:\/\/taiwanrail\.vercel\.app\/sitemap\.xml/i.test(robots), 'robots.txt must point at the canonical sitemap');

const sitemap = read('public/sitemap.xml');
const urlBlocks = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => match[1]);
assert(urlBlocks.length >= 19, 'sitemap should include base pages plus generated route pages');
// The homepage tab-switch variants (?transport=hsr / ?transport=train) must NOT be
// in the sitemap — they are duplicates of "/" and caused "Discovered, not indexed".
assert(!/[?&]transport=/.test(sitemap), 'sitemap must not include ?transport= homepage-variant URLs');

for (const block of urlBlocks) {
  const locMatch = block.match(/<loc>([^<]+)<\/loc>/);
  const loc = locMatch?.[1] ?? '';
  assert(loc.startsWith(SITE), `sitemap loc is not canonical site URL: ${loc || '(missing)'}`);
  assert(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(block), `sitemap loc is missing lastmod: ${loc}`);
  assert(!/<changefreq>|<priority>/.test(block), `sitemap must omit ignored changefreq/priority tags: ${loc}`);
  assert(!/\/api\/|\/data\//.test(loc), `sitemap must not include API or data URLs: ${loc}`);
  assert(!/[?&](fromId|toId)=/.test(loc), `sitemap must not include station deep-link query URLs: ${loc}`);

  if (loc.includes('/routes/')) {
    assert(!loc.includes('?'), `route sitemap URL must be clean and canonical: ${loc}`);
    const localPath = loc.replace(SITE, '').replace(/\/$/, '/index.html');
    assert(existsSync(resolve(ROOT, 'public', localPath.replace(/^\//, ''))), `route sitemap URL has no generated file: ${loc}`);
  }
}

const routePages = walkIndexPages(resolve(ROOT, 'public/routes'));
assert(routePages.length >= 17, 'expected at least 17 generated route landing pages');

for (const routePage of routePages) {
  const html = readFileSync(routePage, 'utf8');
  const routePath = routePathForFile(routePage);
  const canonicalUrl = `${SITE}${routePath}`;
  const types = extractJsonLdTypes(html);

  assert(/<title>[^<]+<\/title>/.test(html), `${routePath} is missing title`);
  assert(/<meta name="description" content="[^"]+" \/>/.test(html), `${routePath} is missing meta description`);
  assert(new RegExp(`<link rel="canonical" href="${canonicalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" \\/>`).test(html), `${routePath} canonical does not match its route URL`);
  assert(/<meta name="robots" content="index, follow/.test(html), `${routePath} must be indexable`);
  assert(!/noindex/i.test(html), `${routePath} must not include noindex`);
  assert(/<h1>[^<]+<\/h1>/.test(html), `${routePath} is missing H1`);
  assert(types.includes('WebPage'), `${routePath} is missing WebPage JSON-LD`);
  assert(types.includes('BreadcrumbList'), `${routePath} is missing BreadcrumbList JSON-LD`);
  assert(types.includes('FAQPage'), `${routePath} is missing FAQPage JSON-LD (data-rich route content)`);
  assert(/"dateModified":"\d{4}-\d{2}-\d{2}"/.test(html), `${routePath} WebPage JSON-LD is missing dateModified`);
  assert(/"@type":"TravelAction"/.test(html), `${routePath} WebPage JSON-LD is missing TravelAction mainEntity`);
}

const appSource = read('src/App.tsx');
for (const routePage of routePages) {
  const routePath = routePathForFile(routePage);
  assert(appSource.includes(routePath), `App.tsx canonical/internal-link map does not include ${routePath}`);
}

for (const question of [
  '這個網站是免費的嗎？',
  '可以查到當日列車誤點嗎？',
  '高鐵票價資料是從哪裡來的？',
  '可以離線使用嗎？',
  '支援轉乘捷運嗎？',
  '停駛與班次取消資訊可信嗎？',
]) {
  assert(read('index.html').includes(question), `index.html FAQ JSON-LD is missing question: ${question}`);
  assert(appSource.includes(question), `visible FAQ source is missing question: ${question}`);
}

if (failures.length) {
  console.error('SEO verification failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`SEO verification passed: ${urlBlocks.length} sitemap URLs, ${routePages.length} route pages, ${seoDocs.length} source docs.`);
