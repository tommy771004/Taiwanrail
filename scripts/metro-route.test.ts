import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildMetroDepartures,
  buildMetroRouteDepartures,
  computeMetroRoute,
  computeSameLineJourney,
  getMetroAlert,
  getMetroLineTransfer,
  getMetroLiveBoard,
  getMetroLivePosition,
  getMetroS2STravelTime,
  keepRingContinuations,
  metroHeadwayAt,
  metroLineOwner,
  metroPartnerSystem,
  metroTrainTypeLabel,
  parseMetroAlerts,
  type MetroLineTimes,
} from '../src/lib/metro.js';
import { deriveS2SFromTimetables } from './metro-s2s-from-timetable.js';

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

const allDays = { Monday: 1, Tuesday: 1, Wednesday: 1, Thursday: 1, Friday: 1, Saturday: 1, Sunday: 1 };
const row = (destId: string, destName: string, times: string[]) => ({
  DestinationStationID: destId,
  DestinationStationName: { Zh_tw: destName, En: destName },
  ServiceDay: allDays,
  Timetables: times.map((t, i) => ({ Sequence: i + 1, DepartureTime: t, TrainType: 0 })),
});

test('a train bound past the end of S2STravelTime still counts toward that end', () => {
  // R00 is a new terminus S2STravelTime has not caught up with, like R01 廣慈/奉天宮.
  const lines = [chain('R', ['R03', 'R02', 'R01'])];
  const j = computeSameLineJourney(lines, 'R03', 'R02', true)!;
  const deps = buildMetroDepartures([row('R00', '新終點', ['12:00'])], j, true, '00:00', 1);
  assert.deepEqual(deps.map((d) => d.destName), ['新終點']);
});

test('a train bound the other way past a line end is not picked up', () => {
  const lines = [chain('R', ['R03', 'R02', 'R01'])];
  const j = computeSameLineJourney(lines, 'R02', 'R03', true)!;
  assert.deepEqual(buildMetroDepartures([row('R00', '新終點', ['12:00'])], j, true, '00:00', 1), []);
});

test('a terminus on another branch of the line never counts as past this end', () => {
  // O54 蘆洲 numbers higher than O21 迴龍 but is a real branch, not a new station.
  const lines = [chain('O', ['O21', 'O12', 'O01']), chain('O', ['O54', 'O12', 'O01'])];
  const j = computeSameLineJourney(lines, 'O01', 'O21', true)!;
  assert.deepEqual(buildMetroDepartures([row('O54', '蘆洲', ['12:00'])], j, true, '00:00', 1), []);
});

test('a leg without a timetable keeps the trip but never gets a clock time', () => {
  const lines = [chain('R', ['R01', 'R02']), chain('BR', ['BR01', 'BR02', 'BR03'])];
  const journeys = [
    computeSameLineJourney(lines, 'R01', 'R02', true)!,
    computeSameLineJourney(lines, 'BR01', 'BR03', true)!,
  ];
  const deps = buildMetroRouteDepartures(
    [[row('R02', 'R02', ['12:00'])], []], journeys, [300], true, '00:00', 30, 1);
  assert.equal(deps.length, 1);
  assert.equal(deps[0].departureTime, '12:00');
  assert.equal(deps[0].arrivalTime, null);
  assert.deepEqual(
    { dep: deps[0].legs[1].departureTime, arr: deps[0].legs[1].arrivalTime, wait: deps[0].legs[1].waitSec, to: deps[0].legs[1].destName },
    { dep: null, arr: null, wait: 0, to: 'BR03' },
  );
  // Two rides of 150 s, 300 s, plus the 300 s walk; the 文湖線 wait is unknown and left out.
  assert.equal(deps[0].totalTimeSec, 150 + 300 + 300);
});

