import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { decodeCrowdLevel, encodeCrowdLevels, typicalCrowdAt, type CrowdLevel, type MetroCrowdTable } from '../src/lib/metroCrowd.js';
import {
  addFlow, buildCrowdGraph, classifyDays, emptyLoads, fastestPath, lineLevels, MIN_HOURLY_LOAD, nextHop,
  NOMINAL_SEGMENT_SEC, resolveOdName, TRANSFER_PENALTY_SEC,
} from './metro-crowd-model.js';

/**
 * 「此時段通常多擠」 is an estimate, so these tests pin the rules that keep it honest:
 * riders are only counted on train segments (never on a transfer walk), a flow spills into
 * the next hour by ride time, levels are relative to the line's own busy hours, and a cell
 * with no estimate decodes to null rather than "quiet".
 */

// Line A: A1–A2–A3–A4; line B crosses at A2 (B1–B2, B2 = A2 by transfer); A4 has no run time.
const stations = [
  { id: 'A1', name: '甲', line: 'A' }, { id: 'A2', name: '乙', line: 'A' }, { id: 'A3', name: '丙', line: 'A' },
  { id: 'A4', name: '丁', line: 'A' }, { id: 'B1', name: '戊', line: 'B' }, { id: 'B2', name: '乙', line: 'B' },
];
const sec = new Map([['A1|A2', 120], ['A2|A3', 120], ['B1|B2', 100]]);
const graph = buildCrowdGraph([['A1', 'A2', 'A3', 'A4'], ['B1', 'B2']], sec, stations, []);

test('OD names: 臺/台 and a trailing 站 are ignored; a line prefix restricts to that line', () => {
  assert.deepEqual(resolveOdName('乙站', stations), ['A2', 'B2']);
  assert.deepEqual(resolveOdName('B乙', stations), ['B2']);
  assert.deepEqual(resolveOdName('不存在', stations), []);
});

test('routing: riders are counted on train segments only, never on the transfer', () => {
  const p = fastestPath(graph, ['B1'], ['A3'])!;
  assert.deepEqual(p.segments.map((s) => `${s.from}>${s.to}`), ['B1>B2', 'A2>A3']);
  // The second segment starts after the first ride plus the transfer and its waiting penalty.
  assert.ok(p.segments[1].atSec >= 100 + TRANSFER_PENALTY_SEC);
  assert.equal(fastestPath(graph, ['A2'], ['A2', 'B2']), null);
});

test('a segment without a run time still routes, at the nominal weight', () => {
  const p = fastestPath(graph, ['A3'], ['A4'])!;
  assert.deepEqual(p.segments, [{ from: 'A3', to: 'A4', atSec: 0 }]);
  assert.equal(graph.get('A3')!.find((e) => e.to === 'A4')!.sec, NOMINAL_SEGMENT_SEC);
});

test('a flow spills into the next hour by how long after entry the segment is ridden', () => {
  const loads = emptyLoads();
  addFlow(loads, 'wd', 8, 100, { segments: [{ from: 'A1', to: 'A2', atSec: 0 }, { from: 'A2', to: 'A3', atSec: 1800 }] });
  assert.equal(loads.wd.get('A1>A2')![8], 100);
  assert.equal(loads.wd.get('A2>A3')![8], 50);
  assert.equal(loads.wd.get('A2>A3')![9], 50);
  addFlow(loads, 'wd', 23, 10, { segments: [{ from: 'A1', to: 'A2', atSec: 3600 }] });
  assert.equal(loads.wd.get('A1>A2')![0], 10); // past midnight wraps to hour 0
});

test('levels are relative to the line\'s busy weekday hours, per train where trains are known', () => {
  const loads = emptyLoads();
  const peak = new Float64Array(24);
  peak[8] = 1000; peak[12] = 400; peak[3] = MIN_HOURLY_LOAD - 1;
  loads.wd.set('A1>A2', peak);
  // Perhour: 08 is the reference, 12 is 40% of it → level 2, below the floor → 0.
  const perHour = lineLevels({ segments: ['A1>A2'], loads }).get('A1>A2')!;
  assert.equal(perHour.wd[8], 4);
  assert.equal(perHour.wd[12], 2);
  assert.equal(perHour.wd[3], 0);
  // Per train: midday runs a third as many trains, so each one carries more than at the peak.
  const n = new Float64Array(24);
  n[8] = 20; n[12] = 4;
  const perTrain = lineLevels({ segments: ['A1>A2'], loads, trains: { wd: new Map([['A1>A2', n]]), we: new Map() } }).get('A1>A2')!;
  assert.equal(perTrain.wd[12], 4);
  assert.equal(perTrain.wd[8], 2); // 50 per train vs the 100-per-train reference
});

