/**
 * Generates static SEO landing pages for popular TRA / THSR routes.
 * Each page is a self-contained HTML doc with its own <title>, meta, H1 and
 * — crucially — REAL data pulled from the committed TDX datasets (fastest
 * journey time, weekday/weekend direct frequency, first/last departure, intermediate
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
const TDX_SOURCE = 'https://tdx.transportdata.tw/';
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

// --- Section hub pages -----------------------------------------------------
// Four indexable landing pages, one per top-level function. These are the
// canonical targets Google can promote as sitelinks ("快速連結") under the
// homepage result: each has a distinct clean URL, a unique <title>/<h1>
// matching the label we link to it with, and real supporting content. The
// homepage footer links to them with the same anchor text, and index.html
// declares them as SiteNavigationElement — Google decides whether to render
// sitelinks, this just gives it a clean structure to draw them from.
const HUBS = [
  {
    slug: 'tra', appQuery: 'train', role: 'train',
    accent: '#2563eb', accentSoft: '#eff6ff', accentText: '#1e40af', shadow: 'rgba(37,99,235,.5)',
    zh: {
      nav: '台鐵時刻查詢',
      title: '台鐵時刻查詢 | 台鐵列車時刻表、票價、誤點即時查詢 TRA Timetable',
      lead: '免費查詢台鐵（TRA）列車時刻表：輸入起訖站即可看到當日與未來班次、車種、停靠站、票價，以及來自 TDX LiveBoard 的即時誤點分鐘數與停駛公告。',
      bullets: ['自強、莒光、區間車全車種班次與到離時間', '各站停靠順序與轉乘捷運提示', '即時誤點（綠色準點 / 紅色誤點 X 分）與停駛章', '常用班次加入最愛、開啟發車提醒'],
    },
    en: {
      nav: 'TRA Timetable',
      title: 'TRA Timetable Search | Taiwan Railway Trains, Fares & Live Delays',
      lead: 'Free Taiwan Railway (TRA) timetable search: pick an origin and destination to see today and upcoming trains, train types, stops, fares and live delay minutes from TDX LiveBoard.',
      bullets: ['All train types (Tze-Chiang, Chu-Kuang, Local) with arrival/departure times', 'Full stopping pattern and metro transfer hints', 'Live delay minutes and cancellation notices', 'Save favourite trains and set departure reminders'],
    },
  },
  {
    slug: 'thsr', appQuery: 'hsr', role: 'hsr',
    accent: '#ea580c', accentSoft: '#fff7ed', accentText: '#9a3412', shadow: 'rgba(234,88,12,.5)',
    zh: {
      nav: '高鐵時刻查詢',
      title: '高鐵時刻查詢 | 高鐵時刻表、票價、自由座即時查詢 THSR Timetable',
      lead: '免費查詢台灣高鐵（THSR）時刻表：南港到左營全線班次、行車時間、停靠站，以及來自 TDX 的標準座、商務座、自由座官方票價。',
      bullets: ['南港～左營全線直達與各站停班次', '標準車廂、商務車廂、自由座全票價', '各站到離時間與行車時間', '一鍵開啟 T-EX 訂票'],
    },
    en: {
      nav: 'THSR Timetable',
      title: 'THSR Timetable Search | Taiwan High Speed Rail Times & Fares',
      lead: 'Free Taiwan High Speed Rail (THSR) timetable search: every service from Nangang to Zuoying with journey times, stops, and official standard / business / non-reserved fares from TDX.',
      bullets: ['Full Nangang–Zuoying line, direct and all-stop services', 'Standard, business and non-reserved seat fares', 'Per-station arrival and departure times', 'Open T-EX booking in one tap'],
    },
  },
  {
    slug: 'metro', appQuery: 'metro', role: 'metro',
    accent: '#0891b2', accentSoft: '#ecfeff', accentText: '#155e75', shadow: 'rgba(8,145,178,.5)',
    zh: {
      nav: '捷運即時查詢',
      title: '捷運即時查詢 | 台北、桃園、台中、高雄捷運票價與車程 Metro',
      lead: '一次查詢全台 7 個捷運與輕軌系統（台北、新北、桃園、台中、高雄捷運與高雄、淡海輕軌）的站到站票價、行車時間與換乘資訊。',
      bullets: ['台北 / 新北 / 桃園 / 台中 / 高雄捷運 + 高雄 / 淡海輕軌', '站到站票價與預估行車時間', '跨線行程接續站到站行程規劃', '即時到站看板（LiveBoard）'],
    },
    en: {
      nav: 'Metro Live Search',
      title: 'Metro Live Search | Taipei, Taoyuan, Taichung & Kaohsiung MRT',
      lead: 'Search all 7 Taiwan metro and light-rail systems (Taipei, New Taipei, Taoyuan, Taichung, Kaohsiung MRT plus Kaohsiung and Danhai LRT) for station-to-station fares, travel times and transfers.',
      bullets: ['Taipei / New Taipei / Taoyuan / Taichung / Kaohsiung MRT + LRT', 'Station-to-station fares and estimated travel time', 'Cross-line trips hand off to journey planning', 'Live arrival board (LiveBoard)'],
    },
  },
  {
    slug: 'journey', appQuery: 'plan', role: 'journey',
    accent: '#059669', accentSoft: '#ecfdf5', accentText: '#065f46', shadow: 'rgba(5,150,105,.5)',
    zh: {
      nav: '行程路線查詢',
      title: '行程路線查詢 | 門到門轉乘路線規劃、YouBike 接駁 Journey Planner',
      lead: '輸入任意起點與終點（車站或地名），規劃結合台鐵、高鐵、捷運、公車與 YouBike 的門到門轉乘路線，含每段步行、搭乘與轉乘時間。',
      bullets: ['以地名或車站規劃任意兩點行程', '整合鐵路、捷運、公車與 YouBike 接駁', '逐段步行、搭乘、轉乘時間與路線', '最近單車站點建議'],
    },
    en: {
      nav: 'Journey Planner',
      title: 'Journey Planner | Door-to-Door Multimodal Routing & YouBike',
      lead: 'Enter any origin and destination (a station or a place name) to plan a door-to-door route combining TRA, THSR, metro, bus and YouBike, with per-leg walking, riding and transfer times.',
      bullets: ['Plan any two points by place name or station', 'Combines rail, metro, bus and YouBike legs', 'Per-leg walking, riding and transfer times', 'Nearest bike-share station suggestions'],
    },
  },
];

// --- Data loading + stats --------------------------------------------------
function loadJson(file) {
  try { return JSON.parse(readFileSync(join(DATA_ROOT, file), 'utf8')); }
  catch (e) { console.warn(`  ! could not read ${file}: ${e.message}`); return null; }
}

/**
 * Data-as-of date, taken from the dataset itself rather than from the build clock.
 * `SITEMAP_LASTMOD` is a *page* modification date, which is legitimately build time;
 * using it to describe the data would overstate freshness, because the refresh
 * workflow runs every other day while a build can happen at any time.
 */
const isoDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

const thsrTimetable = loadJson('thsr-timetable.json') || [];
const thsrFares = loadJson('thsr-fares.json') || [];
const traTimetableRaw = loadJson('tra-timetable.json');
const traTimetable = (traTimetableRaw && traTimetableRaw.TrainTimetables) || [];

const TRA_DATA_AS_OF = isoDate(traTimetableRaw?.UpdateTime) || SITEMAP_LASTMOD;
const THSR_DATA_AS_OF = isoDate(thsrTimetable[0]?.UpdateTime) || SITEMAP_LASTMOD;

const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const fmtDur = (m) => {
  if (!Number.isFinite(m)) return null;
  if (m < 60) return `${m} 分鐘`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} 小時 ${r} 分` : `${h} 小時`;
};
/** Compact per-row duration, e.g. "2h08" / "47m" — the wordy form is too wide in a table. */
const fmtDurCell = (m, isEnglish) => {
  if (!Number.isFinite(m)) return '—';
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return isEnglish ? `${r}m` : `${r} 分`;
  return isEnglish
    ? `${h}h${String(r).padStart(2, '0')}`
    : `${h} 時 ${String(r).padStart(2, '0')} 分`;
};
const fmtDurEn = (m) => {
  if (!Number.isFinite(m)) return null;
  if (m < 60) return `${m} minutes`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} hr ${r} min` : `${h} hr`;
};

const WEEKDAY_KEYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const WEEKEND_KEYS = ['Saturday', 'Sunday'];

const servesAny = (serviceDay, keys) =>
  !!serviceDay && keys.some((key) => Number(serviceDay[key]) > 0);

const hhmm = (m) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * Scan a timetable for direct services from→to.
 *
 * Returns the matched services themselves, with every aggregate derived from that
 * one list, so a headline figure can never disagree with the services behind it.
 *
 * `ServiceDay` in the weekly general timetable is a per-weekday flag set, so a
 * matching entry is not necessarily a *daily* departure. Counting every match as one
 * overstated frequency by folding weekend-only extras into the weekday figure —
 * hence the separate weekday / weekend counts.
 */