test('a timed leg after an untimed one has no clock either: the connection is unknown', () => {
  const lines = [chain('R', ['R01', 'R02']), chain('BR', ['BR01', 'BR02']), chain('BL', ['BL01', 'BL02'])];
  const journeys = [
    computeSameLineJourney(lines, 'R01', 'R02', true)!,
    computeSameLineJourney(lines, 'BR01', 'BR02', true)!,
    computeSameLineJourney(lines, 'BL01', 'BL02', true)!,
  ];
  const deps = buildMetroRouteDepartures(
    [[row('R02', 'R02', ['12:00'])], [], [row('BL02', 'BL02', ['12:30'])]], journeys, [60, 60], true, '00:00', 30, 1);
  assert.equal(deps.length, 1);
  assert.equal(deps[0].legs[2].departureTime, null);
  assert.equal(deps[0].arrivalTime, null);
});

test('a first leg without a timetable has no departure to list', () => {
  const lines = [chain('BR', ['BR01', 'BR02']), chain('R', ['R01', 'R02'])];
  const journeys = [
    computeSameLineJourney(lines, 'BR01', 'BR02', true)!,
    computeSameLineJourney(lines, 'R01', 'R02', true)!,
  ];
  assert.deepEqual(buildMetroRouteDepartures([[], [row('R02', 'R02', ['12:00'])]], journeys, [60], true, '00:00', 30, 1), []);
});

test('committed 台北捷運 data: 文湖線 transfers and 象山-bound trips list departures', async () => {
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
    const timetable = async (id: string) => JSON.parse(
      await readFile(join(root, 'public/data/metro_TRTC', `${id}.json`), 'utf8').catch(() => '[]'));
    const list = async (a: string, b: string) => {
      const r = computeMetroRoute(s2s, edges, a, b, true)!;
      const journeys = r.legs.map((l) => computeSameLineJourney(s2s, l.stopIds[0], l.stopIds[l.stopIds.length - 1], true)!);
      return buildMetroRouteDepartures(
        await Promise.all(r.legs.map((l) => timetable(l.stopIds[0]))),
        journeys, r.transfers.map((t) => t.transferTimeSec), true, '12:00', 30, 1);
    };

    const toBrownLine = await list('大安森林公園', '南京復興');
    assert.ok(toBrownLine.length > 0);
    assert.equal(toBrownLine[0].legs[1].departureTime, null);
    assert.equal(toBrownLine[0].arrivalTime, null);

    // Ends on the 象山 stretch of 淡水信義線, where every train is bound for R01.
    assert.ok((await list('頂埔', '象山')).length > 0);

    const south = computeSameLineJourney(s2s, 'R06', 'R02', true)!;
    const deps = buildMetroDepartures(await timetable('R06'), south, true, '12:00', 1);
    assert.ok(deps.length > 0);
    assert.ok(deps.every((d) => d.destName === '廣慈/奉天宮'));
    // Northbound trains from the same platform pair stay out.
    const north = computeSameLineJourney(s2s, 'R06', 'R07', true)!;
    assert.ok(buildMetroDepartures(await timetable('R06'), north, true, '12:00', 1).every((d) => d.destId !== 'R01'));
  } finally {
    globalThis.fetch = realFetch;
  }
});

// All-pairs S2STravelTime (桃園機捷, 高雄輕軌): each row is one station pair and RunTime is
// already cumulative, so adding rows up counts the same stretch over and over.
const pair = (a: string, b: string, runTime: number) => ({ ...seg(a, b), runTime, stopTime: 0 });

