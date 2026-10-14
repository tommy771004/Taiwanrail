import { RefreshCw } from 'lucide-react';

interface RefreshButtonProps {
  onRefresh: () => void;
  refreshing: boolean;
  label: string;
  className?: string;
}

/**
 * Icon button that re-requests one live panel (nearby bus stops, a YouBike dock).
 * Stops propagation because these panels sit inside clickable result cards.
 */
export default function RefreshButton({ onRefresh, refreshing, label, className = '' }: RefreshButtonProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!refreshing) onRefresh();
      }}
      disabled={refreshing}
      aria-label={label}
      className={`size-8 shrink-0 inline-flex items-center justify-center rounded-full transition-colors disabled:cursor-wait ${className}`}
    >
      <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
    </button>
  );
}
