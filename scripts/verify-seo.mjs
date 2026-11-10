import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const ROOT = process.cwd();
const SITE = 'https://taiwanrail.vercel.app';
const TDX_SOURCE = 'https://tdx.transportdata.tw/';

const failures = [];

function read(path) {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

/** Reverse the five entities the generator's esc() produces, so lengths measure what a searcher sees. */
function decodeEntities(value) {
  return String(value)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
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
assert(urlBlocks.length >= 36, 'sitemap should include 2 base pages plus 34 localized route pages');
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

const routePages = [
  ...walkIndexPages(resolve(ROOT, 'public/routes')),
  ...walkIndexPages(resolve(ROOT, 'public/en/routes')),
];
assert(routePages.length >= 34, 'expected 17 route pairs in Traditional Chinese and English');

for (const routePage of routePages) {
  const html = readFileSync(routePage, 'utf8');
  const routePath = routePathForFile(routePage);
  const canonicalUrl = `${SITE}${routePath}`;
  const isEnglish = routePath.startsWith('/en/');
  const baseRoutePath = isEnglish ? routePath.replace(/^\/en/, '') : routePath;
  const zhUrl = `${SITE}${baseRoutePath}`;
  const enUrl = `${SITE}/en${baseRoutePath}`;
  const types = extractJsonLdTypes(html);

  assert(
    html.includes(`<html lang="${isEnglish ? 'en' : 'zh-Hant-TW'}">`),
    `${routePath} has the wrong document language`,
  );
  assert(/<title>[^<]+<\/title>/.test(html), `${routePath} is missing title`);
  assert(/<meta name="description" content="[^"]+" \/>/.test(html), `${routePath} is missing meta description`);

  // A title or description past the SERP budget is cut by Google, so the tail is not
  // extra keywords — it is content the searcher never sees, and an over-long
  // description makes Google likelier to bin it and synthesise its own snippet. The
  // budgets are per locale because Google truncates by pixel width and a CJK glyph is
  // about twice as wide as a Latin one. Kept in step with MAX_TITLE / MAX_DESCRIPTION
  // in generate-route-pages.mjs; `npm run seo:audit-meta` reports the same defect
  // across every generated page, including ones this loop does not cover.
  const budget = isEnglish ? { title: 62, description: 158 } : { title: 34, description: 84 };
  const titleText = decodeEntities(html.match(/<title>([^<]+)<\/title>/)?.[1] ?? '');
  const descriptionText = decodeEntities(html.match(/<meta name="description" content="([^"]+)" \/>/)?.[1] ?? '');
  assert(
    [...titleText].length <= budget.title,
    `${routePath} title is ${[...titleText].length} chars, over the ${isEnglish ? 'en' : 'zh'} budget of ${budget.title}`,
  );
  assert(
    [...descriptionText].length <= budget.description,
    `${routePath} meta description is ${[...descriptionText].length} chars, over the ${isEnglish ? 'en' : 'zh'} budget of ${budget.description}`,
  );
  // Each locale's metadata targets that locale only. The zh description used to end
  // with a full English restatement of itself, which spent about half the zh snippet
  // budget duplicating what the /en/ page already targets.
  if (!isEnglish) {
    assert(
      !/Real-time (TRA|THSR) timetable/.test(descriptionText),
      `${routePath} zh meta description restates itself in English, wasting the snippet budget`,
    );
  }
  assert(new RegExp(`<link rel="canonical" href="${canonicalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" \\/>`).test(html), `${routePath} canonical does not match its route URL`);
  assert(/<meta name="robots" content="index, follow/.test(html), `${routePath} must be indexable`);
  assert(!/noindex/i.test(html), `${routePath} must not include noindex`);
  assert(/<h1>[^<]+<\/h1>/.test(html), `${routePath} is missing H1`);

  // Frequency must be stated per ServiceDay group. A single "per day" figure folds
  // weekend-only extras into the weekday count and overstates it.
  const weekdayRow = isEnglish ? 'Direct trains (weekday)' : '平日直達班次';
  const weekendRow = isEnglish ? 'Direct trains (weekend)' : '假日直達班次';
  assert(html.includes(weekdayRow), `${routePath} is missing the weekday frequency row`);
  assert(html.includes(weekendRow), `${routePath} is missing the weekend frequency row`);
  assert(
    !/Direct trains per day|每日直達班次|direct trains daily|每日約有/.test(html),
    `${routePath} still states a single daily frequency`,
  );

  // The page must answer the query itself: a visitor arriving from search sees the
  // actual departures without downloading any JavaScript.
  assert(/<table class="timetable">/.test(html), `${routePath} is missing the timetable`);
  assert(
    /<details class="later-departures">/.test(html),
    `${routePath} is missing the collapsed later-departures section`,
  );
  // The Google tag is the single permitted external script: it is async, it does no
  // render-blocking work, and the page still answers the query with JS disabled. Every
  // other external script is still banned — that zero-JS first paint is the only
  // advantage these pages hold over the native timetable apps.
  const externalScripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/gi)].map((m) => m[1]);
  for (const src of externalScripts) {
    assert(
      src.startsWith('https://www.googletagmanager.com/gtag/js?id='),
      `${routePath} loads external JavaScript (${src}); only the Google tag is permitted`,
    );
  }

  const timetableRows = [...html.matchAll(/<tr><td>(.*?)<\/td><td>.*?<\/td><td>(\d\d:\d\d)<\/td><td>(\d\d:\d\d)<\/td>/g)];
  assert(timetableRows.length > 0, `${routePath} timetable has no service rows`);
  for (const [, trainNo] of timetableRows) {
    assert(/^\d+$/.test(trainNo), `${routePath} timetable row has no train number: ${trainNo}`);
  }

  // Self-consistency: the stated frequency must equal the rows actually printed.
  // This is what catches a stat drifting away from the services behind it — without
  // re-implementing the ServiceDay grouping here.
  const statedWeekday = html.match(isEnglish ? /Direct trains \(weekday\)<\/th><td>Approx\. (\d+)/ : /平日直達班次[^<]*<\/th><td>約 (\d+) 班/);
  const statedWeekend = html.match(isEnglish ? /Direct trains \(weekend\)<\/th><td>Approx\. (\d+)/ : /假日直達班次[^<]*<\/th><td>約 (\d+) 班/);
  assert(statedWeekday && statedWeekend, `${routePath} frequency rows are not machine-readable`);

  const sections = html.split(/<h3>/).slice(1);
  assert(sections.length >= 2, `${routePath} is missing the weekday/weekend timetable sections`);
  const rowsIn = (section) => (section.match(/<tr><td>/g) || []).length;
  assert(
    rowsIn(sections[0]) === Number(statedWeekday[1]),
    `${routePath} weekday timetable lists ${rowsIn(sections[0])} services but states ${statedWeekday[1]}`,
  );
  assert(
    rowsIn(sections[1]) === Number(statedWeekend[1]),
    `${routePath} weekend timetable lists ${rowsIn(sections[1])} services but states ${statedWeekend[1]}`,
  );

  // Fares are published for both operators now (TRA's dataset was verified against the
  // official tariff once direction disambiguation landed). Assert presence and shape
  // only — never an amount, because fares change with the refresh and with revisions.
  // TRA labels the row 全票單程票價, THSR 標準車廂全票; English uses one label for both.
  const fareRow = html.match(isEnglish
    ? /Adult one-way fare<\/th><td>(.*?)<\/td>/
    : /(?:全票單程票價|標準車廂全票)[^<]*<\/th><td>(.*?)<\/td>/);
  assert(fareRow, `${routePath} does not state an adult one-way fare`);
  assert(
    fareRow ? /NT\$\d+/.test(fareRow[1]) : false,
    `${routePath} fare row has no NT$ figure`,
  );

  // The page must date its own data. Without this a visitor cannot tell whether the
  // weekly pattern shown is current, and the page silently reads as if it were live.
  const asOf = html.match(isEnglish ? /Data as of (\d{4}-\d{2}-\d{2})/ : /資料截至 (\d{4}-\d{2}-\d{2})/);
  assert(asOf, `${routePath} does not state the date its timetable data is from`);
  assert(
    !Number.isNaN(Date.parse(asOf[1])),
    `${routePath} states an unparseable data-as-of date: ${asOf[1]}`,
  );

  const pageBytes = Buffer.byteLength(html, 'utf8');
  assert(
    pageBytes <= 60_000,
    `${routePath} is ${(pageBytes / 1000).toFixed(1)} kB; route pages must stay under 60 kB`,
  );
  assert(types.includes('WebPage'), `${routePath} is missing WebPage JSON-LD`);
  assert(types.includes('BreadcrumbList'), `${routePath} is missing BreadcrumbList JSON-LD`);
  assert(types.includes('FAQPage'), `${routePath} is missing FAQPage JSON-LD (data-rich route content)`);
  assert(/"dateModified":"\d{4}-\d{2}-\d{2}"/.test(html), `${routePath} WebPage JSON-LD is missing dateModified`);
  assert(/"@type":"TravelAction"/.test(html), `${routePath} WebPage JSON-LD is missing TravelAction mainEntity`);
  assert(html.includes(`"citation":"${TDX_SOURCE}"`), `${routePath} WebPage JSON-LD must cite the official TDX source`);
  assert(
    html.includes(`<a href="${TDX_SOURCE}" rel="external noopener noreferrer">`),
    `${routePath} visible content must link to the official TDX source`,
  );
  assert(
    html.includes(`<link rel="alternate" hreflang="zh-Hant" href="${zhUrl}" />`)
      && html.includes(`<link rel="alternate" hreflang="en" href="${enUrl}" />`)
      && html.includes(`<link rel="alternate" hreflang="x-default" href="${zhUrl}" />`),
    `${routePath} must declare reciprocal zh-Hant/en/x-default hreflang links`,
  );
  if (isEnglish) {
    assert(html.includes('<h2>Route overview</h2>'), `${routePath} must render English route content`);
    assert(html.includes('<h2>Frequently asked questions</h2>'), `${routePath} must render an English FAQ heading`);
  }
}

// --- Analytics coverage ----------------------------------------------------
// Generated pages are standalone documents and never load the SPA, so they do not
// inherit index.html's Google tag. When they lacked it, GA4 saw only "/" and "/en/"
// — 2 of the 290 sitemap URLs — and reported the property as receiving no data.
// Pin the tag on every page and pin one measurement ID across all of them, so the
// SPA entry and the generated pages can never drift onto different properties.
const GA_ID_PATTERN = /googletagmanager\.com\/gtag\/js\?id=(G-[A-Z0-9]+)/;
const indexHtml = read('index.html');
const indexGaId = indexHtml.match(GA_ID_PATTERN)?.[1];
assert(indexGaId, 'index.html is missing the Google tag (gtag.js) script');

const generatedPages = walkIndexPages(resolve(ROOT, 'public'));
assert(generatedPages.length > 0, 'expected generated static pages under public/');
for (const page of generatedPages) {
  const html = readFileSync(page, 'utf8');
  const pagePath = routePathForFile(page);
  const gaId = html.match(GA_ID_PATTERN)?.[1];
  assert(gaId, `${pagePath} is missing the Google tag; GA4 cannot measure this page`);
  assert(
    !gaId || gaId === indexGaId,
    `${pagePath} uses measurement ID ${gaId} but index.html uses ${indexGaId}`,
  );
  assert(
    html.includes(`gtag('config', '${indexGaId}')`),
    `${pagePath} loads gtag.js but never calls gtag('config', …), so it sends no page_view`,
  );
}

const appSource = read('src/App.tsx');
// Generated by generate-route-pages.mjs from the same ROUTES the pages come from.
const indexableRoutesSource = read('src/lib/indexableRoutes.ts');
assert(
  appSource.includes(`href="${TDX_SOURCE}"`) && appSource.includes('rel="external noopener noreferrer"'),
  'homepage visible content must link to the official TDX source',
);
assert(
  appSource.includes('href={isZh ? r.href : `/en${r.href}`}'),
  'English homepage popular-route links must point to localized /en/routes/ pages',
);
for (const routePage of routePages) {
  const routePath = routePathForFile(routePage);
  const baseRoutePath = routePath.replace(/^\/en/, '');
  assert(
    indexableRoutesSource.includes(`'${baseRoutePath}'`),
    `generated indexable-route map does not include ${baseRoutePath}`,
  );
}

const llms = read('public/llms.txt');
assert(llms.includes(`[TDX 運輸資料流通服務平臺](${TDX_SOURCE})`), 'llms.txt must link to the official TDX source');

for (const question of [
  '這個網站是免費的嗎？',
  '可以查到當日列車誤點嗎？',
  '高鐵票價資料是從哪裡來的？',
  '可以離線使用嗎？',
  '支援轉乘捷運嗎？',
  '可以查公車到站時間嗎？',
  '可以查 YouBike 站點的可借車輛嗎？',
]) {
  assert(read('index.html').includes(question), `index.html FAQ JSON-LD is missing question: ${question}`);
  assert(appSource.includes(question), `visible FAQ source is missing question: ${question}`);
}

// --- SPA head tags ---------------------------------------------------------
// index.html carries a static copy of the tags <Helmet> renders, for crawlers that do
// not run JavaScript. React 19 hoists Helmet's tags without replacing anything, so
// every rendered page once had two descriptions and two canonicals. Each static copy
// is therefore marked `data-static-head` and App removes the marked tags on mount.
// A tag Helmet renders but that is not marked comes back as a duplicate; a marked tag
// Helmet does not render (robots, verification …) silently disappears.
const HELMET_TAGS = [
  /<title[ >]/,
  /<meta name="(title|description)" /,
  /<link rel="canonical" /,
  /<link rel="alternate" hreflang=/,
  /<meta property="og:(type|site_name|url|title|description|image|locale|locale:alternate)" /,
  /<meta name="twitter:(card|title|description|image)" /,
];
const headLines = indexHtml.slice(0, indexHtml.indexOf('</head>')).split('\n')
  .filter((line) => /^\s*<(title|meta|link)\b/.test(line));
for (const line of headLines) {
  const helmetRenders = HELMET_TAGS.some((re) => re.test(line));
  const marked = line.includes('data-static-head');
  assert(!helmetRenders || marked, `index.html tag is rendered again by Helmet but lacks data-static-head: ${line.trim()}`);
  assert(helmetRenders || !marked, `index.html tag is marked data-static-head but Helmet never renders it: ${line.trim()}`);
}
assert(
  appSource.includes("querySelectorAll('[data-static-head]')"),
  'App.tsx must remove the static [data-static-head] tags once Helmet has rendered',
);
// The homepage title: the static one and the one the app renders must be the same
// string, and it must name the tabs added after rail.
const staticTitle = decodeEntities(indexHtml.match(/<title data-static-head>([^<]+)<\/title>/)?.[1] ?? '');
assert(staticTitle, 'index.html is missing its <title data-static-head>');
assert(appSource.includes(`title: '${staticTitle}'`), 'index.html <title> must equal HOME_META.zh.title in App.tsx');
for (const word of ['台鐵', '高鐵', '捷運', '公車', 'YouBike']) {
  assert(staticTitle.includes(word), `homepage <title> must mention ${word}`);
}
// The canonical is built from what the page is, never from the raw query string.
assert(
  !/currentSearch|window\.location\.search/.test(appSource.slice(appSource.indexOf('const getDynamicMeta'), appSource.indexOf('} = getDynamicMeta();'))),
  'getDynamicMeta must not build the canonical from window.location.search',
);

// --- Section hubs ------------------------------------------------------------
// One static landing page per app tab. Search engines index these, and the AI crawlers
// robots.txt welcomes do not run the SPA at all, so a tab without a hub page, a
// homepage link and an llms.txt entry does not exist for them. 公車 and 單車 shipped
// that way once; this pins every surface so a seventh tab cannot repeat it.
const HUB_SLUGS = ['tra', 'thsr', 'metro', 'bus', 'youbike', 'journey'];
const YOUBIKE_SOURCE = 'https://www.youbike.com.tw/';
for (const slug of HUB_SLUGS) {
  for (const locale of ['', '/en']) {
    const hubPath = `${locale}/${slug}/`;
    const hubFile = resolve(ROOT, `public${hubPath}index.html`);
    assert(existsSync(hubFile), `${hubPath} hub page is missing`);
    assert(sitemap.includes(`<loc>${SITE}${hubPath}</loc>`), `sitemap must list ${hubPath}`);
    assert(appSource.includes(`'${hubPath}'`), `SPA footer must link to ${hubPath}`);
    if (!existsSync(hubFile)) continue;
    const hub = readFileSync(hubFile, 'utf8');
    assert(hub.includes(`<link rel="canonical" href="${SITE}${hubPath}" />`), `${hubPath} canonical does not match its URL`);
    assert(/<h1>[^<]+<\/h1>/.test(hub), `${hubPath} is missing H1`);
    // Every other hub must be one link away, or the new page is an orphan.
    for (const other of HUB_SLUGS.filter((x) => x !== slug)) {
      assert(hub.includes(`href="${SITE}${locale}/${other}/"`), `${hubPath} must link to the ${other} hub`);
    }
  }
  assert(indexHtml.includes(`"url": "${SITE}/${slug}/"`), `index.html SiteNavigationElement list is missing /${slug}/`);
  assert(indexHtml.includes(`<li><a href="/${slug}/">`), `index.html <noscript> nav is missing /${slug}/`);
  assert(llms.includes(`${SITE}/${slug}/`), `llms.txt must link to /${slug}/`);
}
// 公車 and 單車 answer questions on the page itself, with matching FAQPage JSON-LD.
for (const hubPath of ['/bus/', '/en/bus/', '/youbike/', '/en/youbike/']) {
  const hubFile = resolve(ROOT, `public${hubPath}index.html`);
  if (!existsSync(hubFile)) continue;
  const hub = readFileSync(hubFile, 'utf8');
  assert(extractJsonLdTypes(hub).includes('FAQPage'), `${hubPath} is missing FAQPage JSON-LD`);
  const isYouBike = hubPath.includes('youbike');
  // YouBike data is the operator's feed, not TDX: crediting TDX there is a false
  // attribution that every AI answer quoting the page would repeat.
  assert(
    hub.includes(`"citation":"${isYouBike ? YOUBIKE_SOURCE : TDX_SOURCE}"`),
    `${hubPath} must cite ${isYouBike ? 'YouBike' : 'TDX'} as its data source`,
  );
  assert(
    hub.includes(`<a href="${isYouBike ? YOUBIKE_SOURCE : TDX_SOURCE}" rel="external noopener noreferrer">`),
    `${hubPath} visible footer must link to its real data source`,
  );
  if (isYouBike) {
    assert(!hub.includes(`href="${TDX_SOURCE}"`), `${hubPath} must not credit TDX for YouBike data`);
  } else {
    // Counts come from public/data/bus/*.json and each row carries that file's own date.
    assert(/<table class="stats">/.test(hub), `${hubPath} is missing the per-city coverage table`);
    const rows = [...hub.matchAll(/<tr><td>[^<]+<\/td><td>([\d,]+)<\/td><td>([\d,]+)<\/td><td>(\d{4}-\d{2}-\d{2})<\/td><\/tr>/g)];
    assert(rows.length >= 1, `${hubPath} coverage table has no dated city rows`);
  }
}
assert(llms.includes(`(${YOUBIKE_SOURCE})`), 'llms.txt must name YouBike as the source of YouBike data');

// --- Publisher identity ----------------------------------------------------
// A data site has no article bylines, so /about/ carries the trust signals: who runs
// it, where the data comes from, what is logged. It only counts if crawlers can reach
// it from every page and if every page names the same publisher entity.
for (const locale of ['', '/en']) {
  const aboutFile = resolve(ROOT, `public${locale}/about/index.html`);
  assert(existsSync(aboutFile), `${locale}/about/ page is missing`);
  if (existsSync(aboutFile)) {
    const about = readFileSync(aboutFile, 'utf8');
    assert(about.includes('"@type":"AboutPage"'), `${locale}/about/ must declare AboutPage JSON-LD`);
    assert(about.includes(`"@id":"${SITE}/#organization"`), `${locale}/about/ must describe the site Organization`);
  }
  assert(sitemap.includes(`<loc>${SITE}${locale}/about/</loc>`), `sitemap must list ${locale}/about/`);
}
for (const page of generatedPages) {
  const html = readFileSync(page, 'utf8');
  const pagePath = routePathForFile(page);
  const aboutUrl = `${SITE}${pagePath.startsWith('/en/') ? '/en' : ''}/about/`;
  assert(html.includes(`href="${aboutUrl}"`), `${pagePath} must link to ${aboutUrl}`);
  assert(html.includes(`"@id":"${SITE}/#organization"`), `${pagePath} must name the site Organization as publisher`);
}
assert(appSource.includes("'/about/'") && appSource.includes("'/en/about/'"), 'SPA footer must link to /about/ and /en/about/');
assert(indexHtml.includes('"publishingPrinciples": "https://taiwanrail.vercel.app/about/"'), 'index.html Organization must point publishingPrinciples at /about/');

if (failures.length) {
  console.error('SEO verification failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`SEO verification passed: ${urlBlocks.length} sitemap URLs, ${routePages.length} route pages, ${seoDocs.length} source docs.`);
