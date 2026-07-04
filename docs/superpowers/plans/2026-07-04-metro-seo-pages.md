# Metro System SEO Landing Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate 7 static, indexable SEO landing pages (one per metro/LRT operator) with real
stats pulled from committed TDX data, wire them into the sitemap, and let their CTA deep-link
land on the right operator inside the app.

**Architecture:** Extend `scripts/generate-route-pages.mjs` (the existing TRA/HSR static-page
generator) with a parallel metro code path: a `METRO_SYSTEMS` table, a `metroSystemStats()`
aggregator over `public/data/metro_<CODE>/*`, and a `pageForMetro()` HTML/JSON-LD builder — same
shape as the existing `pageFor()`. Then two small app-side changes let `?transport=metro&system=<CODE>`
preselect an operator in `MetroSearch`.

**Tech Stack:** Plain Node ESM (`node scripts/generate-route-pages.mjs`, no TypeScript, no build
step), React 19 for the two app-side edits.

**Note on testing:** This repo has no unit-test framework for scripts or React components (see
`CLAUDE.md`: "no linter beyond `tsc`"; the only automated tests are `tsx --test` data-integrity
checks). The existing TRA/HSR generator this extends has no unit tests either — it's verified by
running it and checking output, plus the existing `npm run seo:verify` structural checks. This
plan follows that same convention: "run and inspect" steps stand in for red/green tests.

---

### Task 1: Data helpers — read metro static files, compute per-system stats

**Files:**
- Modify: `scripts/generate-route-pages.mjs` (imports near line 15-17; new code after the
  existing `statsFor()` function, currently ending around line 160)

- [ ] **Step 1: Add `readdirSync` to the existing fs import**

Change:
```js
import { readFileSync } from 'node:fs';
```
to:
```js
import { readFileSync, readdirSync } from 'node:fs';
```

- [ ] **Step 2: Add the metro system table**

Insert after the existing `S` station catalogue (after the closing `};` of `const S = {...}`,
around line 48):

```js
// --- Metro system catalogue --------------------------------------------
// Codes match METRO_SYSTEMS in src/lib/metro.ts. `slug` is the SEO URL segment.
const METRO_SYSTEMS = [
  { code: 'TRTC',   zh: '台北捷運', en: 'Taipei Metro',      slug: 'taipei-metro' },
  { code: 'NTMC',   zh: '新北捷運', en: 'New Taipei Metro',   slug: 'new-taipei-metro' },
  { code: 'TYMC',   zh: '桃園捷運', en: 'Taoyuan Metro',      slug: 'taoyuan-metro' },
  { code: 'TMRT',   zh: '台中捷運', en: 'Taichung Metro',     slug: 'taichung-metro' },
  { code: 'KRTC',   zh: '高雄捷運', en: 'Kaohsiung Metro',    slug: 'kaohsiung-metro' },
  { code: 'KLRT',   zh: '高雄輕軌', en: 'Kaohsiung LRT',      slug: 'kaohsiung-lrt' },
  { code: 'NTDLRT', zh: '淡海輕軌', en: 'Danhai LRT',         slug: 'danhai-lrt' },
];
```

- [ ] **Step 3: Add `loadMetroJson` and `fmtHHMM`**

Insert right after the existing `loadJson()` function (around line 74):

```js
function loadMetroJson(system, name) {
  try { return JSON.parse(readFileSync(join(DATA_ROOT, `metro_${system}`, name), 'utf8')); }
  catch { return null; }
}

const fmtHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
```

- [ ] **Step 4: Add `metroSystemStats()`**

Insert after `statsFor()` (after its closing `}`, around line 160):

