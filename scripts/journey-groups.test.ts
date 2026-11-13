import assert from 'node:assert/strict';
import test from 'node:test';

import type { RouteLeg, RouteResult } from '../src/lib/api';
import {
  fastestOf,
  firstRideLeg,
  groupRoutes,
  legKind,
  legMinutes,
  minutesUntilDeparture,
  fastestGroup,
  prepareRoutes,
  routeCategory,
  routeTotalFare,
  taipeiClock,
  taipeiTimeOf,
} from '../src/lib/journeyGroups';
import { metroLineByName } from '../src/lib/metro';

const leg = (mode: string, over: Partial<RouteLeg> = {}): RouteLeg => ({ mode, raw: {}, ...over });
const route = (sec: number, legs: RouteLeg[]): RouteResult => ({
  travelTimeSec: sec, startTime: '', endTime: '', transfers: 0, legs, raw: {},
});

test('legKind reads codes and category names', () => {
  assert.equal(legKind('0'), 'walk');
  assert.equal(legKind('3'), 'hsr');
  assert.equal(legKind('walk'), 'walk');
  assert.equal(legKind('MRT'), 'metro');
  assert.equal(legKind('TRA'), 'tra');
  assert.equal(legKind('THSR'), 'hsr');
  assert.equal(legKind('BUS'), 'bus');
  assert.equal(legKind('LRT'), 'lrt');
  assert.equal(legKind('light rail'), 'lrt');
  assert.equal(legKind('cable car'), 'cable');
  assert.equal(legKind('drive'), 'car');
  assert.equal(legKind('High Speed Rail'), 'hsr');
  assert.equal(legKind('Rail'), 'tra');
  // A ride with no category is only 'transit' — not a 台鐵 leg.
  assert.equal(legKind('transit'), 'other');
  assert.equal(legKind('public transport'), 'other');
  assert.equal(legKind('???'), 'other');
});

// Shapes below are from live MaaS responses (2026-11-13): 松山→桃園高鐵, 臺北→動物園, 臺北→故宮.
const walk = (sec: number) => leg('pedestrian', { durationSec: sec });
const cycle = (sec: number) => leg('cycle', { durationSec: sec });
const taxi = (sec: number) => leg('YOXI', { durationSec: sec });
const wait = (sec: number) => leg('waiting', { durationSec: sec });
const tra = leg('TRA', { lineName: '樹林-新左營', departTime: '2026-11-13T10:47:00', fromName: '松山' });
const hsr = (t: string) => leg('HSR', { lineName: '南港-左營', departTime: t, fromName: '南港' });

test('live section modes', () => {
  assert.equal(legKind('pedestrian'), 'walk');
  assert.equal(legKind('waiting'), 'wait');
  assert.equal(legKind('cycle'), 'bike');
  assert.equal(legKind('YOXI'), 'taxi');
  assert.equal(legKind('taxi'), 'taxi');
  assert.equal(legKind('Bus'), 'bus');
  assert.equal(legKind('HSR'), 'hsr');
});

test('stub legs are dropped and repeats of one trip collapse', () => {
  const raw = [
    route(2703, [walk(3), tra, walk(233), wait(367), hsr('2026-11-13T11:00:00'), walk(0)]),
    route(2244, [taxi(324), hsr('2026-11-13T11:00:00'), walk(0)]),
    route(2701, [cycle(1), tra, walk(233), wait(367), hsr('2026-11-13T11:00:00'), walk(0)]),
    route(2703, [walk(3), tra, walk(233), wait(367), hsr('2026-11-13T11:00:00'), cycle(0)]),
    route(2700, [taxi(0), tra, walk(233), wait(367), hsr('2026-11-13T11:00:00'), cycle(0)]),
    route(2184, [taxi(324), hsr('2026-11-13T11:08:00'), cycle(0)]),
  ];
  const shown = prepareRoutes(raw);
  assert.equal(shown.length, 3);
  assert.deepEqual(shown[0].legs.map(l => l.mode), ['TRA', 'pedestrian', 'waiting', 'HSR']);
  assert.equal(shown[0].travelTimeSec, 2700); // the quickest copy of the same two trains
  assert.deepEqual(shown.map(routeCategory), ['transit', 'taxi', 'taxi']);
});

