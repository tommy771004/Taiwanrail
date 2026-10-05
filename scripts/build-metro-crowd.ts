/**
 * Build public/data/metro_crowd.json — typical crowding per 台北捷運 / 環狀線 segment by hour —
 * from 臺北捷運各站分時進出量統計 (data.gov.tw 128506, 臺北大眾捷運股份有限公司, monthly).
 *
 *   npm run build-metro-crowd                 # latest month; exits early if already built
 *   npm run build-metro-crowd -- --month=2026-08 --force
 *
 * The monthly CSV is ~300MB (date, hour, entry station, exit station, riders), so it is streamed
 * and never written to disk. The model (routing, spill, levels) is in metro-crowd-model.ts.
 * Fails loudly when an OD-file station name maps to no station: dropping one would silently
 * bias every segment its riders cross.
 */
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';

import { buildLinePatterns, buildLineShape, metroServesWeekday } from '../src/lib/metroBoard.js';
import { CROWD_HOURS, encodeCrowdLevels, type CrowdDayType, type MetroCrowdTable } from '../src/lib/metroCrowd.js';
import {
  addFlow, buildCrowdGraph, classifyDays, emptyLoads, fastestPath, lineLevels, nextHop, resolveOdName,
  type CrowdPath, type CrowdStation,
} from './metro-crowd-model.js';

const INDEX_URL = 'https://data.taipei/api/dataset/63f31c7e-7fc3-418b-bd82-b95158755b4d/resource/eb481f58-1238-4cff-8caa-fa7bb20cb4f4/download';
const DATA = path.join(process.cwd(), 'public', 'data');
const OUT = path.join(DATA, 'metro_crowd.json');
/** Lines the OD file covers: everything TRTC runs, plus NTMC's 環狀線 (same fare gates). */
const SYSTEM_LINES: Record<string, string[] | null> = { TRTC: null, NTMC: ['Y'] };
/** S2STravelTime StopTime is 0 for TRTC; assume a typical dwell so routes compare fairly with NTMC's. */
const DEFAULT_DWELL_SEC = 25;
const MAX_NAMES = 160;
const MAX_DAYS = 31;

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const readJson = (f: string) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const unwrap = (d: any, key: string): any[] => (Array.isArray(d) ? d : d?.[key] ?? []);
const lineOf = (id: string) => id.match(/^[A-Z]+/)?.[0] ?? '';
const idKey = (id: string): [number, string] => [Number(id.match(/\d+/)?.[0] ?? 0), id.replace(/^[A-Za-z]*\d+/, '')];
const compareIds = (a: string, b: string) => idKey(a)[0] - idKey(b)[0] || idKey(a)[1].localeCompare(idKey(b)[1]);

// ── Network ────────────────────────────────────────────────────────────────
const stations: (CrowdStation & { system: string })[] = [];
const patternsByLine = new Map<string, string[][]>(); // "SYS:LINE" → patterns
const segmentSec = new Map<string, number>();
const transfers: { a: string; b: string; sec: number }[] = [];
for (const [system, only] of Object.entries(SYSTEM_LINES)) {
  const keep = (id: string) => !only || only.includes(lineOf(id));
  for (const s of unwrap(readJson(`metro_${system}/stations.json`), 'Stations')) {
    if (keep(s.StationID)) stations.push({ id: s.StationID, name: s.StationName?.Zh_tw ?? '', line: lineOf(s.StationID), system });
  }
  const s2s = unwrap(readJson(`metro_${system}/s2s.json`), 'S2STravelTimes').filter((l) => keep(l.TravelTimes?.[0]?.FromStationID ?? ''));
  for (const l of s2s) for (const t of l.TravelTimes) segmentSec.set(`${t.FromStationID}|${t.ToStationID}`, t.RunTime + (t.StopTime || DEFAULT_DWELL_SEC));
  const byCode = buildLinePatterns(
    s2s.map((l) => ({ segments: l.TravelTimes.map((t: any) => ({ fromId: t.FromStationID, toId: t.ToStationID })) })),
    lineOf,
    compareIds,
  );
  for (const line of new Set(stations.filter((s) => s.system === system).map((s) => s.line))) {
    const ids = stations.filter((s) => s.system === system && s.line === line).map((s) => s.id).sort(compareIds);
    patternsByLine.set(`${system}:${line}`, buildLineShape(byCode.get(line) ?? [], ids).patterns);
  }
  for (const t of unwrap(readJson(`metro_${system}/transfers.json`), 'LineTransfers')) {
    transfers.push({ a: t.FromStationID, b: t.ToStationID, sec: (Number(t.TransferTime) || 4) * 60 });
  }
}
const graph = buildCrowdGraph([...patternsByLine.values()].flat(), segmentSec, stations, transfers);
const systemOf = new Map(stations.map((s) => [s.id, s.system]));

