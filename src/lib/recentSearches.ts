const KEY = 'rail_recent_searches_v1';
const MAX_ENTRIES = 8;

export interface RecentSearchEntry {
  id: string;
  transportType: 'hsr' | 'train';
  originId: string;
  destId: string;
  originName: string;
  destName: string;
  date: string; // absolute YYYY-MM-DD
  selectedDateId: string; // relative id used when saved (today/tomorrow/d3…)
  tripType: 'one-way' | 'round-trip';
  returnDate?: string;
  savedAt: number;
}

function read(): RecentSearchEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(entries: RecentSearchEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch (err) {
    console.warn('[recentSearches] failed to persist', err);
  }
}

export function listRecentSearches(): RecentSearchEntry[] {
  return read();
}

export function addRecentSearch(entry: Omit<RecentSearchEntry, 'id' | 'savedAt'>): RecentSearchEntry[] {
  const existing = read();
  const dedupKey = `${entry.transportType}|${entry.originId}|${entry.destId}|${entry.date}|${entry.tripType}|${entry.returnDate || ''}`;
  const filtered = existing.filter(e =>
    `${e.transportType}|${e.originId}|${e.destId}|${e.date}|${e.tripType}|${e.returnDate || ''}` !== dedupKey
  );
  const next: RecentSearchEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: Date.now(),
  };
  const merged = [next, ...filtered].slice(0, MAX_ENTRIES);
  write(merged);
  return merged;
}

export function removeRecentSearch(id: string): RecentSearchEntry[] {
  const next = read().filter(e => e.id !== id);
  write(next);
  return next;
}

export function clearRecentSearches(): void {
  write([]);
}
