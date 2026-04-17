import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const resources = {
  'zh-TW': {
    translation: {
      "app": {
        "title": "鐵道查詢",
        "hsr": "台灣高鐵",
        "tra": "台灣鐵路",
        "oneWay": "單程",
        "roundTrip": "來回",
        "outbound": "去程",
        "return": "回程",
        "favorites": "我的收藏",
        "watchlist": "班次提醒",
        "origin": "起點站",
        "destination": "終點站",
        "search": "搜尋班次",
        "editSearch": "編輯搜尋",
        "today": "今天",
        "tomorrow": "明天",
        "dayAfterTomorrow": "後天",
        "filters": {
          "time": "時間優先",
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
          "duration": "{{hours}}時{{minutes}}分",
          "durationShort": "{{minutes}}分",
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
        "editSearch": "Edit Search",
        "today": "Today",
        "tomorrow": "Tomorrow",
        "dayAfterTomorrow": "Day After",
        "filters": {
          "time": "Departure Time",
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

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'zh-TW',
    lng: 'zh-TW', // Default to zh-TW as requested
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;