import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { X, Clock, Navigation, CheckCircle, Flame, ArrowRight, Compass, ShieldAlert, Award } from 'lucide-react';

export interface TransferLineDetail {
  code: string;       // e.g. "BL", "R", "G", "BR", "O", "Y", "A", "LRT"
  name: string;       // e.g. "板南線"
  nameEn: string;     // e.g. "Bannan Line"
  color: string;      // Hex color e.g. "#0070bd"
  textColor: string;  // Text color tailwind e.g. "text-white"
}

export interface GuideStep {
  title: string;
  titleEn: string;
  desc: string;
  descEn: string;
}

export interface LayoutLevel {
  level: string; // e.g. "1F", "B1", "B2", "B3"
  title: string;
  titleEn: string;
  desc: string;
  descEn: string;
  highlight?: boolean;
}

export interface DetailedTransfer {
  id: string;
  stationName: string;
  line: TransferLineDetail;
  walkingTime: string;
  walkingTimeEn: string;
  difficulty: 'easy' | 'medium' | 'hard';
  recommendCars: string;
  recommendCarsEn: string;
  accessibleCars?: string;
  accessibleCarsEn?: string;
  warning?: string;
  warningEn?: string;
  steps: GuideStep[];
  levels: LayoutLevel[];
}

// Full interactive database for transfer platform guide maps.
export const DETAILED_TRANSFERS: Record<string, DetailedTransfer[]> = {
  '臺北': [
    {
      id: 'taipei-bl',
      stationName: '台北車站',
      line: { code: 'BL', name: '板南線', nameEn: 'Bannan Line', color: '#0070BD', textColor: 'text-white' },
      walkingTime: '1.5 分鐘 (90 秒)',
      walkingTimeEn: '1.5 mins (90s)',
      difficulty: 'easy',
      recommendCars: '9 - 11 車廂',
      recommendCarsEn: 'Cars 9 - 11',
      accessibleCars: '第 8、10 車廂旁電梯',
      accessibleCarsEn: 'Elevator near Cars 8, 10',
      steps: [
        {
          title: '往南側出口下樓',
          titleEn: 'Exit Southbound',
          desc: '從高鐵/台鐵 B2 月台下車後，步行至南側 (高鐵 9-11 車方向) 往地下三樓 (B3) 下行。',
          descEn: 'After alighting at B2 platform, head southbound (towards HSR Cars 9-11) and descend to B3.'
        },
        {
          title: '專用聯絡閘門直接互轉',
          titleEn: 'Direct Transfer Gates',
          desc: '下樓後即為 B3 三鐵專用轉乘閘門，直接刷悠遊卡、一卡通或感應票卡出高鐵並進捷運，免繞行地面層。',
          descEn: 'At B3, you will find direct transfer gates. Swipe your EasyCard/iPASS to exit HSR and enter MRT directly.'
        },
        {
          title: '搭乘電扶梯下行至板南線月台',
          titleEn: 'Descend to Bannan Platform',
          desc: '進入閘門後，順著藍色板南線 (BL) 指示牌，搭乘中島扶梯即可抵達 B4 板南線月台。',
          descEn: 'Follow the blue Bannan Line (BL) signs and take the escalators down to the B4 platform.'
        }
      ],
      levels: [
        { level: 'B2F', title: '高鐵 / 台鐵月台', titleEn: 'HSR / TRA Platforms', desc: '下車位置，建議在 9-11 節車廂下車', descEn: 'Alighting level, recommend Cars 9-11' },
        { level: 'B3F', title: '三鐵共構專用轉乘閘門', titleEn: 'Direct Transfer Hall', desc: '直達閘門，刷卡直接互轉，無需經過大廳', descEn: 'Direct transfer gates, swipe and cross directly', highlight: true },
        { level: 'B4F', title: '捷運板南線 (藍線) 月台', titleEn: 'MRT Bannan Line Platform', desc: '捷運乘車層，前往南港或板橋方向', descEn: 'MRT platform level for Nangang or Banqiao' }
      ]
    },
    {
      id: 'taipei-r',
      stationName: '台北車站',
      line: { code: 'R', name: '淡水信義線', nameEn: 'Tamsui-Xinyi Line', color: '#E3002C', textColor: 'text-white' },
      walkingTime: '2 分鐘 (120 秒)',
      walkingTimeEn: '2 mins (120s)',
      difficulty: 'easy',
      recommendCars: '1 - 3 車廂',
      recommendCarsEn: 'Cars 1 - 3',
      accessibleCars: '第 8 車廂旁無障礙電梯',
      accessibleCarsEn: 'Elevator near Car 8',
      steps: [
        {
          title: '往北側出口下樓',
          titleEn: 'Exit Northbound',
          desc: '從高鐵/台鐵 B2 月台下車後，步行至北側 (高鐵 1-3 車方向) 往地下三樓 (B3) 下行。',
          descEn: 'After alighting at B2 platform, head northbound (towards HSR Cars 1-3) and descend to B3.'
        },
        {
          title: '通過北側專用轉乘閘門',
          titleEn: 'North Transfer Gates',
          desc: '於 B3 北側直連閘門刷卡出站，可省去穿過擁擠南側大廳的時間。',
          descEn: 'Swipe out through the B3 North direct gates, saving time by bypassing the crowded South hall.'
        },
        {
          title: '下行至淡水信義線月台',
          titleEn: 'Descend to Tamsui-Xinyi Platform',
          desc: '順著紅色淡水信義線 (R) 指示方向下行，即可抵達 B4 捷運紅線月台。',
          descEn: 'Follow red Tamsui-Xinyi Line (R) signs down to the B4 red line platform.'
        }
      ],
      levels: [
        { level: 'B2F', title: '高鐵 / 台鐵月台', titleEn: 'HSR / TRA Platforms', desc: '建議靠北側 1-3 車廂處下車，最靠近電扶梯', descEn: 'Alight at Cars 1-3 for closest escalator access' },
        { level: 'B3F', title: '北側穿堂與直連轉乘閘門', titleEn: 'North Transfer Concourse', desc: '人潮較少，刷卡即通往紅線區域', descEn: 'Less crowded concourse, instant access to Red line', highlight: true },
        { level: 'B4F', title: '捷運淡水信義線 (紅線) 月台', titleEn: 'MRT Tamsui-Xinyi Line Platform', desc: '捷運乘車層，前往象山或淡水方向', descEn: 'MRT platform level for Xiangshan or Tamsui' }
      ]
    }
  ],
  '台北': [
    {
      id: 'taipei-bl-alt',
      stationName: '台北車站',
      line: { code: 'BL', name: '板南線', nameEn: 'Bannan Line', color: '#0070BD', textColor: 'text-white' },
      walkingTime: '1.5 分鐘 (90 秒)',
      walkingTimeEn: '1.5 mins (90s)',
      difficulty: 'easy',
      recommendCars: '9 - 11 車廂',
      recommendCarsEn: 'Cars 9 - 11',
      accessibleCars: '第 8、10 車廂旁電梯',
      accessibleCarsEn: 'Elevator near Cars 8, 10',
      steps: [
        {
          title: '往南側出口下樓',
          titleEn: 'Exit Southbound',
          desc: '從高鐵/台鐵 B2 月台下車後，步行至南側 (高鐵 9-11 車方向) 往地下三樓 (B3) 下行。',
          descEn: 'After alighting at B2 platform, head southbound (towards HSR Cars 9-11) and descend to B3.'
        },
        {
          title: '專用聯絡閘門直接互轉',
          titleEn: 'Direct Transfer Gates',
          desc: '下樓後即為 B3 三鐵專用轉乘閘門，直接刷悠遊卡、一卡通或感應票卡出高鐵並進捷運，免繞行地面層。',
          descEn: 'At B3, you will find direct transfer gates. Swipe your EasyCard/iPASS to exit HSR and enter MRT directly.'
        },
        {
          title: '搭乘電扶梯下行至板南線月台',
          titleEn: 'Descend to Bannan Platform',
          desc: '進入閘門後，順著藍色板南線 (BL) 指示牌，搭乘中島扶梯即可抵達 B4 板南線月台。',
          descEn: 'Follow the blue Bannan Line (BL) signs and take the escalators down to the B4 platform.'
        }
      ],
      levels: [
        { level: 'B2F', title: '高鐵 / 台鐵月台', titleEn: 'HSR / TRA Platforms', desc: '下車位置，建議在 9-11 節車廂下車', descEn: 'Alighting level, recommend Cars 9-11' },
        { level: 'B3F', title: '三鐵共構專用轉乘閘門', titleEn: 'Direct Transfer Hall', desc: '直達閘門，刷卡直接互轉，無需經過大廳', descEn: 'Direct transfer gates, swipe and cross directly', highlight: true },
        { level: 'B4F', title: '捷運板南線 (藍線) 月台', titleEn: 'MRT Bannan Line Platform', desc: '捷運乘車層，前往南港或板橋方向', descEn: 'MRT platform level for Nangang or Banqiao' }
      ]
    },
    {
      id: 'taipei-r-alt',
      stationName: '台北車站',
      line: { code: 'R', name: '淡水信義線', nameEn: 'Tamsui-Xinyi Line', color: '#E3002C', textColor: 'text-white' },
      walkingTime: '2 分鐘 (120 秒)',
      walkingTimeEn: '2 mins (120s)',
      difficulty: 'easy',
      recommendCars: '1 - 3 車廂',
      recommendCarsEn: 'Cars 1 - 3',
      accessibleCars: '第 8 車廂旁無障礙電梯',
      accessibleCarsEn: 'Elevator near Car 8',
      steps: [
        {
          title: '往北側出口下樓',
          titleEn: 'Exit Northbound',
          desc: '從高鐵/台鐵 B2 月台下車後，步行至北側 (高鐵 1-3 車方向) 往地下三樓 (B3) 下行。',
          descEn: 'After alighting at B2 platform, head northbound (towards HSR Cars 1-3) and descend to B3.'
        },
        {
          title: '通過北側專用轉乘閘門',
          titleEn: 'North Transfer Gates',
          desc: '於 B3 北側直連閘門刷卡出站，可省去穿過擁擠南側大廳的時間。',
          descEn: 'Swipe out through the B3 North direct gates, saving time by bypassing the crowded South hall.'
        },
        {
          title: '下行至淡水信義線月台',
          titleEn: 'Descend to Tamsui-Xinyi Platform',
          desc: '順著紅色淡水信義線 (R) 指示方向下行，即可抵達 B4 捷運紅線月台。',
          descEn: 'Follow red Tamsui-Xinyi Line (R) signs down to the B4 red line platform.'
        }
      ],
      levels: [
        { level: 'B2F', title: '高鐵 / 台鐵月台', titleEn: 'HSR / TRA Platforms', desc: '建議靠北側 1-3 車廂處下車，最靠近電扶梯', descEn: 'Alight at Cars 1-3 for closest escalator access' },
        { level: 'B3F', title: '北側穿堂與直連轉乘閘門', titleEn: 'North Transfer Concourse', desc: '人潮較少，刷卡即通往紅線區域', descEn: 'Less crowded concourse, instant access to Red line', highlight: true },
        { level: 'B4F', title: '捷運淡水信義線 (紅線) 月台', titleEn: 'MRT Tamsui-Xinyi Line Platform', desc: '捷運乘車層，前往象山或淡水方向', descEn: 'MRT platform level for Xiangshan or Tamsui' }
      ]
    }
  ],
  '南港': [
    {
      id: 'nangang-bl',
      stationName: '南港車站',
      line: { code: 'BL', name: '板南線', nameEn: 'Bannan Line', color: '#0070BD', textColor: 'text-white' },
      walkingTime: '1 分鐘 (60 秒)',
      walkingTimeEn: '1 min (60s)',
      difficulty: 'easy',
      recommendCars: '6 - 8 車廂',
      recommendCarsEn: 'Cars 6 - 8',
      steps: [
        {
          title: '上行至 B1 剪票出口',
          titleEn: 'Ascend to B1 Exit',
          desc: '高鐵或台鐵下車後，搭乘月台中央的電扶梯往上至地下一樓 (B1) 穿堂大廳並刷卡出站。',
          descEn: 'After alighting, take the central escalator up to B1 concourse and exit through HSR/TRA gates.'
        },
        {
          title: '直行地下連絡通道',
          titleEn: 'Straight through Passage',
          desc: '出站後，往捷運板南線 (BL) 指標前進，步行僅約 50 公尺地下通道即可抵達捷運南港站入閘口。',
          descEn: 'After exiting, follow Bannan Line (BL) signs through a 50m underground walkway to the MRT entrance.'
        }
      ],
      levels: [
        { level: 'B2F', title: '高鐵 / 台鐵月台', titleEn: 'HSR / TRA Platforms', desc: '下車層，建議在中段 6-8 車廂附近搭乘扶梯上樓', descEn: 'Take central escalators up from Cars 6-8' },
        { level: 'B1F', title: 'B1 聯絡大廳與地下連通道', titleEn: 'B1 Concourse & Passage', desc: '刷卡出站並直接穿越地下連絡道直通捷運站', descEn: 'Exit and walk 50m to MRT gates', highlight: true },
        { level: 'B2F-M', title: '捷運板南線南港站閘門', titleEn: 'MRT Nangang Station Gates', desc: '捷運入站層與月台', descEn: 'MRT concourse and platform level' }
      ]
    },
    {
      id: 'nangang-br',
      stationName: '南港車站',
      line: { code: 'BR', name: '文湖線', nameEn: 'Wenhu Line', color: '#9E652E', textColor: 'text-white' },
      walkingTime: '6 分鐘',
      walkingTimeEn: '6 mins',
      difficulty: 'hard',
      recommendCars: '1 - 3 車廂',
      recommendCarsEn: 'Cars 1 - 3',
      warning: '文湖線為高架車站，高鐵為地下車站，兩者垂直落差極大，且需穿過南港展覽館或步行至南港展覽館站轉乘最快。',
      warningEn: 'Wenhu Line is elevated while HSR is underground. The level change is steep, and walking to Nangang Exhibition Center station is highly advised.',
      steps: [
        {
          title: '上行至 B1 穿堂並出站',
          titleEn: 'Ascend to B1 & Exit',
          desc: '下車後，由月台前段扶梯上樓，刷卡離開高鐵付費區。',
          descEn: 'Alight, take front escalators to B1, and exit the gates.'
        },
        {
          title: '轉乘板南線搭乘一站',
          titleEn: 'Take MRT Bannan Line 1 Stop',
          desc: '最輕鬆的方式是先進入捷運南港站，搭乘板南線往東「南港展覽館方向」僅 1 站，在終點站轉乘文湖線 (高架層)。',
          descEn: 'The easiest way is to enter MRT Bannan Line, travel 1 stop eastbound to Nangang Exhibition Center, and transfer there.'
        }
      ],
      levels: [
        { level: 'B2F', title: '高鐵 / 台鐵月台', titleEn: 'HSR / TRA Platforms', desc: '地下月台層', descEn: 'Underground platform' },
        { level: 'B1F', title: '聯絡穿堂', titleEn: 'B1 Concourse', desc: '轉乘捷運板南線往南港展覽館', descEn: 'Transfer to Bannan Line towards Exhibition Center' },
        { level: '3F', title: '捷運文湖線高架月台 (南港展覽館)', titleEn: 'MRT Wenhu Line Platform', desc: '高架乘車層，前往科技大樓、動物園方向', descEn: 'Elevated platform for Technology Building, Zoo' }
      ]
    }
  ],
  '板橋': [
    {
      id: 'banqiao-bl',
      stationName: '板橋車站',
      line: { code: 'BL', name: '板南線', nameEn: 'Bannan Line', color: '#0070BD', textColor: 'text-white' },
      walkingTime: '2 分鐘 (120 秒)',
      walkingTimeEn: '2 mins (120s)',
      difficulty: 'easy',
      recommendCars: '8 - 10 車廂',
      recommendCarsEn: 'Cars 8 - 10',
      accessibleCars: '第 8 車廂旁無障礙電梯',
      accessibleCarsEn: 'Elevator near Car 8',
      steps: [
        {
          title: '搭乘扶梯直達 B1',
          titleEn: 'Ascend to B1',
          desc: '高鐵月台位於 B2，建議由第 8-10 車處，搭乘中央電扶梯直接上行至 B1 穿堂大廳。',
          descEn: 'Alight at B2, take the central escalators near Cars 8-10 up to B1 Concourse.'
        },
        {
          title: '往東側出站',
          titleEn: 'Exit East Gate',
          desc: '向東剪票口方向出站，出站後左轉，順著藍色板南線指標直行地下街。',
          descEn: 'Exit through the East Gates, turn left, and follow blue Bannan Line signs along the basement passageway.'
        },
        {
          title: '進入捷運板橋站閘門',
          titleEn: 'Enter MRT Banqiao Gates',
          desc: '步行約 60 公尺即抵達捷運板南線進站閘門，搭電扶梯向下即可乘車。',
          descEn: 'Walk 60m to MRT Banqiao gates and take the escalators down to the platform.'
        }
      ],
      levels: [
        { level: 'B2F', title: '高鐵 / 台鐵月台', titleEn: 'HSR / TRA Platforms', desc: '地下二樓，建議 8-10 車廂下車', descEn: 'B2 level, alight near Cars 8-10' },
        { level: 'B1F', title: 'B1 轉乘大廳與商場', titleEn: 'B1 Concourse & Mall', desc: '三鐵連通核心層，設有多家美食街與捷運連通道', descEn: 'Interchange core, mall, and direct walkway', highlight: true },
        { level: 'B2F-M', title: '捷運板南線月台', titleEn: 'MRT Bannan Line Platform', desc: '捷運乘車層，前往台北或土城方向', descEn: 'MRT platform level for Taipei or Tucheng' }
      ]
    },
    {
      id: 'banqiao-y',
      stationName: '板橋車站',
      line: { code: 'Y', name: '環狀線', nameEn: 'Circular Line', color: '#FFDF00', textColor: 'text-slate-800' },
      walkingTime: '5 分鐘 (300 秒)',
      walkingTimeEn: '5 mins (300s)',
      difficulty: 'medium',
      recommendCars: '1 - 3 車廂',
      recommendCarsEn: 'Cars 1 - 3',
      steps: [
        {
          title: '搭電扶梯上行至 1F 大廳',
          titleEn: 'Ascend to 1F Lobby',
          desc: '高鐵下車後，搭乘扶梯一路上行穿過 B1，直達地上一樓 (1F) 車站大廳。',
          descEn: 'After alighting, take escalators up through B1 directly to the 1F Main Station Lobby.'
        },
        {
          title: '從西側 1 號出口出站',
          titleEn: 'Exit via West Exit 1',
          desc: '由車站大廳西側 (板橋客運站方向) 走出 1 號出口，前方即為環狀線高架站體。',
          descEn: 'Head to the west side of the lobby, exit via Exit 1, and the elevated Circular Line station is right in front.'
        },
        {
          title: '乘長扶梯上行至 3F 月台',
          titleEn: 'Escalator to 3F Platform',
          desc: '穿過站外天橋，搭乘連續電扶梯上行至 3 樓環狀線進站閘門與月台。',
          descEn: 'Cross the skybridge and take the escalators up to the 3F Circular Line concourse and platforms.'
        }
      ],
      levels: [
        { level: 'B2F', title: '高鐵 / 台鐵月台', titleEn: 'HSR / TRA Platforms', desc: '地下二樓月台', descEn: 'Underground platform' },
        { level: '1F', title: '一樓車站大廳 (西側出口)', titleEn: '1F Station Lobby (West)', desc: '走出大廳，銜接站外行人跨街廣場', descEn: 'Walk outside to the pedestrian plaza' },
        { level: '3F', title: '捷運環狀線高架月台', titleEn: 'MRT Circular Line Platform', desc: '高架車站，前往新莊或中和方向', descEn: 'Elevated platform for Xinzhuang or Zhonghe', highlight: true }
      ]
    }
  ],
  '松山': [
    {
      id: 'songshan-g',
      stationName: '松山車站',
      line: { code: 'G', name: '松山新店線', nameEn: 'Songshan-Xindian Line', color: '#008659', textColor: 'text-white' },
      walkingTime: '2 分鐘 (120 秒)',
      walkingTimeEn: '2 mins (120s)',
      difficulty: 'easy',
      recommendCars: '中後段車廂',
      recommendCarsEn: 'Middle/Rear Cars',
      steps: [
        {
          title: '上行至地下一樓 B1 穿堂',
          titleEn: 'Ascend to B1 Concourse',
          desc: '台鐵下車後，搭乘扶梯上行至 B1 穿堂層，朝西側剪票口方向前進。',
          descEn: 'Alight from TRA, take escalators to B1, and head toward the West gates.'
        },
        {
          title: '通過地下直連通道',
          titleEn: 'Underground Corridor',
          desc: '刷卡出站後，前方即為寬敞的地下連絡道，直行步行 80 公尺即可直接進入捷運松山站閘門。',
          descEn: 'Exit the TRA gates, follow the wide underground corridor 80m straight into MRT Songshan Station.'
        }
      ],
      levels: [
        { level: 'B2F', title: '台鐵地下月台', titleEn: 'TRA Platform', desc: '搭乘扶梯上樓', descEn: 'Take escalators up' },
        { level: 'B1F', title: '台鐵剪票大廳與捷運連通道', titleEn: 'TRA Gates & Interchange Passage', desc: '直連剪票口，無雨乾爽通道', descEn: 'Dry, direct underground walkway', highlight: true },
        { level: 'B2F-M', title: '捷運松山新店線月台', titleEn: 'MRT Songshan-Xindian Platform', desc: '捷運起點站，可直接上車免等候', descEn: 'Terminal station, board directly with plenty of seats' }
      ]
    }
  ],
  '桃園': [
    {
      id: 'taoyuan-a',
      stationName: '高鐵桃園站',
      line: { code: 'A', name: '機場捷運', nameEn: 'Airport MRT', color: '#8452A1', textColor: 'text-white' },
      walkingTime: '2 分鐘 (120 秒)',
      walkingTimeEn: '2 mins (120s)',
      difficulty: 'easy',
      recommendCars: '1 - 3 車廂 (靠北側)',
      recommendCarsEn: 'Cars 1 - 3 (North End)',
      accessibleCars: '第 1 車廂旁電梯',
      accessibleCarsEn: 'Elevator near Car 1',
      warning: '自由座車廂通常在 10-12 車。若搭乘自由座且攜帶大型行李，下車後需前行較長距離穿過月台。',
      warningEn: 'Non-reserved seats are in Cars 10-12. If carrying heavy luggage, you must walk a long distance along the platform to reach the north exits.',
      steps: [
        {
          title: '上行至一樓大廳',
          titleEn: 'Ascend to 1F Lobby',
          desc: '由月台前段 (1-3車) 搭乘電扶梯上行至一樓大廳，朝「1號出口」方向前進並出站。',
          descEn: 'Alight at North end (Cars 1-3), take escalators to 1F, and head to Exit 1.'
        },
        {
          title: '遮雨行人天橋直達',
          titleEn: 'Rain-sheltered Walkway',
          desc: '走出 1 號出口，順著遮雨走廊前行約 50 公尺，搭乘扶梯往上即為機場捷運 A18 高鐵桃園站大廳。',
          descEn: 'Walk through Exit 1, follow the rain-sheltered bridge 50m, and take the escalator up to the Airport MRT A18 lobby.'
        }
      ],
      levels: [
        { level: 'B2F', title: '高鐵月台層', titleEn: 'HSR Platform', desc: '地下二樓月台，建議往前段 1-3 車廂移動', descEn: 'B2 underground level, head towards Cars 1-3' },
        { level: '1F', title: '高鐵大廳與 1 號出口', titleEn: 'HSR Lobby & Exit 1', desc: '設有售票與旅遊服務，走出遮雨廊道直達對面', descEn: 'Lobby level, follow sheltered corridor outside' },
        { level: '2F', title: '機場捷運 A18 站體', titleEn: 'Airport MRT A18 Station', desc: '高架閘門與月台，可直達桃園機場或台北', descEn: 'Elevated gates and platforms for Airport or Taipei', highlight: true }
      ]
    }
  ],
  '高鐵桃園': [
    {
      id: 'taoyuan-a-alt',
      stationName: '高鐵桃園站',
      line: { code: 'A', name: '機場捷運', nameEn: 'Airport MRT', color: '#8452A1', textColor: 'text-white' },
      walkingTime: '2 分鐘 (120 秒)',
      walkingTimeEn: '2 mins (120s)',
      difficulty: 'easy',
      recommendCars: '1 - 3 車廂 (靠北側)',
      recommendCarsEn: 'Cars 1 - 3 (North End)',
      accessibleCars: '第 1 車廂旁電梯',
      accessibleCarsEn: 'Elevator near Car 1',
      warning: '自由座車廂通常在 10-12 車。若搭乘自由座且攜帶大型行李，下車後需前行較長距離穿過月台。',
      warningEn: 'Non-reserved seats are in Cars 10-12. If carrying heavy luggage, you must walk a long distance along the platform to reach the north exits.',
      steps: [
        {
          title: '上行至一樓大廳',
          titleEn: 'Ascend to 1F Lobby',
          desc: '由月台前段 (1-3車) 搭乘電扶梯上行至一樓大廳，朝「1號出口」方向前進並出站。',
          descEn: 'Alight at North end (Cars 1-3), take escalators to 1F, and head to Exit 1.'
        },
        {
          title: '遮雨行人天橋直達',
          titleEn: 'Rain-sheltered Walkway',
          desc: '走出 1 號出口，順著遮雨走廊前行約 50 公尺，搭乘扶梯往上即為機場捷運 A18 高鐵桃園站大廳。',
          descEn: 'Walk through Exit 1, follow the rain-sheltered bridge 50m, and take the escalator up to the Airport MRT A18 lobby.'
        }
      ],
      levels: [
        { level: 'B2F', title: '高鐵月台層', titleEn: 'HSR Platform', desc: '地下二樓月台，建議往前段 1-3 車廂移動', descEn: 'B2 underground level, head towards Cars 1-3' },
        { level: '1F', title: '高鐵大廳與 1 號出口', titleEn: 'HSR Lobby & Exit 1', desc: '設有售票與旅遊服務，走出遮雨廊道直達對面', descEn: 'Lobby level, follow sheltered corridor outside' },
        { level: '2F', title: '機場捷運 A18 站體', titleEn: 'Airport MRT A18 Station', desc: '高架閘門與月台，可直達桃園機場或台北', descEn: 'Elevated gates and platforms for Airport or Taipei', highlight: true }
      ]
    }
  ],
  '新烏日': [
    {
      id: 'xinwuri-tc',
      stationName: '新烏日車站',
      line: { code: 'TML', name: '中捷綠線', nameEn: 'TC MRT Green', color: '#8EC31C', textColor: 'text-slate-800' },
      walkingTime: '3 分鐘 (180 秒)',
      walkingTimeEn: '3 mins (180s)',
      difficulty: 'easy',
      recommendCars: '6 - 8 車廂',
      recommendCarsEn: 'Cars 6 - 8',
      warning: '第 6 車為高鐵商務車廂，一般旅客無法於車內穿越，請改由 5 或 7 車進出車廂。',
      warningEn: 'Car 6 is HSR Business Class; non-business passengers cannot walk through. Use Car 5 or 7 instead.',
      steps: [
        {
          title: '下行至高鐵 2F 穿堂大廳',
          titleEn: 'Descend to 2F Concourse',
          desc: '高鐵月台位於高架 3F，下車後搭電扶梯下行至 2F 穿堂大廳，往「3號出口」臺鐵通廊方向前進。',
          descEn: 'HSR platforms are on elevated 3F. Take escalators down to the 2F concourse and head toward Exit 3 (TRA walkway).'
        },
        {
          title: '穿越三鐵共構連通廊道',
          titleEn: 'Through the Interchange Walkway',
          desc: '由 3 號出口進入高鐵、台鐵、中捷三鐵共構之 2F 室內連通廊道，全程遮風避雨，直行穿越台鐵新烏日站大廳。',
          descEn: 'Enter the covered 2F indoor walkway linking HSR, TRA, and MRT, and walk straight through the TRA Xinwuri hall.'
        },
        {
          title: '抵達捷運「高鐵台中站」',
          titleEn: 'Arrive at MRT Station',
          desc: '順著 2F 連通廊道即可直達台中捷運綠線「高鐵台中站」進站閘門。',
          descEn: 'Follow the 2F walkway directly to the Taichung MRT Green Line gates at HSR Taichung Station.'
        }
      ],
      levels: [
        { level: '3F', title: '高鐵高架月台', titleEn: 'HSR Elevated Platform', desc: '月台層 (高架)，推薦在高鐵中段 6-8 車下車', descEn: 'Elevated platform level, recommend central Cars 6-8' },
        { level: '2F', title: '三鐵共構穿堂與連通廊道', titleEn: 'Interchange Concourse & Walkway', desc: '核心連通層，串接高鐵大廳、台鐵新烏日站與中捷', descEn: 'Core level linking HSR lobby, TRA Xinwuri, and MRT', highlight: true },
        { level: '3F', title: '台中捷運綠線高鐵台中站月台', titleEn: 'Taichung Metro Green Line Platform', desc: '高架車站，往北屯總站或市區方向', descEn: 'Elevated station for Beitun or Downtown' }
      ]
    }
  ],
  '臺中': [
    {
      id: 'taichung-tc',
      stationName: '台中車站 (新烏日)',
      line: { code: 'TML', name: '中捷綠線', nameEn: 'TC MRT Green', color: '#8EC31C', textColor: 'text-slate-800' },
      walkingTime: '3 分鐘 (180 秒)',
      walkingTimeEn: '3 mins (180s)',
      difficulty: 'easy',
      recommendCars: '6 - 8 車廂',
      recommendCarsEn: 'Cars 6 - 8',
      steps: [
        {
          title: '下行至高鐵 2F 穿堂大廳',
          titleEn: 'Descend to 2F Concourse',
          desc: '高鐵月台位於高架 3F，下車後搭電扶梯下行至 2F 穿堂大廳，往「3號出口」臺鐵通廊方向前進。',
          descEn: 'HSR platforms are on elevated 3F. Take escalators down to the 2F concourse and head toward Exit 3 (TRA walkway).'
        },
        {
          title: '穿越三鐵共構連通廊道',
          titleEn: 'Through the Interchange Walkway',
          desc: '由 3 號出口進入高鐵、台鐵、中捷三鐵共構之 2F 室內連通廊道，全程遮風避雨，直行穿越台鐵新烏日站大廳。',
          descEn: 'Enter the covered 2F indoor walkway linking HSR, TRA, and MRT, and walk straight through the TRA Xinwuri hall.'
        },
        {
          title: '抵達捷運「高鐵台中站」',
          titleEn: 'Arrive at MRT Station',
          desc: '順著 2F 連通廊道即可直達台中捷運綠線「高鐵台中站」進站閘門。',
          descEn: 'Follow the 2F walkway directly to the Taichung MRT Green Line gates at HSR Taichung Station.'
        }
      ],
      levels: [
        { level: '3F', title: '高鐵高架月台', titleEn: 'HSR Elevated Platform', desc: '月台層 (高架)，推薦在高鐵中段 6-8 車下車', descEn: 'Elevated platform level, recommend central Cars 6-8' },
        { level: '2F', title: '三鐵共構穿堂與連通廊道', titleEn: 'Interchange Concourse & Walkway', desc: '核心連通層，串接高鐵大廳、台鐵新烏日站與中捷', descEn: 'Core level linking HSR lobby, TRA Xinwuri, and MRT', highlight: true },
        { level: '3F', title: '台中捷運綠線高鐵台中站月台', titleEn: 'Taichung Metro Green Line Platform', desc: '高架車站，往北屯總站或市區方向', descEn: 'Elevated station for Beitun or Downtown' }
      ]
    }
  ],
  '台中': [
    {
      id: 'taichung-tc-alt',
      stationName: '台中車站 (新烏日)',
      line: { code: 'TML', name: '中捷綠線', nameEn: 'TC MRT Green', color: '#8EC31C', textColor: 'text-slate-800' },
      walkingTime: '3 分鐘 (180 秒)',
      walkingTimeEn: '3 mins (180s)',
      difficulty: 'easy',
      recommendCars: '6 - 8 車廂',
      recommendCarsEn: 'Cars 6 - 8',
      steps: [
        {
          title: '下行至高鐵 2F 穿堂大廳',
          titleEn: 'Descend to 2F Concourse',
          desc: '高鐵月台位於高架 3F，下車後搭電扶梯下行至 2F 穿堂大廳，往「3號出口」臺鐵通廊方向前進。',
          descEn: 'HSR platforms are on elevated 3F. Take escalators down to the 2F concourse and head toward Exit 3 (TRA walkway).'
        },
        {
          title: '穿越三鐵共構連通廊道',
          titleEn: 'Through the Interchange Walkway',
          desc: '由 3 號出口進入高鐵、台鐵、中捷三鐵共構之 2F 室內連通廊道，全程遮風避雨，直行穿越台鐵新烏日站大廳。',
          descEn: 'Enter the covered 2F indoor walkway linking HSR, TRA, and MRT, and walk straight through the TRA Xinwuri hall.'
        },
        {
          title: '抵達捷運「高鐵台中站」',
          titleEn: 'Arrive at MRT Station',
          desc: '順著 2F 連通廊道即可直達台中捷運綠線「高鐵台中站」進站閘門。',
          descEn: 'Follow the 2F walkway directly to the Taichung MRT Green Line gates at HSR Taichung Station.'
        }
      ],
      levels: [
        { level: '3F', title: '高鐵高架月台', titleEn: 'HSR Elevated Platform', desc: '月台層 (高架)，推薦在高鐵中段 6-8 車下車', descEn: 'Elevated platform level, recommend central Cars 6-8' },
        { level: '2F', title: '三鐵共構穿堂與連通廊道', titleEn: 'Interchange Concourse & Walkway', desc: '核心連通層，串接高鐵大廳、台鐵新烏日站與中捷', descEn: 'Core level linking HSR lobby, TRA Xinwuri, and MRT', highlight: true },
        { level: '3F', title: '台中捷運綠線高鐵台中站月台', titleEn: 'Taichung Metro Green Line Platform', desc: '高架車站，往北屯總站或市區方向', descEn: 'Elevated station for Beitun or Downtown' }
      ]
    }
  ],
  '高鐵臺中': [
    {
      id: 'taichung-tc-alt2',
      stationName: '高鐵台中站',
      line: { code: 'TML', name: '中捷綠線', nameEn: 'TC MRT Green', color: '#8EC31C', textColor: 'text-slate-800' },
      walkingTime: '3 分鐘 (180 秒)',
      walkingTimeEn: '3 mins (180s)',
      difficulty: 'easy',
      recommendCars: '6 - 8 車廂',
      recommendCarsEn: 'Cars 6 - 8',
      steps: [
        {
          title: '下行至高鐵 2F 穿堂大廳',
          titleEn: 'Descend to 2F Concourse',
          desc: '高鐵月台位於高架 3F，下車後搭電扶梯下行至 2F 穿堂大廳，往「3號出口」臺鐵通廊方向前進。',
          descEn: 'HSR platforms are on elevated 3F. Take escalators down to the 2F concourse and head toward Exit 3 (TRA walkway).'
        },
        {
          title: '穿越三鐵共構連通廊道',
          titleEn: 'Through the Interchange Walkway',
          desc: '由 3 號出口進入高鐵、台鐵、中捷三鐵共構之 2F 室內連通廊道，全程遮風避雨，直行穿越台鐵新烏日站大廳。',
          descEn: 'Enter the covered 2F indoor walkway linking HSR, TRA, and MRT, and walk straight through the TRA Xinwuri hall.'
        },
        {
          title: '抵達捷運「高鐵台中站」',
          titleEn: 'Arrive at MRT Station',
          desc: '順著 2F 連通廊道即可直達台中捷運綠線「高鐵台中站」進站閘門。',
          descEn: 'Follow the 2F walkway directly to the Taichung MRT Green Line gates at HSR Taichung Station.'
        }
      ],
      levels: [
        { level: '3F', title: '高鐵高架月台', titleEn: 'HSR Elevated Platform', desc: '月台層 (高架)，推薦在高鐵中段 6-8 車下車', descEn: 'Elevated platform level, recommend central Cars 6-8' },
        { level: '2F', title: '三鐵共構穿堂與連通廊道', titleEn: 'Interchange Concourse & Walkway', desc: '核心連通層，串接高鐵大廳、台鐵新烏日站與中捷', descEn: 'Core level linking HSR lobby, TRA Xinwuri, and MRT', highlight: true },
        { level: '3F', title: '台中捷運綠線高鐵台中站月台', titleEn: 'Taichung Metro Green Line Platform', desc: '高架車站，往北屯總站或市區方向', descEn: 'Elevated station for Beitun or Downtown' }
      ]
    }
  ],
  '新左營': [
    {
      id: 'zuoying-r',
      stationName: '新左營 / 左營站',
      line: { code: 'R', name: '高捷紅線', nameEn: 'KMRT Red Line', color: '#E3002C', textColor: 'text-white' },
      walkingTime: '1.5 分鐘 (90 秒)',
      walkingTimeEn: '1.5 mins (90s)',
      difficulty: 'easy',
      recommendCars: '2 - 4 車廂',
      recommendCarsEn: 'Cars 2 - 4',
      warning: '高雄捷運紅線班距較長，且車廂通常僅 3 節，遇到連假或大型巨蛋演唱會散場時，捷運月台會實施人潮管制，請預留 15-20 分鐘排隊時間。',
      warningEn: 'Kaohsiung MRT runs short 3-car trains with longer intervals. Heavy queues form after Kaohsiung Arena concerts; prepare extra 15-20 mins.',
      steps: [
        {
          title: '上行至高鐵二樓大廳',
          titleEn: 'Ascend to 2F Lobby',
          desc: '地面一樓月台下車後，搭扶梯上至 2 樓大廳，由「北側2號出口」刷卡出站。',
          descEn: 'Alight at 1F ground platform, take escalators to 2F lobby, and exit via North Exit 2.'
        },
        {
          title: '下行手扶梯直達捷運層',
          titleEn: 'Escalator to MRT level',
          desc: '出 2 號出口後，前方即有長型下行手扶梯，乘梯直下地下一樓 (B1) 即可看見高雄捷運左營站 (R16) 剪票大廳。',
          descEn: 'Outside Exit 2, take the long escalator straight down to B1 to reach the KMRT Zuoying (R16) gates.'
        }
      ],
      levels: [
        { level: '1F', title: '高鐵地面月台', titleEn: 'HSR Ground Platforms', desc: '建議搭乘 2-4 車靠近中央電扶梯上樓', descEn: 'Recommend Cars 2-4 for central escalator upward access' },
        { level: '2F', title: '高鐵車站大廳 (2號出口)', titleEn: 'HSR 2F Main Concourse', desc: '出站往2號出口前方搭乘直達下行電扶梯', descEn: 'Exit HSR and take direct downward escalator at Exit 2' },
        { level: 'B1F', title: '高雄捷運左營站 (R16) 閘門層', titleEn: 'KMRT Zuoying (R16) Gates', desc: '捷運入閘與乘車層，往小港或岡山方向', descEn: 'MRT ticket gates and boarding concourse', highlight: true }
      ]
    }
  ],
  '左營': [
    {
      id: 'zuoying-r-alt',
      stationName: '新左營 / 左營站',
      line: { code: 'R', name: '高捷紅線', nameEn: 'KMRT Red Line', color: '#E3002C', textColor: 'text-white' },
      walkingTime: '1.5 分鐘 (90 秒)',
      walkingTimeEn: '1.5 mins (90s)',
      difficulty: 'easy',
      recommendCars: '2 - 4 車廂',
      recommendCarsEn: 'Cars 2 - 4',
      warning: '高雄捷運紅線班距較長，且車廂通常僅 3 節，遇到連假或大型巨蛋演唱會散場時，捷運月台會實施人潮管制，請預留 15-20 分鐘排隊時間。',
      warningEn: 'Kaohsiung MRT runs short 3-car trains with longer intervals. Heavy queues form after Kaohsiung Arena concerts; prepare extra 15-20 mins.',
      steps: [
        {
          title: '上行至高鐵二樓大廳',
          titleEn: 'Ascend to 2F Lobby',
          desc: '地面一樓月台下車後，搭扶梯上至 2 樓大廳，由「北側2號出口」刷卡出站。',
          descEn: 'Alight at 1F ground platform, take escalators to 2F lobby, and exit via North Exit 2.'
        },
        {
          title: '下行手扶梯直達捷運層',
          titleEn: 'Escalator to MRT level',
          desc: '出 2 號出口後，前方即有長型下行手扶梯，乘梯直下地下一樓 (B1) 即可看見高雄捷運左營站 (R16) 剪票大廳。',
          descEn: 'Outside Exit 2, take the long escalator straight down to B1 to reach the KMRT Zuoying (R16) gates.'
        }
      ],
      levels: [
        { level: '1F', title: '高鐵地面月台', titleEn: 'HSR Ground Platforms', desc: '建議搭乘 2-4 車靠近中央電扶梯上樓', descEn: 'Recommend Cars 2-4 for central escalator upward access' },
        { level: '2F', title: '高鐵車站大廳 (2號出口)', titleEn: 'HSR 2F Main Concourse', desc: '出站往2號出口前方搭乘直達下行電扶梯', descEn: 'Exit HSR and take direct downward escalator at Exit 2' },
        { level: 'B1F', title: '高雄捷運左營站 (R16) 閘門層', titleEn: 'KMRT Zuoying (R16) Gates', desc: '捷運入閘與乘車層，往小港或岡山方向', descEn: 'MRT ticket gates and boarding concourse', highlight: true }
      ]
    }
  ],
  '高雄': [
    {
      id: 'kaohsiung-r',
      stationName: '高雄車站',
      line: { code: 'R', name: '高捷紅線', nameEn: 'KMRT Red Line', color: '#E3002C', textColor: 'text-white' },
      walkingTime: '1 分鐘 (60 秒)',
      walkingTimeEn: '1 min (60s)',
      difficulty: 'easy',
      recommendCars: '6 - 8 車廂',
      recommendCarsEn: 'Cars 6 - 8',
      steps: [
        {
          title: '下行至 B3 三鐵轉乘層',
          titleEn: 'Descend to B3 Interchange',
          desc: '台鐵月台位於 B2，下車後依「捷運轉乘」指標下行至地下三樓 (B3) 三鐵轉乘穿堂層。',
          descEn: 'TRA platforms are on B2. Follow the "MRT Transfer" signs down to the B3 interchange concourse.'
        },
        {
          title: '經 B3 連通道直達捷運',
          titleEn: 'B3 Corridor to MRT',
          desc: 'B3 轉乘連通道於 2024 年啟用，無須繞行地面，刷卡進入高雄捷運紅線 R11 高雄車站，再下行至 B4 月台。',
          descEn: 'The B3 transfer corridor (opened 2024) connects directly to KMRT Red Line R11 without going to street level; then descend to the B4 platform.'
        }
      ],
      levels: [
        { level: 'B2F', title: '台鐵地下月台', titleEn: 'TRA Platforms', desc: '下車層，建議靠 6-8 車廂出電扶梯最方便', descEn: 'Alighting level, recommend central Cars 6-8' },
        { level: 'B3F', title: '三鐵轉乘穿堂 (B3 連通道)', titleEn: 'B3 Interchange Concourse', desc: '2024 年啟用，全天候無雨直達捷運', descEn: 'Opened 2024, all-weather direct corridor to MRT', highlight: true },
        { level: 'B4F', title: '高雄捷運紅線 R11 月台', titleEn: 'KMRT Red Line R11 Platform', desc: '捷運乘車層，往左營高鐵或小港方向', descEn: 'KMRT platform for Zuoying HSR or Siaogang' }
      ]
    }
  ],
  '美麗島': [
    {
      id: 'formosa-r',
      stationName: '美麗島站',
      line: { code: 'R', name: '紅線', nameEn: 'KMRT Red Line', color: '#E3002C', textColor: 'text-white' },
      walkingTime: '2 分鐘',
      walkingTimeEn: '2 mins',
      difficulty: 'easy',
      recommendCars: '中段車廂',
      recommendCarsEn: 'Middle Cars',
      steps: [
        {
          title: '紅橘兩線十字交會',
          titleEn: 'Red & Orange Interchange',
          desc: '美麗島站為高雄捷運的十字樞紐，紅線月台在 B3 層，橘線月台在 B2 層。',
          descEn: 'Formosa Boulevard is KMRT\'s core junction; Red line is B3 and Orange line is B2.'
        },
        {
          title: '利用圓形轉乘手扶梯',
          titleEn: 'Circular Escalators',
          desc: '月台中央設有圓形中庭，搭乘電扶梯上行 1 層即可直達 B2 橘線月台或 B1 穹頂大廳。',
          descEn: 'Head to the central circular atrium and take the escalators up 1 level to the B2 Orange line platform.'
        }
      ],
      levels: [
        { level: 'B1F', title: '光之穹頂大廳', titleEn: 'Dome of Light Lobby', desc: '世界知名公共藝術大廳，付費剪票區', descEn: 'World-famous public art hall and ticket gates' },
        { level: 'B2F', title: '捷運橘線月台', titleEn: 'KMRT Orange Line Platform', desc: '前往哈瑪星(西子灣)或大寮方向', descEn: 'Orange line level for Hamasen or Daliao', highlight: true },
        { level: 'B3F', title: '捷運紅線月台', titleEn: 'KMRT Red Line Platform', desc: '前往小港或左營高鐵、岡山方向', descEn: 'Red line level for Siaogang or Gangshan' }
      ]
    }
  ],
  '六家': [
    {
      id: 'liujia-thsr',
      stationName: '六家車站',
      line: { code: 'HSR', name: '台灣高鐵', nameEn: 'Taiwan HSR', color: '#E97300', textColor: 'text-white' },
      walkingTime: '1 分鐘 (60 秒)',
      walkingTimeEn: '1 min (60s)',
      difficulty: 'easy',
      recommendCars: '靠驗票閘門車廂',
      recommendCarsEn: 'Cars near gates',
      steps: [
        {
          title: '台鐵六家站下車出閘門',
          titleEn: 'Alight at TRA Liujia',
          desc: '六家線為終端站，台鐵月台與驗票閘門皆在 2 樓，下車後直接刷卡出站。',
          descEn: 'Liujia is a terminal; TRA platform and gates are both on 2F. Alight and exit through the gates.'
        },
        {
          title: '2 樓通廊直通高鐵',
          titleEn: '2F Corridor to HSR',
          desc: '出站後順著高鐵指標走 2 樓高架連通走廊，全程室內、步行僅約 1 分鐘即抵高鐵新竹站穿堂。',
          descEn: 'Follow the HSR signs along the 2F elevated indoor corridor — about 1 minute to the HSR Hsinchu concourse.'
        },
        {
          title: '上行至 3 樓高鐵月台',
          titleEn: 'Up to 3F HSR Platform',
          desc: '進入高鐵穿堂刷卡後，搭電扶梯上行至 3 樓高架月台候車。',
          descEn: 'Enter the HSR concourse, then take the escalator up to the 3F elevated platform.'
        }
      ],
      levels: [
        { level: '2F', title: '台鐵六家站月台', titleEn: 'TRA Liujia Platform', desc: '高架終端站，下車與驗票閘門同層', descEn: 'Elevated terminal, platform and gates same level' },
        { level: '2F', title: '2 樓高架連通走廊', titleEn: '2F Elevated Corridor', desc: '室內走廊直通高鐵新竹站，步行約 1 分鐘', descEn: 'Indoor corridor to HSR Hsinchu, ~1 min walk', highlight: true },
        { level: '3F', title: '高鐵新竹站高架月台', titleEn: 'HSR Hsinchu Platform', desc: '高架月台，往北台北或南下台中、左營', descEn: 'Elevated platform for Taipei or Taichung/Zuoying' }
      ]
    }
  ],
  '沙崙': [
    {
      id: 'shalun-thsr',
      stationName: '沙崙車站',
      line: { code: 'HSR', name: '台灣高鐵', nameEn: 'Taiwan HSR', color: '#E97300', textColor: 'text-white' },
      walkingTime: '2 分鐘 (120 秒)',
      walkingTimeEn: '2 mins (120s)',
      difficulty: 'easy',
      recommendCars: '靠驗票閘門車廂',
      recommendCarsEn: 'Cars near gates',
      steps: [
        {
          title: '台鐵沙崙站下車出閘門',
          titleEn: 'Alight at TRA Shalun',
          desc: '沙崙線為終端站，月台、售票與驗票閘門皆位於 2 樓，下車後刷卡出站。',
          descEn: 'Shalun is a terminal; platform, ticketing and gates are all on 2F. Alight and exit.'
        },
        {
          title: '2 樓空橋通廊接高鐵',
          titleEn: '2F Skybridge to HSR',
          desc: '出閘門後順著高鐵指標走 2 樓室內空橋通廊，全程不淋雨，直達高鐵台南站穿堂。',
          descEn: 'Follow HSR signs along the 2F covered skybridge directly to the HSR Tainan concourse.'
        },
        {
          title: '上行至 3 樓高鐵月台',
          titleEn: 'Up to 3F HSR Platform',
          desc: '進入高鐵穿堂刷卡後，搭電扶梯上行至 3 樓高架月台候車。',
          descEn: 'Enter the HSR concourse, then escalate up to the 3F elevated platform.'
        }
      ],
      levels: [
        { level: '2F', title: '台鐵沙崙站月台', titleEn: 'TRA Shalun Platform', desc: '高架終端站，月台與閘門同層', descEn: 'Elevated terminal, platform and gates same level' },
        { level: '2F', title: '2 樓連通空橋', titleEn: '2F Connecting Skybridge', desc: '室內空橋直通高鐵台南站，步行約 2 分鐘', descEn: 'Covered skybridge to HSR Tainan, ~2 min walk', highlight: true },
        { level: '3F', title: '高鐵台南站高架月台', titleEn: 'HSR Tainan Platform', desc: '高架月台，往北台中、台北或南下左營', descEn: 'Elevated platform for Taichung/Taipei or Zuoying' }
      ]
    }
  ],
  '豐富': [
    {
      id: 'fengfu-thsr',
      stationName: '豐富車站',
      line: { code: 'HSR', name: '台灣高鐵', nameEn: 'Taiwan HSR', color: '#E97300', textColor: 'text-white' },
      walkingTime: '10 - 15 分鐘',
      walkingTimeEn: '10 - 15 mins',
      difficulty: 'medium',
      recommendCars: '靠後站 (高鐵側) 車廂',
      recommendCarsEn: 'Rear cars (HSR side)',
      warning: '豐富站與高鐵苗栗站非共構，需經約 90 公尺站外風雨走廊步行轉乘，全程約 10-15 分鐘，建議預留 20 分鐘。',
      warningEn: 'Fengfu and HSR Miaoli are not co-located. Transfer uses a ~90m covered outdoor walkway, about 10-15 mins. Allow 20 mins to be safe.',
      steps: [
        {
          title: '台鐵豐富站下車出站',
          titleEn: 'Alight at TRA Fengfu',
          desc: '台中線 (山線) 區間車於豐富站 2 樓高架月台下車，搭電扶梯下行至 1 樓出口刷卡出站。',
          descEn: 'Alight at the 2F elevated platform of Fengfu (Mountain Line), descend to the 1F exit and tap out.'
        },
        {
          title: '走 90 公尺風雨走廊',
          titleEn: '90m Covered Walkway',
          desc: '出站後順著指標走約 90 公尺站外風雨走廊 (有頂棚)，前往高鐵苗栗站 5 號出口。',
          descEn: 'Follow signs ~90m along the roofed outdoor walkway to HSR Miaoli Exit 5.'
        },
        {
          title: '上行至 5 樓高鐵月台',
          titleEn: 'Up to 5F HSR Platform',
          desc: '進入高鐵苗栗站，於 2 樓穿堂刷卡進站，再搭電扶梯上行至 5 樓高架月台。',
          descEn: 'Enter HSR Miaoli, tap in at the 2F concourse, then escalate up to the 5F elevated platform.'
        }
      ],
      levels: [
        { level: '2F', title: '台鐵豐富站高架月台', titleEn: 'TRA Fengfu Platform', desc: '台中線區間車月台 (高架)，下車層', descEn: 'Mountain Line local platform (elevated), alighting level' },
        { level: '1F', title: '站外 90 公尺風雨走廊', titleEn: 'Outdoor 90m Walkway', desc: '兩站間有頂棚連通步道，步行約 10-15 分鐘', descEn: 'Roofed connecting walkway, ~10-15 min walk', highlight: true },
        { level: '5F', title: '高鐵苗栗站高架月台', titleEn: 'HSR Miaoli Platform', desc: '高架月台層，往北台北或南下台中、左營', descEn: 'Elevated platform for Taipei or Taichung/Zuoying' }
      ]
    }
  ]
};

