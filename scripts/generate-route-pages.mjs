/**
 * Generates static SEO landing pages for popular TRA / THSR routes.
 * Each page is a self-contained HTML doc with its own <title>, meta, H1,
 * description, JSON-LD TravelAction and a deep link into the SPA.
 *
 * Output: public/routes/<transport>/<origin-slug>-to-<dest-slug>/index.html
 * Sitemap: overwrites public/sitemap.xml including all generated URLs.
 *
 * Run: node scripts/generate-route-pages.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const SITE = 'https://taiwanrail.vercel.app';
const OUT_ROOT = resolve(process.cwd(), 'public');

const S = {
  taipei:    { id: '1000', zh: '臺北', en: 'Taipei' },
  banqiao:   { id: '1020', zh: '板橋', en: 'Banqiao' },
  hsinchu:   { id: '1130', zh: '新竹', en: 'Hsinchu' },
  taichung:  { id: '3300', zh: '臺中', en: 'Taichung' },
  tainan:    { id: '5000', zh: '臺南', en: 'Tainan' },
  kaohsiung: { id: '6000', zh: '高雄', en: 'Kaohsiung' },
  hualien:   { id: '7080', zh: '花蓮', en: 'Hualien' },
  taitung:   { id: '7000', zh: '臺東', en: 'Taitung' },
  yilan:     { id: '7361', zh: '宜蘭', en: 'Yilan' },
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

const slug = (en) => en.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function pageFor(r) {
  const isHsr = r.transport === 'hsr';
  const transportLabel = isHsr ? '高鐵' : '台鐵';
  const transportLabelEn = isHsr ? 'THSR' : 'TRA';
  const title = `${r.from.zh} 到 ${r.to.zh} ${transportLabel}時刻表 | ${r.from.en} to ${r.to.en} ${transportLabelEn} Timetable`;
  const description = `${r.from.zh}站到${r.to.zh}站的${transportLabel}班次、票價、停靠站與誤點即時查詢。Real-time ${transportLabelEn} timetable, fares and delays from ${r.from.en} to ${r.to.en}.`;
  const slugPath = `${slug(r.from.en)}-to-${slug(r.to.en)}`;
  const pathname = `/routes/${r.transport}/${slugPath}/`;
  const absoluteUrl = SITE + pathname;
  const appDeepLink = `${SITE}/?transport=${r.transport}&fromId=${r.from.id}&toId=${r.to.id}`;

  const jsonLdTravel = {
    '@context': 'https://schema.org',
    '@type': 'TravelAction',
    agent: { '@type': 'Organization', name: transportLabelEn },
    fromLocation: { '@type': 'TrainStation', name: r.from.zh, identifier: r.from.id },
    toLocation:   { '@type': 'TrainStation', name: r.to.zh,   identifier: r.to.id },
    description,
    url: absoluteUrl,
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

  const accent = isHsr ? '#ea580c' : '#2563eb';
  const accentSoft = isHsr ? '#fff7ed' : '#eff6ff';
  const accentText = isHsr ? '#9a3412' : '#1e40af';
  const shadow = isHsr ? 'rgba(234,88,12,.5)' : 'rgba(37,99,235,.5)';

  const html = `<!doctype html>
<html lang="zh-Hant-TW">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="${accent}" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <link rel="canonical" href="${absoluteUrl}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${absoluteUrl}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:image" content="${SITE}/pwa-512x512.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${SITE}/pwa-512x512.png" />
    <script type="application/ld+json">${JSON.stringify(jsonLdTravel)}</script>
    <script type="application/ld+json">${JSON.stringify(breadcrumb)}</script>
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
    </style>
  </head>
  <body>
    <main>
      <nav><a href="${SITE}/">← 回首頁 Home</a></nav>
      <div class="meta">${transportLabel} · ${transportLabelEn}</div>
      <h1>${r.from.zh} 到 ${r.to.zh}・${transportLabel}時刻表</h1>
      <p>${description}</p>
      <a class="cta" href="${appDeepLink}">查詢 ${r.from.zh} → ${r.to.zh} 即時班次 →</a>

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

      <p style="margin-top:40px;color:#94a3b8;font-size:12px;">資料來源：交通部 TDX 運輸資料流通服務平臺</p>
    </main>
    <script>setTimeout(function () { location.replace(${JSON.stringify(appDeepLink)}); }, 1200);</script>
  </body>
</html>
`;
  return { pathname, html, url: absoluteUrl };
}

async function main() {
  const generated = [];
  for (const r of ROUTES) {
    const { pathname, html, url } = pageFor(r);
    const filePath = join(OUT_ROOT, pathname.replace(/^\//, ''), 'index.html');
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, html, 'utf8');
    console.log(`  ✓ ${pathname}`);
    generated.push({ url });
  }

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>
  <url><loc>${SITE}/?transport=train</loc><changefreq>daily</changefreq><priority>0.9</priority></url>
  <url><loc>${SITE}/?transport=hsr</loc><changefreq>daily</changefreq><priority>0.9</priority></url>
${generated.map(g => `  <url><loc>${g.url}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`).join('\n')}
</urlset>
`;
  await writeFile(join(OUT_ROOT, 'sitemap.xml'), sitemap, 'utf8');
  console.log(`  ✓ sitemap.xml (${generated.length} route pages + 3 base URLs)`);
}

main().catch(err => { console.error(err); process.exit(1); });