test('all-pairs data: a trip reads its own row instead of adding rows up', () => {
  const line: MetroLineTimes = {
    lineId: 'A',
    segments: [
      pair('A1', 'A2', 300), pair('A1', 'A3', 540), pair('A1', 'A4', 660),
      pair('A2', 'A1', 300), pair('A2', 'A3', 240), pair('A2', 'A4', 360),
      pair('A3', 'A1', 540), pair('A3', 'A2', 240), pair('A3', 'A4', 120),
      pair('A4', 'A1', 660), pair('A4', 'A2', 360), pair('A4', 'A3', 120),
    ],
  };
  const out = computeSameLineJourney([line], 'A1', 'A4', true)!;
  assert.equal(out.travelTimeSec, 660);
  assert.deepEqual(out.stopIds, ['A1', 'A2', 'A3', 'A4']);
  assert.deepEqual(out.stopOffsetsSec, [0, 300, 540, 660]);
  const back = computeSameLineJourney([line], 'A4', 'A2', true)!;
  assert.equal(back.travelTimeSec, 360);
  assert.deepEqual(back.stopIds, ['A4', 'A3', 'A2']);
  assert.deepEqual(back.stopOffsetsSec, [0, 120, 360]);
});

// A four-stop ring laid out like 高雄輕軌: entry 0 lists low → high ids, entry 1 high → low plus
// the once-round self-loop, and each pair has a row for each way round.
const ring: MetroLineTimes[] = [
  {
    lineId: 'C',
    segments: [
      pair('C1', 'C2', 100), pair('C1', 'C3', 300), pair('C1', 'C4', 600),
      pair('C2', 'C3', 200), pair('C2', 'C4', 500), pair('C3', 'C4', 300),
      pair('C1', 'C2', 900), pair('C1', 'C3', 700), pair('C1', 'C4', 400),
      pair('C2', 'C3', 800), pair('C2', 'C4', 600), pair('C3', 'C4', 700),
    ],
  },
  {
    lineId: 'C',
    segments: [
      pair('C1', 'C1', 1000), pair('C2', 'C1', 900), pair('C3', 'C1', 700), pair('C4', 'C1', 400),
      pair('C3', 'C2', 200), pair('C4', 'C2', 500), pair('C4', 'C3', 300),
      pair('C1', 'C1', 1000), pair('C2', 'C1', 100), pair('C3', 'C1', 300), pair('C4', 'C1', 600),
      pair('C3', 'C2', 800), pair('C4', 'C2', 600), pair('C4', 'C3', 700),
    ],
  },
];
const directed = (direction: number, times: string[]) => ({ ...row('C1', '起訖站', times), Direction: direction });

test('ring: a trip goes the short way round, in the Direction that way runs', () => {
  const up = computeSameLineJourney(ring, 'C1', 'C3', true)!;
  assert.deepEqual(up.stopIds, ['C1', 'C2', 'C3']);
  assert.deepEqual(up.stopOffsetsSec, [0, 100, 300]);
  assert.equal(up.ringDirection, 0);

  const down = computeSameLineJourney(ring, 'C4', 'C3', true)!;
  assert.deepEqual(down.stopIds, ['C4', 'C3']);
  assert.equal(down.ringDirection, 1);

  assert.deepEqual(
    buildMetroDepartures([directed(0, ['12:00']), directed(1, ['12:05'])], up, true, '00:00', 1).map((d) => d.departureTime),
    ['12:00'],
  );
});

test('ring: the short way can run across the end of the line', () => {
  const j = computeSameLineJourney(ring, 'C4', 'C2', true)!;
  assert.deepEqual(j.stopIds, ['C4', 'C1', 'C2']);
  assert.deepEqual(j.stopOffsetsSec, [0, 400, 500]);
  assert.equal(j.ringDirection, 0);
  assert.deepEqual(j.ringEnd, { stopId: 'C1', offsetSec: 400 });
  // A trip that merely starts or ends there needs no train to carry on past it.
  assert.equal(computeSameLineJourney(ring, 'C4', 'C1', true)!.ringEnd, undefined);
  assert.equal(computeSameLineJourney(ring, 'C1', 'C2', true)!.ringEnd, undefined);
});

test('ring: trains reaching the end after its last departure that way cannot carry on', () => {
  const j = computeSameLineJourney(ring, 'C4', 'C2', true)!;
  const deps = buildMetroDepartures([directed(0, ['12:00', '12:10'])], j, true, '00:00', 1);
  const end = [directed(0, ['12:15']), directed(1, ['23:00'])];
  assert.deepEqual(keepRingContinuations(deps, j, end, 1).map((d) => d.departureTime), ['12:00']);
  assert.deepEqual(keepRingContinuations(deps, j, [], 1), deps);
});

