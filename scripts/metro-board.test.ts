import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
  boardDirOf,
  boardStrip,
  buildBoardLine,
  buildLinePatterns,
  buildLineShape,
  extendWithUncovered,
  lineLayout,
  lineTrains,
  metroServesWeekday,
  minutesUntil,
  type BoardLineInput,
} from '../src/lib/metroBoard.js';

/**
 * The arrivals board labels every minute 「即時」 or 「表定」, so these tests pin the
 * two things that decide which label a rider sees and whether it is honest:
 * direction (by position within a service pattern, not TDX's Direction code — and never
 * across two branches) and the rule that a timetable-derived train is never marked live.
 * Rule tests use synthetic rows; the pipeline tests read the committed 台北捷運 data.
 */

const R = ['R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R09', 'R10', 'R11', 'R12', 'R22', 'R28'];
const nameMap = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { Zh_tw: id, En: id }]));
// A Y-shaped line like 中和新蘆線: trunk O01–O12 forks at O12 into O13–O14 and O50–O51.
const BRANCH_A = ['O01', 'O02', 'O12', 'O13', 'O14'];
const BRANCH_B = ['O01', 'O02', 'O12', 'O50', 'O51'];
const pos = (stationId: string, destStationId: string, moveStatus = 0) =>
  ({ trainNo: stationId, lineId: '', stationId, stationName: {}, destStationId, destName: {}, direction: 0, moveStatus });
const WEEKDAY = { ServiceTag: '平日', Monday: true, Tuesday: true, Wednesday: true, Thursday: true, Friday: true, Saturday: false, Sunday: false };
const SUNDAY = { ServiceTag: '週日', Monday: false, Tuesday: false, Wednesday: false, Thursday: false, Friday: false, Saturday: false, Sunday: true };

function input(over: Partial<BoardLineInput>): BoardLineInput {
  return {
    stationId: 'R10',
    patterns: [R],
    names: nameMap([...R, ...BRANCH_A, ...BRANCH_B]),
    liveBoard: [],
    timetable: [],
    platforms: [],
    trainLive: [],
    nowMin: 12 * 60,
    weekday: 3,
    ...over,
  };
}

const row = (dest: string, serviceDay: object, times: string[]) => ({
  StationID: 'R10',
  DestinationStaionID: dest,
  DestinationStationName: { Zh_tw: dest, En: dest },
  ServiceDay: serviceDay,
  Timetables: times.map((t, i) => ({ Sequence: i + 1, DepartureTime: t })),
});

test('direction comes from where the terminus sits on the line', () => {
  assert.equal(boardDirOf([R], 'R10', 'R28'), 'up');
  assert.equal(boardDirOf([R], 'R10', 'R22'), 'up'); // short-turn 北投 still heads the 淡水 way
  assert.equal(boardDirOf([R], 'R10', 'R01'), 'down');
  assert.equal(boardDirOf([R], 'R10', 'R10'), null);
  assert.equal(boardDirOf([R], 'R10', 'BL12'), null);
  // No train runs from one branch onto the other.
  assert.equal(boardDirOf([BRANCH_A, BRANCH_B], 'O13', 'O51'), null);
  assert.equal(boardDirOf([BRANCH_A, BRANCH_B], 'O13', 'O01'), 'down');
});

test('patterns: one per branch, oriented low → high id, short turns and non-chains dropped', () => {
  const seg = (a: string, b: string) => ({ fromId: a, toId: b });
  const chain = (ids: string[]) => ({ segments: ids.slice(0, -1).map((id, i) => seg(id, ids[i + 1])) });
  const patterns = buildLinePatterns(
    [
      chain([...BRANCH_A].reverse()), // TDX lists 迴龍 → 南勢角
      chain([...BRANCH_B].reverse()),
      chain(['O02', 'O12']), // short turn inside both
      { segments: [seg('X1', 'X2'), seg('X1', 'X3')] }, // all-pairs, not a chain
    ],
    (id) => id.replace(/\d.*$/, ''),
    (a, b) => a.localeCompare(b),
  );
  assert.deepEqual(patterns.get('O'), [BRANCH_A, BRANCH_B]);
  assert.equal(patterns.has('X'), false);
});

test('layout: longest pattern is the main line, the other branch hangs off its junction', () => {
  assert.deepEqual(lineLayout([BRANCH_A, BRANCH_B]), {
    main: BRANCH_A,
    branches: [{ junctionId: 'O12', ids: ['O12', 'O50', 'O51'] }],
  });
  // A station S2STravelTime doesn't cover yet (R01 beyond R02) is kept at the end it belongs to.
  assert.deepEqual(extendWithUncovered(['R02', 'R03'], ['R01', 'R02', 'R03'], new Set(['R02', 'R03'])), ['R01', 'R02', 'R03']);
});

