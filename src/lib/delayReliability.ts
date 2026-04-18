const HISTORY_KEY = 'rail_delay_history_v1';
const MAX_SAMPLES_PER_TRAIN = 12;
const MAX_TRAINS_TRACKED = 200;

export type ReliabilityLevel = 'reliable' | 'minor' | 'caution' | 'frequent';

export interface ReliabilityScore {
  level: ReliabilityLevel;
  score: number;
  expectedDelayMin: number;
  reasons: string[];
  sampleSize: number;
  source: 'observed' | 'heuristic' | 'mixed';
}

interface DelayRecord {
  delays: number[];
  updatedAt: number;
}

type HistoryMap = Record<string, DelayRecord>;

function readHistory(): HistoryMap {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as HistoryMap;
  } catch {
    return {};
  }
}

function writeHistory(map: HistoryMap): void {
  if (typeof localStorage === 'undefined') return;
  try {
    let trimmed = map;
    const keys = Object.keys(map);
    if (keys.length > MAX_TRAINS_TRACKED) {
      const sorted = keys.sort((a, b) => map[b].updatedAt - map[a].updatedAt);
      trimmed = {};
      sorted.slice(0, MAX_TRAINS_TRACKED).forEach((k) => {
        trimmed[k] = map[k];
      });
    }
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  } catch (err) {
    console.warn('[delayReliability] failed to persist history', err);
  }
}

export function recordDelaySample(trainNo: string, delayMinutes: number): void {
  if (!trainNo) return;
  if (!Number.isFinite(delayMinutes)) return;
  const map = readHistory();
  const rec = map[trainNo] || { delays: [], updatedAt: 0 };
  rec.delays = [...rec.delays.slice(-(MAX_SAMPLES_PER_TRAIN - 1)), Math.max(0, Math.round(delayMinutes))];
  rec.updatedAt = Date.now();
  map[trainNo] = rec;
  writeHistory(map);
}

export function recordDelayBatch(samples: Record<string, number>): void {
  const map = readHistory();
  const now = Date.now();
  let touched = false;
  for (const [trainNo, delay] of Object.entries(samples)) {
    if (!trainNo || !Number.isFinite(delay)) continue;
    const rec = map[trainNo] || { delays: [], updatedAt: 0 };
    const last = rec.delays[rec.delays.length - 1];
    // Avoid spamming identical successive samples within 2 min.
    if (last === Math.round(delay) && now - rec.updatedAt < 120_000) continue;
    rec.delays = [...rec.delays.slice(-(MAX_SAMPLES_PER_TRAIN - 1)), Math.max(0, Math.round(delay))];
    rec.updatedAt = now;
    map[trainNo] = rec;
    touched = true;
  }
  if (touched) writeHistory(map);
}

function average(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

export interface ReliabilityInput {
  trainNo: string;
  trainTypeId?: string;
  trainTypeName?: string;
  tripLine?: number;
  direction?: number;
  transportType: 'hsr' | 'train';
  departureMinutes?: number;
  destinationStationId?: string;
  originStationId?: string;
}

const EAST_LINE_PREFIXES = ['7', '8'];

function looksLikeEastLine(stationId?: string): boolean {
  if (!stationId) return false;
  return EAST_LINE_PREFIXES.includes(stationId.charAt(0));
}

function isCrossLineTzeChiang(input: ReliabilityInput): boolean {
  if (input.transportType !== 'train') return false;
  const name = input.trainTypeName || '';
  if (!name.includes('自強')) return false;
  // 跨線自強 (西部幹線 ↔ 東部幹線) 常見誤點
  const oEast = looksLikeEastLine(input.originStationId);
  const dEast = looksLikeEastLine(input.destinationStationId);
  return oEast !== dEast;
}

export function getReliability(input: ReliabilityInput): ReliabilityScore | null {
  if (!input.trainNo) return null;

  const history = readHistory()[input.trainNo];
  const observed = history?.delays || [];
  const observedAvg = average(observed);
  const observedHits = observed.filter((d) => d >= 5).length;

  const reasons: string[] = [];
  let heuristicDelay = 0;

  if (input.transportType === 'hsr') {
    heuristicDelay = 0;
  } else if (isCrossLineTzeChiang(input)) {
    heuristicDelay += 7;
    reasons.push('cross_line');
  } else if (looksLikeEastLine(input.originStationId) || looksLikeEastLine(input.destinationStationId)) {
    heuristicDelay += 4;
    reasons.push('east_line');
  }

  if (input.transportType === 'train' && input.departureMinutes != null) {
    const m = input.departureMinutes;
    const isPeak = (m >= 7 * 60 && m <= 9 * 60 + 30) || (m >= 17 * 60 && m <= 19 * 60 + 30);
    if (isPeak) {
      heuristicDelay += 2;
      reasons.push('peak_hour');
    }
  }

  // Combined estimate: weight observed data when we have ≥3 samples.
  let expectedDelayMin: number;
  let source: ReliabilityScore['source'];
  if (observed.length >= 3) {
    const w = Math.min(1, observed.length / 6);
    expectedDelayMin = Math.round(observedAvg * w + heuristicDelay * (1 - w));
    source = heuristicDelay > 0 ? 'mixed' : 'observed';
  } else if (observed.length > 0) {
    expectedDelayMin = Math.round((observedAvg + heuristicDelay) / 2);
    source = 'mixed';
  } else if (heuristicDelay > 0) {
    expectedDelayMin = heuristicDelay;
    source = 'heuristic';
  } else {
    return null;
  }

  if (observedHits >= 2 && !reasons.includes('observed_late')) {
    reasons.push('observed_late');
  }

  let level: ReliabilityLevel;
  if (expectedDelayMin >= 10) level = 'frequent';
  else if (expectedDelayMin >= 5) level = 'caution';
  else if (expectedDelayMin >= 2) level = 'minor';
  else level = 'reliable';

  // Score: 100 = perfectly on time, 0 = chronic late
  const score = Math.max(0, Math.min(100, 100 - expectedDelayMin * 6));

  return {
    level,
    score,
    expectedDelayMin,
    reasons,
    sampleSize: observed.length,
    source,
  };
}
