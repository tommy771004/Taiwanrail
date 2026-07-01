/**
 * Generates static SEO landing pages for popular TRA / THSR routes.
 * Each page is a self-contained HTML doc with its own <title>, meta, H1 and
 * — crucially — REAL data pulled from the committed TDX datasets (fastest
 * journey time, daily direct frequency, first/last departure, intermediate
 * stops, and THSR fares). This turns thin templated pages into genuinely
 * useful content so Google indexes them instead of flagging them as
 * "Discovered – currently not indexed" / scaled content.
 *
 * Output: public/routes/<transport>/<origin-slug>-to-<dest-slug>/index.html
 * Sitemap: overwrites public/sitemap.xml including all generated URLs.
 *
 * Run: node scripts/generate-route-pages.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const SITE = (process.env.APP_URL || process.env.VITE_APP_URL || 'https://taiwanrail.vercel.app').replace(/\/+$/, '');
const OUT_ROOT = resolve(process.cwd(), 'public');
const DATA_ROOT = join(OUT_ROOT, 'data');
const SITEMAP_LASTMOD = process.env.SITEMAP_LASTMOD || new Date().toISOString().slice(0, 10);

// --- Station catalogue -----------------------------------------------------
// IDs are TDX StationID values (verified against public/data/*-stations.json).
// NOTE: TRA and THSR are separate numbering systems — do not mix them.
const S = {
  // TRA (Taiwan Railways)
  taipei:    { id: '1000', zh: '臺北', en: 'Taipei' },
  banqiao:   { id: '1020', zh: '板橋', en: 'Banqiao' },
  hsinchu:   { id: '1210', zh: '新竹', en: 'Hsinchu' },
  taichung:  { id: '3300', zh: '臺中', en: 'Taichung' },
  tainan:    { id: '4220', zh: '臺南', en: 'Tainan' },
  kaohsiung: { id: '4400', zh: '高雄', en: 'Kaohsiung' },
  hualien:   { id: '7000', zh: '花蓮', en: 'Hualien' },
  taitung:   { id: '6000', zh: '臺東', en: 'Taitung' },
  yilan:     { id: '7190', zh: '宜蘭', en: 'Yilan' },
  // THSR (High Speed Rail)
  hsrNangang:  { id: '0990', zh: '南港', en: 'Nangang' },
  hsrTaipei:   { id: '1000', zh: '臺北', en: 'Taipei' },
  hsrBanqiao:  { id: '1010', zh: '板橋', en: 'Banqiao' },
  hsrTaoyuan:  { id: '1020', zh: '桃園', en: 'Taoyuan' },
  hsrHsinchu:  { id: '1030', zh: '新竹', en: 'Hsinchu' },
  hsrTaichung: { id: '1040', zh: '臺中', en: 'Taichung' },
  hsrTainan:   { id: '1060', zh: '臺南', en: 'Tainan' },
  hsrZuoying:  { id: '1070', zh: '左營', en: 'Zuoying' },
};

const ROUTES = [
  { transport: 'train', from: S.taipei,    to: S.kaohsiung },
  { transport: 'train', from: S.taipei,    to: S.hualien },
  { transport: 'train', from: S.taipei,    to: S.taichung },
  { transport: 'train', from: S.taipei,    to: S.hsinchu },
  { transport: 'train', from: S.taipei,    to: S.yilan },
  { transport: 'train', from: S.taipei,    to: S.tainan },
  { transport: 'train', from: S.hualien,   to: S.taitung },
  { transport: 'train', from: S.taichung,  to: S.kaohsiung },
  { transport: 'train', from: S.banqiao,   to: S.kaohsiung },
  { transport: 'hsr',   from: S.hsrNangang,  to: S.hsrZuoying },
  { transport: 'hsr',   from: S.hsrTaipei,   to: S.hsrZuoying },
  { transport: 'hsr',   from: S.hsrTaipei,   to: S.hsrTaichung },
  { transport: 'hsr',   from: S.hsrTaipei,   to: S.hsrTainan },
  { transport: 'hsr',   from: S.hsrTaipei,   to: S.hsrHsinchu },
  { transport: 'hsr',   from: S.hsrTaichung, to: S.hsrZuoying },
  { transport: 'hsr',   from: S.hsrBanqiao,  to: S.hsrTaichung },
  { transport: 'hsr',   from: S.hsrTaoyuan,  to: S.hsrTaichung },
];

// --- Data loading + stats --------------------------------------------------
function loadJson(file) {
  try { return JSON.parse(readFileSync(join(DATA_ROOT, file), 'utf8')); }
  catch (e) { console.warn(`  ! could not read ${file}: ${e.message}`); return null; }
}

const thsrTimetable = loadJson('thsr-timetable.json') || [];
const thsrFares = loadJson('thsr-fares.json') || [];
const traTimetableRaw = loadJson('tra-timetable.json');
const traTimetable = (traTimetableRaw && traTimetableRaw.TrainTimetables) || [];

const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const fmtDur = (m) => {
  if (!Number.isFinite(m)) return null;
  if (m < 60) return `${m} 分鐘`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} 小時 ${r} 分` : `${h} 小時`;
};

/** Scan a timetable for direct services from→to and return aggregate stats. */
function scanTimetable(entries, getStops, getInfo, fromId, toId) {
  let fastest = Infinity, count = 0, firstDep = Infinity, lastDep = -Infinity;
  let fastestStops = null, fastestType = null;
  for (const entry of entries) {
    const stops = getStops(entry);
    if (!stops) continue;
    const ai = stops.findIndex((s) => s.StationID === fromId);
    if (ai < 0) continue;
    const bi = stops.findIndex((s, i) => i > ai && s.StationID === toId);
    if (bi < 0) continue;
    const dep = stops[ai].DepartureTime || stops[ai].ArrivalTime;
    const arr = stops[bi].ArrivalTime || stops[bi].DepartureTime;
    if (!dep || !arr) continue;
    let dur = toMin(arr) - toMin(dep);
    if (dur < 0) dur += 1440;
    count += 1;
    const depM = toMin(dep);
    if (depM < firstDep) firstDep = depM;
    if (depM > lastDep) lastDep = depM;
    if (dur < fastest) {
      fastest = dur;
      fastestStops = stops.slice(ai + 1, bi).map((s) => s.StationName?.Zh_tw).filter(Boolean);
      fastestType = getInfo ? getInfo(entry) : null;
    }
  }
  if (count === 0) return null;
  const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return {
    fastest, count,
    first: fmt(firstDep), last: fmt(lastDep),
    stops: fastestStops || [], fastestType,
  };
}

