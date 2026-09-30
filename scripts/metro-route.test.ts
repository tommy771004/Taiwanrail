import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
  computeMetroRoute,
  getMetroLineTransfer,
  getMetroS2STravelTime,
  type MetroLineTimes,
} from '../src/lib/metro.js';

/**
 * Transfer counting for 站到站. A branch line is several S2STravelTime entries under one
 * lineId (中和新蘆線 = 迴龍→南勢角 + 蘆洲→南勢角), and no train runs from one branch onto
 * the other, so 迴龍 → 蘆洲 is a change of trains at 大橋頭 even though the colour never
 * changes. Rule tests use a synthetic Y-shaped line; the pipeline test runs the committed
 * 台北捷運 data against trips checked by hand on the operator's route map.
 */

const name = (zh: string) => ({ Zh_tw: zh, En: zh });
const seg = (a: string, b: string) => ({ fromId: a, fromName: name(a), toId: b, toName: name(b), runTime: 120, stopTime: 30 });
const chain = (lineId: string, ids: string[]): MetroLineTimes => ({
  lineId,
  segments: ids.slice(0, -1).map((id, i) => seg(id, ids[i + 1])),
});

// Trunk T1–T3 splits at T3 into branches A1–A2 and B1–B2, like 大橋頭.
const Y = [chain('O', ['A2', 'A1', 'T3', 'T2', 'T1']), chain('O', ['B2', 'B1', 'T3', 'T2', 'T1'])];

test('riding the trunk into one branch is a single leg', () => {
  const r = computeMetroRoute(Y, [], 'T1', 'A2', true)!;
  assert.equal(r.transferCount, 0);
  assert.deepEqual(r.legs[0].stopIds, ['T1', 'T2', 'T3', 'A1', 'A2']);
});

test('branch to branch changes trains at the junction, with no walk', () => {
  const r = computeMetroRoute(Y, [], 'A2', 'B2', true)!;
  assert.equal(r.transferCount, 1);
  assert.deepEqual(r.legs.map((l) => l.stopIds), [['A2', 'A1', 'T3'], ['T3', 'B1', 'B2']]);
  assert.deepEqual(r.transfers, [{ stationName: 'T3', transferTimeSec: 0, sameLine: true }]);
});

test('a short-turn pattern inside a longer one never forces a change', () => {
  const lines = [chain('BL', ['X1', 'X2', 'X3', 'X4']), chain('BL', ['X2', 'X3'])];
  assert.equal(computeMetroRoute(lines, [], 'X1', 'X4', true)!.transferCount, 0);
});

test('committed 台北捷運 data: transfer counts match the route map', async () => {
  const root = process.cwd();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: string) => {
    try {
      const body = await readFile(join(root, 'public', String(u)), 'utf8');
      return { ok: true, json: async () => JSON.parse(body) } as Response;
    } catch {
      return { ok: false, json: async () => null } as unknown as Response;
    }
  }) as typeof fetch;
  try {
    const s2s = await getMetroS2STravelTime('TRTC');
    const edges = await getMetroLineTransfer('TRTC');
    const count = (a: string, b: string) => computeMetroRoute(s2s, edges, a, b, true)?.transferCount;
    const via = (a: string, b: string) => computeMetroRoute(s2s, edges, a, b, true)?.transfers.map((t) => t.stationName);

    // 中和新蘆線 has no stop on 文湖線: 2 transfers is the minimum.
    assert.equal(count('蘆洲', '木柵'), 2);
    // Branch changes on one line.
    assert.deepEqual(via('迴龍', '蘆洲'), ['大橋頭']);
    assert.deepEqual(via('新北投', '淡水'), ['北投']);
    assert.deepEqual(via('小碧潭', '新店'), ['七張']);
    // Plain cross-line trips stay at one.
    assert.equal(count('頂埔', '淡水'), 1);
    assert.equal(count('南港展覽館', '動物園'), 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});
