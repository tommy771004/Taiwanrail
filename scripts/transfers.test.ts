import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import { getDetailedTransfers } from '../src/components/TransferMapModal';
import { getTransfers } from '../src/lib/transfers';

// transfers.ts is keyed by station name, so a typo or a metro-only name (圓山, 美麗島)
// silently never matches. These tests tie it to the committed station datasets.

type Station = { StationID: string; StationName: { Zh_tw: string }; StationPosition?: { PositionLat?: number; PositionLon?: number } };

function rows(path: string): Station[] {
  const json = JSON.parse(readFileSync(path, 'utf8'));
  if (Array.isArray(json)) return json;
  return Object.values(json).find(Array.isArray) as Station[];
}

function metres(a: Station, b: Station): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const [la1, lo1, la2, lo2] = [a.StationPosition!.PositionLat!, a.StationPosition!.PositionLon!, b.StationPosition!.PositionLat!, b.StationPosition!.PositionLon!].map(rad);
  return 6_371_000 * Math.hypot((lo2 - lo1) * Math.cos((la1 + la2) / 2), la2 - la1);
}

const hasPos = (s: Station) => !!(s.StationPosition?.PositionLat && s.StationPosition?.PositionLon);

const tra = rows('public/data/tra-stations.json');
const thsr = rows('public/data/thsr-stations.json');
const metro = readdirSync('public/data')
  .filter(dir => dir.startsWith('metro_') && existsSync(`public/data/${dir}/stations.json`))
  .flatMap(dir => rows(`public/data/${dir}/stations.json`).map(s => ({ ...s, sys: dir.slice(6) })));

/** Close enough that riders treat it as an interchange; 楠梓 (440 m) is listed as a walk-over on top. */
const INTERCHANGE_METRES = 300;

test('every TRA station next to a metro / light-rail / THSR station has a transfer badge', () => {
  const missing: string[] = [];
  for (const t of tra) {
    // 臺北-環島 is a ticketing alias of 臺北, not a stop riders see.
    if (!hasPos(t) || t.StationName.Zh_tw.includes('-')) continue;
    const near = [...metro, ...thsr.map(s => ({ ...s, sys: 'THSR' }))]
      .filter(hasPos)
      .filter(s => metres(t, s) <= INTERCHANGE_METRES);
    if (near.length && getTransfers(t.StationName.Zh_tw).length === 0) {
      missing.push(`${t.StationName.Zh_tw} ↔ ${near.map(s => `${s.sys} ${s.StationID} ${s.StationName.Zh_tw}`).join(', ')}`);
    }
  }
  assert.deepEqual(missing, [], `TRA stations within ${INTERCHANGE_METRES} m of another rail station but missing from transfers.ts`);
});

test('every HSR station next to a metro station has a transfer badge', () => {
  const missing = thsr
    .filter(h => hasPos(h) && metro.some(m => hasPos(m) && metres(h, m) <= INTERCHANGE_METRES))
    .filter(h => getTransfers(`高鐵${h.StationName.Zh_tw}`).length === 0)
    .map(h => h.StationName.Zh_tw);
  assert.deepEqual(missing, []);
});

test('transfer keys are real station names (TRA name, or 高鐵 + THSR name)', () => {
  const traNames = new Set(tra.map(s => s.StationName.Zh_tw));
  const thsrNames = new Set(thsr.map(s => `高鐵${s.StationName.Zh_tw}`));
  const source = readFileSync('src/lib/transfers.ts', 'utf8');
  const keys = [...source.matchAll(/^ {2}'([^']+)':\s*\[/gm)].map(m => m[1]);
  assert.ok(keys.length > 20);
  const unknown = keys.filter(k => !traNames.has(k) && !thsrNames.has(k));
  assert.deepEqual(unknown, [], 'keys that no TRA/THSR stop name can ever match');
});

test('TRA 左營 (舊城) is not the Kaohsiung MRT interchange — 新左營 is', () => {
  assert.deepEqual(getTransfers('左營'), []);
  assert.deepEqual(getDetailedTransfers('左營', 'train'), []);
  assert.ok(getTransfers('新左營').some(t => t.detail.includes('R16')));
  // The HSR station keeps its own walking directions.
  assert.ok(getDetailedTransfers('左營', 'hsr').length > 0);
});

test('TRA 烏日 gets its own entry, not 新烏日\'s HSR walking directions', () => {
  const detailed = getDetailedTransfers('烏日', 'train');
  assert.ok(detailed.length > 0);
  assert.ok(detailed.every(d => !d.id.startsWith('xinwuri') && d.stationName === '烏日'));
  assert.match(detailed[0].walkingTime, /約 \d+ 分鐘/);
});

test('Taichung MRT codes follow TDX (G17), not the planning number 119', () => {
  const source = readFileSync('src/lib/transfers.ts', 'utf8') + readFileSync('src/components/TransferMapModal.tsx', 'utf8');
  assert.doesNotMatch(source, /\b119\b/);
  assert.ok(metro.some(s => s.sys === 'TMRT' && s.StationID === 'G17'));
});
