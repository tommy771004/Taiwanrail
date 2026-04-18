import React from 'react';
import { AlertTriangle, ShieldCheck, Clock } from 'lucide-react';
import type { ReliabilityScore } from '../lib/delayReliability';

interface Props {
  reliability: ReliabilityScore;
  language: string;
  compact?: boolean;
}

const LEVEL_STYLE: Record<ReliabilityScore['level'], string> = {
  reliable: 'bg-emerald-50/80 text-emerald-700 border-emerald-100',
  minor: 'bg-sky-50/80 text-sky-700 border-sky-100',
  caution: 'bg-amber-50/80 text-amber-700 border-amber-200',
  frequent: 'bg-red-50/80 text-red-700 border-red-200',
};

function reasonText(reason: string, lang: string): string {
  const zh: Record<string, string> = {
    cross_line: '跨線車次',
    east_line: '東部幹線',
    peak_hour: '尖峰時段',
    observed_late: '近期實測誤點',
  };
  const en: Record<string, string> = {
    cross_line: 'Cross-line route',
    east_line: 'East-coast line',
    peak_hour: 'Peak hour',
    observed_late: 'Recently observed late',
  };
  const dict = lang === 'zh-TW' ? zh : en;
  return dict[reason] || reason;
}

function levelLabel(level: ReliabilityScore['level'], expected: number, lang: string): string {
  if (lang === 'zh-TW') {
    if (level === 'reliable') return '準點';
    if (level === 'minor') return `偶有 ${expected} 分鐘誤點`;
    if (level === 'caution') return `常態誤點 ${expected} 分鐘`;
    return `誤點熱區 +${expected} 分`;
  }
  if (level === 'reliable') return 'Punctual';
  if (level === 'minor') return `Mild +${expected}m`;
  if (level === 'caution') return `Often late ~${expected}m`;
  return `Frequently late +${expected}m`;
}

export default function ReliabilityBadge({ reliability, language, compact }: Props) {
  if (reliability.level === 'reliable' && reliability.source === 'heuristic') return null;

  const Icon = reliability.level === 'reliable' ? ShieldCheck : reliability.level === 'minor' ? Clock : AlertTriangle;
  const label = levelLabel(reliability.level, reliability.expectedDelayMin, language);
  const tooltipParts: string[] = [
    language === 'zh-TW' ? `準點評分 ${reliability.score}` : `Reliability ${reliability.score}/100`,
  ];
  if (reliability.sampleSize > 0) {
    tooltipParts.push(
      language === 'zh-TW'
        ? `近 ${reliability.sampleSize} 次觀測平均`
        : `avg of ${reliability.sampleSize} recent observations`
    );
  }
  reliability.reasons.forEach((r) => tooltipParts.push(reasonText(r, language)));
  const tooltip = tooltipParts.join(' · ');

  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1 ${compact ? 'px-1.5 py-0.5 text-[0.625rem]' : 'px-2 py-1 text-[0.6875rem]'} rounded-full font-bold border ${LEVEL_STYLE[reliability.level]}`}
    >
      <Icon className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      <span>{label}</span>
    </span>
  );
}