```js
/**
 * Aggregate one metro system's committed static snapshot into page-ready stats.
 * Throws if a REQUIRED file (stations, at least one line) is missing so the
 * caller can skip just this system — each of the 7 operators has an
 * independently-fetched snapshot and one gap (e.g. KLRT's fares/ was briefly
 * empty) must not block the other 6 pages or the sitemap write.
 */
function metroSystemStats(code) {
  const stations = loadMetroJson(code, 'stations.json') || [];
  if (!stations.length) throw new Error(`metro_${code}/stations.json missing or empty`);

  const s2s = loadMetroJson(code, 's2s.json') || [];
  if (!s2s.length) throw new Error(`metro_${code}/s2s.json missing or empty`);

  const transfersRaw = loadMetroJson(code, 'transfers.json') || [];

  // Line display names come from LineTransfer's Zh_tw/En pair — the only
  // place in the static snapshot that carries a human line name, so a line
  // with zero transfer records falls back to its raw LineID.
  const lineNames = new Map();
  for (const t of transfersRaw) {
    if (t.FromLineID && t.FromLineName) lineNames.set(t.FromLineID, { zh: t.FromLineName.Zh_tw, en: t.FromLineName.En });
    if (t.ToLineID && t.ToLineName) lineNames.set(t.ToLineID, { zh: t.ToLineName.Zh_tw, en: t.ToLineName.En });
  }

  // s2s.json entries are per-ROUTE-VARIANT (e.g. TRTC's BL has a full BL-1 and
  // a shorter branch BL-2), not one row per line. Represent each LineID by its
  // longest variant so the table shows the full line, not a short-turn branch.
  //
  // CORRECTED after Task 1 spec review found this shape assumption breaks for
  // two of the five systems that have s2s.json at all: TDX's S2STravelTime is
  // NOT consistently a sequential adjacent-station chain. TRTC/NTMC/KRTC store
  // one entry per adjacent hop (entries == distinct stations - 1); TYMC/KLRT
  // store a full/partial OD MATRIX where every entry's RunTime is already the
  // CUMULATIVE time from that entry's FromStationID to its ToStationID (e.g.
  // TYMC's "A1→A2" RunTime=300s, "A1→A3"=480s/540s — two conflicting values
  // for the same pair because rows come from different reference origins;
  // "A1→ the airport terminus"=2160s+). Using `segs.length + 1` as the station
  // count against a matrix produces nonsense (TYMC "505 stations", KLRT "743
  // stations" — the real counts are 22 and 38). Detect the shape instead of
  // assuming one: a genuine chain never has more entries than distinct
  // stations; a matrix always does (it is close to N*(N-1)).
  const byLine = new Map();
  for (const route of s2s) {
    const segs = route.TravelTimes || [];
    if (!segs.length) continue;
    const stationIds = new Set();
    for (const t of segs) {
      if (t.FromStationID) stationIds.add(t.FromStationID);
      if (t.ToStationID) stationIds.add(t.ToStationID);
    }
    const stationCount = stationIds.size;
    const isSequentialChain = segs.length <= stationCount;
    const minutes = isSequentialChain
      // Chain: entries are individual adjacent hops — sum them for the full ride.
      ? Math.round(segs.reduce((a, t) => a + (t.RunTime || 0) + (t.StopTime || 0), 0) / 60)
      // Matrix: RunTime is already cumulative per pair, so the longest pair
      // recorded anywhere in the array IS the end-to-end one-way time.
      : Math.round(Math.max(...segs.map((t) => t.RunTime || 0)) / 60);
    const prev = byLine.get(route.LineID);
    if (!prev || stationCount > prev.stationCount) {
      byLine.set(route.LineID, { lineId: route.LineID, stationCount, minutes });
    }
  }
  const lines = [...byLine.values()]
    .map((l) => ({ ...l, name: lineNames.get(l.lineId)?.zh || l.lineId, nameEn: lineNames.get(l.lineId)?.en || l.lineId }))
    .sort((a, b) => b.stationCount - a.stationCount);

  // Fare range: scan every committed per-origin ODFare file, take the
  // full-fare (FareClass 1) min/max across the whole system. `fares/` can be
  // absent for a system whose ODFare fetch failed (e.g. KLRT) — that's not a
  // hard failure, the page just omits the price row/FAQ.
  let fareRange = null;
  try {
    const files = readdirSync(join(DATA_ROOT, `metro_${code}`, 'fares'));
    let min = Infinity, max = -Infinity;
    for (const f of files) {
      const rows = loadMetroJson(code, `fares/${f}`) || [];
      for (const row of rows) {
        const full = (row.Fares || []).find((x) => x.FareClass === 1);
        if (full && Number.isFinite(full.Price)) {
          if (full.Price < min) min = full.Price;
          if (full.Price > max) max = full.Price;
        }
      }
    }
    if (Number.isFinite(min) && Number.isFinite(max)) fareRange = { min, max };
  } catch { /* no fares/ dir for this system — price stats omitted */ }

  // Operating hours: scan every station's root-level Timetables[]. Treat any
  // DepartureTime hour < 04:00 as a post-midnight last train, not a genuine
  // first train (shift it +1440 before min/max so it can only win "latest",
  // never falsely win "earliest") — TDX metro timetables express those as
  // 00:xx-03:xx rather than 24:xx/25:xx.
  let earliestNorm = Infinity, latestNorm = -Infinity;
  for (const s of stations) {
    const rows = loadMetroJson(code, `${s.StationID}.json`);
    if (!rows) continue;
    for (const dir of rows) {
      for (const t of dir.Timetables || []) {
        const raw = toMin(t.DepartureTime);
        if (!Number.isFinite(raw)) continue;
        const norm = raw < 240 ? raw + 1440 : raw;
        if (norm < earliestNorm) earliestNorm = norm;
        if (norm > latestNorm) latestNorm = norm;
      }
    }
  }
  const hours = Number.isFinite(earliestNorm) && Number.isFinite(latestNorm)
    ? { first: fmtHHMM(earliestNorm % 1440), last: fmtHHMM(latestNorm % 1440) }
    : null;

  const interchangeNames = [...new Set(transfersRaw.map((t) => t.FromStationName?.Zh_tw).filter(Boolean))];
  const interchangeNamesEn = [...new Set(transfersRaw.map((t) => t.FromStationName?.En).filter(Boolean))];

  return {
    stationCount: stations.length,
    lines,
    fareRange,
    hours,
    interchangeCount: interchangeNames.length,
    interchangeNames: interchangeNames.slice(0, 5),
    interchangeNamesEn: interchangeNamesEn.slice(0, 5),
  };
}
```