test('committed data: ring and all-pairs trips match the timetables', async () => {
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
    const klrt = await getMetroS2STravelTime('KLRT');
    const timetable = async (id: string) => JSON.parse(await readFile(join(root, 'public/data/metro_KLRT', `${id}.json`), 'utf8'));

    // Both ways round list trains, each once: a Direction is 15-minute-ish, not doubled.
    for (const [a, b, direction] of [['C1', 'C2', 0], ['C2', 'C1', 1], ['C3', 'C20', 0], ['C20', 'C3', 1]] as const) {
      const j = computeSameLineJourney(klrt, a, b, true)!;
      assert.equal(j.ringDirection, direction, `${a}→${b}`);
      const deps = buildMetroDepartures(await timetable(a), j, true, '12:00', 1);
      assert.ok(deps.length > 0, `${a}→${b}`);
      assert.equal(new Set(deps.map((d) => d.departureTime)).size, deps.length, `${a}→${b}`);
      assert.ok(deps.every((d) => d.destName === j.stopNames[j.stopNames.length - 1]));
    }

    // Direction 0 climbs the ids: a C5 train leaves C1 about 10 minutes earlier, not 28.
    assert.ok(Math.abs(computeSameLineJourney(klrt, 'C1', 'C5', true)!.travelTimeSec - 600) <= 60);
    assert.ok(computeSameLineJourney(klrt, 'C20', 'C3', true)!.travelTimeSec < 3600);

    const across = computeSameLineJourney(klrt, 'C36', 'C2', true)!;
    assert.deepEqual(across.stopIds, ['C36', 'C37', 'C1', 'C2']);
    assert.equal(across.ringEnd?.stopId, 'C1');

    assert.equal((await getMetroS2STravelTime('TMRT'))[0].lineId, 'G');
    const tymc = await getMetroS2STravelTime('TYMC');
    assert.equal(computeSameLineJourney(tymc, 'A1', 'A8', true)!.travelTimeSec, 1560);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('express and local trains of one all-pairs line each keep their own ride', () => {
  const local: MetroLineTimes = {
    lineId: 'A',
    trainType: 1,
    segments: [pair('A1', 'A2', 300), pair('A1', 'A3', 900), pair('A2', 'A3', 600), pair('A2', 'A1', 300), pair('A3', 'A1', 900), pair('A3', 'A2', 600)],
  };
  const express: MetroLineTimes = { lineId: 'A', trainType: 2, segments: [pair('A1', 'A3', 600), pair('A3', 'A1', 600)] };
  const timed = (trainType: number, time: string) => ({
    ...row('A3', 'A3', [time]),
    Timetables: [{ Sequence: 1, DepartureTime: time, TrainType: trainType }],
  });

  const through = computeSameLineJourney([local, express], 'A1', 'A3', true)!;
  assert.equal(through.travelTimeSec, 900);
  assert.deepEqual(
    buildMetroDepartures([timed(1, '12:00'), timed(2, '12:05')], through, true, '00:00', 1)
      .map((d) => [d.departureTime, d.arrivalTime, d.rideSec]),
    [['12:00', '12:15', 900], ['12:05', '12:15', 600]],
  );
  assert.deepEqual(through.ridesByTrainType?.[2].stopIds, ['A1', 'A3']);

  // The express does not stop at A2, so it is not a way of getting there.
  const skipped = computeSameLineJourney([local, express], 'A1', 'A2', true)!;
  assert.deepEqual(
    buildMetroDepartures([timed(1, '12:00'), timed(2, '12:05')], skipped, true, '00:00', 1).map((d) => d.departureTime),
    ['12:00'],
  );
});

test('metroTrainTypeLabel: TDX train type 2 is the express, not 1', () => {
  assert.equal(metroTrainTypeLabel(2, true), '直達');
  assert.equal(metroTrainTypeLabel(1, true), '普通');
  assert.equal(metroTrainTypeLabel(0, true), '普通');
});

test('metroHeadwayAt reads the window around now, on today\'s service day', () => {
  const rows = [
    {
      LineNo: 'BR', LineID: 'BR', ServiceDay: { Monday: true, Sunday: false },
      Headways: [
        { StartTime: '07:00', EndTime: '09:00', MinHeadwayMins: 2, MaxHeadwayMins: 4 },
        { StartTime: '23:00', EndTime: '00:00', MinHeadwayMins: 12, MaxHeadwayMins: 12 },
      ],
    },
    { LineNo: 'BR', LineID: 'BR', ServiceDay: { Monday: false, Sunday: true }, Headways: [{ StartTime: '06:00', EndTime: '23:00', MinHeadwayMins: 4, MaxHeadwayMins: 10 }] },
    { LineNo: '1', LineID: 'G', ServiceDay: { Monday: true }, Headways: [{ StartTime: '07:00', EndTime: '09:00', MinHeadwayMins: 6, MaxHeadwayMins: 6 }] },
  ];
  assert.deepEqual(metroHeadwayAt(rows, 'BR', 1, 8 * 60), { minMins: 2, maxMins: 4 });
  assert.deepEqual(metroHeadwayAt(rows, 'BR', 1, 23 * 60 + 30), { minMins: 12, maxMins: 12 });
  assert.deepEqual(metroHeadwayAt(rows, 'BR', 0, 8 * 60), { minMins: 4, maxMins: 10 });
  assert.deepEqual(metroHeadwayAt(rows, '1', 1, 8 * 60), { minMins: 6, maxMins: 6 });
  assert.equal(metroHeadwayAt(rows, 'BR', 1, 12 * 60), null);
  assert.equal(metroHeadwayAt(rows, 'R', 1, 8 * 60), null);
});

test('deriveS2SFromTimetables takes run times from one train along its route', () => {
  const stops = [
    { StationID: 'V1', StationName: name('V1') },
    { StationID: 'V2', StationName: name('V2') },
    { StationID: 'V3', StationName: name('V3') },
  ];
  const routed = (times: string[], direction = 0) => ({ ...row('V3', 'V3', times), RouteID: 'V-1', Direction: direction });
  // Like the real data, a terminus has no departures toward itself: V3 lists only the way back.
  const files: Record<string, any[]> = {
    V1: [routed(['12:00', '12:15'])],
    V2: [routed(['12:02', '12:17']), routed(['12:13', '12:28'], 1)],
    V3: [routed(['12:10', '12:25'], 1)],
  };
  const out = deriveS2SFromTimetables(
    [{ LineID: 'V', RouteID: 'V-1', Direction: 0, Stations: stops }, { LineID: 'V', RouteID: 'V-1', Direction: 1, Stations: [...stops].reverse() }],
    (id) => files[id] ?? [],
  );
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].TravelTimes.map((t) => [t.FromStationID, t.ToStationID, t.RunTime]), [['V1', 'V2', 120], ['V2', 'V3', 180]]);
});

