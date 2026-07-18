const KEY = 'rail_recent_searches_v1';
const MAX_ENTRIES = 8;

export interface RecentSearchEntry {
  id: string;
  transportType: 'hsr' | 'train';
  originId: string;
  destId: string;
  originName: string;
  destName: string;
  tripType: 'one-way' | 'round-trip';
  savedAt: number;
}

function read(): RecentSearchEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const hadDateFields = parsed.some((entry) =>
      entry && typeof entry === 'object' && (
        'date' in entry || 'selectedDateId' in entry || 'returnDate' in entry
      )
    );
    const normalized = parsed
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
      .map((entry) => {
        const cleanEntry = { ...entry };
        delete cleanEntry.date;
        delete cleanEntry.selectedDateId;
        delete cleanEntry.returnDate;
        return cleanEntry as unknown as RecentSearchEntry;
      });

    // Migrate v1 entries so dates are no longer retained in localStorage.
    if (hadDateFields) {
      try {
        localStorage.setItem(KEY, JSON.stringify(normalized.slice(0, MAX_ENTRIES)));
      } catch {
        // Ignore migration failures; the in-memory normalized list is still usable.
      }
    }
    return normalized;
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
  const dedupKey = `${entry.transportType}|${entry.originId}|${entry.destId}|${entry.tripType}`;
  const filtered = existing.filter(e =>
    `${e.transportType}|${e.originId}|${e.destId}|${e.tripType}` !== dedupKey
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
