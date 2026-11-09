import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const resources = {
  'zh-TW': {
    translation: {
      "app": {
        "title": "時刻查詢",
        "hsr": "高鐵",
        "tra": "台鐵",
        "bus": "公車",
        "bike": "單車",
        "oneWay": "單程",
        "roundTrip": "來回",
        "outbound": "去程",
        "return": "回程",
        "favorites": "我的收藏",
        "watchlist": "班次提醒",
        "origin": "起點站",
        "destination": "終點站",
        "search": "搜尋時刻",
        "queryThrottle": "操作較頻繁，請稍候再查。",
        "editSearch": "編輯搜尋",
        "today": "今天",
        "tomorrow": "明天",
        "dayAfterTomorrow": "後天",
        "filters": {
          "time": "時間",
          "fastest": "最快抵達",
          "cheapest": "票價最低",
          "reserved": "對號座優先",
          "accessible": "無障礙"
        },
        "toasts": {
          "favAdded": "已加入收藏",
          "favRemoved": "已取消收藏",
          "watchAdded": "已開啟提醒",
          "watchRemoved": "已關閉提醒",
          "langChanged": "語言已切換至 {{lang}}",
          "trainNotFoundInList": "在目前的結果列表中找不到該班次"
        },
        "results": {
          "found": "共找到 {{count}} 班列車",
          "noResults": "無資料",
          "noResultsDesc": "目前沒有這段行程的班次資料，請更換日期或車站，或稍後再試",
          "noMatches": "沒有符合條件的班次",
          "noMatchesDesc": "目前的篩選或今天剩下的班次都沒有符合的車次，請調整篩選或更換日期",
          "prev": "上一頁",
          "next": "下一頁",
          "page": "第 {{current}} 頁，共 {{total}} 頁"
        },
        "train": {
          "duration": "{{hours}}小時{{minutes}}分",
          "durationShort": "{{minutes}}分鐘",
          "stops": "停靠站資訊",
          "onTime": "準點",
          "delay": "延誤 {{minutes}} 分",
          "fare": "票價 NT$ {{price}}"
        },
        "station": {
          "select": "請選擇車站",
          "searchPlaceholder": "搜尋車站..."
        }
      },
      "bike": {
        "title": "YouBike 微笑單車",
        "areas": "全台 14 區",
        "searchPlaceholder": "搜尋站名、地址或地標",
        "searchLabel": "搜尋 YouBike 站點",
        "clearSearch": "清除搜尋",
        "locate": "使用目前位置",
        "locating": "定位中…",
        "recenter": "回到目前位置",
        "modeLabel": "我要",
        "rent": "借車",
        "return": "還車",
        "viewLabel": "顯示方式",
        "map": "地圖",
        "list": "列表",
        "nearHere": "目前位置附近",
        "nearbyCount": "附近 {{count}} 站",
        "byDistance": "依距離",
        "live": "即時 {{time}}",
        "staleBadge": "{{time}} · 非即時",
        "refresh": "重新整理",
        "searchArea": "搜尋這個區域",
        "nearestWithBikes": "最近有車",
        "nearestWithDocks": "最近可還",
        "canRent": "可借",
        "canReturn": "可還",
        "canReturnSpaces": "可還空位",
        "totalSpaces": "總車位",
        "totalOf": "共 {{count}} 位",
        "bikesUnit": "{{count}} 台",
        "docksUnit": "{{count}} 位",
        "fewLeft": "剩少量",
        "noBikes": "目前無車",
        "fewDocks": "快滿",
        "noDocks": "車位已滿",
        "suspended": "暫停營運",
        "suspendedNote": "此站目前不提供借還車，不顯示車數。",
        "typeBreakdown": "2.0 ×{{yb2}} · 電輔 ×{{eyb}}",
        "meters": "{{n}} m",
        "km": "{{n}} km",
        "walkMinutes": "約 {{minutes}} 分",
        "walkFrom": "步行 {{distance}} · 約 {{minutes}} 分",
        "navigate": "步行導航",
        "navigateExternal": "Google 地圖 ↗",
        "navigateAria": "以 Google 地圖步行導航到 {{name}}（開啟新視窗）",
        "saveFav": "設為常用站",
        "removeFav": "取消常用站",
        "favorites": "常用站",
        "close": "關閉",
        "legendRent": "可借：",
        "legendReturn": "可還空位：",
        "legendMany": "3 以上",
        "legendFew": "1–2",
        "legendNoBikes": "無車",
        "legendNoDocks": "滿",
        "markerAria": "{{name}}，可借 {{bikes}} 台，可還 {{docks}} 位",
        "markerSuspendedAria": "{{name}}，暫停營運",
        "loading": "正在讀取附近的 YouBike 站點…",
        "noneNearby": "附近 {{distance}} 內沒有 YouBike 站點",
        "noneNearbyHint": "YouBike 目前在 14 個縣市地區營運。可以改用站名或地標搜尋。",
        "loadFailed": "YouBike 即時資料暫時無法取得",
        "loadFailedStale": "下方是 {{time}} 的資料，車數可能已經改變。",
        "retry": "重試",
        "needLocation": "尚未取得位置。開啟定位後，會改為依距離列出附近站點。",
        "locationDenied": "定位權限被拒，請在瀏覽器設定中允許",
        "locationFailed": "無法取得目前位置",
        "allAreas": "全部縣市",
        "results": "{{count}} 個站點",
        "noResults": "找不到符合「{{q}}」的站點",
        "foldHint": "「台」「臺」視為相同",
        "searching": "搜尋中…",
        "taipeiFallback": "全國資料暫時無法取得，目前只顯示臺北市站點。",
        "source": "資料來源：YouBike 官方即時資訊（約每分鐘更新）",
        "sourceTaipei": "資料來源：臺北市資料大平臺 YouBike 即時資訊",
        "mapLabel": "YouBike 站點地圖",
        "selected": "已選取",
        "backToNearby": "回到附近站點"
      }
    }
  },
  'en': {
    translation: {
      "app": {
        "title": "Taiwan Rail",
        "hsr": "THSR (HSR)",
        "tra": "TRA (Railway)",
        "bus": "Bus",
        "bike": "Bike",
        "oneWay": "One-way",
        "roundTrip": "Round-trip",
        "outbound": "Outbound",
        "return": "Return",
        "favorites": "Favorites",
        "watchlist": "Alerts",
        "origin": "Origin",
        "destination": "Destination",
        "search": "Search Trains",
        "queryThrottle": "You're searching a bit quickly — try again in a moment.",
        "editSearch": "Edit Search",
        "today": "Today",
        "tomorrow": "Tomorrow",
        "dayAfterTomorrow": "Day After",
        "filters": {
          "time": "Time",
          "fastest": "Fastest",
          "cheapest": "Cheapest",
          "reserved": "Reserved Only",
          "accessible": "Accessible"
        },
        "toasts": {
          "favAdded": "Added to favorites",
          "favRemoved": "Removed from favorites",
          "watchAdded": "Alerts enabled",
          "watchRemoved": "Alerts disabled",
          "langChanged": "Language changed to {{lang}}",
          "trainNotFoundInList": "Train not found in current results"
        },
        "results": {
          "found": "{{count}} trains found",
          "noResults": "No data",
          "noResultsDesc": "No train data for this trip right now. Try another date or stations, or try again later.",
          "noMatches": "No matching trains",
          "noMatchesDesc": "Nothing fits the current filters or today's remaining trains. Adjust the filters or pick another date.",
          "prev": "Prev",
          "next": "Next",
          "page": "Page {{current}} of {{total}}"
        },
        "train": {
          "duration": "{{hours}}h {{minutes}}m",
          "durationShort": "{{minutes}}m",
          "stops": "Stop Information",
          "onTime": "On Time",
          "delay": "Delayed {{minutes}} min",
          "fare": "Fare NT$ {{price}}"
        },
        "station": {
          "select": "Select Station",
          "searchPlaceholder": "Search stations..."
        }
      },
      "bike": {
        "title": "YouBike",
        "areas": "14 areas in Taiwan",
        "searchPlaceholder": "Search docks, addresses or places",
        "searchLabel": "Search YouBike docks",
        "clearSearch": "Clear search",
        "locate": "Use my location",
        "locating": "Locating…",
        "recenter": "Back to my location",
        "modeLabel": "I want to",
        "rent": "Rent",
        "return": "Return",
        "viewLabel": "View",
        "map": "Map",
        "list": "List",
        "nearHere": "Near you",
        "nearbyCount": "{{count}} docks nearby",
        "byDistance": "by distance",
        "live": "Live {{time}}",
        "staleBadge": "{{time}} · not live",
        "refresh": "Refresh",
        "searchArea": "Search this area",
        "nearestWithBikes": "Nearest with bikes",
        "nearestWithDocks": "Nearest free dock",
        "canRent": "Bikes",
        "canReturn": "Docks",
        "canReturnSpaces": "Free docks",
        "totalSpaces": "Total",
        "totalOf": "{{count}} docks total",
        "bikesUnit": "{{count}} bikes",
        "docksUnit": "{{count}} docks",
        "fewLeft": "Few left",
        "noBikes": "No bikes",
        "fewDocks": "Almost full",
        "noDocks": "Full",
        "suspended": "Out of service",
        "suspendedNote": "This dock is out of service; no counts are shown.",
        "typeBreakdown": "2.0 ×{{yb2}} · E-bike ×{{eyb}}",
        "meters": "{{n}} m",
        "km": "{{n}} km",
        "walkMinutes": "~{{minutes}} min",
        "walkFrom": "{{distance}} walk · ~{{minutes}} min",
        "navigate": "Walking directions",
        "navigateExternal": "Google Maps ↗",
        "navigateAria": "Walking directions to {{name}} in Google Maps (opens a new tab)",
        "saveFav": "Save dock",
        "removeFav": "Remove saved dock",
        "favorites": "Saved docks",
        "close": "Close",
        "legendRent": "Bikes:",
        "legendReturn": "Free docks:",
        "legendMany": "3+",
        "legendFew": "1–2",
        "legendNoBikes": "none",
        "legendNoDocks": "full",
        "markerAria": "{{name}}, {{bikes}} bikes, {{docks}} free docks",
        "markerSuspendedAria": "{{name}}, out of service",
        "loading": "Loading nearby YouBike docks…",
        "noneNearby": "No YouBike dock within {{distance}}",
        "noneNearbyHint": "YouBike runs in 14 areas of Taiwan. Try searching by dock name or place.",
        "loadFailed": "Live YouBike data is unavailable right now",
        "loadFailedStale": "Showing data from {{time}}; counts may have changed.",
        "retry": "Retry",
        "needLocation": "No location yet. Allow location to list docks near you by distance.",
        "locationDenied": "Location blocked — allow it in browser settings",
        "locationFailed": "Could not get your location",
        "allAreas": "All areas",
        "results": "{{count}} docks",
        "noResults": "No docks match “{{q}}”",
        "foldHint": "台 and 臺 match each other",
        "searching": "Searching…",
        "taipeiFallback": "Nationwide data is unavailable; showing Taipei City docks only.",
        "source": "Source: YouBike official live data (updated about every minute)",
        "sourceTaipei": "Source: Taipei City open data (YouBike live)",
        "mapLabel": "YouBike dock map",
        "selected": "Selected",
        "backToNearby": "Back to nearby docks"
      }
    }
  }
};