**Known data-completeness gaps (confirmed against the committed snapshot, not a code bug —
document, don't try to fix by fabricating data):**
- `TMRT` and `NTDLRT` have **no `s2s.json` at all** in the current snapshot — `metroSystemStats()`
  correctly throws for both, and the Task 3 loop skips them with a warning. Their pages simply
  won't generate until `npm run fetch-metro-data` picks up a working fetch for those two systems.
  Expect 5 of 7 metro pages on the first run, not 7.
- `TYMC` and `KLRT` have **no `transfers.json`** — both are effectively single-line systems, so
  `lineNames` stays empty and each line's display name falls back to its raw `LineID` ("A", "C")
  instead of a proper name, and the 轉乘/interchange row and FAQ are omitted entirely (both
  correctly, per the existing graceful-degradation logic — nothing further to fix here).

- [ ] **Step 5: Manual smoke check (stands in for a unit test — see note above)**

Run:
```bash
node -e "
const m = await import('./scripts/generate-route-pages.mjs');
" 2>&1 | head -5
```
This will actually run the whole script (it has a top-level `main().catch(...)` call), which is
not what we want yet — instead verify the new function in isolation with a scratch script:

```bash
node --input-type=module -e "
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const DATA_ROOT = join(process.cwd(), 'public', 'data');
function loadMetroJson(system, name) {
  try { return JSON.parse(readFileSync(join(DATA_ROOT, \`metro_\${system}\`, name), 'utf8')); }
  catch { return null; }
}
const stations = loadMetroJson('TRTC', 'stations.json');
console.log('TRTC stations:', stations.length);
const s2s = loadMetroJson('TRTC', 's2s.json');
console.log('TRTC lines (raw route-variants):', s2s.length);
"
```
Expected: `TRTC stations: 121` and `TRTC lines (raw route-variants): 11` — confirms the file
paths and shapes assumed in Step 4 are correct before wiring the real function in. (Full
end-to-end verification of `metroSystemStats()` itself happens in Task 3, Step 3, once it's
called from `main()`.)

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-route-pages.mjs
git commit -m "$(cat <<'EOF'
feat(seo): add metro static-data stat aggregation to route-page generator

Reads the committed public/data/metro_* snapshot (stations, per-line
travel times, ODFare, transfers) into per-system stats, laying the
groundwork for metro SEO landing pages.
EOF
)"
```

---

### Task 2: `pageForMetro()` — HTML + JSON-LD page builder

**Files:**
- Modify: `scripts/generate-route-pages.mjs` (new function after the existing `pageFor()`,
  currently ending around line 445, before `async function main()`)

- [ ] **Step 1: Write `pageForMetro()`**

```js
function pageForMetro(code, allCodes, locale = 'zh') {
  const isEnglish = locale === 'en';
  const sys = METRO_SYSTEMS.find((s) => s.code === code);
  const stats = metroSystemStats(code);

  const basePathname = `/routes/metro/${sys.slug}/`;
  const pathname = `${isEnglish ? '/en' : ''}${basePathname}`;
  const absoluteUrl = SITE + pathname;
  const zhUrl = SITE + basePathname;
  const enUrl = `${SITE}/en${basePathname}`;
  const appDeepLink = `${SITE}${isEnglish ? '/en/' : '/'}?transport=metro&system=${code}`;

  const lineCount = stats.lines.length;
  const longest = stats.lines[0]; // sorted desc by stationCount in metroSystemStats

  const statZh = `共 ${lineCount} 條路線、${stats.stationCount} 座車站，最長單一路線單程約 ${longest ? fmtDur(longest.minutes) : '—'}。`;
  const statEn = ` ${lineCount} lines, ${stats.stationCount} stations; the longest single line takes about ${longest ? fmtDurEn(longest.minutes) : '—'} end to end.`;

  const title = isEnglish
    ? `${sys.en} Route Map, Fares & Live Timetable`
    : `${sys.zh}路線圖、票價與即時班次查詢 | ${sys.en} Route Map & Timetable`;
  const description = isEnglish
    ? `Plan your ${sys.en} trip: lines, station counts, fare range, operating hours and interchange stations.${statEn}`
    : `${sys.zh}路線、車站數、票價區間、營運時間與轉乘站一次看。${statZh}`;

  const jsonLdWebPage = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${absoluteUrl}#webpage`,
    url: absoluteUrl,
    name: title,
    description,
    inLanguage: isEnglish ? 'en' : 'zh-Hant-TW',
    dateModified: SITEMAP_LASTMOD,
    citation: TDX_SOURCE,
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: isEnglish ? 'Home' : '首頁', item: `${SITE}${isEnglish ? '/en/' : '/'}` },
      { '@type': 'ListItem', position: 2, name: isEnglish ? 'Metro' : '捷運', item: `${SITE}${isEnglish ? '/en/' : '/'}?transport=metro` },
      { '@type': 'ListItem', position: 3, name: isEnglish ? sys.en : sys.zh, item: absoluteUrl },
    ],
  };

  // --- FAQ (visible + JSON-LD), built only from stats we actually have ---
  const faqs = [];
  faqs.push({
    q: isEnglish ? `How many lines does ${sys.en} have?` : `${sys.zh}有幾條路線？`,
    a: isEnglish
      ? `${sys.en} operates ${lineCount} line${lineCount === 1 ? '' : 's'} across ${stats.stationCount} stations.`
      : `${sys.zh}目前共有 ${lineCount} 條路線、${stats.stationCount} 座車站。`,
  });
  if (stats.hours) {
    faqs.push({
      q: isEnglish ? `What are ${sys.en}'s operating hours?` : `${sys.zh}的營運時間到幾點？`,
      a: isEnglish
        ? `Trains typically run from about ${stats.hours.first} to ${stats.hours.last}, though this varies by line and station — check the live timetable for the exact first/last train at your station.`
        : `列車約自 ${stats.hours.first} 行駛至 ${stats.hours.last}，實際首末班依路線與車站而異，請以即時查詢結果為準。`,
    });
  }
  if (stats.fareRange) {
    faqs.push({
      q: isEnglish ? `How much does ${sys.en} cost?` : `${sys.zh}票價怎麼算？`,
      a: isEnglish
        ? `A single full-fare ride costs between NT$${stats.fareRange.min} and NT$${stats.fareRange.max} depending on distance. IC cards (悠遊卡/一卡通) get a discount over single-journey tickets. Source: TDX ODFare.`
        : `全票單程票價依里程介於 NT$${stats.fareRange.min}–NT$${stats.fareRange.max} 之間，使用悠遊卡／一卡通享有優惠（資料來源：TDX ODFare）。`,
    });
  }
  if (stats.interchangeNames.length) {
    faqs.push({
      q: isEnglish ? `Where can I transfer to other lines on ${sys.en}?` : `${sys.zh}在哪些站可以轉乘其他路線？`,
      a: isEnglish
        ? `There are ${stats.interchangeCount} in-system interchange points, including ${stats.interchangeNamesEn.join(', ')}.`
        : `站內共有 ${stats.interchangeCount} 個轉乘點，包含${stats.interchangeNames.join('、')}等站。`,
    });
  }
  faqs.push({
    q: isEnglish ? `Is this ${sys.en} information free to use?` : `查詢${sys.zh}資訊要付費嗎？`,
    a: isEnglish
      ? 'Yes. Search and browsing are free and require no account. Data comes from the Taiwan MOTC TDX public API.'
      : '完全免費。資料來源為交通部 TDX 運輸資料流通服務平臺公開 API，搜尋與瀏覽都不需要註冊。',
  });

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };

  const ldScripts = [jsonLdWebPage, breadcrumb, faqJsonLd]
    .map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`)
    .join('\n    ');

  const lineRows = stats.lines.map((l) =>
    `<tr><th>${esc(isEnglish ? l.nameEn : l.name)}</th><td>${isEnglish ? `${l.stationCount} stations · ${fmtDurEn(l.minutes)}` : `${l.stationCount} 站・約 ${fmtDur(l.minutes)}`}</td></tr>`
  ).join('\n          ');
  const fareRow = stats.fareRange
    ? `<tr><th>${isEnglish ? 'Full fare range' : '全票票價區間'}</th><td>NT$${stats.fareRange.min}–${stats.fareRange.max}</td></tr>`
    : '';
  const hoursRow = stats.hours
    ? `<tr><th>${isEnglish ? 'Approx. operating hours' : '約略營運時間'}</th><td>${stats.hours.first} – ${stats.hours.last}</td></tr>`
    : '';
  const interchangeRow = stats.interchangeNames.length
    ? `<tr><th>${isEnglish ? 'Interchange stations' : '站內轉乘點'}</th><td>${isEnglish ? `${stats.interchangeCount} points (${stats.interchangeNamesEn.join(', ')})` : `${stats.interchangeCount} 處（${stats.interchangeNames.join('、')} 等）`}</td></tr>`
    : '';

  const faqBlock = `
      <h2>${isEnglish ? 'Frequently asked questions' : '常見問題 FAQ'}</h2>
      <div class="faq">
        ${faqs.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n        ')}
      </div>`;

  const related = allCodes
    .filter((c) => c !== code)
    .map((c) => {
      const s = METRO_SYSTEMS.find((x) => x.code === c);
      const routePath = `/routes/metro/${s.slug}/`;
      return isEnglish
        ? `<li><a href="${SITE}/en${routePath}">${s.en}</a></li>`
        : `<li><a href="${SITE}${routePath}">${s.zh}</a></li>`;
    }).join('\n        ');

  const accent = '#0891b2', accentSoft = '#ecfeff', accentText = '#155e75', shadow = 'rgba(8,145,178,.5)';

  const html = `<!doctype html>
<html lang="${isEnglish ? 'en' : 'zh-Hant-TW'}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="${accent}" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
    <link rel="icon" type="image/svg+xml" href="/logo.svg" />
    <link rel="apple-touch-icon" href="/pwa-192x192.png" />
    <link rel="canonical" href="${absoluteUrl}" />
    <link rel="alternate" hreflang="zh-Hant" href="${zhUrl}" />
    <link rel="alternate" hreflang="en" href="${enUrl}" />
    <link rel="alternate" hreflang="x-default" href="${zhUrl}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${absoluteUrl}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:image" content="${SITE}/pwa-512x512.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(description)}" />
    <meta name="twitter:image" content="${SITE}/pwa-512x512.png" />
    ${ldScripts}
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans TC", sans-serif; margin: 0; background: linear-gradient(180deg, #fff 0%, #f1f5f9 100%); color: #0f172a; }
      main { max-width: 720px; margin: 0 auto; padding: 48px 24px 80px; }
      h1 { font-size: 32px; font-weight: 800; letter-spacing: -0.02em; margin: 0 0 12px; }
      h2 { font-size: 20px; margin: 40px 0 12px; }
      p  { line-height: 1.7; color: #475569; font-size: 15px; }
      .cta { display: inline-block; margin-top: 24px; padding: 14px 28px; background: ${accent}; color: #fff; border-radius: 999px; text-decoration: none; font-weight: 700; box-shadow: 0 12px 28px -12px ${shadow}; }
      .meta { display: inline-block; padding: 6px 14px; border-radius: 999px; background: ${accentSoft}; color: ${accentText}; font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 20px; }
      nav a { color: #64748b; font-size: 13px; text-decoration: none; }
      nav a:hover { color: #0f172a; }
      table.stats { width: 100%; border-collapse: collapse; font-size: 14px; margin: 8px 0 4px; }
      table.stats th, table.stats td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
      table.stats th { color: #334155; font-weight: 700; white-space: nowrap; width: 45%; }
      table.stats td { color: #0f172a; font-weight: 600; }
      .src { color: #94a3b8; font-size: 12px; }
      .faq details { border-bottom: 1px solid #e2e8f0; padding: 10px 0; }
      .faq summary { cursor: pointer; font-weight: 700; color: #0f172a; font-size: 15px; }
      .faq p { margin: 8px 0 0; }
      .related a { color: ${accentText}; text-decoration: none; font-weight: 600; }
      .related a:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <main>
      <nav><a href="${SITE}${isEnglish ? '/en/' : '/'}">← ${isEnglish ? 'Back to home' : '回首頁 Home'}</a></nav>
      <div class="meta">${isEnglish ? 'Metro' : '捷運'} · ${sys.en}</div>
      <h1>${isEnglish ? `${sys.en} route map & timetable` : `${sys.zh}・路線圖與班次查詢`}</h1>
      <p>${esc(description)}</p>
      <a class="cta" href="${appDeepLink}">${isEnglish ? `Check live ${sys.en} trains` : `查詢 ${sys.zh} 即時班次`} →</a>

      <h2>${isEnglish ? `${sys.en} facts` : `${sys.zh}・路線資訊一覽`}</h2>
      <table class="stats">
        <tbody>
          ${lineRows}
          ${fareRow}
          ${hoursRow}
          ${interchangeRow}
        </tbody>
      </table>
      <p class="src">${isEnglish
        ? `Statistics calculated from the <a href="${TDX_SOURCE}" rel="external noopener noreferrer">Taiwan MOTC TDX</a> public data (${SITEMAP_LASTMOD} edition). Check the live app for current schedules, fares and delays.`
        : `資料統計自交通部 <a href="${TDX_SOURCE}" rel="external noopener noreferrer">TDX 運輸資料流通服務平臺</a>公開資料（${SITEMAP_LASTMOD} 版）；實際班次、票價請以即時查詢為準。`}</p>
${faqBlock}
      <h2>${isEnglish ? 'Other metro systems' : '其他捷運系統 Other systems'}</h2>
      <ul class="related">
        ${related}
      </ul>

      <p style="margin-top:40px;color:#94a3b8;font-size:12px;">${isEnglish ? 'Data source: ' : '資料來源：交通部 '}<a href="${TDX_SOURCE}" rel="external noopener noreferrer">${isEnglish ? 'Taiwan MOTC TDX' : 'TDX 運輸資料流通服務平臺'}</a></p>
    </main>
  </body>
</html>
`;
  return { pathname, html, url: absoluteUrl };
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/generate-route-pages.mjs
git commit -m "$(cat <<'EOF'
feat(seo): add pageForMetro() HTML/JSON-LD builder

Mirrors pageFor()'s structure (WebPage + BreadcrumbList + FAQPage,
answer-first stats table, related-links) for the 7 metro systems.
EOF
)"
```

---

### Task 3: Wire metro generation into `main()` + sitemap

**Files:**
- Modify: `scripts/generate-route-pages.mjs` (inside `async function main()`, currently lines
  447-508)

- [ ] **Step 1: Add the metro generation loop, per-system fault-isolated**

In `main()`, after the existing `for (const r of ROUTES) { ... }` loop and before the `const
sitemap = ...` template literal, add:

```js
  // --- Metro system pages ---------------------------------------------
  // Each of the 7 systems has an independently-fetched static snapshot, so a
  // gap in one (missing stations/lines data) must not take down the other 6
  // pages or abort the sitemap write — skip and warn instead of throwing.
  const metroCodes = METRO_SYSTEMS.map((s) => s.code);
  const metroGenerated = [];
  for (const code of metroCodes) {
    try {
      const localizedPages = [
        pageForMetro(code, metroCodes, 'zh'),
        pageForMetro(code, metroCodes, 'en'),
      ];
      for (const { pathname, html, url } of localizedPages) {
        const filePath = join(OUT_ROOT, pathname.replace(/^\//, ''), 'index.html');
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, html, 'utf8');
        console.log(`  ✓ ${pathname}`);
        metroGenerated.push({ url, basePathname: pathname.replace(/^\/en/, '') });
      }
    } catch (e) {
      console.warn(`  ! skipped metro/${code}: ${e.message}`);
    }
  }
```

- [ ] **Step 2: Fold `metroGenerated` into the sitemap**

Change the sitemap template literal's body from:
```js
${generated.map((g) => {
    const zhUrl = `${SITE}${g.basePathname}`;
    const enUrl = `${SITE}/en${g.basePathname}`;
    return `  <url>
    <loc>${g.url}</loc>
    <xhtml:link rel="alternate" hreflang="zh-Hant" href="${zhUrl}" />
    <xhtml:link rel="alternate" hreflang="en" href="${enUrl}" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${zhUrl}" />
    <lastmod>${SITEMAP_LASTMOD}</lastmod>
  </url>`;
  }).join('\n')}
</urlset>
`;
```
to:
```js
${[...generated, ...metroGenerated].map((g) => {
    const zhUrl = `${SITE}${g.basePathname}`;
    const enUrl = `${SITE}/en${g.basePathname}`;
    return `  <url>
    <loc>${g.url}</loc>
    <xhtml:link rel="alternate" hreflang="zh-Hant" href="${zhUrl}" />
    <xhtml:link rel="alternate" hreflang="en" href="${enUrl}" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${zhUrl}" />
    <lastmod>${SITEMAP_LASTMOD}</lastmod>
  </url>`;
  }).join('\n')}
</urlset>
`;
```

- [ ] **Step 3: Update the final log line**

Change:
```js
  console.log(`  ✓ sitemap.xml (${generated.length} route pages + 2 base URLs)`);
```
to:
```js
  console.log(`  ✓ sitemap.xml (${generated.length} route pages + ${metroGenerated.length} metro pages + 2 base URLs)`);
```

- [ ] **Step 4: Run the generator and inspect output**

Run:
```bash
npm run generate-routes
```
Expected: existing TRA/HSR `✓` lines unchanged, plus 14 new lines like
`✓ /routes/metro/taipei-metro/` and `✓ /en/routes/metro/taipei-metro/` (one pair per system, 7
systems × 2 locales = 14), and the final line reading
`✓ sitemap.xml (17 route pages + 14 metro pages + 2 base URLs)`. If any system logs
`! skipped metro/<CODE>: ...`, open `public/data/metro_<CODE>/` and confirm which required file
(`stations.json` or `s2s.json`) is actually missing — that system's data snapshot needs
re-fetching (`npm run fetch-metro-data`), not a code fix.

- [ ] **Step 5: Spot-check one generated page**

Run:
```bash
node -e "console.log(require('fs').readFileSync('public/routes/metro/taipei-metro/index.html','utf8').slice(0, 3000))"
```
Confirm: `<title>` contains "台北捷運", the stats table has multiple `<tr>` rows with real
station counts and minute figures (not `undefined`/`NaN`), and at least one `<script
type="application/ld+json">` block is valid JSON (eyeball it).

- [ ] **Step 6: Run existing SEO/lint checks**

Run:
```bash
npm run seo:verify
npm run lint
```
Expected: both exit 0. `seo:verify` validates the sitemap structurally (XML parses, URLs
resolve, hreflang reciprocal) — it doesn't know about metro pages specifically but will catch a
malformed sitemap or broken URL.

- [ ] **Step 7: Commit**

```bash
git add scripts/generate-route-pages.mjs public/routes/metro/ public/sitemap.xml
git commit -m "$(cat <<'EOF'
feat(seo): generate 7 metro system landing pages, add to sitemap

Wires pageForMetro() into the build's route-page generation step.
Each system's page generation is fault-isolated so a missing snapshot
file for one operator can't take down the other 6 or the sitemap write.
EOF
)"
```

---

### Task 4: `?system=<CODE>` deep-link support in the app

**Files:**
- Modify: `src/App.tsx` (near line 232, and the `<MetroSearch>` render around line 2437)
- Modify: `src/components/MetroSearch.tsx` (Props interface at line 14-20, component signature
  at line 83, `system` state at line 108)

- [ ] **Step 1: Add `initialSystem` to `MetroSearchProps`**

In `src/components/MetroSearch.tsx`, change:
```ts
interface MetroSearchProps {
  language: string;
  geoCoords?: { lat: number; lon: number } | null;
  onResultsActiveChange?: (active: boolean) => void;
  /** Fired when a search is initiated (used to collapse the search card). */
  onSearch?: () => void;
}
```
to:
```ts
interface MetroSearchProps {
  language: string;
  geoCoords?: { lat: number; lon: number } | null;
  onResultsActiveChange?: (active: boolean) => void;
  /** Fired when a search is initiated (used to collapse the search card). */
  onSearch?: () => void;
  /** Preselect this operator (e.g. from `?system=KRTC`); falls back to the default if invalid. */
  initialSystem?: string | null;
}
```

- [ ] **Step 2: Consume it in the component signature and initial `system` state**

Change:
```ts
export default function MetroSearch({ language, geoCoords, onResultsActiveChange, onSearch }: MetroSearchProps) {
```
to:
```ts
export default function MetroSearch({ language, geoCoords, onResultsActiveChange, onSearch, initialSystem }: MetroSearchProps) {
```

Change:
```ts
  const [system, setSystem] = useState(METRO_SYSTEMS[0].code);
```
to:
```ts
  const [system, setSystem] = useState(() =>
    initialSystem && METRO_SYSTEMS.some((s) => s.code === initialSystem) ? initialSystem : METRO_SYSTEMS[0].code
  );
```

- [ ] **Step 3: Parse `?system=` in `App.tsx` and pass it down**

In `src/App.tsx`, add a new state near the `mainTab` declaration (around line 232):
```ts
  const [mainTab, setMainTab] = useState<'train' | 'hsr' | 'metro' | 'plan'>(transportType);
  // Preselects a metro operator when arriving via a metro SEO landing page's
  // CTA (`?transport=metro&system=KRTC`); read once on mount like transportType.
  const [initialMetroSystem] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('system');
  });
```

Then update the `<MetroSearch>` render (around line 2437) from:
```tsx
              <MetroSearch language={i18n.language} geoCoords={geoCoords} onResultsActiveChange={setMetroResultsActive} onSearch={() => setIsSearchCollapsed(true)} />
```
to:
```tsx
              <MetroSearch language={i18n.language} geoCoords={geoCoords} onResultsActiveChange={setMetroResultsActive} onSearch={() => setIsSearchCollapsed(true)} initialSystem={initialMetroSystem} />
```

- [ ] **Step 4: Type-check**

Run:
```bash
npm run lint
```
Expected: exit 0, no new TS errors.

- [ ] **Step 5: Manual browser verification**

Run:
```bash
npm run dev
```
Then open (adjust port to whatever `npm run dev` prints):
- `http://localhost:3000/?transport=metro&system=KRTC` → metro tab opens with **高雄捷運**
  preselected in the system dropdown.
- `http://localhost:3000/?transport=metro&system=NOPE` (invalid code) → falls back to the
  default system (`METRO_SYSTEMS[0]`, 台北捷運) without erroring.
- `http://localhost:3000/?transport=metro` (no `system` param) → unchanged behavior, defaults
  as before.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/MetroSearch.tsx
git commit -m "$(cat <<'EOF'
feat(metro): support ?system= deep link into MetroSearch

Lets the new metro SEO landing pages' CTA land on the right operator
instead of always defaulting to the first system in the list.
EOF
)"
```

---

### Task 3.5 (discovered during Task 3, not in the original spec): teach `verify-seo.mjs` about metro pages

`npm run seo:verify` (`scripts/verify-seo.mjs`) predates this feature and applies TRA/HSR-only
assertions to every page under `public/routes/**` indiscriminately — it requires a
`TravelAction` JSON-LD `mainEntity` (metro system pages correctly have none, by design — no
single origin/destination) and requires every route path to appear as a literal substring in
`src/App.tsx` (metro pages deep-link via `?transport=metro&system=<CODE>`, not a literal path
row). Both are real, deliberate differences from Task 2's design, not bugs — but they mean
`seo:verify` now fails for every metro page, and per STRUCTURE.md's own maintenance checklist
this script is meant to gate new route pages. Not part of the original 4-task plan, but a
same-day follow-up:

**Files:** Modify `scripts/verify-seo.mjs` (no changes to `scripts/generate-route-pages.mjs`,
`pageForMetro`, or `metroSystemStats` — those are correct as-is).

- Split the combined `routePages` walk into `routePages` (TRA/HSR, everything existing/unchanged)
  and `metroPages` (anything under `/routes/metro/`), by filtering on `routePathForFile(p)`.
- Run the existing assertion loop (byte-for-byte unchanged, including `TravelAction` and the
  App.tsx literal-path check) only over `routePages` — zero behavior change for TRA/HSR.
- Add a new, separate assertion loop over `metroPages` checking the subset that actually applies:
  document lang, title, meta description, canonical, robots indexable, no noindex, H1,
  `WebPage`/`BreadcrumbList`/`FAQPage` JSON-LD (no `TravelAction`), `dateModified`, TDX citation
  (JSON-LD + visible link), reciprocal hreflang, and a `?transport=metro&system=` deep link
  present in the HTML. For English metro pages, check for the (shared, not TRA/HSR-specific)
  `<h2>Frequently asked questions</h2>` heading instead of TRA/HSR's `<h2>Route overview</h2>`.
- Update the final `console.log` summary to also report the metro page count.

**Verification:** `npm run seo:verify` must exit 0 with both TRA/HSR and metro pages present.

---

## Self-review notes

- **Spec coverage:** all 8 content sections from the design spec (hero, line table, fare,
  hours, transfers, FAQ, related links, CTA) are implemented in `pageForMetro()`; the
  per-system resilience requirement is implemented via the try/catch in Task 3 Step 1; the
  `?system=` CTA follow-through is Task 4; build integration (extend existing script, not a new
  one) is Tasks 1-3.
- **Placeholder scan:** no TBD/TODO; every step has real code, not descriptions of code.
- **Type consistency:** `metroSystemStats()` (Task 1) return shape (`stationCount`, `lines`,
  `fareRange`, `hours`, `interchangeCount`, `interchangeNames`, `interchangeNamesEn`) matches
  exactly what `pageForMetro()` (Task 2) destructures via `stats.*`. `METRO_SYSTEMS` entries
  (`code`/`zh`/`en`/`slug`) match what both `pageForMetro()` and the `main()` loop (Task 3)
  reference.
- **Out of scope (unchanged from spec):** journey-planner landing page is a separate plan.
- **Post-review correction (2026-07-04):** Task 1's spec-compliance review caught that
  `s2s.json`'s shape isn't consistently a sequential chain across systems (TYMC/KLRT store a full
  OD matrix instead) — the `byLine` grouping logic above was corrected to detect and handle both
  shapes before Task 2 could render the wrong numbers onto a public page. See the inline comment
  in the `metroSystemStats()` code block for the mechanism.
