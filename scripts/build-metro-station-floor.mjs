// Build a station "floor" for the metro picker from data already in the repo /
// from stable station constants, so a TDX 429 (which collapses getMetroStations
// to the ~8-station mock) can never shrink the list below this. The scheduled
// fetch-tdx-metro.ts later overwrites stations.json with the complete /Station
// snapshot (coordinates + every line); this is only the offline safety net, and
// it is shown ONLY while live is unavailable (getMetroStations treats a real
// live list as authoritative), so the floors below never appear when TDX works.
//
//   node scripts/build-metro-station-floor.mjs
//
// Names are zh/en, no coordinates (matching the timetable-derived data). Where a
// line has no StationTimeTable we use a constant. IDs follow TDX where known.
import fs from 'fs';
import path from 'path';

const row = (StationID, Zh_tw, En, LineID) => ({ StationID, StationName: { Zh_tw, En }, LineID });

// 台北捷運 文湖線 BR01–BR24 (no StationTimeTable → constant).
const TRTC_BR = [
  ['BR01', '動物園', 'Taipei Zoo'], ['BR02', '木柵', 'Muzha'], ['BR03', '萬芳社區', 'Wanfang Community'],
  ['BR04', '萬芳醫院', 'Wanfang Hospital'], ['BR05', '辛亥', 'Xinhai'], ['BR06', '麟光', 'Linguang'],
  ['BR07', '六張犁', 'Liuzhangli'], ['BR08', '科技大樓', 'Technology Building'], ['BR09', '大安', 'Daan'],
  ['BR10', '忠孝復興', 'Zhongxiao Fuxing'], ['BR11', '南京復興', 'Nanjing Fuxing'],
  ['BR12', '中山國中', 'Zhongshan Junior High School'], ['BR13', '松山機場', 'Songshan Airport'],
  ['BR14', '大直', 'Dazhi'], ['BR15', '劍南路', 'Jiannan Road'], ['BR16', '西湖', 'Xihu'],
  ['BR17', '港墘', 'Gangqian'], ['BR18', '文德', 'Wende'], ['BR19', '內湖', 'Neihu'],
  ['BR20', '大湖公園', 'Dahu Park'], ['BR21', '葫洲', 'Huzhou'], ['BR22', '東湖', 'Donghu'],
  ['BR23', '南港軟體園區', 'Nangang Software Park'], ['BR24', '南港展覽館', 'Taipei Nangang Exhibition Center'],
].map(([a, b, c]) => row(a, b, c, 'BR'));

// 桃園捷運 機場線 A1–A23.
const TYMC_A = [
  ['A1', '台北車站', 'Taipei Main Station'], ['A2', '三重', 'Sanchong'], ['A3', '新北產業園區', 'New Taipei Industrial Park'],
  ['A4', '新莊副都心', 'Xinzhuang Fuduxin'], ['A5', '泰山', 'Taishan'], ['A6', '泰山貴和', 'Taishan Guihe'],
  ['A7', '體育大學', 'Taoyuan Sports University'], ['A8', '長庚醫院', 'Chang Gung Memorial Hospital'], ['A9', '林口', 'Linkou'],
  ['A10', '山鼻', 'Shanbi'], ['A11', '坑口', 'Kengkou'], ['A12', '機場第一航廈', 'Airport Terminal 1'],
  ['A13', '機場第二航廈', 'Airport Terminal 2'], ['A14a', '機場旅館', 'Airport Hotel'], ['A15', '大園', 'Dayuan'],
  ['A16', '橫山', 'Hengshan'], ['A17', '領航', 'Linghang'], ['A18', '高鐵桃園站', 'Taoyuan HSR Station'],
  ['A19', '桃園體育園區', 'Taoyuan Sports Park'], ['A20', '興南', 'Xingnan'], ['A21', '環北', 'Huanbei'],
  ['A22', '老街溪', 'Laojie River'], ['A23', '中壢', 'Zhongli'],
].map(([a, b, c]) => row(a, b, c, 'A'));