function thsrFare(fromId, toId) {
  const row = thsrFares.find((f) =>
    (f.OriginStationID === fromId && f.DestinationStationID === toId) ||
    (f.OriginStationID === toId && f.DestinationStationID === fromId));
  if (!row) return null;
  const pick = (cabin) => row.Fares.find((x) => x.FareClass === 1 && x.CabinClass === cabin)?.Price ?? null;
  // CabinClass 1=標準座 Standard, 2=商務座 Business, 3=自由座 Non-reserved (verified vs known fares)
  return { standard: pick(1), business: pick(2), nonReserved: pick(3) };
}

function statsFor(r) {
  if (r.transport === 'hsr') {
    const s = scanTimetable(
      thsrTimetable,
      (e) => e.GeneralTimetable?.StopTimes,
      null,
      r.from.id, r.to.id,
    );
    return s ? { ...s, fare: thsrFare(r.from.id, r.to.id) } : null;
  }
  // NOTE: TRA fares are intentionally NOT published. The public/data/tra-fares
  // dataset has unreliable distances/prices (e.g. Taipei→Taichung listed at
  // 711 km) so publishing them risks wrong, harmful content. TRA pages rely on
  // journey time / frequency / train type / stops instead. THSR fares are clean.
  return scanTimetable(
    traTimetable,
    (e) => e.StopTimes,
    (e) => e.TrainInfo?.TrainTypeName?.Zh_tw,
    r.from.id, r.to.id,
  );
}

