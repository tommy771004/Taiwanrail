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

export interface RailTrainDelayRow {
  TrainNo?: string | number;
  DelayTime?: number;
}

/**
 * Layer the station LiveBoard over the network-wide LiveTrainDelay feed.
 *
 * LiveBoard only lists trains about to call at the searched station, so a train
 * that has already left it (a rider on board) or is still far up the line has no
 * row there; LiveTrainDelay covers every running train. Where both report a train,
 * the station board wins: it is the delay predicted for this station, while
 * LiveTrainDelay is the delay at the last station the train passed.
 * Rows without a finite DelayTime are skipped here rather than read as on time —
 * a missing reading must not turn a delayed train green.
 */
export function mergeRailLiveDelays(
  trainDelays: RailTrainDelayRow[] | null | undefined,
  board: IndexedRailLiveBoard,
): IndexedRailLiveBoard {
  const delays: Record<string, number> = {};
  for (const row of Array.isArray(trainDelays) ? trainDelays : []) {
    const trainNo = row?.TrainNo == null ? '' : String(row.TrainNo).trim();
    if (!trainNo) continue;
    if (typeof row.DelayTime !== 'number' || !Number.isFinite(row.DelayTime)) continue;
    delays[trainNo] = row.DelayTime;
  }
  for (const [trainNo, delay] of Object.entries(board.delays)) {
    // loadRailLiveDelays reads an unparseable DelayTime as 0; that guess must not
    // overwrite a real reading from LiveTrainDelay.
    const raw = board.details[trainNo]?.DelayTime;
    const hasReading = typeof raw === 'number' && Number.isFinite(raw);
    if (hasReading || !(trainNo in delays)) delays[trainNo] = delay;
  }
  return { delays, details: board.details };
}