// 高雄捷運 紅線 R3–R21 + 橘線 O1–O14 (confident core; northern Red extension and
// any future stations are left to the live snapshot to avoid wrong ids).
const KRTC = [
  ['R3', '小港', 'Siaogang', 'R'], ['R4', '高雄國際機場', 'Kaohsiung International Airport', 'R'],
  ['R5', '前鎮高中', 'Cianjhen Junior High School', 'R'], ['R6', '凱旋', 'Kaisyuan', 'R'], ['R7', '獅甲', 'Shihjia', 'R'],
  ['R8', '三多商圈', 'Sanduo Shopping District', 'R'], ['R9', '中央公園', 'Central Park', 'R'], ['R10', '美麗島', 'Formosa Boulevard', 'R'],
  ['R11', '高雄車站', 'Kaohsiung Main Station', 'R'], ['R12', '後驛', 'Houyi', 'R'], ['R13', '凹子底', 'Aozihdi', 'R'],
  ['R14', '巨蛋', 'Kaohsiung Arena', 'R'], ['R15', '生態園區', 'Ecological District', 'R'], ['R16', '左營', 'Zuoying', 'R'],
  ['R17', '世運', 'World Games', 'R'], ['R18', '油廠國小', 'Refinery Elementary School', 'R'],
  ['R19', '楠梓加工區', 'Nanzih Export Processing Zone', 'R'], ['R20', '後勁', 'Houjing', 'R'], ['R21', '都會公園', 'Metropolitan Park', 'R'],
  ['O1', '西子灣', 'Sizihwan', 'O'], ['O2', '鹽埕埔', 'Yanchengpu', 'O'], ['O4', '市議會', 'City Council', 'O'],
  ['O5', '美麗島', 'Formosa Boulevard', 'O'], ['O6', '信義國小', 'Sinyi Elementary School', 'O'], ['O7', '文化中心', 'Cultural Center', 'O'],
  ['O8', '五塊厝', 'Wukuaicuo', 'O'], ['O9', '技擊館', 'Martial Arts Stadium', 'O'], ['O10', '衛武營', 'Weiwuying', 'O'],
  ['O11', '鳳山西', 'Fongshan West', 'O'], ['O12', '鳳山', 'Fongshan', 'O'], ['O13', '大東', 'Dadong', 'O'],
  ['O14', '鳳山國中', 'Fongshan Junior High School', 'O'],
].map(([a, b, c, d]) => row(a, b, c, d));

// 新北捷運 環狀線 Y07–Y20.
const NTMC_Y = [
  ['Y07', '大坪林', 'Dapinglin'], ['Y08', '十四張', 'Shisizhang'], ['Y09', '秀朗橋', 'Xiulang Bridge'],
  ['Y10', '景平', 'Jingping'], ['Y11', '景安', "Jing'an"], ['Y12', '中和', 'Zhonghe'],
  ['Y13', '橋和', 'Qiaohe'], ['Y14', '中原', 'Zhongyuan'], ['Y15', '板新', 'Banxin'],
  ['Y16', '板橋', 'Banqiao'], ['Y17', '新埔民生', 'Xinpu Minsheng'], ['Y18', '頭前庄', 'Touqianzhuang'],
  ['Y19', '幸福', 'Xingfu'], ['Y20', '新北產業園區', 'New Taipei Industrial Park'],
].map(([a, b, c]) => row(a, b, c, 'Y'));

// 台中捷運 綠線 101–118 (names confident; numeric ids best-effort).
const TMRT_G = [
  ['101', '北屯總站', 'Beitun Main Station'], ['102', '舊社', 'Jiushe'], ['103', '松竹', 'Songzhu'],
  ['104', '四維國小', 'Sihwei Elementary School'], ['105', '文心崇德', 'Wenxin Chongde'], ['106', '文心中清', 'Wenxin Zhongqing'],
  ['107', '文心櫻花', 'Wenxin Yinghua'], ['108', '市政府', 'Taichung City Hall'], ['109', '水安宮', "Shui'an Temple"],
  ['110', '文心森林公園', 'Wenxin Forest Park'], ['111', '南屯', 'Nantun'], ['112', '豐樂公園', 'Fongle Sculpture Park'],
  ['113', '大慶', 'Daqing'], ['114', '九張犁', 'Jiuzhangli'], ['115', '九德', 'Jiude'],
  ['116', '烏日', 'Wuri'], ['117', '成功', 'Chenggong'], ['118', '高鐵台中站', 'Taichung HSR Station'],
].map(([a, b, c]) => row(a, b, c, 'G'));