test('a street walk and an in-station walk read as one walk', () => {
  const mrt = leg('MRT', { lineName: '淡水信義線', departTime: '2026-11-13T10:47:00' });
  const r = prepareRoutes([route(1266, [
    leg('pedestrian', { durationSec: 123, fromName: '起點', toName: '台北車站 M1' }),
    leg('pedestrian', { durationSec: 180, fromName: '台北車站 M1', toName: '台北車站' }),
    mrt, walk(60), taxi(276),
  ])])[0];
  assert.deepEqual(r.legs.map(l => l.mode), ['pedestrian', 'MRT', 'pedestrian', 'YOXI']);
  assert.equal(r.legs[0].durationSec, 303);
  assert.equal(r.legs[0].fromName, '起點');
  assert.equal(r.legs[0].toName, '台北車站');
});

test('one trip reached different ways is listed once per tab', () => {
  const bus = leg('Bus', { lineName: '和平幹線', departTime: '2026-11-13T10:46:00' });
  const shown = prepareRoutes([
    route(3179, [walk(286), bus, cycle(523)]),
    route(2665, [walk(286), bus, taxi(159)]),
    route(3036, [cycle(143), bus, cycle(523)]),
    route(2522, [cycle(143), bus, taxi(159)]),
    route(2924, [taxi(31), bus, cycle(523)]),
    route(2410, [taxi(31), bus, taxi(159)]),
  ]);
  assert.deepEqual(shown.map(r => [r.travelTimeSec, routeCategory(r)]), [[2924, 'bike'], [2410, 'taxi']]);
});

test('tabs follow how the rides are reached, in a fixed order', () => {
  const bus = leg('Bus', { lineName: '260區', departTime: '2026-11-13T10:39:00' });
  const mrt = leg('MRT', { lineName: '淡水信義線', departTime: '2026-11-13T10:47:00' });
  const routes = prepareRoutes([
    route(1367, [walk(95), bus, taxi(312)]),
    route(1266, [walk(123), walk(180), mrt, walk(60), taxi(276)]),
    route(1204, [cycle(61), walk(180), mrt, walk(60), taxi(276)]),
    route(3179, [walk(286), bus, cycle(523)]),
    route(1500, [walk(300), bus, walk(200)]),
  ]);
  const groups = groupRoutes(routes);
  assert.deepEqual(groups.map(g => g.key), ['transit', 'bike', 'taxi']);
  // The 1204 s copy is the same 淡水信義線 train as the 1266 s one in the same tab;
  // the quicker copy stays, in the slot the first one had.
  assert.deepEqual(groups.find(g => g.key === 'taxi')?.indexes, [0, 1]);
  assert.equal(routes[1].travelTimeSec, 1204);
  assert.equal(groups.find(g => g.key === 'taxi')?.fastestSec, 1204);
  assert.equal(fastestOf(routes), 1204);
  assert.equal(routeCategory(route(600, [walk(600)])), 'walk');
});

test('the quickest tab opens first; ties keep the tab order', () => {
  const bus = leg('Bus', { lineName: '260區', departTime: '2026-11-13T11:18:00' });
  const mrt = leg('MRT', { lineName: '淡水信義線', departTime: '2026-11-13T11:10:00' });
  // 臺北→故宮 live: 單車接駁 34 min, 計程車接駁 19 min.
  const groups = groupRoutes([route(2040, [bus, cycle(420)]), route(1140, [walk(180), mrt, taxi(300)])]);
  assert.deepEqual(groups.map(g => g.key), ['bike', 'taxi']);
  assert.equal(fastestGroup(groups)?.key, 'taxi');
  const tie = groupRoutes([route(1200, [walk(120), bus, walk(120)]), route(1200, [bus, taxi(120)])]);
  assert.equal(fastestGroup(tie)?.key, 'transit');
  assert.equal(fastestGroup(groupRoutes([route(0, [bus]), route(0, [mrt, taxi(120)])]))?.key, 'transit');
  assert.equal(fastestGroup([]), undefined);
});