test('at a fork the heading names every branch; on a branch, only its own end', () => {
  const at = (stationId: string) => buildBoardLine(input({ stationId, patterns: [BRANCH_A, BRANCH_B] }));
  const [down, up] = at('O12');
  assert.deepEqual(up.terminusIds, ['O14', 'O51']);
  assert.deepEqual(down.terminusIds, ['O01']);
  const [, upA] = at('O13');
  assert.deepEqual(upA.terminusIds, ['O14']);
  const [, upEnd] = at('O51');
  assert.equal(upEnd.isLineEnd, true);
});

test('strip stops at a fork instead of drawing one branch as the line', () => {
  const strip = boardStrip([BRANCH_A, BRANCH_B], 'O12', [pos('O02', 'O51', 1), pos('O12', 'O14', 1)]);
  assert.deepEqual(strip.ids, ['O01', 'O02', 'O12', null, null]);
  assert.equal(strip.continuesUp, true);
  // The train leaving O02 sits between O02 and O12; the one leaving O12 into a branch has no slot.
  assert.deepEqual(strip.trains, [{ offset: -0.5, dir: 'up' }]);
});

test('a branch section still places trains bound for the far end of the trunk', () => {
  const trains = lineTrains([pos('O50', 'O01', 1)], ['O12', 'O50', 'O51'], [BRANCH_A, BRANCH_B]);
  assert.deepEqual(trains, [{ index: 0.5, dir: 'down' }]);
});

test('minutesUntil folds across midnight', () => {
  assert.equal(minutesUntil('12:05', 12 * 60), 5);
  assert.equal(minutesUntil('00:05', 23 * 60 + 50), 15);
  assert.equal(minutesUntil('23:55', 10), -15);
  assert.equal(minutesUntil('bad', 0), null);
});

test('only today\'s service day is used', () => {
  assert.equal(metroServesWeekday({ ServiceDay: WEEKDAY }, 3), true);
  assert.equal(metroServesWeekday({ ServiceDay: WEEKDAY }, 0), false);
  assert.equal(metroServesWeekday({}, 0), true);

  const [, up] = buildBoardLine(input({
    timetable: [row('R28', WEEKDAY, ['12:04', '12:10']), row('R28', SUNDAY, ['12:02'])],
  }));
  assert.equal(up.next?.minutes, 4);
  assert.equal(up.following?.minutes, 10);
});

test('live next train; following falls back to a scheduled one, labelled as such', () => {
  const [, up] = buildBoardLine(input({
    liveBoard: [{ StationID: 'R10', StationName: {}, DestinationStationID: 'R22', DestinationStationName: { Zh_tw: '北投' }, EstimateTime: 3 }],
    timetable: [row('R28', WEEKDAY, ['12:02', '12:04', '12:09'])],
  }));
  assert.deepEqual([up.next?.minutes, up.next?.live, up.next?.destId], [3, true, 'R22']);
  // 12:04 is within the gap of the live 3-minute train (likely the same train), so 12:09 follows.
  assert.deepEqual([up.following?.minutes, up.following?.live], [9, false]);
});

test('without LiveBoard every train is scheduled, never live', () => {
  const [down, up] = buildBoardLine(input({ timetable: [row('R01', WEEKDAY, ['12:01', '12:07'])] }));
  assert.equal(down.next?.live, false);
  assert.equal(down.following?.live, false);
  assert.equal(up.next, null);
  assert.equal(up.noService, true);
});

test('line ends show no trains in the dead-end direction', () => {
  const [down, up] = buildBoardLine(input({ stationId: 'R01', timetable: [] }));
  assert.equal(down.isLineEnd, true);
  assert.equal(down.next, null);
  assert.equal(up.isLineEnd, false);
  assert.equal(up.noService, false); // no timetable at all = unknown, not "no service"
});

test('crowdedness belongs to the nearest upstream train bound for the same terminus', () => {
  const [, up] = buildBoardLine(input({
    liveBoard: [{ StationID: 'R10', StationName: {}, DestinationStationID: 'R28', DestinationStationName: {}, EstimateTime: 2 }],
    trainLive: [
      { TrainNo: 'a', LineID: 'R', StationID: 'R06', DestinationStationID: 'R28', Direction: 0, CarCrowdedness: [4, 4, 4, 4, 4, 4] },
      { TrainNo: 'b', LineID: 'R', StationID: 'R09', DestinationStationID: 'R28', Direction: 0, CarCrowdedness: [1, 2, 1, 2, 1, 2] },
      { TrainNo: 'c', LineID: 'R', StationID: 'R11', DestinationStationID: 'R28', Direction: 0, CarCrowdedness: [3, 3, 3, 3, 3, 3] },
    ],
  }));
  assert.deepEqual(up.crowdedness, [1, 2, 1, 2, 1, 2]);
});

test('strip places departed trains half-way toward their terminus', () => {
  const { trains } = boardStrip([R], 'R10', [pos('R09', 'R28', 1), pos('R11', 'R01'), pos('R02', 'R28')]);
  assert.deepEqual(trains, [{ offset: -0.5, dir: 'up' }, { offset: 1, dir: 'down' }]);
});

