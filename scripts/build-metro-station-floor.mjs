// Build a station "floor" for the metro picker from data already in the repo,
// so a TDX 429 (which collapses getMetroStations to the ~8-station mock) can
// never shrink the list below this. The scheduled fetch-tdx-metro.ts later
// overwrites stations.json with the complete /Station snapshot (coords + all
// lines); this is only the offline safety net.
//
//   node scripts/build-metro-station-floor.mjs
//
// TRTC source = the committed per-station StationTimeTable files (BL/G/O/R).
// Those omit the headway-based 文湖線 (BR), so its stations are appended from a
// stable constant below (names only — no coordinates, matching the rest).
import fs from 'fs';
import path from 'path';

// 文湖線 BR01–BR24 (zh/en names per TDX). No coordinates by design.
const WENHU_BR = [
  ['BR01', '動物園', 'Taipei Zoo'],
  ['BR02', '木柵', 'Muzha'],
  ['BR03', '萬芳社區', 'Wanfang Community'],
  ['BR04', '萬芳醫院', 'Wanfang Hospital'],
  ['BR05', '辛亥', 'Xinhai'],
  ['BR06', '麟光', 'Linguang'],
  ['BR07', '六張犁', 'Liuzhangli'],
  ['BR08', '科技大樓', 'Technology Building'],
  ['BR09', '大安', 'Daan'],
  ['BR10', '忠孝復興', 'Zhongxiao Fuxing'],
  ['BR11', '南京復興', 'Nanjing Fuxing'],
  ['BR12', '中山國中', 'Zhongshan Junior High School'],
  ['BR13', '松山機場', 'Songshan Airport'],
  ['BR14', '大直', 'Dazhi'],
  ['BR15', '劍南路', 'Jiannan Road'],
  ['BR16', '西湖', 'Xihu'],
  ['BR17', '港墘', 'Gangqian'],
  ['BR18', '文德', 'Wende'],
  ['BR19', '內湖', 'Neihu'],
  ['BR20', '大湖公園', 'Dahu Park'],
  ['BR21', '葫洲', 'Huzhou'],
  ['BR22', '東湖', 'Donghu'],
  ['BR23', '南港軟體園區', 'Nangang Software Park'],
  ['BR24', '南港展覽館', 'Taipei Nangang Exhibition Center'],
].map(([StationID, Zh_tw, En]) => ({ StationID, StationName: { Zh_tw, En }, LineID: 'BR' }));

function buildTRTC(dataDir) {
  const dir = path.join(dataDir, 'metro_TRTC');
  const files = fs.readdirSync(dir).filter((f) => /^[A-Za-z0-9]+\.json$/.test(f) && f !== 'stations.json');
  const byId = new Map();
  for (const f of files) {
    let rows;
    try { rows = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    const r = Array.isArray(rows) ? rows[0] : rows;
    if (!r || !r.StationID || byId.has(r.StationID)) continue;
    const n = r.StationName || {};
    byId.set(r.StationID, { StationID: r.StationID, StationName: { Zh_tw: n.Zh_tw || '', En: n.En || '' }, LineID: r.LineID || '' });
  }
  for (const s of WENHU_BR) if (!byId.has(s.StationID)) byId.set(s.StationID, s);
  const out = [...byId.values()].sort((a, b) => a.StationID.localeCompare(b.StationID));
  fs.writeFileSync(path.join(dir, 'stations.json'), JSON.stringify(out));
  const lines = [...new Set(out.map((s) => s.LineID))].sort().join(', ');
  console.log(`✅ metro_TRTC/stations.json: ${out.length} stations (lines: ${lines})`);
}

const dataDir = path.join(process.cwd(), 'public', 'data');
buildTRTC(dataDir);
