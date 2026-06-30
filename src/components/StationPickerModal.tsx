import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Search, XCircle, CheckCircle } from 'lucide-react';
import { Station } from '../lib/api';

export const COUNTY_ORDER = [
  '基隆市','新北市','臺北市','桃園市','新竹縣','新竹市','苗栗縣',
  '臺中市','彰化縣','南投縣','雲林縣','嘉義縣','嘉義市',
  '臺南市','高雄市','屏東縣','臺東縣','花蓮縣','宜蘭縣',
];

export function extractCounty(station: Station): string {
  const addr = (station as any).StationAddress as string | undefined;
  if (!addr) return '其他';
  const m = addr.match(/^\d{3,6}([一-龥]+?[市縣])/);
  return m ? m[1] : '其他';
}

interface Props {
  isOpen: boolean;
  isOrigin: boolean;
  transportType: 'hsr' | 'train';
  stations: Station[];
  selectedId: string;
  stationsLoading: boolean;
  stationsError: string | null;
  onSelect: (stationId: string) => void;
  onClose: () => void;
  onRetry: () => void;
}

export default function StationPickerModal({
  isOpen,
  isOrigin,
  transportType,
  stations,
  selectedId,
  stationsLoading,
  stationsError,
  onSelect,
  onClose,
  onRetry,
}: Props) {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState('');
  const [selectedCounty, setSelectedCounty] = useState<string>('');
  const countyListRef = useRef<HTMLDivElement>(null);

  // On open, default county to the county of currently selected station
  useEffect(() => {
    if (!isOpen) { setSearch(''); return; }
    if (transportType !== 'train' || stations.length === 0) return;
    const current = stations.find(s => s.StationID === selectedId);
    const county = current ? extractCounty(current) : '';
    const ordered = buildCountyList(stations);
    setSelectedCounty(county && ordered.includes(county) ? county : (ordered[0] || ''));
  }, [isOpen, selectedId, stations, transportType]);

  if (!isOpen) return null;

  const isTrain = transportType === 'train';
  const searching = search.trim() !== '';

  // Build ordered county list from actual station data
  function buildCountyList(stns: Station[]): string[] {
    const inData = new Set(stns.map(extractCounty));
    const ordered = COUNTY_ORDER.filter(c => inData.has(c));
    const others = [...inData].filter(c => !COUNTY_ORDER.includes(c));
    return [...ordered, ...others];
  }

  const countyList = isTrain ? buildCountyList(stations) : [];
  const activeCounty = selectedCounty || countyList[0] || '';

  const filterStation = (s: Station, q: string) => {
    const q2 = q.toLowerCase();
    const zh = s.StationName?.Zh_tw || '';
    const en = (s.StationName?.En || '').toLowerCase();
    return zh.includes(q) || en.includes(q2) || s.StationID.includes(q);
  };

  const stationsForCounty = isTrain && !searching
    ? stations.filter(s => extractCounty(s) === activeCounty)
    : stations.filter(s => filterStation(s, search.trim()));

  const accentClass = transportType === 'hsr'
    ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 focus:ring-orange-400/50'
    : 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 focus:ring-blue-400/50';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/80 backdrop-blur-md p-4 sm:p-6 shadow-2xl transition-all duration-300 overflow-hidden touch-none"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm sm:max-w-md max-h-[88dvh] min-h-0 flex flex-col bg-white dark:bg-slate-900 rounded-3xl sm:rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-[0_40px_80px_-15px_rgba(0,0,0,0.5)] p-4 sm:p-5 animate-in fade-in zoom-in-95 duration-300 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-4 px-2 pt-2">
          <div className={`p-2 rounded-xl ${transportType === 'hsr' ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/30' : 'bg-blue-100 text-blue-600 dark:bg-blue-900/30'}`}>
            <MapPin className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-lg leading-tight text-slate-800 dark:text-slate-100">
              {isOrigin ? t('app.origin') : t('app.destination')}
            </h3>
            <p className="text-[11px] font-medium text-slate-400">
              {i18n.language === 'zh-TW' ? '選擇車站' : 'Select Station'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto p-2 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
          >
            <XCircle className="w-6 h-6" />
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-3 shrink-0 px-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('app.station.searchPlaceholder')}
            className={`w-full pl-11 pr-4 py-3 bg-slate-100/80 dark:bg-slate-800/80 rounded-2xl text-base outline-none focus:ring-2 transition-all shadow-inner ${
              transportType === 'hsr' ? 'focus:ring-orange-400/50' : 'focus:ring-blue-400/50'
            }`}
          />
        </div>

        {/* Body */}
        {stationsLoading ? (
          <div className="flex-1 py-12 flex justify-center text-slate-400 animate-pulse text-sm">Loading stations...</div>
        ) : stationsError ? (
          <div className="flex-1 py-8 text-center text-red-500 text-sm">
            {stationsError}
            <button
              onClick={onRetry}
              className="block mx-auto mt-3 px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition"
            >Retry</button>
          </div>
        ) : isTrain && !searching ? (
          /* 2-column county / station layout */
          <div className="flex flex-1 min-h-0">
            {/* County list */}
            <div
              ref={countyListRef}
              className="w-[40%] shrink-0 overflow-y-auto soft-scrollbar flex flex-col gap-0.5 pr-2 border-r border-slate-100 dark:border-slate-800"
            >
              {countyList.map(county => {
                const stationCount = stations.filter(s => extractCounty(s) === county).length;
                return (
                  <button
                    key={county}
                    onClick={() => setSelectedCounty(county)}
                    className={`w-full text-left px-2.5 py-2 rounded-xl text-sm font-semibold transition-all flex items-center justify-between gap-1 ${
                      county === activeCounty
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="truncate">{county}</span>
                    <span className={`text-[10px] shrink-0 px-1.5 py-0.5 rounded-full font-bold tabular-nums ${
                      county === activeCounty
                        ? 'bg-white/25 text-white'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                    }`}>{stationCount}</span>
                  </button>
                );
              })}
            </div>

            {/* Station list for selected county */}
            <div className="flex-1 overflow-y-auto soft-scrollbar flex flex-col gap-0.5 pl-2">
              {stationsForCounty.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-sm">
                  {i18n.language === 'zh-TW' ? '此縣市無車站' : 'No stations'}
                </div>
              ) : stationsForCounty.map(s => {
                const isSelected = s.StationID === selectedId;
                return (
                  <button
                    key={s.StationID}
                    onClick={() => onSelect(s.StationID)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl transition-all duration-150 flex items-center justify-between ${
                      isSelected
                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 font-bold shadow-sm ring-1 ring-blue-500/20'
                        : 'hover:bg-slate-100/80 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-300 font-medium'
                    }`}
                  >
                    <span className="text-sm">
                      {i18n.language === 'zh-TW' ? (s.StationName?.Zh_tw || '車站') : (s.StationName?.En || 'Station')}
                    </span>
                    {isSelected && <CheckCircle className="w-4 h-4 text-blue-500 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          /* Flat search / HSR list */
          <div className="flex-1 overflow-y-auto soft-scrollbar px-1 pb-2">
            {stationsForCounty.length === 0 ? (
              <div className="py-16 text-center text-slate-400 text-base">
                <p>{t('app.noResults') || 'No stations found'}</p>
              </div>
            ) : stationsForCounty.map(s => {
              const isSelected = s.StationID === selectedId;
              return (
                <button
                  key={s.StationID}
                  onClick={() => onSelect(s.StationID)}
                  className={`w-full text-left px-5 py-4 mb-2 rounded-[1.25rem] transition-all duration-200 flex items-center justify-between ${
                    isSelected
                      ? (transportType === 'hsr'
                        ? 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400 font-bold shadow-sm ring-1 ring-orange-500/20'
                        : 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 font-bold shadow-sm ring-1 ring-blue-500/20')
                      : 'hover:bg-slate-100/80 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-300 font-medium'
                  }`}
                >
                  <span className="text-lg">
                    {i18n.language === 'zh-TW' ? (s.StationName?.Zh_tw || '車站') : (s.StationName?.En || 'Station')}
                  </span>
                  {isSelected && <CheckCircle className={`w-5 h-5 ${transportType === 'hsr' ? 'text-orange-500' : 'text-blue-500'}`} />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