test('a route fare is shown only when every ride leg is priced', () => {
  assert.equal(routeTotalFare(route(1, [leg('walk'), leg('MRT', { fare: 25 }), leg('TRA', { fare: 30 })])), 55);
  assert.equal(routeTotalFare(route(1, [leg('MRT', { fare: 25 }), leg('BUS')])), undefined);
  assert.equal(routeTotalFare(route(1, [leg('walk')])), undefined);
});

test('the first ride leg skips walking', () => {
  const r = route(1, [leg('walk'), leg('BUS', { fromName: '南京三民路口' }), leg('TRA')]);
  assert.equal(firstRideLeg(r)?.fromName, '南京三民路口');
});

test('routing times read as Taipei clock times', () => {
  assert.deepEqual(taipeiTimeOf('2026-11-13T10:32:00'), { date: '2026-11-13', minutes: 632 });
  assert.deepEqual(taipeiTimeOf('2026-11-13T10:32:00+08:00'), { date: '2026-11-13', minutes: 632 });
  // 02:32 UTC is 10:32 in Taipei.
  assert.deepEqual(taipeiTimeOf('2026-11-13T02:32:00Z'), { date: '2026-11-13', minutes: 632 });
  // 17:10 UTC is 01:10 the next day in Taipei.
  assert.deepEqual(taipeiTimeOf('2026-11-13T17:10:00Z'), { date: '2026-11-14', minutes: 70 });
  assert.deepEqual(taipeiTimeOf('10:32'), { minutes: 632 });
  assert.equal(taipeiTimeOf('soon'), null);
  assert.equal(taipeiClock('2026-11-13T09:05:00'), '09:05');
  assert.equal(taipeiClock(undefined), '');
});

test('departure countdown: today only, never negative, across midnight', () => {
  const today = '2026-11-13';
  assert.equal(minutesUntilDeparture('2026-11-13T10:32:00', 10 * 60 + 18, today), 14);
  assert.equal(minutesUntilDeparture('2026-11-13T10:32:00', 10 * 60 + 32.5, today), null);
  assert.equal(minutesUntilDeparture('2026-11-13T10:32:00', 10 * 60 + 40, today), null);
  assert.equal(minutesUntilDeparture('2026-11-15T10:32:00', 600, today), null);
  // The app's clock reports 00:05 as 24:05; the train leaves 00:20 on the next date.
  assert.equal(minutesUntilDeparture('2026-11-14T00:20:00', 23 * 60 + 50, today), 30);
  assert.equal(minutesUntilDeparture('2026-11-13T00:20:00', 24 * 60 + 5, today), 15);
  assert.equal(minutesUntilDeparture(undefined, 600, today), null);
});

test('leg minutes: own duration, else clock times', () => {
  assert.equal(legMinutes(leg('walk', { durationSec: 420 })), 7);
  assert.equal(legMinutes(leg('walk', { durationSec: 20 })), 1);
  assert.equal(legMinutes(leg('walk', { departTime: '2026-11-13T23:55:00', arriveTime: '2026-11-14T00:06:00' })), 11);
  assert.equal(legMinutes(leg('walk')), null);
});

test('metro line names resolve to a line, unknown ones to nothing', () => {
  assert.deepEqual(metroLineByName('松山新店線'), { system: 'TRTC', code: 'G' });
  assert.deepEqual(metroLineByName('Songshan-Xindian Line'), { system: 'TRTC', code: 'G' });
  assert.deepEqual(metroLineByName('板南線(南港展覽館-頂埔)'), { system: 'TRTC', code: 'BL' });
  assert.deepEqual(metroLineByName('BL'), { system: 'TRTC', code: 'BL' });
  assert.deepEqual(metroLineByName('臺中捷運綠線'), { system: 'TMRT', code: 'G' });
  assert.deepEqual(metroLineByName('環狀輕軌'), { system: 'KRTC', code: 'C' });
  // G is both 松山新店線 and 台中綠線: a bare code that two systems use is not guessed.
  assert.equal(metroLineByName('G'), null);
  assert.equal(metroLineByName('307'), null);
  assert.equal(metroLineByName(undefined), null);
});
