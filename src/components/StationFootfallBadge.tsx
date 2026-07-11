import { useEffect, useState } from 'react';
import { getStationFootfall, type FootfallMode, type StationFootfall } from '../lib/stationFootfall';

interface StationFootfallBadgeProps {
  mode: FootfallMode;
  stationId?: string;
  stationName?: string;
  date: string;
  time: string;
  language: string;
  className?: string;
}

const labels = {
  'zh-TW': {
    prefix: '歷史統計人流：',
    low: '較少',
    medium: '一般',
    high: '偏高',
  },
  en: {
    prefix: 'Historical footfall: ',
    low: 'Low',
    medium: 'Typical',
    high: 'Higher',
  },
} as const;

export default function StationFootfallBadge({
  mode,
  stationId,
  stationName,
  date,
  time,
  language,
  className = '',
}: StationFootfallBadgeProps) {
  const [footfall, setFootfall] = useState<StationFootfall | null>(null);

  useEffect(() => {
    let active = true;
    setFootfall(null);
    void getStationFootfall({ mode, stationId, stationName, date, time }).then(result => {
      if (active) setFootfall(result);
    });
    return () => { active = false; };
  }, [date, mode, stationId, stationName, time]);

  if (!footfall) return null;

  const copy = language === 'zh-TW' ? labels['zh-TW'] : labels.en;
  const text = `${copy.prefix}${copy[footfall.level]}`;
  const bars = footfall.level === 'high' ? '▂▅█' : footfall.level === 'medium' ? '▂▅' : '▂';
  return (
    <div
      className={`inline-flex max-w-full items-center gap-1.5 text-[10px] sm:text-[11px] font-semibold leading-4 text-slate-400 dark:text-slate-500 ${className}`}
      aria-label={text}
    >
      <span>{text}</span>
      <span aria-hidden="true" className="min-w-[2.6em] font-mono text-xs tracking-[0.08em] text-slate-500 dark:text-slate-400">{bars}</span>
    </div>
  );
}
