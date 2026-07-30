/**
 * affiliateVisuals.ts
 * 把 affiliates 表的 `icon`（Material Symbols 名稱，規格 §3.1）對應到本專案在用的
 * lucide-react 圖示，並給每張卡片一個穩定的配色。
 *
 * 資料庫只存圖示**名稱**，樣式留在前端：維護端不需要知道 Tailwind class，
 * 也不會有把 class 或 HTML 寫進資料表的機會（規格 §8）。
 */

import {
  Backpack,
  BedDouble,
  Bus,
  Camera,
  Car,
  Compass,
  CreditCard,
  ExternalLink,
  Gift,
  Luggage,
  Map,
  Plane,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Store,
  Ticket,
  Train,
  TramFront,
  Truck,
  Umbrella,
  UtensilsCrossed,
  Wifi,
  type LucideIcon,
} from 'lucide-react';

/**
 * Material Symbols 名稱 → lucide 圖示。
 * 未列到的名稱（或 `icon` 為空）會用預設圖示，不會讓卡片壞掉。
 */
const ICON_MAP: Record<string, LucideIcon> = {
  confirmation_number: Ticket,
  local_activity: Ticket,
  local_play: Ticket,
  hotel: BedDouble,
  bed: BedDouble,
  night_shelter: BedDouble,
  luggage: Luggage,
  local_shipping: Truck,
  backpack: Backpack,
  sim_card: Smartphone,
  smartphone: Smartphone,
  wifi: Wifi,
  signal_wifi_4_bar: Wifi,
  train: Train,
  directions_train: Train,
  tram: TramFront,
  subway: TramFront,
  directions_bus: Bus,
  flight: Plane,
  directions_car: Car,
  car_rental: Car,
  restaurant: UtensilsCrossed,
  local_dining: UtensilsCrossed,
  shopping_cart: ShoppingCart,
  shopping_bag: ShoppingBag,
  storefront: Store,
  store: Store,
  credit_card: CreditCard,
  payments: CreditCard,
  redeem: Gift,
  card_giftcard: Gift,
  photo_camera: Camera,
  map: Map,
  explore: Compass,
  travel_explore: Compass,
  beach_access: Umbrella,
  auto_awesome: Sparkles,
  health_and_safety: ShieldCheck,
  verified_user: ShieldCheck,
};

const DEFAULT_ICON: LucideIcon = ExternalLink;

/** 取得檔位的圖示元件。 */
export function affiliateIcon(icon: string | null | undefined): LucideIcon {
  if (!icon) return DEFAULT_ICON;
  return ICON_MAP[icon.trim().toLowerCase()] ?? DEFAULT_ICON;
}

/** 配色盤（light / dark 皆有對比）。 */
const ICON_TONES = [
  'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300',
  'bg-blue-100 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300',
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-400/15 dark:text-cyan-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-400/15 dark:text-teal-300',
  'bg-orange-100 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300',
];

/**
 * 依 offer id 決定配色。用雜湊而不是陣列 index，
 * 這樣新增／停用檔位時其他卡片的顏色不會跟著換。
 */
export function affiliateIconTone(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 1_000_003;
  }
  return ICON_TONES[hash % ICON_TONES.length];
}
