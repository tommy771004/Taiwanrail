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

test('a category is the set of ride kinds, walking ignored', () => {
  const a = route(3540, [leg('walk'), leg('MRT'), leg('walk'), leg('TRA'), leg('walk')]);
  const b = route(3600, [leg('TRA'), leg('MRT')]);
  assert.equal(routeCategory(a), 'tra+metro');
  assert.equal(routeCategory(b), 'tra+metro');
  assert.equal(routeCategory(route(600, [leg('walk')])), 'walk');
});

test('groups are ordered by their fastest route and keep the API order inside', () => {
  const routes = [
    route(3720, [leg('MRT'), leg('BUS')]),       // 0 metro+bus
    route(3540, [leg('MRT'), leg('TRA')]),       // 1 tra+metro
    route(3540, [leg('BUS'), leg('TRA')]),       // 2 tra+bus
    route(3840, [leg('MRT'), leg('TRA'), leg('BUS')]), // 3 tra+metro+bus
    route(3600, [leg('MRT'), leg('TRA')]),       // 4 tra+metro
  ];
  const groups = groupRoutes(routes);
  assert.deepEqual(groups.map(g => g.key), ['tra+metro', 'tra+bus', 'metro+bus', 'tra+metro+bus']);
  assert.deepEqual(groups[0].indexes, [1, 4]);
  assert.equal(groups[0].fastestSec, 3540);
  assert.equal(fastestOf(routes), 3540);
});

test('a group with no travel time sorts last instead of first', () => {
  const groups = groupRoutes([route(0, [leg('BUS')]), route(1800, [leg('MRT')])]);
  assert.deepEqual(groups.map(g => g.key), ['metro', 'bus']);
  assert.equal(groups[1].fastestSec, 0);
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
