/**
 * Static database for platform exit strategies (轉乘最速攻略)
 * Data based on official THSR/TRA station maps and commuter guides.
 */

export interface PlatformStrategyItem {
  target: string; // "MRT", "Bus", "Exit", etc.
  recommendCars: string;
  description: string;
  descriptionEn: string;
  /** Soft warning shown alongside the recommendation (eg crowding, business-only car). */
  warning?: string;
  /** Cars served by an accessible elevator at this stop, if known. */
  accessibleCars?: string;
}

export interface StationStrategy {
  stationId: string;
  name: string;
  /** Optional note about how the recommendations map to short vs long train sets. */
  trainTypeNotes?: string;
  strategies: PlatformStrategyItem[];
}

export const PLATFORM_STRATEGIES: Record<string, StationStrategy> = {
  // ==========================================
  // THSR Stations (標準 12 節編組，700T)
  // ==========================================
  "1000": { // Taipei (台北) - THSR
    stationId: "1000",
    name: "台北",
    strategies: [
      {
        target: "MRT Bannan Line",
        recommendCars: "9 - 11",
        description: "靠近南側出口，下樓即為板南線(藍線)轉乘區",
        descriptionEn: "Near South Exit, direct access to Bannan Line."
      },
      {
        target: "MRT Tamsui-Xinyi Line",
        recommendCars: "1 - 3",
        description: "靠近北側出口，步行至淡水信義線(紅線)最快",
        descriptionEn: "Near North Exit, fastest route to Tamsui-Xinyi Line."
      },
      {
        target: "TRA Transfer",
        recommendCars: "8 - 10",
        description: "中間連通層直接轉乘台鐵付費區",
        descriptionEn: "Connects directly to TRA platforms via middle floor."
      }
    ]
  },
  "0930": { // Banqiao (板橋) - THSR
    stationId: "0930",
    name: "板橋",
    strategies: [
      {
        target: "MRT / Global Mall",
        recommendCars: "8 - 10",
        description: "電扶梯直達 B1 轉乘大廳與環球購物中心",
        descriptionEn: "Escalators lead to B1 transfer hall and Global Mall."
      }
    ]
  },
  "0990": { // Taoyuan (桃園) - THSR
    stationId: "0990",
    name: "桃園",
    strategies: [
      {
        target: "Airport MRT",
        recommendCars: "1 - 3",
        warning: "注意：自由座車廂通常位於 10-12 車，若搭乘自由座且攜帶大型行李，下車後需步行較長距離穿越月台。",
        description: "靠近 1 號出口方向(北端)，連通機場捷運 A18 站最快",
        descriptionEn: "Follow Exit 1 (North) to Airport MRT A18 Station."
      }
    ]
  },
  "1040": { // Taichung (台中) - THSR
    stationId: "1040",
    name: "台中",
    strategies: [
      {
        target: "TRA Xinwuri / Taxi",
        recommendCars: "6 - 8",
        warning: "第 6 車為商務車廂，一般旅客無法穿越，請由 5 或 7 車進出。",
        description: "位於車站中心點，二樓出站即為台鐵新烏日站直行連通道",
        descriptionEn: "Central escalators to 2F, direct walkway to TRA Xinwuri station."
      }
    ]
  },
  "1030": { // Hsinchu (新竹) - THSR
    stationId: "1030",
    name: "新竹",
    strategies: [
      {
        target: "TRA Liujia Line",
        recommendCars: "6 - 8",
        description: "月台中央電扶梯下樓，出站步行即可抵達台鐵六家站",
        descriptionEn: "Central escalators lead directly to TRA Liujia Station walkway."
      }
    ]
  },
  "1060": { // Tainan (台南) - THSR
    stationId: "1060",
    name: "台南",
    strategies: [
      {
        target: "TRA Shalun Line",
        recommendCars: "6 - 8",
        description: "月台中央電扶梯下樓，出站步行約 3 分鐘抵達台鐵沙崙站",
        descriptionEn: "Central escalators lead to TRA Shalun Station (3 min walk)."
      }
    ]
  },
  "1070": { // Zuoying (左營) - THSR
    stationId: "1070",
    name: "左營",
    strategies: [
      {
        target: "MRT Red Line",
        recommendCars: "2 - 4",
        warning: "高捷紅線目前僅 3 節車廂編組，遇連假或大型活動散場時，轉乘月台極易壅塞，請預留等車時間。",
        description: "下樓往北側 2 號出口方向，即為高雄捷運左營站進站閘門",
        descriptionEn: "Follow Exit 2 (North) for quick KMRT Red Line access."
      }
    ]
  },

  // ==========================================
  // TRA Major Stations (動態編組，此處以 12 節基準映射)
  // ==========================================
  "1000-TRA": { // Taipei (台北) - TRA
    stationId: "1000-TRA",
    name: "台北 (台鐵)",
    trainTypeNotes: "台鐵列車編組長度不一(4~12節)，此推薦位置以長編組(12節)填滿月台為基準。短編組列車通常對齊月台中央。",
    strategies: [
      {
        target: "MRT Bannan Line",
        recommendCars: "10 - 12",
        accessibleCars: "8, 10",
        description: "靠近南側(長編組車尾)，有階梯與電扶梯直達捷運板南線",
        descriptionEn: "South end (Car 10-12) for stairs to Bannan Line."
      },
      {
        target: "MRT Tamsui-Xinyi Line",
        recommendCars: "1 - 3",
        description: "靠近北側，下樓前往淡水信義線最快",
        descriptionEn: "North end, fastest route to Tamsui-Xinyi Line."
      },
      {
        target: "High Speed Rail",
        recommendCars: "8 - 10",
        accessibleCars: "8",
        description: "月台中央連通層可直接刷卡轉乘高鐵付費區",
        descriptionEn: "Central transfer gate for direct HSR access."
      }
    ]
  },
  "3300": { // Taichung (台中) - TRA
    stationId: "3300",
    name: "台中",
    strategies: [
      {
        target: "Bus Station",
        recommendCars: "4 - 6",
        description: "大智路貫通後站動線，利用此區下行電扶梯前往台中轉運中心與大智路公車乘車處最快",
        descriptionEn: "Take escalators here to Dazhi Rd Exit for Taichung Bus Terminal."
      }
    ]
  },
  "4220": { // Kaohsiung (高雄) - TRA
    stationId: "4220",
    name: "高雄",
    strategies: [
      {
        target: "MRT Red Line",
        recommendCars: "6 - 8",
        warning: "高捷紅線目前僅 3 節車廂編組，尖峰時段大量台鐵人潮湧入時易造成捷運穿堂層回堵。",
        description: "中島月台中央區域向下，進入全新「一分鐘轉乘廊道」直達捷運層",
        descriptionEn: "Central area leads to the new 1-minute KMRT transfer corridor."
      }
    ]
  }
};

export function getStrategyForStation(stationId: string, transportType: 'hsr' | 'train'): StationStrategy | undefined {
  const key = transportType === 'train' && stationId === "1000" ? "1000-TRA" : stationId;
  return PLATFORM_STRATEGIES[key];
}
