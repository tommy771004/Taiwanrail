import {
  BedDouble,
  ExternalLink,
  Luggage,
  Smartphone,
  Ticket,
  Wifi,
  type LucideIcon,
} from 'lucide-react';

type AffiliatePartner = {
  name: string;
  descriptionZh: string;
  descriptionEn: string;
  href: string;
  icon: LucideIcon;
  iconClassName: string;
};

export const AFFILIATE_PARTNERS: AffiliatePartner[] = [
  {
    name: 'KLOOK 客路',
    descriptionZh: '旅遊體驗與票券',
    descriptionEn: 'Tours and tickets',
    href: 'https://onelink.one/s/cSkPl',
    icon: Ticket,
    iconClassName: 'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300',
  },
  {
    name: 'KKday',
    descriptionZh: '旅遊體驗平台',
    descriptionEn: 'Travel experiences',
    href: 'https://afflink.one/s/YGj3a',
    icon: Ticket,
    iconClassName: 'bg-rose-100 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300',
  },
  {
    name: 'Agoda',
    descriptionZh: '大中華區訂房',
    descriptionEn: 'Hotel booking',
    href: 'https://onelink.one/s/xA7ag',
    icon: BedDouble,
    iconClassName: 'bg-blue-100 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300',
  },
  {
    name: 'Trip.com',
    descriptionZh: '旅宿與行程預訂',
    descriptionEn: 'Stays and activities',
    href: 'https://afflink.one/s/KuyA9',
    icon: BedDouble,
    iconClassName: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-400/15 dark:text-cyan-300',
  },
  {
    name: 'Lalalocker',
    descriptionZh: '臺灣行李寄放',
    descriptionEn: 'Luggage storage',
    href: 'https://linkgo.one/s/wB02q',
    icon: Luggage,
    iconClassName: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300',
  },
  {
    name: 'Airalo',
    descriptionZh: '旅遊 eSIM',
    descriptionEn: 'Travel eSIM',
    href: 'https://onelink.one/s/iwGsi',
    icon: Smartphone,
    iconClassName: 'bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300',
  },
  {
    name: '台灣租借 WiFi',
    descriptionZh: '行動網路分享器',
    descriptionEn: 'Pocket WiFi rental',
    href: 'https://onelink.one/s/LKEV1',
    icon: Wifi,
    iconClassName: 'bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300',
  },
  {
    name: 'AsiaYo',
    descriptionZh: '旅宿預訂',
    descriptionEn: 'Stay booking',
    href: 'https://onelink.one/s/QDzZS',
    icon: BedDouble,
    iconClassName: 'bg-teal-100 text-teal-700 dark:bg-teal-400/15 dark:text-teal-300',
  },
  {
    name: 'Easytravel 四方通行',
    descriptionZh: '臺灣旅宿',
    descriptionEn: 'Taiwan stays',
    href: 'https://afflink.one/s/nTKoo',
    icon: BedDouble,
    iconClassName: 'bg-orange-100 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300',
  },
];

type AffiliateMarqueeProps = {
  language?: string;
};

function PartnerLink({
  partner,
  isZh,
  duplicate = false,
}: {
  partner: AffiliatePartner;
  isZh: boolean;
  duplicate?: boolean;
}) {
  const Icon = partner.icon;

  return (
    <a
      href={partner.href}
      target="_blank"
      rel="sponsored noopener noreferrer"
      tabIndex={duplicate ? -1 : undefined}
      className="group flex h-[68px] w-[220px] shrink-0 items-center gap-3 rounded-lg border border-slate-200 bg-white px-3.5 text-left shadow-sm transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500 dark:hover:bg-slate-800"
      aria-label={`${partner.name}：${isZh ? partner.descriptionZh : partner.descriptionEn}`}
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${partner.iconClassName}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-slate-900 dark:text-slate-100">
          {partner.name}
        </span>
        <span className="mt-0.5 block truncate text-xs text-slate-600 dark:text-slate-400">
          {isZh ? partner.descriptionZh : partner.descriptionEn}
        </span>
      </span>
      <ExternalLink
        className="h-4 w-4 shrink-0 text-slate-400 transition-colors group-hover:text-slate-700 dark:group-hover:text-slate-200"
        aria-hidden="true"
      />
    </a>
  );
}

export default function AffiliateMarquee({ language = 'zh-TW' }: AffiliateMarqueeProps) {
  const isZh = language === 'zh-TW';

  return (
    <aside
      className="affiliate-marquee mx-4 mt-8 overflow-hidden rounded-lg border border-slate-200 bg-slate-100/80 py-3 dark:border-slate-700 dark:bg-slate-950/60 md:mx-0"
      aria-label={isZh ? '旅程服務合作連結' : 'Sponsored travel services'}
    >
      <div className="mb-3 flex items-center justify-between gap-4 px-4">
        <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
          {isZh ? '旅程服務' : 'Travel services'}
        </p>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          {isZh ? '合作連結' : 'Sponsored links'}
        </span>
      </div>

      <div className="affiliate-marquee-viewport soft-scrollbar overflow-hidden">
        <div className="affiliate-marquee-track">
          <div className="affiliate-marquee-group">
            {AFFILIATE_PARTNERS.map((partner) => (
              <PartnerLink key={partner.href} partner={partner} isZh={isZh} />
            ))}
          </div>
          <div className="affiliate-marquee-group" aria-hidden="true">
            {AFFILIATE_PARTNERS.map((partner) => (
              <PartnerLink
                key={`duplicate-${partner.href}`}
                partner={partner}
                isZh={isZh}
                duplicate
              />
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
