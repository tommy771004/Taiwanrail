// Build the hand-maintained 台北捷運 boarding-platform table that the arrivals board falls back on.
//
//   node scripts/build-trtc-platforms.mjs     (npm run build-trtc-platforms)
//
// TDX `StationPlatform` has no TRTC data (the scheduled fetch only ever wrote
// metro_KLRT/platforms.json), so 「N 號月台」 never showed for 北捷. The platform numbers
// come from each station's zh.wikipedia article: its 車站樓層 table lists every
// platform as 「'''一月台'''」 followed by the next station with its code, e.g.
// 中山 「一月台 … （R12 [[雙連站]]）」. The next station's code is what pins the
// direction — the terminus name is rendered by a template and is not in the wikitext.
//
// Article titles come from the 台北捷運車站列表 article's rendered links, matched by station
// name (they are disambiguated irregularly — 「板橋車站 (臺灣)」, 「西門站 (臺北市)」 — so they
// cannot be guessed), and the articles are then fetched 50 per request. The output is written to
// public/data/metro_TRTC/platforms-manual.json — a different name from the TDX
// snapshot (platforms.json) so fetch-tdx-metro.ts never overwrites it, and a real
// TDX snapshot wins if one ever appears. Review the coverage report before committing;
// a station the parse misses just shows no platform, as before.
import fs from 'fs';
import path from 'path';

const API = 'https://zh.wikipedia.org/w/api.php';
const UA = 'taiwanrail-platform-table/1.0 (https://taiwanrail.vercel.app)';
const OUT = path.join(process.cwd(), 'public', 'data', 'metro_TRTC', 'platforms-manual.json');

const rawStations = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'metro_TRTC', 'stations.json'), 'utf8'));
const stations = Array.isArray(rawStations) ? rawStations : rawStations.Stations ?? [];
const nameOf = new Map(stations.map((s) => [s.StationID, String(s.StationName?.Zh_tw ?? '').replace(/臺/g, '台')]));
// Line code of a TRTC station id: letter prefix (G03A → G, R22A → R).
const lineOf = (id) => id.match(/^[A-Z]+/)?.[0] ?? '';

const NUMERALS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const toNumber = (s) => (/^\d+$/.test(s) ? Number(s) : NUMERALS[s] ?? null);
// 「'''一月台'''」, or unbolded inside a cell/span: 「<span …>一月台</span>」 (三重).
const LABEL = /(?:'''|>|\|)\s*(?:第)?([一二三四五六七八九十]|\d{1,2})(?:號)?月台\s*(?:'''|<)/;
// 「（R12 [[雙連站]]）」 or 「（R03 {{stl|台北捷運|台北101/世貿}}）」 — only the code matters.
const NEXT = /（\s*([A-Z]{1,2}\d{2}A?)(?=[\s{\[站])/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return res.json();
    await sleep(5000 * (attempt + 1)); // 429: Wikipedia asks for serial, paced requests
  }
  throw new Error(`Wikipedia API failed: ${url}`);
}

/** Platform rows of one article: { platform, nextId } — the label line, then its row within 3 lines. */
function parsePlatforms(text) {
  const lines = text.split('\n');
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LABEL);
    if (!m) continue;
    const n = toNumber(m[1]);
    if (n == null) continue;
    for (let j = i; j < Math.min(lines.length, i + 3); j++) {
      if (j > i && LABEL.test(lines[j])) break;
      const next = lines[j].match(NEXT);
      if (next) { rows.push({ platform: String(n), nextId: next[1] }); break; }
    }
  }
  return rows;
}

