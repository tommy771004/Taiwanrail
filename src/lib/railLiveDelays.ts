export interface RailLiveBoardRow {
  TrainNo?: string | number;
  DelayTime?: number;
  Platform?: string;
}

export interface IndexedRailLiveBoard {
  delays: Record<string, number>;
  details: Record<string, RailLiveBoardRow>;
}

/**
 * Fetch one station LiveBoard once, then index the response so every timetable
 * card can reuse it without issuing a per-train request.
 */
export async function loadRailLiveDelays(
  fetchLiveBoard: (stationId: string) => Promise<RailLiveBoardRow[]>,
  stationId: string,
): Promise<IndexedRailLiveBoard> {
  const rows = await fetchLiveBoard(stationId);
  const delays: Record<string, number> = {};
  const details: Record<string, RailLiveBoardRow> = {};

  for (const row of Array.isArray(rows) ? rows : []) {
    const trainNo = row?.TrainNo == null ? '' : String(row.TrainNo).trim();
    if (!trainNo) continue;

    delays[trainNo] = typeof row.DelayTime === 'number' && Number.isFinite(row.DelayTime)
      ? row.DelayTime
      : 0;
    details[trainNo] = row;
  }

  return { delays, details };
}
