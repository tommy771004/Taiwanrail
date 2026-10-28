import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeTrainPosition,
  scheduleFraction,
  taipeiNowMinutes,
  timeStops,
  trainPosition,
  type PositionStopInput,
} from '../src/lib/trainPosition';

// 自強 109 次（基隆 → 屏東）週間班表的前段，臺北 1000 → 臺中 3300
const stop = (id: string, zh: string, arr: string, dep: string): PositionStopInput => ({
  StationID: id, StationName: { Zh_tw: zh, En: zh }, ArrivalTime: arr, DepartureTime: dep,
});
const T109 = [
  stop('0900', '基隆', '07:34', '07:34'),
  stop('0930', '八堵', '07:41', '07:43'),
  stop('0980', '南港', '08:00', '08:01'),
  stop('1000', '臺北', '08:10', '08:13'),
  stop('1020', '板橋', '08:21', '08:23'),
  stop('1080', '桃園', '08:43', '08:45'),
  stop('3300', '臺中', '10:29', '10:31'),
];
const min = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

test('before the first departure the train waits at its starting station', () => {
  const pos = trainPosition(T109, '1000', '3300', min('07:20'))!;
  assert.equal(pos.motion, 'waiting');
  assert.equal(pos.phase, 'approach');
  assert.equal(pos.stopsToOrigin, 3);
  assert.equal(pos.progress, 0);
  assert.equal(describeTrainPosition(pos, min('07:20'), true), '基隆 待發 07:34 · 還有 3 站到本站');
});

test('approaching the origin counts stops and rounds the minutes up', () => {
  const pos = trainPosition(T109, '1000', '3300', min('08:05') + 0.5)!;
  assert.equal(pos.motion, 'run');
  assert.equal(pos.index, 2);
  assert.equal(pos.phase, 'approach');
  assert.equal(pos.stopsToOrigin, 1);
  assert.equal(describeTrainPosition(pos, min('08:05') + 0.5, true), '南港 → 臺北 · 約 5 分進站');

  const far = trainPosition(T109, '1000', '3300', min('07:50'))!;
  assert.equal(far.stopsToOrigin, 2);
  assert.equal(describeTrainPosition(far, min('07:50'), true), '八堵 → 南港 · 還有 2 站 · 約 20 分');
});

test('dwelling at the origin is its own phase, also when the origin is the first stop', () => {
  const at = trainPosition(T109, '1000', '3300', min('08:11'))!;
  assert.equal(at.phase, 'atOrigin');
  assert.equal(describeTrainPosition(at, min('08:11'), true), '停靠本站 · 08:13 開');

  const firstStop = trainPosition(T109, '0900', '1000', min('07:00'))!;
  assert.equal(firstStop.motion, 'waiting');
  assert.equal(firstStop.phase, 'atOrigin');
});

test('between origin and destination progress follows the scheduled arrival scale', () => {
  const pos = trainPosition(T109, '1000', '3300', min('08:33'))!;
  assert.equal(pos.phase, 'enroute');
  assert.equal(pos.index, 4);
  assert.equal(pos.nextIndex, 5);
  const a = scheduleFraction(pos, 4), b = scheduleFraction(pos, 5);
  assert.ok(pos.progress > a && pos.progress < b);
  assert.equal(pos.progress, a + 0.5 * (b - a));
  assert.equal(describeTrainPosition(pos, min('08:33'), true), '行駛中 · 板橋 → 桃園 · 約 10 分');

  const dwell = trainPosition(T109, '1000', '3300', min('08:44'))!;
  assert.equal(dwell.progress, scheduleFraction(dwell, 5));
  assert.equal(describeTrainPosition(dwell, min('08:44'), true), '停靠 桃園 · 08:45 開');
});

test('a delay shifts the whole train by the same minutes', () => {
  const onTime = trainPosition(T109, '1000', '3300', min('08:12'))!;
  const late = trainPosition(T109, '1000', '3300', min('08:12'), 5)!;
  assert.equal(onTime.phase, 'atOrigin');
  assert.equal(late.phase, 'approach');
  assert.equal(describeTrainPosition(late, min('08:12'), true), '南港 → 臺北 · 約 3 分進站');
});

test('reaching the destination, or running past it, reads as arrived', () => {
  for (const now of [min('10:30'), min('11:00')]) {
    const pos = trainPosition(T109, '1000', '3300', now)!;
    assert.equal(pos.phase, 'arrived');
    assert.equal(pos.progress, 1);
    assert.equal(describeTrainPosition(pos, now, true), '已抵達臺中');
  }
});

test('trains crossing midnight use the App early-morning scale (0~3 h → 24~27 h)', () => {
  const night = [
    stop('A', '甲', '23:40', '23:42'),
    stop('B', '乙', '00:10', '00:12'),
    stop('C', '丙', '00:40', '00:40'),
  ];
  const timed = timeStops(night)!;
  assert.deepEqual(timed.map(s => s.arr), [1420, 1450, 1480]);
  const pos = trainPosition(night, 'A', 'C', 24 * 60 + 20)!;
  assert.equal(pos.motion, 'run');
  assert.equal(pos.index, 1);

  // 凌晨才發車的班次整班搬到 24 點之後，與 getTwMinutes 的 now 同一個尺度
  const early = timeStops([stop('A', '甲', '00:05', '00:05'), stop('B', '乙', '00:30', '00:30')])!;
  assert.deepEqual(early.map(s => s.dep), [1445, 1470]);
});

test('unknown or reversed stations and missing times give no position instead of a guess', () => {
  assert.equal(trainPosition(T109, '9999', '3300', min('08:00')), null);
  assert.equal(trainPosition(T109, '3300', '1000', min('08:00')), null);
  assert.equal(trainPosition([], '1000', '3300', min('08:00')), null);
  assert.equal(trainPosition(undefined, '1000', '3300', min('08:00')), null);
  const broken = T109.map((s, i) => (i === 2 ? { ...s, ArrivalTime: '', DepartureTime: '' } : s));
  assert.equal(trainPosition(broken, '1000', '3300', min('08:00')), null);
});

test('English captions name the stations and keep the "~" estimate marker', () => {
  const pos = trainPosition(T109, '1000', '3300', min('08:33'))!;
  assert.equal(describeTrainPosition(pos, min('08:33'), false), '板橋 → 桃園 · ~10 min');
});

test('taipeiNowMinutes is Taipei wall-clock time with seconds, early hours folded to 24+', () => {
  assert.equal(taipeiNowMinutes(new Date('2026-10-28T00:33:30Z')), 8 * 60 + 33.5);
  assert.equal(taipeiNowMinutes(new Date('2026-10-28T17:05:00Z')), 25 * 60 + 5);
});