test('後續班次: live trains first, then the timetable after them, each labelled', () => {
  const [, up] = buildBoardLine(input({
    liveBoard: [
      { StationID: 'R10', StationName: {}, DestinationStationID: 'R22', DestinationStationName: {}, EstimateTime: 1 },
      { StationID: 'R10', StationName: {}, DestinationStationID: 'R28', DestinationStationName: {}, EstimateTime: 4 },
    ],
    timetable: [row('R28', WEEKDAY, ['12:03', '12:05', '12:07', '12:12'])],
  }));
  assert.deepEqual(
    up.upcoming.map((t) => [t.minutes, t.live, t.time ?? null]),
    // 12:03 and 12:05 are within the gap of the live 4-minute train, so the timetable resumes at 12:07.
    [[1, true, null], [4, true, null], [7, false, '12:07'], [12, false, '12:12']],
  );
});

test('first / last train follow service order, so a 00:20 departure is the last one', () => {
  const [, up] = buildBoardLine(input({
    timetable: [row('R28', WEEKDAY, ['06:00', '23:50', '00:20']), row('R28', SUNDAY, ['05:30', '01:00'])],
  }));
  assert.equal(up.firstTrain, '06:00');
  assert.equal(up.lastTrain, '00:20');
});

test('full-line view keeps every train on the line, and only that line', () => {
  const trains = lineTrains([
    { trainNo: '1', lineId: 'R', stationId: 'R01', stationName: {}, destStationId: 'R28', destName: {}, direction: 0, moveStatus: 1 },
    { trainNo: '2', lineId: 'R', stationId: 'R28', stationName: {}, destStationId: 'R01', destName: {}, direction: 1, moveStatus: 0 },
    { trainNo: '3', lineId: 'BL', stationId: 'BL12', stationName: {}, destStationId: 'BL23', destName: {}, direction: 0, moveStatus: 0 },
    // Standing at the first stop (MoveStatus 0) sits exactly on it.
    { trainNo: '4', lineId: 'R', stationId: 'R01', stationName: {}, destStationId: 'R28', destName: {}, direction: 0, moveStatus: 0 },
  ], R);
  assert.deepEqual(trains, [{ index: 0.5, dir: 'up' }, { index: R.length - 1, dir: 'down' }, { index: 0, dir: 'up' }]);
});

test('committed 台北捷運 data: branches fork where the route map says they do', async () => {
  const read = async (f: string) => JSON.parse(await readFile(join(process.cwd(), 'public/data/metro_TRTC', f), 'utf8'));
  const s2s: any[] = await read('s2s.json');
  const stations: any[] = await read('stations.json');
  const codeOf = (id: string) => id.match(/^[A-Za-z]+/)?.[0] ?? '';
  const key = (id: string): [number, string] => [Number(id.match(/\d+/)?.[0] ?? 0), id.replace(/^[A-Za-z]*\d+/, '')];
  const compare = (a: string, b: string) => key(a)[0] - key(b)[0] || key(a)[1].localeCompare(key(b)[1]);
  const patterns = buildLinePatterns(
    s2s.map((l) => ({ segments: l.TravelTimes.map((t: any) => ({ fromId: t.FromStationID, toId: t.ToStationID })) })),
    codeOf,
    compare,
  );
  const shape = (code: string) => {
    const ids = stations.map((st) => String(st.StationID)).filter((id) => codeOf(id) === code).sort(compare);
    return buildLineShape(patterns.get(code) ?? [], ids);
  };
  const headings = (code: string, stationId: string) => {
    const [down, up] = buildBoardLine(input({ stationId, patterns: shape(code).patterns }));
    return { down: [...down.terminusIds].sort(), up: [...up.terminusIds].sort() };
  };

  assert.deepEqual(shape('O').branches.map((b) => b.junctionId), ['O12']); // 大橋頭
  assert.deepEqual(shape('R').branches.map((b) => b.junctionId), ['R22']); // 北投
  assert.deepEqual(shape('G').branches.map((b) => b.junctionId), ['G03']); // 七張
  assert.deepEqual(headings('O', 'O12').up, ['O21', 'O54']); // 大橋頭 → 迴龍／蘆洲
  assert.deepEqual(headings('O', 'O19').up, ['O21']); // 新莊 → 迴龍 only
  assert.deepEqual(headings('R', 'R22').up, ['R22A', 'R28']); // 北投 → 淡水／新北投
  // R01 廣慈/奉天宮 is in the station list and the timetables but not in S2STravelTime yet.
  assert.equal(shape('R').main[0], 'R01');
  assert.deepEqual(headings('R', 'R10').down, ['R01']);
});

test('committed 台北車站 R10 timetable yields a scheduled train each way on a weekday morning', async () => {
  const raw = JSON.parse(await readFile(join(process.cwd(), 'public/data/metro_TRTC/R10.json'), 'utf8'));
  const [down, up] = buildBoardLine(input({ timetable: raw, nowMin: 8 * 60, weekday: 3 }));
  assert.ok(down.next && !down.next.live, 'weekday morning has a scheduled 往象山端 train');
  assert.ok(up.next && !up.next.live, 'weekday morning has a scheduled 往淡水 train');
  assert.ok(up.following && up.following.minutes >= up.next!.minutes);
});