// Parse a floor label ("5F","1F","B2F","B2F-M") into a sortable rank (higher = physically higher).
export function floorRank(level: string): number {
  const m = level.match(/^(B?)(\d+)/i);
  if (!m) return 0;
  const n = parseInt(m[2], 10);
  return m[1].toUpperCase() === 'B' ? -n : n;
}

// Returns transfer items for a station.
export function getDetailedTransfers(stationName: string): DetailedTransfer[] {
  // Normalize station name
  const name = stationName.replace('高鐵', '').trim();
  const matched = DETAILED_TRANSFERS[name];
  if (matched) return matched;
  
  // Try to find if any key is contained
  for (const key of Object.keys(DETAILED_TRANSFERS)) {
    if (name.includes(key) || key.includes(name)) {
      return DETAILED_TRANSFERS[key];
    }
  }
  return [];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  stationName: string;
}

export default function TransferMapModal({ isOpen, onClose, stationName }: Props) {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language === 'zh-TW';
  const availableTransfers = getDetailedTransfers(stationName);
  const [activeTabIdx, setActiveTabIdx] = useState(0);
  const [selectedLevelIdx, setSelectedLevelIdx] = useState<number>(0);
  const [viewMode, setViewMode] = useState<'3d' | 'list'>('3d');

  // Set default active tab whenever modal opens or station changes
  useEffect(() => {
    if (isOpen) {
      setActiveTabIdx(0);
    }
  }, [isOpen, stationName]);

  // Set default selected level whenever activeTabIdx or stationName or availableTransfers change
  useEffect(() => {
    const currentTransfer = availableTransfers[activeTabIdx] || availableTransfers[0];
    if (currentTransfer && currentTransfer.levels && currentTransfer.levels.length > 0) {
      const sorted = [...currentTransfer.levels].sort((a, b) => floorRank(b.level) - floorRank(a.level));
      const hlIdx = sorted.findIndex(l => l.highlight);
      setSelectedLevelIdx(hlIdx !== -1 ? hlIdx : 0);
    }
  }, [activeTabIdx, stationName, availableTransfers]);

  if (!isOpen || availableTransfers.length === 0) return null;

  const currentTransfer = availableTransfers[activeTabIdx] || availableTransfers[0];
  const { line, walkingTime, walkingTimeEn, difficulty, recommendCars, recommendCarsEn, accessibleCars, accessibleCarsEn, warning, warningEn, steps, levels } = currentTransfer;

  // Display floors sorted physically (high → low, top → bottom); data stays in journey order for markers.
  const displayLevels = [...levels].sort((a, b) => floorRank(b.level) - floorRank(a.level));

  const diffColor = difficulty === 'easy' 
    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
    : difficulty === 'medium'
      ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
      : 'bg-rose-500/10 text-rose-400 border-rose-500/20';

  const diffLabel = difficulty === 'easy'
    ? (isZh ? '簡單' : 'Easy')
    : difficulty === 'medium'
      ? (isZh ? '一般' : 'Medium')
      : (isZh ? '挑戰' : 'Hard');

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-2 sm:p-6 shadow-2xl transition-all duration-300 overflow-y-auto"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-[2.5rem] shadow-[0_40px_80px_-15px_rgba(0,0,0,0.6)] px-3 py-6 sm:p-8 animate-in fade-in zoom-in-95 duration-300 flex flex-col max-h-[92dvh] overflow-hidden"
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-slate-800 text-blue-400">
              <Compass className="size-6 animate-spin-slow" />
            </div>
            <div>
              <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
                {isZh ? `${stationName} 轉乘最速攻略` : `${stationName} Transfer Speed Guide`}
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-all active:scale-95 border border-transparent hover:border-slate-700/50"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Tab Selection if multiple transfers available */}
        {availableTransfers.length > 1 && (
          <div className="flex gap-2 p-1.5 bg-slate-950 rounded-2xl border border-slate-800/80 mt-4 shrink-0 overflow-x-auto no-scrollbar">
            {availableTransfers.map((tr, idx) => (
              <button
                key={tr.id}
                onClick={() => setActiveTabIdx(idx)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs tracking-wider transition-all duration-300 whitespace-nowrap ${
                  activeTabIdx === idx
                    ? 'bg-slate-800 text-white shadow-md border border-slate-700/50'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span
                  style={{ backgroundColor: tr.line.color }}
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black font-mono shrink-0"
                >
                  {tr.line.code}
                </span>
                {isZh ? tr.line.name : tr.line.nameEn}
              </button>
            ))}
          </div>
        )}

        {/* Content Area - Scrollable */}
        <div className="flex-1 overflow-y-auto pr-1 py-4 space-y-6 no-scrollbar">
          {/* Quick Metrics Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Metric 1: Walking time */}
            <div className="bg-slate-950 rounded-2xl p-4 border border-slate-800 flex items-center gap-3.5">
              <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400">
                <Clock className="size-5" />
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest block leading-none">
                  {isZh ? '轉乘耗時' : 'Walking Time'}
                </span>
                <span className="text-sm font-black text-white mt-1 block">
                  {isZh ? walkingTime : walkingTimeEn}
                </span>
              </div>
            </div>

            {/* Metric 2: Difficulty */}
            <div className="bg-slate-950 rounded-2xl p-4 border border-slate-800 flex items-center gap-3.5">
              <div className={`p-2.5 rounded-xl border ${diffColor}`}>
                <Flame className="size-5" />
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest block leading-none">
                  {isZh ? '路線難度' : 'Difficulty'}
                </span>
                <span className="text-sm font-black text-white mt-1 block">
                  {diffLabel}
                </span>
              </div>
            </div>

            {/* Metric 3: Recommend Cars */}
            <div className="bg-slate-950 rounded-2xl p-4 border border-slate-800 flex items-center gap-3.5">
              <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400">
                <Navigation className="size-5" />
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest block leading-none">
                  {isZh ? '最速推薦車廂' : 'Best Car Position'}
                </span>
                <span className="text-sm font-black text-white mt-1 block">
                  {isZh ? recommendCars : recommendCarsEn}
                </span>
              </div>
            </div>
          </div>

          {/* Accessibility Info */}
          {accessibleCars && (
            <div className="bg-emerald-500/5 rounded-2xl px-4 py-3 border border-emerald-500/10 flex items-center gap-2.5 text-xs text-emerald-400/90 font-medium">
              <Award className="size-4 shrink-0 text-emerald-400" />
              <span>
                <strong>{isZh ? '無障礙動線：' : 'Accessible Route: '}</strong>
                {isZh ? accessibleCars : accessibleCarsEn}
              </span>
            </div>
          )}

          {/* Warning Message if any */}
          {warning && (
            <div className="bg-rose-500/5 rounded-2xl px-4 py-3.5 border border-rose-500/10 flex gap-3 text-xs text-rose-400 leading-relaxed font-medium">
              <ShieldAlert className="size-5 shrink-0 text-rose-400 mt-0.5" />
              <div>
                <strong className="block mb-0.5">{isZh ? '乘車提醒' : 'Crowd Warning'}</strong>
                {isZh ? warning : warningEn}
              </div>
            </div>
          )}

          {/* Step-by-Step Stepper & Blueprint Floor Plan side by side on desktop */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 pt-2">
            {/* Vertical Stepper - Left Side (8 cols) */}
            <div className="md:col-span-7 space-y-5">
              <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <div className="w-1.5 h-3 bg-blue-500 rounded-full" />
                {isZh ? '走線與乘車步驟' : 'Step-by-Step Directions'}
              </h4>

              <div className="relative pl-6 border-l-2 border-slate-800 space-y-6 ml-3">
                {steps.map((step, idx) => (
                  <div key={idx} className="relative group">
                    {/* Bullet marker */}
                    <div className="absolute -left-[31px] top-0.5 size-4 rounded-full bg-slate-950 border-2 border-slate-700 flex items-center justify-center group-hover:border-blue-500 transition-all">
                      <div className="size-1.5 rounded-full bg-slate-500 group-hover:bg-blue-400" />
                    </div>
                    <h5 className="text-sm font-black text-white flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-500 font-mono">0{idx + 1}.</span>
                      {isZh ? step.title : step.titleEn}
                    </h5>
                    <p className="text-xs text-slate-400 mt-1.5 leading-relaxed font-medium">
                      {isZh ? step.desc : step.descEn}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Vertical Stack Blueprint - Right Side (5 cols) */}
            <div className="md:col-span-5 space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <div className="w-1.5 h-3 bg-pink-500 rounded-full" />
                  {isZh ? '樓層立體對照表' : 'Floor Schematic'}
                </h4>
                <div className="flex p-0.5 bg-slate-950 rounded-lg border border-slate-800 text-[10px] font-bold">
                  <button
                    type="button"
                    onClick={() => setViewMode('3d')}
                    className={`px-2.5 py-1 rounded transition-all duration-200 ${
                      viewMode === '3d'
                        ? 'bg-slate-800 text-white font-black'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {isZh ? '3D 立體' : '3D View'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('list')}
                    className={`px-2.5 py-1 rounded transition-all duration-200 ${
                      viewMode === 'list'
                        ? 'bg-slate-800 text-white font-black'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {isZh ? '詳細清單' : 'List View'}
                  </button>
                </div>
              </div>

              {viewMode === '3d' ? (
                <div className="relative h-[290px] w-full bg-slate-950/40 border border-slate-800/80 rounded-2xl flex flex-col justify-between p-4 overflow-hidden shadow-inner select-none">
                  {/* Subtle futuristic coordinate overlays */}
                  <div className="absolute top-2 left-2 text-[8px] font-mono text-slate-600 tracking-widest uppercase">
                    SYSTEM: SECURE_TRANSIT // {stationName}
                  </div>
                  <div className="absolute bottom-2 right-2 text-[8px] font-mono text-slate-600 tracking-widest">
                    GRID_ORIENT: ISO_S35
                  </div>

                  {/* The 3D Stack Stage */}
                  <div className="relative flex-1 w-full flex items-center justify-center pt-2 overflow-hidden">
                    <div 
                      className="relative w-[240px] h-[100px]"
                      style={{ 
                        perspective: '1000px',
                        transformStyle: 'preserve-3d'
                      }}
                    >
                      {/* Vertical Flow Pipeline */}
                      <div 
                        className="absolute left-[20%] top-[35%] w-[2px] h-[120px] border-l-2 border-dashed border-blue-500/40 z-0"
                        style={{
                          transform: 'translateZ(-10px)',
                        }}
                      />
                      
                      {displayLevels.map((lvl, idx) => {
                        const isSelected = selectedLevelIdx === idx;
                        const isHighlight = lvl.highlight;
                        const floorColor = isHighlight ? (line.color || '#3b82f6') : '#475569';

                        // Stack vertically centered so it can't bleed onto the
                        // detail text below; tighter step when 4 levels.
                        const levelCount = displayLevels.length;
                        const step = levelCount >= 4 ? 48 : 58;
                        const verticalOffset = (idx - (levelCount - 1) / 2) * step;

                        return (
                          <div
                            key={idx}
                            onClick={() => setSelectedLevelIdx(idx)}
                            onMouseEnter={() => setSelectedLevelIdx(idx)}
                            className="absolute left-0 right-0 h-[65px] cursor-pointer transition-all duration-300"
                            style={{
                              top: `calc(50% - 32px + ${verticalOffset}px)`,
                              zIndex: displayLevels.length - idx,
                              transformStyle: 'preserve-3d',
                              transform: `rotateX(55deg) rotateZ(-35deg) skewX(5deg) translate3d(0, ${isSelected ? '-15px' : '0px'}, ${isSelected ? '25px' : '0px'})`,
                            }}
                          >
                            {/* Glass plate slab */}
                            <div 
                              className={`absolute inset-0 rounded-xl border transition-all duration-300 bg-[linear-gradient(135deg,rgba(15,23,42,0.95),rgba(2,6,23,0.95))] ${
                                isSelected 
                                  ? 'border-blue-500 shadow-[0_15px_30px_-5px_rgba(59,130,246,0.3)]' 
                                  : isHighlight
                                    ? 'border-emerald-500/40 shadow-[0_5px_15px_-5px_rgba(16,185,129,0.15)]'
                                    : 'border-slate-800 hover:border-slate-700 shadow-md'
                              }`}
                            >
                              {/* Glowing digital blueprint grid pattern */}
                              <div className="absolute inset-0 rounded-xl opacity-20 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:10px_10px]" />
                              
                              {/* Floor plate edge thickness effect (3D slab look) */}
                              <div 
                                className="absolute left-0 right-0 -bottom-[3px] h-[3px] rounded-b-xl opacity-80"
                                style={{
                                  backgroundColor: isSelected ? '#3b82f6' : isHighlight ? '#10b981' : '#1e293b',
                                  transform: 'rotateX(90deg)',
                                  transformOrigin: 'bottom center',
                                }}
                              />

                              {/* Interactive Content inside the 3D Plate */}
                              <div className="absolute inset-0 flex items-center justify-between px-3 py-2 text-white">
                                {/* Floor Badge */}
                                <div 
                                  style={{
                                    backgroundColor: isSelected ? floorColor : '#1e293b',
                                    color: '#ffffff',
                                    boxShadow: isSelected ? `0 0 10px ${floorColor}80` : 'none'
                                  }}
                                  className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black font-mono shrink-0 select-none transition-all duration-300"
                                >
                                  {lvl.level}
                                </div>

                                {/* Flow Blueprint Schematic - simple mock representation */}
                                <div className="flex-1 px-2.5 flex flex-col justify-center h-full select-none">
                                  <div className="text-[10px] font-black tracking-tight truncate">
                                    {isZh ? lvl.title : lvl.titleEn}
                                  </div>
                                  
                                  {/* Schematic flow nodes */}
                                  <div className="flex items-center gap-1.5 mt-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                                    <div className="flex-1 h-[1px] border-t border-dashed border-slate-700" />
                                    {lvl === levels[0] && (
                                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" title={isZh ? '下車處' : 'Alight'} />
                                    )}
                                    {lvl.highlight && (
                                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" title={isZh ? '聯絡閘門' : 'Transfer'} />
                                    )}
                                    {lvl === levels[levels.length - 1] && (
                                      <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse shrink-0" title={isZh ? '搭車層' : 'Board'} />
                                    )}
                                    <div className="flex-1 h-[1px] border-t border-dashed border-slate-700" />
                                    <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                                  </div>
                                </div>

                                {/* Floating indicator of active selection */}
                                {isSelected && (
                                  <div className="p-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">
                                    <ArrowRight className="size-3.5" />
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Selected level interactive details card below the 3D stack */}
                  {selectedLevelIdx !== null && displayLevels[selectedLevelIdx] && (
                    <div className="bg-slate-950 p-3 rounded-xl border border-blue-500/20 mt-2 flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center font-mono font-black shrink-0">
                        {displayLevels[selectedLevelIdx].level}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-black text-white leading-none">
                            {isZh ? displayLevels[selectedLevelIdx].title : displayLevels[selectedLevelIdx].titleEn}
                          </span>
                          {displayLevels[selectedLevelIdx].highlight && (
                            <span className="px-1 py-0.2 rounded text-[8px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-400 leading-none">
                              {isZh ? '轉乘層' : 'Transfer'}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 font-medium mt-1 leading-normal truncate-2-lines">
                          {isZh ? displayLevels[selectedLevelIdx].desc : displayLevels[selectedLevelIdx].descEn}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2 relative">
                  {/* Connecting dashed line behind floors */}
                  <div className="absolute left-6 top-6 bottom-6 border-l-2 border-dashed border-slate-800" />

                  {displayLevels.map((lvl, idx) => (
                    <div
                      key={idx}
                      className={`relative flex gap-3.5 p-3 rounded-2xl border transition-all duration-300 ${
                        lvl.highlight
                          ? 'bg-slate-950 border-blue-500/30 shadow-[0_4px_20px_-5px_rgba(59,130,246,0.15)] scale-[1.03] z-10'
                          : 'bg-slate-950/40 border-slate-800/80'
                      }`}
                    >
                      {/* Floor circle */}
                      <div
                        style={{
                          backgroundColor: lvl.highlight ? line.color : '#1e293b',
                          boxShadow: lvl.highlight ? `0 0 10px ${line.color}50` : 'none'
                        }}
                        className="size-8 rounded-xl flex items-center justify-center text-xs font-black font-mono text-white shrink-0 z-10"
                      >
                        {lvl.level}
                      </div>
                      <div>
                        <h6 className="text-xs font-black text-white flex items-center gap-1.5">
                          {isZh ? lvl.title : lvl.titleEn}
                          {lvl.highlight && (
                            <span className="px-1 py-0.2 rounded text-[8px] font-black uppercase tracking-widest bg-blue-500/20 text-blue-400">
                              {isZh ? '轉乘層' : 'Transfer'}
                            </span>
                          )}
                        </h6>
                        <p className="text-[10px] text-slate-500 font-medium mt-1 leading-normal">
                          {isZh ? lvl.desc : lvl.descEn}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="border-t border-slate-800 pt-5 mt-4 flex items-center justify-between shrink-0">
          <div className="text-[10px] text-slate-500 font-semibold tracking-wide flex items-center gap-1.5">
            <CheckCircle className="size-3.5 text-emerald-500 shrink-0" />
            <span>{isZh ? '已適配最新三鐵時刻表與出口變更。' : 'Updated with the latest train timetables.'}</span>
          </div>
          <button
            onClick={onClose}
            className={`px-5 py-2.5 rounded-xl text-xs font-black tracking-wider transition-all duration-300 transform active:scale-95 shadow-lg ${
              line.code === 'BL' ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-slate-800 hover:bg-slate-700 text-white'
            }`}
          >
            {isZh ? '關閉' : 'Got It'}
          </button>
        </div>
      </div>
    </div>
  );
}
