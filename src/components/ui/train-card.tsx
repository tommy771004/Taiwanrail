import * as React from "react";
import { motion } from "motion/react";
import { ArrowRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface TrainCardProps {
  /** 列車類型名稱，例如「自強」「普悠瑪」「高鐵」 */
  trainTypeName: string;
  /** 列車代表色 */
  trainTypeColor: "red" | "orange" | "blue";
  /** 車次號碼 */
  trainId: string;
  /** 出發時間 */
  departureTime: string;
  /** 抵達時間 */
  arrivalTime: string;
  /** 行駛時間文字 */
  duration: string;
  /** 主要票價文字（已格式化，例如 "NT$375"） */
  price: string;
  /** 副票種（商務/高鐵商務/自由席等），可不傳 */
  extraFares?: Array<{ label: string; price: string; colorClass: string }>;
  /** 是否已取消 */
  isCancelled?: boolean;
  /** 狀態徽章（準點/誤點等），可不傳 */
  statusBadge?: React.ReactNode;
  /** 可靠度徽章 */
  reliabilityBadge?: React.ReactNode;
  /** 輔助功能圖示 */
  accessIcons?: React.ReactNode;
  /** 路線/方向 meta 標籤 */
  routeMeta?: React.ReactNode;
  /** 收藏、通知等動作按鈕群 */
  actionGroup?: React.ReactNode;
  /** 分享 */
  onShare?: (e: React.MouseEvent) => void;
  /** 訂票 */
  onBook?: (e: React.MouseEvent) => void;
  /** 查看詳情（展開/收合） */
  onDetails?: (e: React.MouseEvent) => void;
  /** 是否已展開 */
  isExpanded?: boolean;
  /** 語言 */
  language?: string;
  className?: string;
}

export const TrainCard: React.FC<TrainCardProps> = ({
  trainTypeName,
  trainTypeColor,
  trainId,
  departureTime,
  arrivalTime,
  duration,
  price,
  extraFares,
  isCancelled = false,
  statusBadge,
  reliabilityBadge,
  accessIcons,
  routeMeta,
  actionGroup,
  onShare,
  onBook,
  onDetails,
  isExpanded = false,
  language = "zh-TW",
  className,
}) => {
  const isTW = language === "zh-TW";
  const typeColorClass =
    trainTypeColor === "red"
      ? "bg-[#ffebeb] text-[#cb171d]"
      : trainTypeColor === "orange"
      ? "bg-[#feebd6] text-[#d85e01]"
      : "bg-[#e0efff] text-[#1b5cb7]";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={cn(
        "w-full rounded-xl border border-slate-100 bg-white shadow-sm hover:shadow-md transition-shadow group",
        isExpanded && "bg-gradient-to-br from-white to-blue-50/30 border-blue-100 shadow-md",
        isCancelled && "opacity-70",
        className
      )}
    >
      <div
        className="px-6 py-5 cursor-pointer select-none"
        onClick={onDetails}
      >
        {/* Top row: refundable badge + status + route meta */}
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {routeMeta}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {statusBadge}
            {reliabilityBadge}
          </div>
        </div>

        {/* Main 3-column grid (mirrors FlightCard) */}
        <div className="grid grid-cols-12 gap-x-6 items-center">

          {/* ─── Col 1–3: Train identity ─── */}
          <div className="col-span-3 flex flex-col gap-2">
            {/* Train type badge */}
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "px-2 py-1 rounded-md text-sm font-bold tracking-widest shrink-0",
                  isCancelled ? "bg-slate-200 text-slate-400 line-through" : typeColorClass
                )}
              >
                {trainTypeName}
              </span>
              <span
                className={cn(
                  "font-black text-xl tracking-tight tabular-nums",
                  isCancelled ? "text-slate-300 line-through" : "text-slate-900"
                )}
              >
                {trainId}
              </span>
            </div>

            {/* Accessibility icons */}
            {accessIcons && (
              <div className="flex items-center gap-1 mt-0.5">{accessIcons}</div>
            )}

            {/* Action group (favorites / notifications) + Details link */}
            <div className="flex items-center gap-2 mt-1">
              {actionGroup}
              <Button
                variant="link"
                className="p-0 h-auto justify-start text-xs text-slate-400 hover:text-blue-600"
                onClick={(e) => { e.stopPropagation(); onDetails?.(e); }}
                aria-label={isTW ? "查看詳情" : "View details"}
              >
                {isTW ? (isExpanded ? "收起詳情" : "查看詳情") : (isExpanded ? "Collapse" : "Details")}
              </Button>
            </div>
          </div>

          {/* ─── Col 4–8: Horizontal timeline ─── */}
          <div className="col-span-5 flex items-center gap-3">
            {/* Departure */}
            <div className="text-center shrink-0">
              <p
                className={cn(
                  "font-black text-4xl tracking-tighter tabular-nums leading-none",
                  isCancelled
                    ? "text-slate-300 line-through"
                    : isExpanded
                    ? "text-blue-600"
                    : "text-slate-900"
                )}
              >
                {departureTime}
              </p>
            </div>

            {/* Duration bar */}
            <div className="flex-grow text-center min-w-0">
              <p className="text-xs text-slate-400 font-medium mb-1">{duration}</p>
              <div className="relative w-full h-px bg-slate-200 my-1">
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-slate-400 border-2 border-white"></div>
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-slate-700 border-2 border-white"></div>
              </div>
              <p className="text-[0.65rem] font-semibold text-slate-400 tracking-wide uppercase">
                {isTW ? "直達" : "Direct"}
              </p>
            </div>

            {/* Arrival */}
            <div className="text-center shrink-0">
              <p
                className={cn(
                  "font-black text-4xl tracking-tighter tabular-nums leading-none",
                  isCancelled ? "text-slate-300 line-through" : "text-slate-900"
                )}
              >
                {arrivalTime}
              </p>
            </div>
          </div>

          {/* ─── Col 9–12: Pricing & booking ─── */}
          <div className="col-span-4 flex flex-col items-end gap-2">
            <p
              className={cn(
                "text-3xl font-light tracking-tight tabular-nums",
                isCancelled ? "text-slate-300 line-through" : "text-slate-800"
              )}
            >
              {price}
            </p>

            {/* Extra fare tiers */}
            {extraFares && extraFares.length > 0 && (
              <div className="flex gap-2 text-[11px] font-semibold">
                {extraFares.map((f) => (
                  <Badge
                    key={f.label}
                    variant="outline"
                    className={cn("border-0 px-2 py-0.5 rounded", f.colorClass)}
                  >
                    {f.label} ${f.price}
                  </Badge>
                ))}
              </div>
            )}

            {/* Action buttons */}
            {!isCancelled && (
              <div className="flex items-center gap-2 mt-1">
                {onShare && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); onShare(e); }}
                    className="text-xs"
                  >
                    {isTW ? "分享" : "Share"}
                  </Button>
                )}
                {onBook && (
                  <Button
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); onBook(e); }}
                    className="bg-slate-900 hover:bg-blue-600 text-white text-xs gap-1.5"
                    aria-label={isTW ? "馬上訂票" : "Book Ticket"}
                  >
                    {isTW ? "馬上訂票" : "Book"}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            )}

            {isCancelled && (
              <Badge variant="outline" className="border-slate-300 text-slate-400 gap-1">
                CANCELLED
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Expand chevron hint */}
      {!isCancelled && (
        <div
          className={cn(
            "flex justify-center pb-1 opacity-0 group-hover:opacity-100 transition-opacity",
            isExpanded && "opacity-100"
          )}
        >
          <span
            className={cn(
              "text-slate-300 transition-transform duration-300 text-xs",
              isExpanded && "rotate-180"
            )}
          >
            ▾
          </span>
        </div>
      )}
    </motion.div>
  );
};

export default TrainCard;
