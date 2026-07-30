/**
 * TRA ODFare direction disambiguation (pure shared contract).
 *
 * TDX ships one ODFare record per (destination, train type, **direction**) — both
 * ways round the island. So 臺北→花蓮 carries the 北迴 route and the trip the long
 * way round via 南迴, and both claim the same OD. No scheduled train takes the long
 * way, but a consumer that keys only by train type silently keeps whichever record
 * came last in the file, which is how the app came to quote the long-way fare.
 *
 * Keeping the smallest `TravelDistance` per (destination, train type) picks the
 * route a direct train actually takes. This is a data-shape rule, not a fare rule:
 * it never looks at prices, so it holds across fare revisions.
 *
 * Imported by both the browser API layer and the build-time data refresh script, so
 * it must stay free of Node and DOM globals — same constraint as the affiliate
 * contract module.
 */

/** The only fields disambiguation needs. Structural, so both TRAODFare and raw TDX rows fit. */
export interface DirectionalODFare {
  DestinationStationID?: string;
  TrainType?: number | string;
  TravelDistance?: number;
}

function groupKey(row: DirectionalODFare): string {
  // NUL cannot occur in a TDX station ID or train type, so it joins without colliding.
  return `${row.DestinationStationID ?? ''}\u0000${row.TrainType ?? ''}`;
}

function distanceOf(row: DirectionalODFare): number {
  const d = row.TravelDistance;
  // A row without a usable distance ranks last, so a row that has one always wins.
  return typeof d === 'number' && Number.isFinite(d) ? d : Number.POSITIVE_INFINITY;
}

/**
 * Keep one record per (destination, train type): the one whose route is shortest.
 *
 * Ties and rows with no usable `TravelDistance` keep the first occurrence, so the
 * result is deterministic for a given input order. Input order of the winners is
 * preserved; nothing is added.
 */
export function pickShortestRouteFares<T extends DirectionalODFare>(
  rows: readonly T[],
): T[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const winnerIndexByKey = new Map<string, number>();

  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object') return;
    const key = groupKey(row);
    const incumbent = winnerIndexByKey.get(key);
    if (incumbent === undefined) {
      winnerIndexByKey.set(key, index);
      return;
    }
    // Strictly shorter wins; equal distance keeps the incumbent.
    if (distanceOf(row) < distanceOf(rows[incumbent])) {
      winnerIndexByKey.set(key, index);
    }
  });

  const kept = new Set(winnerIndexByKey.values());
  return rows.filter((_, index) => kept.has(index));
}