test('a low-ridership weekday counts as a holiday', () => {
  const totals = new Map([
    ['2026-08-03', 2_400_000], ['2026-08-04', 2_500_000], ['2026-08-05', 2_450_000],
    ['2026-08-06', 1_200_000], ['2026-08-08', 1_500_000],
  ]);
  const t = classifyDays(totals);
  assert.equal(t.get('2026-08-04'), 'wd');
  assert.equal(t.get('2026-08-06'), 'we'); // a Thursday at half the usual ridership
  assert.equal(t.get('2026-08-08'), 'we'); // Saturday
});

test('encoding round-trips, and a cell with no estimate is null rather than quiet', () => {
  const wd = Array.from({ length: 24 }, (_, h) => (h === 8 ? 4 : h === 3 ? 0 : 1)) as (CrowdLevel | 0)[];
  const enc = encodeCrowdLevels({ wd, we: Array(24).fill(2) });
  assert.equal(enc.length, 48);
  assert.equal(decodeCrowdLevel(enc, 'wd', 8), 4);
  assert.equal(decodeCrowdLevel(enc, 'wd', 3), null);
  assert.equal(decodeCrowdLevel(enc, 'we', 8), 2);
});

test('lookup: busiest branch wins at a fork, and past midnight moves to the next calendar day', () => {
  const quiet = encodeCrowdLevels({ wd: Array(24).fill(1), we: Array(24).fill(1) });
  const busy = encodeCrowdLevels({ wd: Array(24).fill(3), we: Array(24).fill(2) });
  const segs = { 'X>Y': quiet, 'X>Z': busy };
  assert.equal(typicalCrowdAt(segs, 'X', ['Y', 'Z'], 3, 8 * 60)!.level, 3);
  // Friday 23:58 + 5 min → Saturday 00:03, a weekend hour.
  const late = typicalCrowdAt(segs, 'X', ['Z'], 5, 23 * 60 + 58 + 5)!;
  assert.deepEqual([late.hour, late.dayType, late.level], [0, 'we', 2]);
  assert.equal(typicalCrowdAt(segs, 'X', ['W'], 3, 600), null);
  assert.equal(typicalCrowdAt(undefined, 'X', ['Y'], 3, 600), null);
});

test('nextHop follows the pattern through both stations, not across branches', () => {
  const patterns = [['O01', 'O12', 'O13'], ['O01', 'O12', 'O50']];
  assert.equal(nextHop(patterns, 'O12', 'O50'), 'O50');
  assert.equal(nextHop(patterns, 'O12', 'O01'), 'O01');
  assert.equal(nextHop(patterns, 'O13', 'O50'), null);
});

test('committed table: inbound morning peak is busier than midday, and every cell decodes', async () => {
  const t: MetroCrowdTable = JSON.parse(await readFile(join(process.cwd(), 'public/data/metro_crowd.json'), 'utf8'));
  assert.match(t.Month, /^\d{4}-\d{2}$/);
  for (const segs of Object.values(t.Systems)) for (const v of Object.values(segs)) assert.match(v, /^[0-4]{48}$/);
  const trtc = t.Systems.TRTC;
  const at = (key: string, hour: number) => decodeCrowdLevel(trtc[key], 'wd', hour)!;
  assert.ok(at('O04>O05', 8) > at('O04>O05', 12), '頂溪→古亭 08h > 12h');
  assert.ok(at('BL07>BL08', 8) > at('BL08>BL07', 8), '板橋→新埔 inbound > outbound at 08h');
  assert.ok(t.Systems.NTMC && Object.keys(t.Systems.NTMC).length > 0, '環狀線 is covered');
});