test('committed 淡海輕軌 data: both branches and the change at their fork', async () => {
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
    const lines = await getMetroS2STravelTime('NTDLRT');
    assert.equal(lines.length, 2);
    const timetable = JSON.parse(await readFile(join(root, 'public/data/metro_NTDLRT/V01.json'), 'utf8'));
    const toKanding = computeSameLineJourney(lines, 'V01', 'V11', true)!;
    assert.ok(buildMetroDepartures(timetable, toKanding, true, '12:00', 1).length > 0);
    assert.deepEqual(
      computeMetroRoute(lines, [], '崁頂', '淡水漁人碼頭', true)?.transfers,
      [{ stationName: '濱海沙崙', transferTimeSec: 0, sameLine: true }],
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('committed data: 新北捷運 lines connect through 台北捷運', async () => {
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
    const own = await getMetroS2STravelTime('NTMC');
    const ownEdges = await getMetroLineTransfer('NTMC');
    assert.equal(computeMetroRoute(own, ownEdges, '三峽', '大坪林', true), null);
    assert.equal(metroPartnerSystem('NTMC'), 'TRTC');
    assert.equal(metroLineOwner('NTMC', 'BL'), 'TRTC');
    assert.equal(metroLineOwner('NTMC', 'Y'), 'NTMC');

    const lines = [...own, ...await getMetroS2STravelTime('TRTC')];
    const edges = [...ownEdges, ...await getMetroLineTransfer('TRTC')];
    const r = computeMetroRoute(lines, edges, '三峽', '大坪林', true)!;
    assert.ok(r.legs.length >= 2);
    assert.equal(r.legs[0].lineId, 'LB');
    assert.ok(r.legs.every((l) => computeSameLineJourney(lines, l.stopIds[0], l.stopIds[l.stopIds.length - 1], true)));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('every Metro endpoint the app calls exists in the TDX rail spec', async () => {
  // The /v2/Rail/Metro paths of TDX's OpenAPI document. TrainLiveBoard was polled but never existed.
  const published = new Set([
    'Network', 'Line', 'Station', 'StationOfLine', 'LineTransfer', 'StationFacility', 'StationExit', 'Route',
    'StationOfRoute', 'FirstLastTimetable', 'Frequency', 'S2STravelTime', 'ODFare', 'LiveBoard', 'StationTimeTable',
    'Shape', 'News', 'Alert', 'StoppingPattern', 'LivePosition', 'StationPlatform', 'StationTransfer', 'TransferStations',
  ]);
  const source = await readFile(join(process.cwd(), 'src/lib/metro.ts'), 'utf8');
  const called = [...source.matchAll(/METRO_BASE\}\/(\w+)/g)].map((m) => m[1]);
  assert.ok(called.length >= 5, 'the pattern no longer finds the calls');
  assert.deepEqual(called.filter((name) => !published.has(name)), []);
});

test('live endpoints: an operator TDX does not accept is never asked', async () => {
  const realFetch = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (u: string) => {
    asked.push(String(u));
    return { ok: false, status: 500, json: async () => null, text: async () => '' } as unknown as Response;
  }) as typeof fetch;
  try {
    assert.deepEqual(await getMetroLivePosition('TRTC'), []);
    assert.deepEqual(await getMetroLivePosition('TYMC'), []);
    assert.deepEqual(await getMetroAlert('NTMC'), []);
    assert.deepEqual(await getMetroAlert('NTDLRT'), []);
    assert.deepEqual(await getMetroLiveBoard('NTMC', 'Y07'), []);
    assert.deepEqual(await getMetroLiveBoard('TMRT', 'G3'), []);
    assert.deepEqual(await getMetroLiveBoard('NTDLRT', 'V01'), []);
    assert.deepEqual(asked, []);

    await getMetroLivePosition('KLRT');
    assert.ok(asked.length > 0, 'an accepted operator is still asked');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('parseMetroAlerts drops the operator\'s all-clear and keeps every real notice', () => {
  const allClear = { Title: '正常營運', Description: '正常營運', Status: 1 };
  const disruption = { Title: '板南線延誤', Description: '號誌異常', Status: 2 };
  // Normal status with its own wording is still shown: hiding a real notice is the worse mistake.
  const notice = { Title: '颱風營運調整', Description: '末班車提前', Status: 1 };
  const titleOnly = { Title: '正常營運', Status: 2 };
  assert.deepEqual(parseMetroAlerts({ Alerts: [allClear] }), []);
  assert.deepEqual(
    parseMetroAlerts({ Alerts: [allClear, disruption, notice, titleOnly] }).map((a) => a.title),
    ['板南線延誤', '颱風營運調整', '正常營運'],
  );
  assert.deepEqual(parseMetroAlerts([]), []);
});