// ── Which month ────────────────────────────────────────────────────────────
const indexCsv = await (await fetch(INDEX_URL)).text();
const months = indexCsv.split(/\r?\n/).slice(1).map((l) => l.split(',')).filter((c) => c.length >= 4 && /^\d{4}$/.test(c[1]))
  .map((c) => ({ month: `${c[1]}-${c[2].padStart(2, '0')}`, url: c[3].replace(/^http:/, 'https:') }));
const target = args.month ? months.find((m) => m.month === args.month) : months.sort((a, b) => a.month.localeCompare(b.month)).at(-1);
if (!target) throw new Error(`No ridership file for ${args.month ?? 'any month'} in the index`);
const existing = fs.existsSync(OUT) ? (JSON.parse(fs.readFileSync(OUT, 'utf8')) as MetroCrowdTable) : null;
if (existing?.Month === target.month && !('force' in args)) {
  console.log(`✅ metro_crowd.json is already built from ${target.month}; nothing to do.`);
  process.exit(0);
}

// ── Stream the month ───────────────────────────────────────────────────────
console.log(`⬇️  ${target.month}: ${decodeURIComponent(target.url)}`);
const res = await fetch(target.url);
if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
const nameIdx = new Map<string, number>();
const dateIdx = new Map<string, number>();
const flows = new Float32Array(MAX_DAYS * CROWD_HOURS * MAX_NAMES * MAX_NAMES);
const dayTotals: number[] = [];
const idxOf = <K>(m: Map<K, number>, k: K, max: number, what: string) => {
  let i = m.get(k);
  if (i === undefined) {
    if (m.size >= max) throw new Error(`More than ${max} ${what} in the file`);
    m.set(k, (i = m.size));
  }
  return i;
};
let rows = 0;
for await (const line of createInterface({ input: Readable.fromWeb(res.body as any), crlfDelay: Infinity })) {
  const c = line.split(',');
  if (c.length < 5 || !/^\d{4}-\d{2}-\d{2}$/.test(c[0])) continue;
  const n = Number(c[4]);
  if (!(n > 0)) continue;
  const d = idxOf(dateIdx, c[0], MAX_DAYS, 'dates');
  const h = Number(c[1]);
  const o = idxOf(nameIdx, c[2].trim(), MAX_NAMES, 'stations');
  const e = idxOf(nameIdx, c[3].trim(), MAX_NAMES, 'stations');
  flows[((d * CROWD_HOURS + h) * MAX_NAMES + o) * MAX_NAMES + e] += n;
  dayTotals[d] = (dayTotals[d] ?? 0) + n;
  if (++rows % 2_000_000 === 0) console.log(`   ${rows.toLocaleString()} rows…`);
}
console.log(`   ${rows.toLocaleString()} non-zero rows, ${dateIdx.size} days, ${nameIdx.size} stations`);

// ── Names → station ids (fail loudly) ──────────────────────────────────────
const idsOfName: string[][] = [];
const unresolved: string[] = [];
for (const [name, i] of nameIdx) {
  idsOfName[i] = resolveOdName(name, stations);
  if (idsOfName[i].length === 0) unresolved.push(name);
}
if (unresolved.length) {
  console.error(`❌ OD station names with no matching station: ${unresolved.join(', ')}`);
  console.error('   Fix resolveOdName (or the station list) — dropping them would bias every segment their riders cross.');
  process.exit(1);
}

// ── Day types, averages, routing ───────────────────────────────────────────
const dayType = classifyDays(new Map([...dateIdx].map(([date, i]) => [date, dayTotals[i] ?? 0])));
const days: Record<CrowdDayType, number[]> = { wd: [], we: [] };
for (const [date, i] of dateIdx) days[dayType.get(date)!].push(i);
const holidays = [...dateIdx.keys()].filter((date) => dayType.get(date) === 'we' && ![0, 6].includes(new Date(`${date}T12:00:00+08:00`).getUTCDay()));
console.log(`   weekday ${days.wd.length} days, weekend/holiday ${days.we.length} days${holidays.length ? ` (weekday holidays: ${holidays.join(', ')})` : ''}`);