const slug = (en) => en.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function pageFor(r, allRoutes) {
  const isHsr = r.transport === 'hsr';
  const transportLabel = isHsr ? '高鐵' : '台鐵';
  const transportLabelEn = isHsr ? 'THSR' : 'TRA';
  const title = `${r.from.zh} 到 ${r.to.zh} ${transportLabel}時刻表 | ${r.from.en} to ${r.to.en} ${transportLabelEn} Timetable`;
  const slugPath = `${slug(r.from.en)}-to-${slug(r.to.en)}`;
  const pathname = `/routes/${r.transport}/${slugPath}/`;
  const absoluteUrl = SITE + pathname;
  const appDeepLink = `${SITE}/?transport=${r.transport}&fromId=${r.from.id}&toId=${r.to.id}`;

  const st = statsFor(r);
  const dur = st ? fmtDur(st.fastest) : null;

  // Data-rich meta description (answer-first, statistics) — falls back gracefully.
  const stat = st
    ? `最快約 ${dur}、每日約 ${st.count} 班直達、首班 ${st.first} 末班 ${st.last}。`
    : '';
  const description = `${r.from.zh}站到${r.to.zh}站的${transportLabel}班次、票價、停靠站與誤點即時查詢。${stat}Real-time ${transportLabelEn} timetable, fares and delays from ${r.from.en} to ${r.to.en}.`;

  const jsonLdTravel = {
    '@context': 'https://schema.org',
    '@type': 'TravelAction',
    agent: { '@type': 'Organization', name: transportLabelEn },
    fromLocation: { '@type': 'TrainStation', name: r.from.zh, identifier: r.from.id },
    toLocation:   { '@type': 'TrainStation', name: r.to.zh,   identifier: r.to.id },
    description,
    url: absoluteUrl,
  };
  const jsonLdWebPage = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${absoluteUrl}#webpage`,
    url: absoluteUrl,
    name: title,
    description,
    inLanguage: ['zh-Hant-TW', 'en'],
    dateModified: SITEMAP_LASTMOD,
    mainEntity: jsonLdTravel,
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '首頁', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: transportLabel, item: `${SITE}/?transport=${r.transport}` },
      { '@type': 'ListItem', position: 3, name: `${r.from.zh} → ${r.to.zh}`, item: absoluteUrl },
    ],
  };

  // --- Build FAQ (visible + JSON-LD) from real numbers ---
  const faqs = [];
  if (st) {
    faqs.push({
      q: `${r.from.zh}到${r.to.zh}的${transportLabel}車程要多久？`,
      a: `最快約 ${dur}${st.fastestType ? `（${st.fastestType}）` : ''}。實際時間依車種與停靠站數而異，請以即時查詢結果為準。`,
    });
    faqs.push({
      q: `${r.from.zh}到${r.to.zh}一天有幾班${transportLabel}？`,
      a: `每日約有 ${st.count} 班直達車，首班約 ${st.first} 發車、末班約 ${st.last} 發車。`,
    });
    if (isHsr && st.fare && st.fare.standard) {
      const f = st.fare;
      faqs.push({
        q: `${r.from.zh}到${r.to.zh}的高鐵票價多少？`,
        a: `標準車廂全票 NT$${f.standard}${f.nonReserved ? `、自由座 NT$${f.nonReserved}` : ''}${f.business ? `、商務車廂 NT$${f.business}` : ''}（成人單程，資料來源 TDX 高鐵 ODFare）。`,
      });
    }
    if (st.stops && st.stops.length) {
      faqs.push({
        q: `${r.from.zh}到${r.to.zh}的直達車中途停靠哪些站？`,
        a: `最快班次中途停靠 ${st.stops.join('、')}。`,
      });
    } else {
      faqs.push({
        q: `${r.from.zh}到${r.to.zh}有直達不停靠的班次嗎？`,
        a: '有。最快班次為直達車，中途不停靠其他車站。',
      });
    }
  }
  // Generic FAQs — always present so every route page ships valid FAQPage data.
  faqs.push({
    q: `查詢 ${r.from.zh} 到 ${r.to.zh} 的${transportLabel}時刻表要付費嗎？`,
    a: '完全免費。資料來源為交通部 TDX 運輸資料流通服務平臺公開 API，搜尋與瀏覽都不需要註冊。',
  });
  faqs.push({
    q: `${r.from.zh}到${r.to.zh}的誤點與停駛資訊是即時的嗎？`,
    a: '是。點擊「查詢即時班次」後，系統會即時讀取 TDX LiveBoard 誤點分鐘數與 Alert 停駛公告，並在班次卡片上以徽章標示。',
  });
  const faqJsonLd = faqs.length ? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  } : null;

  // --- Related routes (internal linking) ---
  const related = allRoutes
    .filter((x) => !(x.from.id === r.from.id && x.to.id === r.to.id && x.transport === r.transport))
    .sort((a, b) => (b.transport === r.transport ? 1 : 0) - (a.transport === r.transport ? 1 : 0))
    .slice(0, 6)
    .map((x) => {
      const tl = x.transport === 'hsr' ? '高鐵' : '台鐵';
      return `<li><a href="${SITE}/routes/${x.transport}/${slug(x.from.en)}-to-${slug(x.to.en)}/">${x.from.zh} → ${x.to.zh} ${tl}時刻表</a></li>`;
    }).join('\n        ');

  // --- HTML fragments ---
  const accent = isHsr ? '#ea580c' : '#2563eb';
  const accentSoft = isHsr ? '#fff7ed' : '#eff6ff';
  const accentText = isHsr ? '#9a3412' : '#1e40af';
  const shadow = isHsr ? 'rgba(234,88,12,.5)' : 'rgba(37,99,235,.5)';

  const statsTableRows = st ? [
    `<tr><th>最快車程 Fastest</th><td>${dur}${st.fastestType ? `（${esc(st.fastestType)}）` : ''}</td></tr>`,
    `<tr><th>每日直達班次 Direct trains/day</th><td>約 ${st.count} 班</td></tr>`,
    `<tr><th>首班 / 末班 First / Last</th><td>${st.first} / ${st.last}</td></tr>`,
    (isHsr && st.fare && st.fare.standard)
      ? `<tr><th>標準車廂全票 Standard fare</th><td>NT$${st.fare.standard}${st.fare.nonReserved ? `　自由座 NT$${st.fare.nonReserved}` : ''}${st.fare.business ? `　商務 NT$${st.fare.business}` : ''}</td></tr>`
      : '',
  ].filter(Boolean).join('\n          ') : '';

  const statsBlock = st ? `
      <h2>${r.from.zh} → ${r.to.zh}・班次資訊一覽</h2>
      <table class="stats">
        <tbody>
          ${statsTableRows}
        </tbody>
      </table>
      <p class="src">資料統計自交通部 TDX 公開時刻表（${SITEMAP_LASTMOD} 版）；實際班次、票價與誤點請以即時查詢為準。</p>
      ${st.stops && st.stops.length ? `<p>最快班次中途停靠：${st.stops.map(esc).join('、')}。</p>` : '<p>最快班次為直達車，中途不停靠其他車站。</p>'}` : '';

  const faqBlock = faqs.length ? `
      <h2>常見問題 FAQ</h2>
      <div class="faq">
        ${faqs.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n        ')}
      </div>` : '';

  const ldScripts = [jsonLdWebPage, breadcrumb, faqJsonLd]
    .filter(Boolean)
    .map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`)
    .join('\n    ');

  const html = `<!doctype html>
