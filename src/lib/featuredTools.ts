/**
 * The owner's other sites, listed under 「更多工具服務」 in the side menu. They are the
 * owner's own projects, not sponsored placements: no 贊助 label, no affiliate tracking.
 */
export type FeaturedToolIcon = 'leaf' | 'globe' | 'home' | 'compass';

export interface FeaturedTool {
  url: string;
  icon: FeaturedToolIcon;
  title: { zh: string; en: string };
  desc: { zh: string; en: string };
}

export const FEATURED_TOOLS: readonly FeaturedTool[] = [
  {
    url: 'https://tw-veggieprice.vercel.app/',
    icon: 'leaf',
    title: { zh: '蔬果價格查詢', en: 'Veggie Price Query' },
    desc: { zh: '每日市場行情與歷史價格圖表', en: 'Daily market prices with history charts' },
  },
  {
    url: 'https://rail-national.vercel.app/',
    icon: 'globe',
    title: { zh: '國際地鐵時刻查詢', en: 'International Metro Timetable' },
    desc: { zh: '全球城市地鐵路線與時刻', en: 'Metro routes and timetables worldwide' },
  },
  {
    url: 'https://tw-realestate-price.vercel.app/',
    icon: 'home',
    title: { zh: '實價登錄查詢', en: 'Taiwan Real Estate Prices' },
    desc: { zh: '租屋、土地、房價的實價登錄', en: 'Registered rent, land and home prices' },
  },
  {
    url: 'https://roam-jelly-web.vercel.app/',
    icon: 'compass',
    title: { zh: 'AI 旅遊行程規劃', en: 'AI Itinerary Planner' },
    desc: { zh: '依預算與喜好排出行程與交通', en: 'Trips planned around your budget and interests' },
  },
];