const loads = emptyLoads();
const paths = new Map<number, CrowdPath | null>();
const N = nameIdx.size;
for (let o = 0; o < N; o++) {
  for (let e = 0; e < N; e++) {
    for (const t of ['wd', 'we'] as CrowdDayType[]) {
      for (let h = 0; h < CROWD_HOURS; h++) {
        let sum = 0;
        for (const d of days[t]) sum += flows[((d * CROWD_HOURS + h) * MAX_NAMES + o) * MAX_NAMES + e];
        if (sum <= 0) continue;
        const pk = o * MAX_NAMES + e;
        if (!paths.has(pk)) paths.set(pk, fastestPath(graph, idsOfName[o], idsOfName[e]));
        const p = paths.get(pk);
        if (p) addFlow(loads, t, h, sum / days[t].length, p);
      }
    }
  }
}

// ── Scheduled trains per segment-hour (from the committed station timetables) ─
const trainsByLine = new Map<string, Record<CrowdDayType, Map<string, Float64Array>>>();
for (const s of stations) {
  const file = path.join(DATA, `metro_${s.system}`, `${s.id}.json`);
  if (!fs.existsSync(file)) continue;
  const lineKey = `${s.system}:${s.line}`;
  const patterns = patternsByLine.get(lineKey) ?? [];
  if (!trainsByLine.has(lineKey)) trainsByLine.set(lineKey, { wd: new Map(), we: new Map() });
  const trains = trainsByLine.get(lineKey)!;
  for (const row of JSON.parse(fs.readFileSync(file, 'utf8'))) {
    const hop = nextHop(patterns, s.id, row.DestinationStaionID ?? row.DestinationStationID ?? '');
    if (!hop) continue;
    // Weekday = a Wednesday's rows; weekend = the mean of Saturday's and Sunday's.
    const weights: [CrowdDayType, number][] = [];
    if (metroServesWeekday(row, 3)) weights.push(['wd', 1]);
    if (metroServesWeekday(row, 6)) weights.push(['we', 0.5]);
    if (metroServesWeekday(row, 0)) weights.push(['we', 0.5]);
    for (const tt of row.Timetables ?? []) {
      const h = Number(String(tt.DepartureTime ?? '').slice(0, 2));
      if (!(h >= 0 && h < CROWD_HOURS)) continue;
      for (const [t, w] of weights) {
        const key = `${s.id}>${hop}`;
        let arr = trains[t].get(key);
        if (!arr) trains[t].set(key, (arr = new Float64Array(CROWD_HOURS)));
        arr[h] += w;
      }
    }
  }
}

// ── Levels per line ────────────────────────────────────────────────────────
const table: MetroCrowdTable = {
  Source: '臺北捷運各站分時進出量統計（政府資料開放平臺 data.gov.tw/dataset/128506，臺北大眾捷運股份有限公司）',
  Month: target.month,
  GeneratedAt: new Date().toISOString().slice(0, 10),
  Days: { wd: days.wd.length, we: days.we.length },
  Basis: {},
  Systems: {},
};
const allSegments = new Set([...loads.wd.keys(), ...loads.we.keys()]);
for (const lineKey of patternsByLine.keys()) {
  const [system, line] = lineKey.split(':');
  const segments = [...allSegments].filter((k) => systemOf.get(k.split('>')[0]) === system && lineOf(k.split('>')[0]) === line);
  const trains = trainsByLine.get(lineKey);
  table.Basis[lineKey] = trains ? 'perTrain' : 'perHour';
  for (const [key, levels] of lineLevels({ segments, loads, trains })) {
    (table.Systems[system] ??= {})[key] = encodeCrowdLevels(levels);
  }
}
for (const sys of Object.keys(table.Systems)) {
  table.Systems[sys] = Object.fromEntries(Object.entries(table.Systems[sys]).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));
}
fs.writeFileSync(OUT, JSON.stringify(table, null, 1) + '\n');

const count = Object.values(table.Systems).reduce((n, s) => n + Object.keys(s).length, 0);
console.log(`✅ ${count} segments → ${path.relative(process.cwd(), OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(1)} KB)`);
console.log(`   basis: ${Object.entries(table.Basis).map(([k, v]) => `${k}=${v}`).join(' ')}`);
