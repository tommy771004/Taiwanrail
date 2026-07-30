import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
  pickShortestRouteFares,
  type DirectionalODFare,
} from '../src/lib/odFareDirection.js';

/**
 * Two kinds of test here, deliberately separated:
 *
 * 1. **Rule tests** use synthetic rows. TDX ships one ODFare record per
 *    (destination, train type, direction) — both ways round the island — but the
 *    refresh pipeline now disambiguates on the way in, so the committed dataset no
 *    longer contains a pair to choose between. Synthetic rows are the only place the
 *    choice can still be exercised.
 * 2. **Pipeline tests** use the committed dataset, and assert the invariant the
 *    refresh script is supposed to maintain. They fail if a future refresh stops
 *    disambiguating, or if the upstream shape drifts.
 *
 * Every assertion is RELATIONAL — "the kept record is the shortest of its group".
 * None pins a fare amount or a distance. Fares change with the every-other-day
 * refresh and with operator revisions, so a hardcoded amount would fail on a
 * legitimate price change and would freeze an unverified number into the spec.
 */
const TAIPEI_ORIGIN_FILE = join(
  process.cwd(),
  'public',
  'data',
  'tra-fares',
  '1000.json',
);

type Row = DirectionalODFare & { Direction?: string | number };

const row = (
  trainType: number | string,
  travelDistance?: number,
  direction?: string,
): Row => ({
  DestinationStationID: '7000',
  TrainType: trainType,
  ...(travelDistance === undefined ? {} : { TravelDistance: travelDistance }),
  ...(direction === undefined ? {} : { Direction: direction }),
});

async function loadTaipeiFares(): Promise<Row[]> {
  const raw = await readFile(TAIPEI_ORIGIN_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : parsed.ODFares ?? [];
}

function groupOf(rows: readonly Row[]): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.DestinationStationID}|${r.TrainType}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(r);
    else groups.set(key, [r]);
  }
  return groups;
}

// --- Rule tests (synthetic rows) ---

test('picks the shorter route when both directions are present', () => {
  const short = row(3, 194.3, '順行');
  const long = row(3, 681.6, '逆行');

  assert.deepEqual(pickShortestRouteFares([short, long]), [short]);
  // Order must not decide the winner: the pre-fix consumer kept whichever came last.
  assert.deepEqual(pickShortestRouteFares([long, short]), [short]);
});

test('never keeps the longest route', () => {
  const candidates = [row(3, 681.6), row(3, 194.3), row(3, 420.0)];
  const longest = Math.max(...candidates.map((r) => r.TravelDistance!));

  const [kept] = pickShortestRouteFares(candidates);
  assert.notEqual(kept.TravelDistance, longest);
  assert.equal(kept.TravelDistance, Math.min(...candidates.map((r) => r.TravelDistance!)));
});

test('a lone candidate passes through untouched', () => {
  const only = row(3, 194.3);
  assert.deepEqual(pickShortestRouteFares([only]), [only]);
});

test('train types are disambiguated independently', () => {
  const tzeChiangShort = row(3, 194.3);
  const tzeChiangLong = row(3, 681.6);
  const chuKuangShort = row(4, 194.3);
  const chuKuangLong = row(4, 681.6);

  assert.deepEqual(
    pickShortestRouteFares([tzeChiangLong, chuKuangShort, tzeChiangShort, chuKuangLong]),
    [chuKuangShort, tzeChiangShort],
  );
});

test('destinations are disambiguated independently', () => {
  const hualien = { DestinationStationID: '7000', TrainType: 3, TravelDistance: 194.3 };
  const taitung = { DestinationStationID: '6000', TrainType: 3, TravelDistance: 380.0 };

  assert.deepEqual(pickShortestRouteFares([hualien, taitung]), [hualien, taitung]);
});

test('a record with a usable distance beats one without', () => {
  const withoutDistance = row(3);
  const withDistance = row(3, 194.3);

  assert.deepEqual(pickShortestRouteFares([withoutDistance, withDistance]), [withDistance]);
  assert.deepEqual(pickShortestRouteFares([withDistance, withoutDistance]), [withDistance]);
});

test('non-finite distances are treated as unusable', () => {
  const nan = { DestinationStationID: '7000', TrainType: 3, TravelDistance: Number.NaN };
  const usable = row(3, 681.6);

  assert.deepEqual(pickShortestRouteFares([nan, usable]), [usable]);
});

test('when no candidate has a distance the first occurrence is kept', () => {
  const first = row(3, undefined, '順行');
  const second = row(3, undefined, '逆行');

  assert.deepEqual(pickShortestRouteFares([first, second]), [first]);
});

test('equal distances keep the first occurrence, so output is deterministic', () => {
  const first = row(3, 10, '順行');
  const second = row(3, 10, '逆行');

  assert.deepEqual(pickShortestRouteFares([first, second]), [first]);
});

test('preserves input order and never invents records', () => {
  const rows = [row(4, 681.6), row(3, 194.3), row(4, 194.3), row(7, 194.3)];
  const kept = pickShortestRouteFares(rows);

  assert.ok(kept.length <= rows.length);
  let cursor = -1;
  for (const r of kept) {
    const index = rows.indexOf(r);
    assert.ok(index > cursor, 'kept records are out of input order');
    cursor = index;
  }
});

test('empty and malformed input is safe', () => {
  assert.deepEqual(pickShortestRouteFares([]), []);
  assert.deepEqual(pickShortestRouteFares(undefined as unknown as Row[]), []);
  assert.deepEqual(
    pickShortestRouteFares([null as unknown as Row, undefined as unknown as Row]),
    [],
  );
});

// --- Pipeline tests (committed dataset) ---

test('committed dataset holds one record per destination and train type', async () => {
  // Fails if a future refresh stops disambiguating on the way in.
  const rows = await loadTaipeiFares();
  assert.ok(rows.length > 0, 'fixture is empty; dataset missing?');

  for (const [key, bucket] of groupOf(rows)) {
    assert.equal(bucket.length, 1, `committed dataset has ${bucket.length} records for ${key}`);
  }
});

test('every committed record carries a usable travel distance', async () => {
  // Upstream shape guard: without TravelDistance the rule silently degrades to
  // "keep the first record", which would reintroduce the bug without failing above.
  const rows = await loadTaipeiFares();

  const missing = rows.filter(
    (r) => typeof r.TravelDistance !== 'number' || !Number.isFinite(r.TravelDistance),
  );
  assert.equal(missing.length, 0, `${missing.length} committed records lack TravelDistance`);
});

test('disambiguation is idempotent on the committed dataset', async () => {
  const rows = await loadTaipeiFares();
  assert.equal(pickShortestRouteFares(rows).length, rows.length);
});