// 1) Station id → article title, via the list article's links.
const list = await api({ action: 'parse', page: '台北捷運車站列表', prop: 'text', variant: 'zh-tw' });
const decode = (t) => t.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const linked = [...new Set([...list.parse.text.matchAll(/title="([^"]+)"/g)].map((m) => decode(m[1])))];
const titleOf = new Map();
for (const [id, name] of nameOf) {
  const hits = linked.filter((t) => {
    const n = t.replace(/臺/g, '台');
    return [name, name.split('/')[0]].some((base) =>
      n.startsWith(base.endsWith('站') ? base : `${base}站`) || n.startsWith(`${base}車站`));
  });
  // 「臺北車站」 and 「台北車站」 are the same article under two spellings.
  if (new Set(hits.map((t) => t.replace(/臺/g, '台'))).size === 1) titleOf.set(id, hits[0]);
  else console.warn(`⚠️ ${id} ${name}: ${hits.length ? `ambiguous article (${hits.join(', ')})` : 'no article linked'}`);
}

// 2) Fetch every article, 50 titles per request.
const titles = [...new Set(titleOf.values())];
const textOf = new Map();
for (let k = 0; k < titles.length; k += 50) {
  const d = await api({
    action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', redirects: '1',
    titles: titles.slice(k, k + 50).join('|'),
  });
  const resolved = new Map(titles.slice(k, k + 50).map((t) => [t, t]));
  for (const step of [...(d.query.normalized ?? []), ...(d.query.redirects ?? [])]) {
    for (const [from, to] of resolved) if (to === step.from) resolved.set(from, step.to);
  }
  const pages = new Map((d.query.pages ?? []).map((p) => [p.title, p.revisions?.[0]?.slots?.main?.content]));
  for (const [asked, final] of resolved) if (pages.get(final)) textOf.set(asked, pages.get(final));
  await sleep(1000);
}

// 3) Parse. An interchange article covers every line at that station; each row lands on the
// station id of the line its next station is on (中山: R rows → R11, G rows → G14). Rows toward
// stations outside TRTC (環狀線 Y, 萬大線 LG under construction, 淡海輕軌 V) are skipped.
const rows = [];
const idsByTitle = new Map();
for (const [id, t] of titleOf) idsByTitle.set(t, [...(idsByTitle.get(t) ?? []), id]);
for (const [title, ids] of idsByTitle) {
  const text = textOf.get(title);
  if (!text) { console.warn(`⚠️ ${ids.join('/')} ${title}: article not fetched`); continue; }
  for (const r of parsePlatforms(text)) {
    if (!nameOf.has(r.nextId)) continue;
    const own = ids.find((x) => lineOf(x) === lineOf(r.nextId));
    if (!own) { console.warn(`⚠️ ${title}: platform ${r.platform} → ${r.nextId} matches none of ${ids.join('/')}`); continue; }
    rows.push({ StationID: own, PlatformID: r.platform, LineID: lineOf(own), DestinationStationID: r.nextId });
  }
}

// Same platform + next station listed twice (an article repeating its table) → keep one.
const unique = [...new Map(rows.map((r) => [`${r.StationID}|${r.PlatformID}|${r.DestinationStationID}`, r])).values()]
  .sort((a, b) => a.StationID.localeCompare(b.StationID, 'en', { numeric: true }) || Number(a.PlatformID) - Number(b.PlatformID));

fs.writeFileSync(OUT, JSON.stringify({
  Source: 'zh.wikipedia.org station articles (車站樓層 tables), crawled by scripts/build-trtc-platforms.mjs',
  GeneratedAt: new Date().toISOString().slice(0, 10),
  Note: 'DestinationStationID is the adjacent station the platform departs toward, not the terminus.',
  StationPlatforms: unique,
}, null, 1) + '\n');

const covered = new Map();
for (const r of unique) covered.set(r.StationID, (covered.get(r.StationID) ?? 0) + 1);
const missing = [...nameOf.keys()].filter((id) => !covered.has(id));
const single = [...covered].filter(([, n]) => n < 2).map(([id]) => id);
console.log(`✅ ${unique.length} platform rows for ${covered.size}/${nameOf.size} stations → ${path.relative(process.cwd(), OUT)}`);
if (missing.length) console.log(`   no platforms: ${missing.map((id) => `${id} ${nameOf.get(id)}`).join(', ')}`);
if (single.length) console.log(`   only one platform row (expected only at a branch end): ${single.join(', ')}`);