// 高雄輕軌 環狀輕軌 C1–C14 (confident core; the 2023–24 loop extension C15–C38 is
// left to the live snapshot to avoid wrong ids/names).
const KLRT_C = [
  ['C1', '籬仔內', 'Lizihnei'], ['C2', '凱旋瑞田', 'Kaisyuan Ruitian'], ['C3', '前鎮之星', 'Cianjhen Star'],
  ['C4', '凱旋中華', 'Kaisyuan Zhonghua'], ['C5', '夢時代', 'Dream Mall'], ['C6', '經貿園區', 'Trade Park'],
  ['C7', '軟體園區', 'Software Park'], ['C8', '高雄展覽館', 'Kaohsiung Exhibition Center'], ['C9', '旅運中心', 'Cruise Terminal'],
  ['C10', '光榮碼頭', 'Glory Pier'], ['C11', '真愛碼頭', 'Love Pier'], ['C12', '駁二大義', 'Dayi Pier-2'],
  ['C13', '駁二蓬萊', 'Penglai Pier-2'], ['C14', '哈瑪星', 'Hamasing'],
].map(([a, b, c]) => row(a, b, c, 'C'));

// 淡海輕軌 綠山線 V01–V10 (confident core; 藍海線等留給 live).
const NTDLRT_V = [
  ['V01', '紅樹林', 'Hongshulin'], ['V02', '淡金鄧公', 'Danjin Denggong'], ['V03', '淡江大學', 'Tamkang University'],
  ['V04', '淡金北新', 'Danjin Beixin'], ['V05', '新市一路', 'Xinshi 1st Rd.'], ['V06', '淡水行政中心', 'Tamsui District Office'],
  ['V07', '濱海義山', 'Binhai Yishan'], ['V08', '濱海沙崙', 'Binhai Shalun'], ['V09', '淡海新市鎮', 'Tamhai New Town'],
  ['V10', '崁頂', 'Kanding'],
].map(([a, b, c]) => row(a, b, c, 'V'));

const isCompleteSnapshot = (file) => {
  try {
    const a = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(a) && a.some((s) => s?.StationPosition && typeof s.StationPosition.PositionLat === 'number');
  } catch { return false; }
};

function write(dataDir, systemCode, stations) {
  const dir = path.join(dataDir, `metro_${systemCode}`);
  const file = path.join(dir, 'stations.json');
  if (isCompleteSnapshot(file)) { console.log(`↩︎  metro_${systemCode}: complete /Station snapshot present — left as-is`); return; }
  const byId = new Map();
  for (const s of stations) if (s.StationID && !byId.has(s.StationID)) byId.set(s.StationID, s);
  const out = [...byId.values()].sort((a, b) => a.StationID.localeCompare(b.StationID));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`✅ metro_${systemCode}/stations.json: ${out.length} stations (lines: ${[...new Set(out.map((s) => s.LineID))].sort().join(', ')})`);
}

// TRTC base comes from the committed per-station StationTimeTable files (BL/G/O/R).
function trtcFromTimetables(dataDir) {
  const dir = path.join(dataDir, 'metro_TRTC');
  const out = [];
  for (const f of fs.readdirSync(dir).filter((f) => /^[A-Za-z0-9]+\.json$/.test(f) && f !== 'stations.json')) {
    let rows; try { rows = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    const r = Array.isArray(rows) ? rows[0] : rows;
    if (!r?.StationID) continue;
    const n = r.StationName || {};
    out.push(row(r.StationID, n.Zh_tw || '', n.En || '', r.LineID || ''));
  }
  return out;
}

const dataDir = path.join(process.cwd(), 'public', 'data');
write(dataDir, 'TRTC', [...trtcFromTimetables(dataDir), ...TRTC_BR]);
write(dataDir, 'TYMC', TYMC_A);
write(dataDir, 'KRTC', KRTC);
write(dataDir, 'NTMC', NTMC_Y);
write(dataDir, 'TMRT', TMRT_G);
write(dataDir, 'KLRT', KLRT_C);
write(dataDir, 'NTDLRT', NTDLRT_V);