function scanTimetable(entries, getStops, getMeta, getServiceDay, fromId, toId) {
  const services = [];
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
    let durationMin = toMin(arr) - toMin(dep);
    if (durationMin < 0) durationMin += 1440;
    const meta = getMeta ? getMeta(entry) : null;
    const serviceDay = getServiceDay ? getServiceDay(entry) : null;
    services.push({
      trainNo: meta?.trainNo ?? null,
      typeName: meta?.typeName ?? null,
      typeNameEn: meta?.typeNameEn ?? null,
      depMin: toMin(dep),
      dep: hhmm(toMin(dep)),
      arr: hhmm(toMin(arr)),
      durationMin,
      weekday: servesAny(serviceDay, WEEKDAY_KEYS),
      weekend: servesAny(serviceDay, WEEKEND_KEYS),
      stops: stops.slice(ai + 1, bi).map((s) => s.StationName?.Zh_tw).filter(Boolean),
    });
  }
  if (services.length === 0) return null;

  services.sort((a, b) => a.depMin - b.depMin);
  const fastestService = services.reduce(
    (best, s) => (s.durationMin < best.durationMin ? s : best),
    services[0],
  );

  return {
    services,
    fastest: fastestService.durationMin,
    weekdayCount: services.filter((s) => s.weekday).length,
    weekendCount: services.filter((s) => s.weekend).length,
    first: services[0].dep,
    last: services[services.length - 1].dep,
    stops: fastestService.stops,
    fastestType: fastestService.typeName,
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
      // THSR runs a single service class, so there is no per-train type to show.
      (e) => ({ trainNo: e.GeneralTimetable?.GeneralTrainInfo?.TrainNo ?? null, typeName: null, typeNameEn: null }),
      (e) => e.GeneralTimetable?.ServiceDay,
      r.from.id, r.to.id,
    );
    return s ? { ...s, fare: thsrFare(r.from.id, r.to.id) } : null;
  }
  // NOTE: TRA fares are still NOT published here, but not for the reason previously
  // recorded. The ODFare dataset is sound; it carries one record per direction round
  // the island, and the consumer used to keep the long-way record — which is where
  // the "Taipei→Taichung listed at 711 km" figure came from. That is disambiguated at
  // the data layer now (Taipei→Taichung reads 164.6 km). Publishing still waits on a
  // manual spot-check of the absolute prices against the operator. THSR fares are
  // published because they have no directional ambiguity.
  return scanTimetable(
    traTimetable,
    (e) => e.StopTimes,
    (e) => ({
      trainNo: e.TrainInfo?.TrainNo ?? null,
      typeName: e.TrainInfo?.TrainTypeName?.Zh_tw ?? null,
      typeNameEn: e.TrainInfo?.TrainTypeName?.En ?? null,
    }),
    (e) => e.ServiceDay,
    r.from.id, r.to.id,
  );
}

