import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeMetroStationName } from '../src/lib/stationFootfall.js';

const METRO_INDEX_URL = 'https://data.taipei/api/dataset/63f31c7e-7fc3-418b-bd82-b95158755b4d/resource/eb481f58-1238-4cff-8caa-fa7bb20cb4f4/download';
const TRA_RESOURCE_URL = 'https://ods.railway.gov.tw/tra-ods-web/ods/download/dataResource/8ae4cabf6973990e0169947ed32454b9';

type Score = 0 | 1 | 2;
type MetroOutput = Record<string, Array<Array<Score | null>>>;
type TraOutput = Record<string, Array<Score | null>>;

interface MetroIndexRow {
  SeqNo: string;
  西元年: string;
  月: string;
  URL: string;
}

interface TraRow {
  trnOpDate: string;
  staCode: string;
  gateInComingCnt: string;
  gateOutGoingCnt: string;
}

function weekdayForDate(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(value.getTime()) ? null : value.getUTCDay();
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function quantile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function classify(value: number, lower: number, upper: number): Score {
  if (upper <= lower) return 1;
  if (value <= lower) return 0;
  if (value >= upper) return 2;
  return 1;
}

function parseCsvLine(line: string): string[] {
  // The operator CSV has five unquoted fields. Keep a small quoted-field parser
  // so a future station label with punctuation cannot silently shift columns.
  const result: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  return response.text();
}

function makeMetroMatrix(): Array<Array<Score | null>> {
  return Array.from({ length: 7 }, () => Array<Score | null>(24).fill(null));
}

async function buildMetro(): Promise<{ data: MetroOutput; sourceMonth: string; sourceUrl: string }> {
  const indexText = await fetchText(METRO_INDEX_URL);
  const [header, ...lines] = indexText.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (!header.includes('URL')) throw new Error('Unexpected Taipei Metro index header');

  const rows = lines
    .map(line => parseCsvLine(line))
    .filter(parts => parts.length >= 4)
    .map(parts => ({ SeqNo: parts[0], 西元年: parts[1], 月: parts[2], URL: parts[3] } satisfies MetroIndexRow))
    .filter(row => row.URL);
  const latest = rows.sort((a, b) => Number(a.SeqNo) - Number(b.SeqNo)).at(-1);
  if (!latest) throw new Error('Taipei Metro index has no monthly CSV');

  const sourceUrl = latest.URL.replace(/^http:/, 'https:');
  const csv = await fetchText(sourceUrl);
  const dailyTotals = new Map<string, number>();
  const csvLines = csv.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (csvLines.shift() !== '日期,時段,進站,出站,人次') throw new Error('Unexpected Taipei Metro monthly CSV header');

  for (const line of csvLines) {
    if (!line) continue;
    const [date, hourRaw, entering, exiting, countRaw] = parseCsvLine(line);
    const hour = Number(hourRaw);
    const count = Number(countRaw);
    if (weekdayForDate(date) === null || !Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isFinite(count)) continue;
    for (const name of [entering, exiting]) {
      const station = normalizeMetroStationName(name || '');
      if (!station) continue;
      const key = `${date}|${hour}|${station}`;
      dailyTotals.set(key, (dailyTotals.get(key) ?? 0) + count);
    }
  }

  const samples = new Map<string, Array<Array<number[]>>>();
  for (const [key, total] of dailyTotals) {
    const [date, hourRaw, station] = key.split('|');
    const weekday = weekdayForDate(date);
    const hour = Number(hourRaw);
    if (weekday === null) continue;
    let matrix = samples.get(station);
    if (!matrix) {
      matrix = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => []));
      samples.set(station, matrix);
    }
    matrix[weekday][hour].push(total);
  }

  const data: MetroOutput = {};
  for (const [station, matrix] of samples) {
    const averages = matrix.map(day => day.map(values => average(values)));
    const comparable = averages.flat().filter((value): value is number => value !== null);
    if (comparable.length < 3) continue;
    const lower = quantile(comparable, 1 / 3);
    const upper = quantile(comparable, 2 / 3);
    const output = makeMetroMatrix();
    for (let weekday = 0; weekday < 7; weekday++) {
      for (let hour = 0; hour < 24; hour++) {
        const value = averages[weekday][hour];
        if (value !== null) output[weekday][hour] = classify(value, lower, upper);
      }
    }
    data[station] = output;
  }

  return { data, sourceMonth: `${latest.西元年}-${latest.月.padStart(2, '0')}`, sourceUrl };
}

async function buildTra(): Promise<{ data: TraOutput; dateRange: string }> {
  const response = await fetch(TRA_RESOURCE_URL);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${TRA_RESOURCE_URL}`);
  const rows = await response.json() as TraRow[];
  if (!Array.isArray(rows)) throw new Error('Unexpected TRA JSON payload');

  const samples = new Map<string, Array<number[]>>();
  let earliest = '';
  let latest = '';
  for (const row of rows) {
    const compactDate = row.trnOpDate;
    const date = /^\d{8}$/.test(compactDate)
      ? `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`
      : '';
    const weekday = weekdayForDate(date);
    const total = Number(row.gateInComingCnt) + Number(row.gateOutGoingCnt);
    if (weekday === null || !row.staCode || !Number.isFinite(total)) continue;
    let days = samples.get(row.staCode);
    if (!days) {
      days = Array.from({ length: 7 }, () => []);
      samples.set(row.staCode, days);
    }
    days[weekday].push(total);
    if (!earliest || date < earliest) earliest = date;
    if (!latest || date > latest) latest = date;
  }

  const data: TraOutput = {};
  for (const [stationId, days] of samples) {
    const averages = days.map(day => average(day));
    const comparable = averages.filter((value): value is number => value !== null);
    if (comparable.length < 3) continue;
    const lower = quantile(comparable, 1 / 3);
    const upper = quantile(comparable, 2 / 3);
    data[stationId] = averages.map(value => value === null ? null : classify(value, lower, upper));
  }

  return { data, dateRange: earliest && latest ? `${earliest}..${latest}` : '' };
}

async function main() {
  const [metro, tra] = await Promise.all([buildMetro(), buildTra()]);
  const output = {
    version: 1 as const,
    generatedAt: new Date().toISOString(),
    sources: {
      metro: { dataset: 'https://data.gov.tw/dataset/128506', month: metro.sourceMonth, url: metro.sourceUrl },
      tra: { dataset: 'https://data.gov.tw/dataset/8792', range: tra.dateRange, url: TRA_RESOURCE_URL },
    },
    metro: metro.data,
    tra: tra.data,
  };
  const outputPath = path.join(process.cwd(), 'public', 'data', 'station-footfall.json');
  await fs.writeFile(outputPath, `${JSON.stringify(output)}\n`, 'utf8');
  console.log(`Wrote ${outputPath}: ${Object.keys(metro.data).length} Metro station names, ${Object.keys(tra.data).length} TRA stations.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