/**
 * Decide the initial UI language. Precedence:
 *   1. An explicit `/en` URL renders English; any other non-root path is a
 *      language-specific SEO/deep route, so it keeps the Chinese default.
 *   2. On the ambiguous root path, crawlers/prerender always get the canonical
 *      Chinese so indexing stays consistent with the hreflang/canonical setup.
 *   3. A previously saved manual choice (the 🌐 toggle) wins over auto-detection.
 *   4. Otherwise fall back to the device/browser locale — any Chinese variant
 *      (zh, zh-TW, zh-CN, zh-Hant, zh-Hans, …) → Chinese; everything else → English.
 */
function detectInitialLanguage(): 'en' | 'zh-TW' {
  if (typeof window === 'undefined') return 'zh-TW';

  const path = window.location.pathname;
  if (path === '/en' || path.startsWith('/en/')) return 'en';
  if (path !== '/' && path !== '') return 'zh-TW';

  // Root path: keep crawlers/prerender on the canonical Chinese page.
  const ua = navigator.userAgent || '';
  if (/bot|crawl|spider|prerender|lighthouse|headlesschrome/i.test(ua)) return 'zh-TW';

  try {
    const saved = localStorage.getItem('tw-lang');
    if (saved === 'en' || saved === 'zh-TW') return saved;
  } catch { /* localStorage unavailable */ }

  const langs = navigator.languages?.length ? navigator.languages : [navigator.language || ''];
  return langs.some((l) => l.toLowerCase().startsWith('zh')) ? 'zh-TW' : 'en';
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'zh-TW',
    lng: detectInitialLanguage(), // path → saved choice → device locale (see above)
    detection: {
      order: ['path', 'navigator'],
      lookupFromPathIndex: 0,
      caches: [],
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
