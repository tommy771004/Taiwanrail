/**
 * changelog.ts — 功能更新記錄, shown from the side menu (ChangelogModal).
 *
 * Hand-written from the git history, for riders: one entry per change a rider can
 * see or feel, in plain words. Leave out what they cannot (quotas, caching, logging,
 * refactors, tests). Dates are the day the change went live, Taipei time; newest day
 * first. Every entry needs both languages. `npm run test:changelog` pins the shape.
 *
 * i18n: the two languages of an entry are written side by side here, so one cannot be
 * forgotten, and `changelogBundle` turns them into an i18next namespace
 * (`CHANGELOG_NS`, key `<date>.<index>`). ChangelogModal registers that namespace when
 * its lazy chunk loads, so the entries stay out of the entry bundle, and reads every
 * entry through `t()` like the rest of the app. The dialog's own labels (title, 新增／
 * 修改／移除 …) are ordinary keys under `changelog` in `src/i18n.ts`. A new language is
 * one more field per entry plus one more `ChangelogLang`.
 *
 * When you ship a rider-visible change, add it here in the same commit.
 */

export type ChangeKind = 'added' | 'changed' | 'removed';

export interface ChangeItem {
  kind: ChangeKind;
  zh: string;
  en: string;
}

export interface ChangeDay {
  /** YYYY-MM-DD, Taipei. */
  date: string;
  items: ChangeItem[];
}

/** The i18next namespace the entries are registered under. */
export const CHANGELOG_NS = 'changelog';

/** i18next language code → the field of a ChangeItem that holds its text. */
export const CHANGELOG_LANGS = { 'zh-TW': 'zh', en: 'en' } as const;
export type ChangelogLang = keyof typeof CHANGELOG_LANGS;

/** The i18next key of one entry inside CHANGELOG_NS. */
export const changeKey = (date: string, index: number) => `${date}.${index}`;

/** The entries of one language as an i18next resource bundle: { '<date>': { '<index>': text } }. */
export function changelogBundle(lang: ChangelogLang): Record<string, Record<string, string>> {
  const field = CHANGELOG_LANGS[lang];
  const bundle: Record<string, Record<string, string>> = {};
  for (const day of CHANGELOG) {
    bundle[day.date] = Object.fromEntries(day.items.map((item, i) => [String(i), item[field]]));
  }
  return bundle;
}