const slug = (en) => en.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function pageFor(r, allRoutes, locale = 'zh') {
  const isEnglish = locale === 'en';
  const isHsr = r.transport === 'hsr';
  const transportLabel = isHsr ? '高鐵' : '台鐵';
  const transportLabelEn = isHsr ? 'THSR' : 'TRA';
  const slugPath = `${slug(r.from.en)}-to-${slug(r.to.en)}`;
  const basePathname = `/routes/${r.transport}/${slugPath}/`;
  const pathname = `${isEnglish ? '/en' : ''}${basePathname}`;
  const absoluteUrl = SITE + pathname;
  const zhUrl = SITE + basePathname;
  const enUrl = `${SITE}/en${basePathname}`;
  const appDeepLink = `${SITE}${isEnglish ? '/en/' : '/'}?transport=${r.transport}&fromId=${r.from.id}&toId=${r.to.id}`;

  const st = statsFor(r);
  const dataAsOf = isHsr ? THSR_DATA_AS_OF : TRA_DATA_AS_OF;
  const dur = st ? fmtDur(st.fastest) : null;
  const durEn = st ? fmtDurEn(st.fastest) : null;

  // Data-rich meta description (answer-first, statistics) — falls back gracefully.
  const statZh = st
    ? `最快約 ${dur}、平日約 ${st.weekdayCount} 班・假日約 ${st.weekendCount} 班直達、首班 ${st.first} 末班 ${st.last}。`
    : '';
  const statEn = st
    ? ` The fastest direct journey is about ${durEn}, with about ${st.weekdayCount} direct trains on weekdays and ${st.weekendCount} at weekends; first departure ${st.first}, last departure ${st.last}.`
    : '';
  const title = isEnglish
    ? `${r.from.en} to ${r.to.en} ${transportLabelEn} Timetable, Fares & Live Status`
    : `${r.from.zh} 到 ${r.to.zh} ${transportLabel}時刻表 | ${r.from.en} to ${r.to.en} ${transportLabelEn} Timetable`;
  const description = isEnglish
    ? `Check ${transportLabelEn} trains from ${r.from.en} to ${r.to.en}, including timetable, fares, stops, delays and cancellations.${statEn}`
    : `${r.from.zh}站到${r.to.zh}站的${transportLabel}班次、票價、停靠站與誤點即時查詢。${statZh}Real-time ${transportLabelEn} timetable, fares and delays from ${r.from.en} to ${r.to.en}.`;

  const jsonLdTravel = {
    '@context': 'https://schema.org',
    '@type': 'TravelAction',
    agent: { '@type': 'Organization', name: transportLabelEn },
    fromLocation: { '@type': 'TrainStation', name: isEnglish ? r.from.en : r.from.zh, identifier: r.from.id },
    toLocation:   { '@type': 'TrainStation', name: isEnglish ? r.to.en : r.to.zh, identifier: r.to.id },
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
    inLanguage: isEnglish ? 'en' : 'zh-Hant-TW',
    dateModified: SITEMAP_LASTMOD,
    citation: TDX_SOURCE,
    mainEntity: jsonLdTravel,
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: isEnglish ? 'Home' : '首頁', item: `${SITE}${isEnglish ? '/en/' : '/'}` },
      { '@type': 'ListItem', position: 2, name: isEnglish ? transportLabelEn : transportLabel, item: `${SITE}${isEnglish ? '/en/' : '/'}?transport=${r.transport}` },
      { '@type': 'ListItem', position: 3, name: `${isEnglish ? r.from.en : r.from.zh} → ${isEnglish ? r.to.en : r.to.zh}`, item: absoluteUrl },
    ],
  };

  // --- Build FAQ (visible + JSON-LD) from real numbers ---
  const faqs = [];
  if (st) {
    faqs.push({
      q: isEnglish
        ? `How long is the ${transportLabelEn} trip from ${r.from.en} to ${r.to.en}?`
        : `${r.from.zh}到${r.to.zh}的${transportLabel}車程要多久？`,
      a: isEnglish
        ? `The fastest direct journey takes about ${durEn}. Actual travel time varies by service and number of stops; check the live results before travelling.`
        : `最快約 ${dur}${st.fastestType ? `（${st.fastestType}）` : ''}。實際時間依車種與停靠站數而異，請以即時查詢結果為準。`,
    });
    faqs.push({
      q: isEnglish
        ? `How many direct ${transportLabelEn} trains run from ${r.from.en} to ${r.to.en}?`
        : `${r.from.zh}到${r.to.zh}一天有幾班${transportLabel}？`,
      a: isEnglish
        ? `About ${st.weekdayCount} direct trains run on weekdays and ${st.weekendCount} at weekends. The first departs around ${st.first} and the last around ${st.last}.`
        : `平日約有 ${st.weekdayCount} 班直達車、週末假日約 ${st.weekendCount} 班，首班約 ${st.first} 發車、末班約 ${st.last} 發車。`,
    });
    if (isHsr && st.fare && st.fare.standard) {
      const f = st.fare;
      faqs.push({
        q: isEnglish
          ? `How much is the THSR fare from ${r.from.en} to ${r.to.en}?`
          : `${r.from.zh}到${r.to.zh}的高鐵票價多少？`,
        a: isEnglish
          ? `The adult one-way fare is NT$${f.standard} for a standard reserved seat${f.nonReserved ? `, NT$${f.nonReserved} for a non-reserved seat` : ''}${f.business ? `, and NT$${f.business} for business class` : ''}. Source: TDX THSR ODFare.`
          : `標準車廂全票 NT$${f.standard}${f.nonReserved ? `、自由座 NT$${f.nonReserved}` : ''}${f.business ? `、商務車廂 NT$${f.business}` : ''}（成人單程，資料來源 TDX 高鐵 ODFare）。`,
      });
    }
    if (st.stops && st.stops.length) {
      faqs.push({
        q: isEnglish
          ? `Does the fastest train from ${r.from.en} to ${r.to.en} make intermediate stops?`
          : `${r.from.zh}到${r.to.zh}的直達車中途停靠哪些站？`,
        a: isEnglish
          ? `Yes. The fastest service makes ${st.stops.length} intermediate ${st.stops.length === 1 ? 'stop' : 'stops'}. Open the live timetable to see the current stopping pattern.`
          : `最快班次中途停靠 ${st.stops.join('、')}。`,
      });
    } else {
      faqs.push({
        q: isEnglish
          ? `Is there a non-stop train from ${r.from.en} to ${r.to.en}?`
          : `${r.from.zh}到${r.to.zh}有直達不停靠的班次嗎？`,
        a: isEnglish
          ? 'Yes. The fastest service is non-stop between these stations.'
          : '有。最快班次為直達車，中途不停靠其他車站。',
      });
    }
  }
  // Generic FAQs — always present so every route page ships valid FAQPage data.
  faqs.push({
    q: isEnglish
      ? `Is the ${r.from.en} to ${r.to.en} timetable free to use?`
      : `查詢 ${r.from.zh} 到 ${r.to.zh} 的${transportLabel}時刻表要付費嗎？`,
    a: isEnglish
      ? 'Yes. Search and browsing are free and require no account. The data comes from the Taiwan Ministry of Transportation TDX public API.'
      : '完全免費。資料來源為交通部 TDX 運輸資料流通服務平臺公開 API，搜尋與瀏覽都不需要註冊。',
  });
  faqs.push({
    q: isEnglish
      ? `Are delays and cancellations from ${r.from.en} to ${r.to.en} updated live?`
      : `${r.from.zh}到${r.to.zh}的誤點與停駛資訊是即時的嗎？`,
    a: isEnglish
      ? `Not on this page. The timetable above is the recurring weekly pattern, as of ${dataAsOf}. Opening the live timetable retrieves delay minutes from TDX LiveBoard and cancellation notices from TDX Alert.`
      : `本頁的班次表不是即時的 —— 它是每週固定班表，資料截至 ${dataAsOf}。點擊「查詢即時班次」後，系統才會即時讀取 TDX LiveBoard 誤點分鐘數與 Alert 停駛公告，並在班次卡片上以徽章標示。`,
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
      const tlEn = x.transport === 'hsr' ? 'THSR' : 'TRA';
      const routePath = `/routes/${x.transport}/${slug(x.from.en)}-to-${slug(x.to.en)}/`;
      return isEnglish
        ? `<li><a href="${SITE}/en${routePath}">${x.from.en} → ${x.to.en} ${tlEn} timetable</a></li>`
        : `<li><a href="${SITE}${routePath}">${x.from.zh} → ${x.to.zh} ${tl}時刻表</a></li>`;
    }).join('\n        ');

  // --- HTML fragments ---
  const accent = isHsr ? '#ea580c' : '#2563eb';
  const accentSoft = isHsr ? '#fff7ed' : '#eff6ff';
  const accentText = isHsr ? '#9a3412' : '#1e40af';
  const shadow = isHsr ? 'rgba(234,88,12,.5)' : 'rgba(37,99,235,.5)';

  const statsTableRows = st ? [
    `<tr><th>${isEnglish ? 'Fastest journey' : '最快車程 Fastest'}</th><td>${isEnglish ? durEn : `${dur}${st.fastestType ? `（${esc(st.fastestType)}）` : ''}`}</td></tr>`,
    `<tr><th>${isEnglish ? 'Direct trains (weekday)' : '平日直達班次 Direct trains/weekday'}</th><td>${isEnglish ? `Approx. ${st.weekdayCount}` : `約 ${st.weekdayCount} 班`}</td></tr>`,
    `<tr><th>${isEnglish ? 'Direct trains (weekend)' : '假日直達班次 Direct trains/weekend'}</th><td>${isEnglish ? `Approx. ${st.weekendCount}` : `約 ${st.weekendCount} 班`}</td></tr>`,
    `<tr><th>${isEnglish ? 'First / last departure' : '首班 / 末班 First / Last'}</th><td>${st.first} / ${st.last}</td></tr>`,
    (isHsr && st.fare && st.fare.standard)
      ? `<tr><th>${isEnglish ? 'Adult one-way fare' : '標準車廂全票 Standard fare'}</th><td>NT$${st.fare.standard}${st.fare.nonReserved ? `${isEnglish ? ' · Non-reserved ' : '　自由座 '}NT$${st.fare.nonReserved}` : ''}${st.fare.business ? `${isEnglish ? ' · Business ' : '　商務 '}NT$${st.fare.business}` : ''}</td></tr>`
      : '',
  ].filter(Boolean).join('\n          ') : '';

  const statsBlock = st ? `
      <h2>${isEnglish ? `${r.from.en} to ${r.to.en} timetable facts` : `${r.from.zh} → ${r.to.zh}・班次資訊一覽`}</h2>
      <table class="stats">
        <tbody>
          ${statsTableRows}
        </tbody>
      </table>
      <p class="src">${isEnglish
        ? `Statistics calculated from the <a href="${TDX_SOURCE}" rel="external noopener noreferrer">Taiwan MOTC TDX</a> public timetable. Data as of ${dataAsOf}. Check live results for current schedules, fares and delays.`
        : `資料統計自交通部 <a href="${TDX_SOURCE}" rel="external noopener noreferrer">TDX 運輸資料流通服務平臺</a>公開時刻表；資料截至 ${dataAsOf}。實際班次、票價與誤點請以即時查詢為準。`}</p>
      ${isEnglish
        ? `<p>${st.stops && st.stops.length ? `The fastest service makes ${st.stops.length} intermediate ${st.stops.length === 1 ? 'stop' : 'stops'}.` : 'The fastest service is non-stop.'}</p>`
        : (st.stops && st.stops.length ? `<p>最快班次中途停靠：${st.stops.map(esc).join('、')}。</p>` : '<p>最快班次為直達車，中途不停靠其他車站。</p>')}` : '';

  // Departures at or after this hour start collapsed. Cutting by time of day rather
  // than by row count keeps the visible portion meaningful across routes whose
  // frequency differs fourfold (26 to 101 services).
  const COLLAPSE_FROM_MIN = 12 * 60;

  const timetableRow = (s) => {
    const type = isEnglish
      ? s.typeNameEn ?? transportLabelEn
      : s.typeName ?? transportLabel;
    return `<tr><td>${esc(s.trainNo ?? '—')}</td><td>${esc(type)}</td><td>${s.dep}</td><td>${s.arr}</td><td>${fmtDurCell(s.durationMin, isEnglish)}</td></tr>`;
  };

  const timetableFor = (group, heading, emptyNote) => {
    const services = st ? st.services.filter((s) => s[group]) : [];
    if (!services.length) return `<h3>${heading}</h3>\n      <p>${emptyNote}</p>`;
    const early = services.filter((s) => s.depMin < COLLAPSE_FROM_MIN);
    const later = services.filter((s) => s.depMin >= COLLAPSE_FROM_MIN);
    const head = `<thead><tr>
            <th scope="col">${isEnglish ? 'Train' : '車次'}</th>
            <th scope="col">${isEnglish ? 'Type' : '車種'}</th>
            <th scope="col">${isEnglish ? 'Depart' : '出發'}</th>
            <th scope="col">${isEnglish ? 'Arrive' : '抵達'}</th>
            <th scope="col">${isEnglish ? 'Duration' : '行駛時間'}</th>
          </tr></thead>`;
    const table = (rows) => `<table class="timetable">
          ${head}
          <tbody>${rows.map(timetableRow).join('')}</tbody>
        </table>`;
    const laterLabel = isEnglish
      ? `Departures from 12:00 onwards (${later.length})`
      : `12:00 之後的班次（${later.length} 班）`;
    return [
      `<h3>${heading}</h3>`,
      early.length ? table(early) : '',
      later.length
        ? `<details class="later-departures"><summary>${laterLabel}</summary>
        ${table(later)}
        </details>`
        : '',
    ].filter(Boolean).join('\n      ');
  };

  const timetableBlock = st ? `
      <h2>${isEnglish
        ? `${r.from.en} to ${r.to.en} direct ${transportLabelEn} services`
        : `${r.from.zh} → ${r.to.zh}・直達班次時刻表`}</h2>
      <p class="src">${isEnglish
        ? `Scheduled direct services from the weekly TDX general timetable. <strong>Data as of ${dataAsOf}</strong> — this is the recurring weekly pattern, not today's running order. Extra services, retimings, delays and cancellations announced for a specific date are not shown here.`
        : `以下為 TDX 每週通用時刻表的固定直達班次，<strong>資料截至 ${dataAsOf}</strong>。這是每週的固定班表，不是今日實際運行狀況：特定日期的加班車、改點、誤點與停駛都不在此表內。`}</p>
      <p><a class="cta" href="${appDeepLink}">${isEnglish
        ? `Check today's delays and cancellations for ${r.from.en} → ${r.to.en}`
        : `查詢 ${r.from.zh} → ${r.to.zh} 今日誤點與停駛`} →</a></p>
      ${timetableFor('weekday', isEnglish ? 'Weekdays (Mon–Fri)' : '平日（週一～週五）', isEnglish ? 'No direct weekday services.' : '平日無直達班次。')}
      ${timetableFor('weekend', isEnglish ? 'Weekends (Sat–Sun)' : '假日（週六、週日）', isEnglish ? 'No direct weekend services.' : '假日無直達班次。')}` : '';

  const faqBlock = faqs.length ? `
      <h2>${isEnglish ? 'Frequently asked questions' : '常見問題 FAQ'}</h2>
      <div class="faq">
        ${faqs.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n        ')}
      </div>` : '';

  const ldScripts = [jsonLdWebPage, breadcrumb, faqJsonLd]
    .filter(Boolean)
    .map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`)
    .join('\n    ');

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
      ul { padding-left: 20px; color: #475569; font-size: 14px; line-height: 1.9; }
      table.stats { width: 100%; border-collapse: collapse; font-size: 14px; margin: 8px 0 4px; }
      table.stats th, table.stats td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
      table.stats th { color: #334155; font-weight: 700; white-space: nowrap; width: 45%; }
      table.stats td { color: #0f172a; font-weight: 600; }
      .src { color: #94a3b8; font-size: 12px; }
      .timetable { width: 100%; border-collapse: collapse; font-size: 14px; margin: 6px 0 12px; }
      .timetable th, .timetable td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #e2e8f0; }
      .timetable thead th { color: #64748b; font-size: 12px; font-weight: 700; white-space: nowrap; }
      .timetable td { color: #0f172a; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .timetable td:nth-child(2) { font-weight: 500; color: #475569; }
      details.later-departures { margin: 0 0 16px; }
      details.later-departures > summary { cursor: pointer; color: ${accentText}; font-weight: 700; font-size: 14px; padding: 8px 0; }
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
      <div class="meta">${transportLabel} · ${transportLabelEn}</div>
      <h1>${isEnglish ? `${r.from.en} to ${r.to.en} ${transportLabelEn} timetable` : `${r.from.zh} 到 ${r.to.zh}・${transportLabel}時刻表`}</h1>
      <p>${esc(description)}</p>
      <a class="cta" href="${appDeepLink}">${isEnglish ? `Check live ${r.from.en} → ${r.to.en} trains` : `查詢 ${r.from.zh} → ${r.to.zh} 即時班次`} →</a>
${statsBlock}
${timetableBlock}
      <h2>${isEnglish ? 'Route overview' : '關於這段路線'}</h2>
      <p>${isEnglish
        ? `This page summarizes ${transportLabelEn} services from ${r.from.en} to ${r.to.en}. Open the live search to view trains for today and the next two days, including fares, stopping patterns, delays and cancellations.`
        : `本頁提供 ${r.from.zh}（${r.from.en}）出發前往 ${r.to.zh}（${r.to.en}）的 ${transportLabel} 班次資訊入口。點擊上方按鈕即會開啟鐵道查詢 App 並自動填入起訖站，顯示今日、明日、後日所有班次、票價、停靠站以及即時誤點狀態。`}</p>

      <h2>${isEnglish ? 'What you can check' : '你可以做什麼'}</h2>
      <ul>
        ${isEnglish
          ? `<li>Full-day ${r.from.en} ↔ ${r.to.en} schedules and fares</li>
        <li>Intermediate stops and arrival/departure times</li>
        <li>Live delay minutes and cancellation notices</li>
        <li>Metro, airport MRT, light rail and BRT transfer hints</li>
        <li>Favourite trains and departure reminders</li>`
          : `<li>即時查詢 ${r.from.zh} ↔ ${r.to.zh} 全日班次與票價</li>
        <li>檢視列車停靠站與各站到離時間</li>
        <li>查看當日誤點分鐘數（綠色準點 / 紅色誤點）</li>
        <li>展開停靠站查看 捷運 / 機捷 / 高捷 / 輕軌 / BRT 轉乘提示</li>
        <li>將常用班次加入最愛、開啟提醒</li>`}
      </ul>
${faqBlock}
      <h2>${isEnglish ? 'Other popular routes' : '其他熱門路線 Other routes'}</h2>
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

function hubPageFor(hub, locale = 'zh') {
  const isEnglish = locale === 'en';
  const t = isEnglish ? hub.en : hub.zh;
  const basePathname = `/${hub.slug}/`;
  const pathname = `${isEnglish ? '/en' : ''}${basePathname}`;
  const absoluteUrl = SITE + pathname;
  const zhUrl = SITE + basePathname;
  const enUrl = `${SITE}/en${basePathname}`;
  const homeUrl = `${SITE}${isEnglish ? '/en/' : '/'}`;
  const appDeepLink = `${homeUrl}?transport=${hub.appQuery}`;

  // Popular route pages for the two rail hubs (internal linking down the tree).
  const relatedRoutes = (hub.role === 'train' || hub.role === 'hsr')
    ? ROUTES.filter((x) => x.transport === (hub.role === 'hsr' ? 'hsr' : 'train'))
        .slice(0, 8)
        .map((x) => {
          const routePath = `/routes/${x.transport}/${slug(x.from.en)}-to-${slug(x.to.en)}/`;
          const tl = x.transport === 'hsr' ? '高鐵' : '台鐵';
          const tlEn = x.transport === 'hsr' ? 'THSR' : 'TRA';
          return isEnglish
            ? `<li><a href="${SITE}/en${routePath}">${x.from.en} → ${x.to.en} ${tlEn} timetable</a></li>`
            : `<li><a href="${SITE}${routePath}">${x.from.zh} → ${x.to.zh} ${tl}時刻表</a></li>`;
        }).join('\n        ')
    : '';

  // Cross-links to the other three hubs — this is the navigational cluster that
  // makes the four functions read as a coherent set of sitelink candidates.
  const otherHubs = HUBS.filter((h) => h.slug !== hub.slug).map((h) => {
    const ht = isEnglish ? h.en : h.zh;
    return `<li><a href="${SITE}${isEnglish ? '/en' : ''}/${h.slug}/">${esc(ht.nav)}</a></li>`;
  }).join('\n        ');

  const jsonLdWebPage = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${absoluteUrl}#webpage`,
    url: absoluteUrl,
    name: t.title,
    description: t.lead,
    inLanguage: isEnglish ? 'en' : 'zh-Hant-TW',
    dateModified: SITEMAP_LASTMOD,
    isPartOf: { '@type': 'WebSite', '@id': `${SITE}/#website`, url: `${SITE}/` },
    citation: TDX_SOURCE,
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: isEnglish ? 'Home' : '首頁', item: homeUrl },
      { '@type': 'ListItem', position: 2, name: t.nav, item: absoluteUrl },
    ],
  };
  const ldScripts = [jsonLdWebPage, breadcrumb]
    .map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`)
    .join('\n    ');

  const bullets = t.bullets.map((b) => `<li>${esc(b)}</li>`).join('\n        ');
  const relatedBlock = relatedRoutes ? `
      <h2>${isEnglish ? 'Popular routes' : '熱門路線'}</h2>
      <ul class="related">
        ${relatedRoutes}
      </ul>` : '';

  const html = `<!doctype html>
<html lang="${isEnglish ? 'en' : 'zh-Hant-TW'}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="${hub.accent}" />
    <title>${esc(t.title)}</title>
    <meta name="description" content="${esc(t.lead)}" />
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
    <link rel="icon" type="image/svg+xml" href="/logo.svg" />
    <link rel="apple-touch-icon" href="/pwa-192x192.png" />
    <link rel="canonical" href="${absoluteUrl}" />
    <link rel="alternate" hreflang="zh-Hant" href="${zhUrl}" />
    <link rel="alternate" hreflang="en" href="${enUrl}" />
    <link rel="alternate" hreflang="x-default" href="${zhUrl}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${absoluteUrl}" />
    <meta property="og:title" content="${esc(t.title)}" />
    <meta property="og:description" content="${esc(t.lead)}" />
    <meta property="og:image" content="${SITE}/pwa-512x512.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(t.title)}" />
    <meta name="twitter:description" content="${esc(t.lead)}" />
    <meta name="twitter:image" content="${SITE}/pwa-512x512.png" />
    ${ldScripts}
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans TC", sans-serif; margin: 0; background: linear-gradient(180deg, #fff 0%, #f1f5f9 100%); color: #0f172a; }
      main { max-width: 720px; margin: 0 auto; padding: 48px 24px 80px; }
      h1 { font-size: 32px; font-weight: 800; letter-spacing: -0.02em; margin: 0 0 12px; }
      h2 { font-size: 20px; margin: 40px 0 12px; }
      p  { line-height: 1.7; color: #475569; font-size: 15px; }
      .cta { display: inline-block; margin-top: 24px; padding: 14px 28px; background: ${hub.accent}; color: #fff; border-radius: 999px; text-decoration: none; font-weight: 700; box-shadow: 0 12px 28px -12px ${hub.shadow}; }
      .meta { display: inline-block; padding: 6px 14px; border-radius: 999px; background: ${hub.accentSoft}; color: ${hub.accentText}; font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 20px; }
      nav a { color: #64748b; font-size: 13px; text-decoration: none; }
      nav a:hover { color: #0f172a; }
      ul { padding-left: 20px; color: #475569; font-size: 14px; line-height: 1.9; }
      .related a, .hubs a { color: ${hub.accentText}; text-decoration: none; font-weight: 600; }
      .related a:hover, .hubs a:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <main>
      <nav><a href="${homeUrl}">← ${isEnglish ? 'Back to home' : '回首頁 Home'}</a></nav>
      <div class="meta">${esc(t.nav)}</div>
      <h1>${esc(t.nav)}</h1>
      <p>${esc(t.lead)}</p>
      <a class="cta" href="${appDeepLink}">${isEnglish ? 'Open the live search' : '開始即時查詢'} →</a>

      <h2>${isEnglish ? 'What you can do' : '你可以做什麼'}</h2>
      <ul>
        ${bullets}
      </ul>
${relatedBlock}
      <h2>${isEnglish ? 'More features' : '其他功能'}</h2>
      <ul class="hubs">
        ${otherHubs}
      </ul>

      <p style="margin-top:40px;color:#94a3b8;font-size:12px;">${isEnglish ? 'Data source: ' : '資料來源：交通部 '}<a href="${TDX_SOURCE}" rel="external noopener noreferrer">${isEnglish ? 'Taiwan MOTC TDX' : 'TDX 運輸資料流通服務平臺'}</a></p>
    </main>
  </body>
</html>
`;
  return { pathname, html, url: absoluteUrl, basePathname };
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
    const localizedPages = [
      pageFor(r, ROUTES, 'zh'),
      pageFor(r, ROUTES, 'en'),
    ];
    for (const { pathname, html, url } of localizedPages) {
      const filePath = join(OUT_ROOT, pathname.replace(/^\//, ''), 'index.html');
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, html, 'utf8');
      console.log(`  ✓ ${pathname}`);
      generated.push({ url, basePathname: pathname.replace(/^\/en/, '') });
    }
  }

  // Section hub landing pages (台鐵 / 高鐵 / 捷運 / 行程) — sitelink candidates.
  let hubCount = 0;
  for (const hub of HUBS) {
    for (const { pathname, html, url, basePathname } of [hubPageFor(hub, 'zh'), hubPageFor(hub, 'en')]) {
      const filePath = join(OUT_ROOT, pathname.replace(/^\//, ''), 'index.html');
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, html, 'utf8');
      console.log(`  ✓ ${pathname}`);
      generated.push({ url, basePathname });
      hubCount += 1;
    }
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
  await writeFile(join(OUT_ROOT, 'sitemap.xml'), sitemap, 'utf8');
  console.log(`  ✓ sitemap.xml (${generated.length - hubCount} route pages + ${hubCount} hub pages + 2 base URLs)`);
}

main().catch(err => { console.error(err); process.exit(1); });
