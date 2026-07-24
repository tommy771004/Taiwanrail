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
          "noResults": "未找到班次",
          "noResultsDesc": "請嘗試更換日期、交通工具或起訖車站",
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
      }
    }
  },
  'en': {
    translation: {
      "app": {
        "title": "Taiwan Rail",
        "hsr": "THSR (HSR)",
        "tra": "TRA (Railway)",
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
          "noResults": "No trains found",
          "noResultsDesc": "Try changing the date, transport, or stations.",
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