export const CHANGELOG: readonly ChangeDay[] = [
  {
    date: '2026-11-13',
    items: [
      { kind: 'changed', zh: '「規劃」結果改為精簡路線列表：每條路線列出總時間、起訖時刻、票價、每段步行分鐘與搭乘路線，以及第一班車幾分鐘後從哪一站發車；上方分頁依「大眾運輸」「單車接駁」「計程車接駁」自動分類並標出各類最快時間，同一班車只列一次。', en: 'Trip planner results are now a compact list: each route shows its total time, clock times, fare, every walk and line, and when the first ride leaves from which stop. Tabs at the top sort the routes into transit, bike + transit and taxi + transit, each with its fastest time, and the same train or bus is listed once.' },
    ],
  },
  {
    date: '2026-11-10',
    items: [
      { kind: 'added', zh: '側邊選單新增「功能更新記錄」，列出近期新增、修改與移除的功能。', en: 'A “What’s new” list in the side menu, showing recently added, changed and removed features.' },
      { kind: 'added', zh: '新增「公車到站查詢」與「YouBike 站點查詢」說明頁，含各城市收錄的公車路線數與常見問題。', en: 'New “Bus Arrivals” and “YouBike Stations” guide pages, with bus route counts per city and common questions.' },
      { kind: 'changed', zh: '側邊選單改為四角圓弧的浮動卡片並縮窄，移除標題下方的說明文字。', en: 'The side menu is now a narrower floating card with rounded corners, without the line under its title.' },
      { kind: 'changed', zh: '捷運、公車、單車、規劃分頁各有自己的網頁標題，瀏覽器分頁與書籤不再顯示成台鐵時刻表。', en: 'The Metro, Bus, Bike and Plan tabs now have their own page titles, so the browser tab and bookmarks no longer read as a TRA timetable.' },
      { kind: 'changed', zh: '「熱門路線」的台鐵／高鐵標籤與首頁 GO 標記文字加深，小字更好讀；螢幕閱讀器可直接跳到主要內容。', en: 'The TRA / THSR tags in Popular Routes and the GO mark on the home screen are darker, so the small text is easier to read; screen readers can jump straight to the main content.' },
      { kind: 'changed', zh: '搜尋班次後，頁面下方的「熱門路線」跑馬燈照常顯示。', en: 'The Popular Routes ticker now stays at the bottom of the page after you search.' },
      { kind: 'changed', zh: '網路不穩時，分頁或視窗載入失敗會顯示提示與「重新整理」按鈕，不再整頁空白。', en: 'When a tab or window fails to load on a weak connection, a notice with a Reload button appears instead of a blank page.' },
    ],
  },
  {
    date: '2026-11-09',
    items: [
      { kind: 'added', zh: '新增「公車」分頁：臺北、新北、桃園、臺中、高雄市區公車的附近站牌地圖、各路線預估到站時間、完整停靠站、路線鍵盤與常用站牌。', en: 'New Bus tab: city buses in Taipei, New Taipei, Taoyuan, Taichung and Kaohsiung, with a map of nearby stops, estimated arrivals per route, full stop lists, a route keypad and favourite stops.' },
      { kind: 'added', zh: '新增「單車」分頁：全台 14 個 YouBike 營運區站點的即時可借車輛與可還空位，可切換地圖／列表與借車／還車、搜尋站名並收藏常用站。', en: 'New Bike tab: live bikes and empty docks at YouBike stations in all 14 operating areas, with map / list views, rent / return modes, search and favourite stations.' },
      { kind: 'changed', zh: '導覽改版：頁首變矮，設定、語言與意見回饋移到側邊選單，六個分頁改放在畫面底部；往下捲動時導覽列自動隱藏。', en: 'New navigation: a shorter header, settings, language and feedback moved into a side menu, and the six tabs moved to the bottom; the bars hide while you scroll down.' },
      { kind: 'changed', zh: '公車與單車：地圖填滿第一個畫面，搜尋結果依距離排序，列表更精簡。', en: 'Bus and Bike: the map fills the first screen, search results are ranked by distance, and the lists are more compact.' },
      { kind: 'changed', zh: '單車：只取得臺北市資料時會清楚標示，不再顯示「附近沒有站點」。', en: 'Bike: when only Taipei City data is available the page says so, instead of “no stations nearby”.' },
      { kind: 'removed', zh: '移除查詢結果下方的「行程準備」推廣卡片。', en: 'Removed the “Trip prep” sponsored cards below search results.' },
    ],
  },
  {
    date: '2026-11-06',
    items: [
      { kind: 'added', zh: '捷運站到站：淡海輕軌可查行車時間；三鶯線與環狀線之間可經台北捷運規劃；文湖線、台中捷運顯示營運單位公布的班距。', en: 'Metro station-to-station: travel times for the Danhai LRT, routes between the Sanying and Circular lines via Taipei Metro, and the operator’s published headway for the Wenhu line and Taichung MRT.' },
      { kind: 'changed', zh: '捷運跨線查詢：行經文湖線、台中捷運的行程不再顯示 0 班，改列出第一段的實際班次，後段標示「依現場班次」。', en: 'Metro cross-line search: trips through the Wenhu line or Taichung MRT no longer show 0 departures; the first leg lists real departures and later legs read “Next train on site”.' },
      { kind: 'changed', zh: '修正淡水信義線往象山方向查無班次，以及桃園機場捷運、高雄輕軌行車時間過長的問題。', en: 'Fixed missing departures toward Xiangshan on the Tamsui–Xinyi line, and travel times that were far too long on the Taoyuan Airport MRT and Kaohsiung LRT.' },
      { kind: 'changed', zh: '高雄輕軌到站看板依順行／逆行分開顯示；桃園機場捷運的普通車與直達車標示更正，直達車不再列在不停靠的車站。', en: 'The Kaohsiung LRT arrivals board is split by direction round the ring; Taoyuan Airport MRT commuter and express labels are corrected, and expresses no longer appear at stations they skip.' },
      { kind: 'changed', zh: '捷運營運正常時，不再顯示「正常營運」公告。', en: 'Metro: the “normal service” notice is no longer shown when nothing is wrong.' },
      { kind: 'removed', zh: '移除捷運逐節車廂擁擠度色條（官方資料沒有這項資訊），保留標示「歷史」的典型擁擠度。', en: 'Removed the per-car metro crowding bars (the official data has no such reading); the typical crowding labelled “historical” stays.' },
    ],
  },
  {
    date: '2026-11-05',
    items: [
      { kind: 'changed', zh: '查詢更快：時刻表先顯示，即時誤點隨後補上。', en: 'Faster searches: the timetable appears first and live delays are laid over it when they arrive.' },
      { kind: 'changed', zh: '查不到結果時，改顯示同一查詢上次取得的真實結果並標示時間；篩選後沒有車次會顯示「沒有符合條件的班次」。', en: 'When a search returns nothing, the last real result for the same search is shown with its time; a filter that leaves no trains says “no matching trains”.' },
      { kind: 'changed', zh: '點選最近搜尋會切到對應的分頁並直接顯示結果。', en: 'Tapping a recent search switches to its tab and shows the results straight away.' },
      { kind: 'changed', zh: '同一個分頁長時間開著時，會提示重新整理以繼續取得即時資料。', en: 'A tab left open for a long time now asks you to reload to keep receiving live data.' },
      { kind: 'removed', zh: '移除列車異動警報橫幅與「今日停駛」標示。', en: 'Removed the rail alert banner and the “cancelled today” label.' },
      { kind: 'removed', zh: '移除所有示意資料：資料取得失敗時一律顯示「無資料」。', en: 'Removed all placeholder data: when a source fails the page now says “no data”.' },
    ],
  },
  {
    date: '2026-11-04',
    items: [
      { kind: 'changed', zh: '來回票的回程分頁展開車次時，停靠站改以回程日期查詢。', en: 'Round trips: expanding a train on the return tab now loads its stops for the return date.' },
      { kind: 'changed', zh: '台鐵即時誤點：分頁在背景、閒置一段時間或深夜時暫停更新，回到頁面操作後恢復。', en: 'TRA live delays pause while the tab is in the background, idle for a while or overnight, and resume when you return.' },
    ],
  },
  {
    date: '2026-11-03',
    items: [
      { kind: 'changed', zh: '定位按鈕記住的位置由台鐵、高鐵、捷運共用：按一次，三個分頁各自帶入最近的車站。', en: 'The location saved by the locate button is shared by TRA, THSR and Metro: one tap gives each tab its own nearest station.' },
    ],
  },
  {
    date: '2026-10-31',
    items: [
      { kind: 'changed', zh: '每日時刻表改為每天更新（原本每四天一次），持續涵蓋未來 14 天。', en: 'Daily timetables now refresh every day (previously every four days) and keep covering the next 14 days.' },
    ],
  },
  {
    date: '2026-10-28',
    items: [
      { kind: 'added', zh: '列車位置：今天的班次會在列表上顯示列車大約行駛到哪裡；明細加入起訖站位置條，手機版停靠站清單自動跟隨列車。', en: 'Train position: today’s trains show roughly where they are on the list; the detail view adds an origin-to-destination strip, and on phones the stop list follows the train.' },
    ],
  },
  {
    date: '2026-10-27',
    items: [
      { kind: 'changed', zh: '定位記憶延長為 30 天：允許過定位後，再次造訪會直接帶入最近的車站。', en: 'Location memory now lasts 30 days: once you have allowed location, a return visit fills in your nearest station.' },
    ],
  },
  {
    date: '2026-10-22',
    items: [
      { kind: 'added', zh: '高鐵對號座剩餘座位：班次卡片與明細顯示標準、商務車廂是有位、座位有限還是售完。', en: 'THSR reserved-seat availability: each train shows whether standard and business cars are available, limited or sold out.' },
      { kind: 'added', zh: '台鐵全線即時誤點：已離站或還在遠方的列車也會顯示誤點，誤點班次的時間改以紅字顯示順延後的時間。', en: 'Network-wide TRA live delays: trains already past your station or still far away show their delay too, with delayed times shown in red.' },
      { kind: 'added', zh: '台鐵支線轉乘：停靠站與轉乘指南顯示集集線、深澳線等支線的同站轉乘資訊。', en: 'TRA branch-line transfers: stops and the transfer guide show same-station changes to branch lines such as the Jiji and Shen’ao lines.' },
      { kind: 'changed', zh: '依官方轉乘資料與車站座標校正台鐵車站的捷運、輕軌與高鐵轉乘資訊。', en: 'Metro, light-rail and THSR transfer information at TRA stations corrected against official transfer data and station coordinates.' },
      { kind: 'changed', zh: '重新載入查詢過的頁面時不再自動重新查詢；重複查詢同一路線不會多一筆瀏覽紀錄。', en: 'Reloading a searched page no longer searches again by itself, and repeating the same search no longer adds a browser-history entry.' },
      { kind: 'removed', zh: '列車明細的停靠站不再顯示「第 N 站」。', en: 'The stop list in train details no longer shows “stop N”.' },
    ],
  },
  {
    date: '2026-10-20',
    items: [
      { kind: 'changed', zh: '定位詢問調整為只在第一次造訪時詢問一次，拒絕後不會再詢問。', en: 'The location prompt now appears once, on your first visit, and never again after you decline.' },
      { kind: 'changed', zh: '規劃分頁取得定位後，會自動以目前位置作為起點。', en: 'The Plan tab uses your current position as the origin once a location fix arrives.' },
    ],
  },
  {
    date: '2026-10-16',
    items: [
      { kind: 'added', zh: '捷運到站看板、站到站與規劃分頁加入定位按鈕，按下才詢問並取得最新位置。', en: 'Locate buttons on the metro arrivals board, station-to-station search and the Plan tab; location is requested only when you tap.' },
      { kind: 'changed', zh: '開啟頁面時不再主動詢問定位，改用上次的最近車站。', en: 'Opening the page no longer asks for your location; it uses your last nearest station instead.' },
      { kind: 'changed', zh: '修正規劃分頁的起訖欄位在手機上被截斷，以及到站看板站名被圖示擠掉的問題。', en: 'Fixed the Plan tab’s origin and destination fields being cut off on phones, and station names squeezed out by icons on the arrivals board.' },
    ],
  },
  {
    date: '2026-10-15',
    items: [
      { kind: 'changed', zh: '網站圖示改為藍底雙窗設計，並補上 iPhone 主畫面用的圖示。', en: 'New site icon (two windows on blue), plus a proper icon for the iPhone home screen.' },
    ],
  },
  {
    date: '2026-10-14',
    items: [
      { kind: 'added', zh: '列車明細的轉乘公車：可收藏常用路線並查看附近其他站牌的更多路線。', en: 'Connecting buses in train details: save favourite routes and see more routes from other nearby stops.' },
      { kind: 'added', zh: '轉乘公車與 YouBike 面板新增重新整理按鈕。', en: 'A refresh button on the connecting-bus and YouBike panels.' },
      { kind: 'changed', zh: '首頁頁尾加入熱門路線時刻表連結；台鐵、高鐵總覽頁改為列出全部路線。', en: 'Popular route timetables are linked from the homepage footer, and the TRA and THSR overview pages now list every route.' },
    ],
  },
  {
    date: '2026-10-10',
    items: [
      { kind: 'added', zh: '新增「關於本站、資料與隱私」頁面，說明資料來源、更新頻率與記錄的內容。', en: 'New “About, data & privacy” page covering data sources, refresh cadence and what is logged.' },
    ],
  },
];