<html lang="zh-Hant-TW">
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
      ul { padding-left: 20px; color: #475569; font-size: 14px; line-height: 1.9; }
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
      <nav><a href="${SITE}/">← 回首頁 Home</a></nav>
      <div class="meta">${transportLabel} · ${transportLabelEn}</div>
      <h1>${r.from.zh} 到 ${r.to.zh}・${transportLabel}時刻表</h1>
      <p>${esc(description)}</p>
      <a class="cta" href="${appDeepLink}">查詢 ${r.from.zh} → ${r.to.zh} 即時班次 →</a>
${statsBlock}
      <h2>關於這段路線</h2>
      <p>本頁提供 ${r.from.zh}（${r.from.en}）出發前往 ${r.to.zh}（${r.to.en}）的 ${transportLabel} 班次資訊入口。點擊上方按鈕即會開啟鐵道查詢 App 並自動填入起訖站，顯示今日、明日、後日所有班次、票價、停靠站以及即時誤點狀態。</p>

      <h2>你可以做什麼</h2>
      <ul>
        <li>即時查詢 ${r.from.zh} ↔ ${r.to.zh} 全日班次與票價</li>
        <li>檢視列車停靠站與各站到離時間</li>
        <li>查看當日誤點分鐘數（綠色準點 / 紅色誤點）</li>
        <li>展開停靠站查看 捷運 / 機捷 / 高捷 / 輕軌 / BRT 轉乘提示</li>
        <li>將常用班次加入最愛、開啟提醒</li>
      </ul>
${faqBlock}
      <h2>其他熱門路線 Other routes</h2>
      <ul class="related">
        ${related}
      </ul>

      <p style="margin-top:40px;color:#94a3b8;font-size:12px;">資料來源：交通部 TDX 運輸資料流通服務平臺</p>
    </main>
  </body>
</html>
`;
  return { pathname, html, url: absoluteUrl };
}

async function main() {
  // Route pages promise real timetable-derived facts. If a required committed
  // dataset is truncated or unreadable, fail before touching existing pages or
  // the sitemap instead of silently replacing useful content with thin output.
  if (!traTimetableRaw || !thsrTimetable.length) {
    throw new Error('Required timetable data is missing or invalid; generation aborted before writing output.');
  }

  const generated = [];
  for (const r of ROUTES) {
    const { pathname, html, url } = pageFor(r, ROUTES);
    const filePath = join(OUT_ROOT, pathname.replace(/^\//, ''), 'index.html');
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, html, 'utf8');
    console.log(`  ✓ ${pathname}`);
    generated.push({ url });
  }

  // Sitemap: ONLY canonical, indexable URLs. The homepage tab-switch variants
  // (?transport=hsr / ?transport=train) are intentionally excluded — they are
  // client-side duplicates of "/" (canonical -> "/") and only generated GSC
  // "Discovered – currently not indexed" noise when listed here.
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>${SITE}/</loc>
    <xhtml:link rel="alternate" hreflang="zh-Hant" href="${SITE}/" />
    <xhtml:link rel="alternate" hreflang="en" href="${SITE}/en/" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/" />
    <lastmod>${SITEMAP_LASTMOD}</lastmod>
  </url>
  <url>
    <loc>${SITE}/en/</loc>
    <xhtml:link rel="alternate" hreflang="zh-Hant" href="${SITE}/" />
    <xhtml:link rel="alternate" hreflang="en" href="${SITE}/en/" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/" />
    <lastmod>${SITEMAP_LASTMOD}</lastmod>
  </url>
${generated.map(g => `  <url><loc>${g.url}</loc><lastmod>${SITEMAP_LASTMOD}</lastmod></url>`).join('\n')}
</urlset>
`;
  await writeFile(join(OUT_ROOT, 'sitemap.xml'), sitemap, 'utf8');
  console.log(`  ✓ sitemap.xml (${generated.length} route pages + 2 base URLs)`);
}

main().catch(err => { console.error(err); process.exit(1); });
