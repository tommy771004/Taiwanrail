import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { DailyTimetableOD } from '../src/lib/api';
import { TRA_LINE_TRANSFERS, planBranchTransfers, serviceMinutes, type TransferLegs } from '../src/lib/traBranchTransfers';

const od = (trainNo: string, dep: string, arr: string) =>
  ({ DailyTrainInfo: { TrainNo: trainNo }, OriginStopTime: { DepartureTime: dep }, DestinationStopTime: { ArrivalTime: arr } }) as unknown as DailyTimetableOD;

test('transfer stations match the TDX LineTransfer snapshot', () => {
  const tdx = JSON.parse(readFileSync('scripts/tra-transfer-snapshot/v3-LineTransfer.json', 'utf8')).LineTransfers;
  assert.equal(TRA_LINE_TRANSFERS.length, tdx.length);
  for (const row of tdx) {
    const ours = TRA_LINE_TRANSFERS.find(t => t.stationId === row.FromStationID);
    assert.ok(ours, `missing ${row.FromStationName.Zh_tw}`);
    assert.equal(ours.stationName, row.FromStationName.Zh_tw);
    assert.equal(ours.toLine, row.ToLineName.Zh_tw);
    assert.equal(ours.minTransferMinutes, row.MinTransferTime);
    assert.equal(ours.note !== '', (row.TransferDescription ?? '') !== '', `${ours.stationName} note`);
  }
});

test('service minutes put 00:00–03:59 after the evening', () => {
  assert.equal(serviceMinutes('23:50'), 23 * 60 + 50);
  assert.equal(serviceMinutes('00:10:00'), 24 * 60 + 10);
  assert.equal(serviceMinutes(''), null);
});

test('each second train gets the latest first train that still makes the minimum transfer', () => {
  const legs: TransferLegs[] = [{
    via: '7360', // 瑞芳, min 3
    first: [od('A', '08:00', '08:40'), od('B', '08:20', '08:58'), od('C', '08:30', '09:01')],
    second: [od('X', '09:00', '09:30')],
  }];
  const [plan, ...rest] = planBranchTransfers(legs);
  assert.equal(rest.length, 0);
  // C arrives 09:01 (too late), B leaves 2 min before X — under the 3-minute minimum; A is the one.
  assert.equal(plan.first.DailyTrainInfo.TrainNo, 'A');
  assert.equal(plan.waitMinutes, 20);
  assert.equal(plan.via.stationName, '瑞芳');
});

test('a train that merely passes the transfer station is not a transfer', () => {
  const legs: TransferLegs[] = [{ via: '6000', first: [od('410', '06:00', '10:00')], second: [od('410', '10:05', '10:30')] }];
  assert.deepEqual(planBranchTransfers(legs), []);
});

test('dominated plans are dropped; across stations the later departure wins', () => {
  const legs: TransferLegs[] = [
    { via: '7360', first: [od('A', '08:00', '08:40'), od('C', '09:20', '09:50')], second: [od('X', '09:00', '09:30'), od('Y', '10:00', '10:30')] },
    // Same second train X reached from a later first train via 三貂嶺 → leave later, same arrival.
    { via: '7330', first: [od('B', '08:20', '08:50')], second: [od('X', '08:55', '09:30')] },
    // Leaves 08:00 and arrives 10:30: B>X (08:20 → 09:30) beats it on both ends.
    { via: '3430', first: [od('D', '08:00', '08:30')], second: [od('Z', '09:00', '10:30')] },
  ];
  const plans = planBranchTransfers(legs);
  assert.deepEqual(plans.map(p => `${p.first.DailyTrainInfo.TrainNo}>${p.second.DailyTrainInfo.TrainNo}@${p.via.stationName}`), ['B>X@三貂嶺', 'C>Y@瑞芳']);
});

test('unknown transfer stations are ignored', () => {
  assert.deepEqual(planBranchTransfers([{ via: '9999', first: [od('A', '08:00', '08:10')], second: [od('B', '08:20', '08:30')] }]), []);
});

// ---- Real weekly timetable: the routes that have no direct train at all ----

type Raw = { TrainInfo: { TrainNo: string }; StopTimes: { StationID: string; ArrivalTime?: string; DepartureTime?: string }[]; ServiceDay: Record<string, number> };
const weekly: Raw[] = JSON.parse(readFileSync('public/data/tra-timetable.json', 'utf8')).TrainTimetables
  .filter((t: Raw) => t.ServiceDay?.Wednesday === 1);
const stations = JSON.parse(readFileSync('public/data/tra-stations.json', 'utf8'));
const idOf = (name: string) => (Array.isArray(stations) ? stations : stations.Stations).find((s: any) => s.StationName.Zh_tw === name).StationID;

function odFrom(o: string, d: string): DailyTimetableOD[] {
  const out: DailyTimetableOD[] = [];
  for (const t of weekly) {
    const i = t.StopTimes.findIndex(s => s.StationID === o);
    const j = t.StopTimes.findIndex(s => s.StationID === d);
    if (i < 0 || j <= i) continue;
    const a = t.StopTimes[i];
    const b = t.StopTimes[j];
    out.push(od(t.TrainInfo.TrainNo, a.DepartureTime || a.ArrivalTime || '', b.ArrivalTime || b.DepartureTime || ''));
  }
  return out;
}

function realPlans(from: string, to: string) {
  const o = idOf(from);
  const d = idOf(to);
  assert.equal(odFrom(o, d).length, 0, `${from}→${to} unexpectedly has direct trains`);
  const legs = TRA_LINE_TRANSFERS.map(t => t.stationId).filter(v => v !== o && v !== d)
    .map(via => ({ via, first: odFrom(o, via), second: odFrom(via, d) }));
  return planBranchTransfers(legs);
}

for (const [from, to, via] of [['臺北', '十分', ['瑞芳', '三貂嶺', '八堵']], ['臺北', '集集', ['二水', '彰化']], ['臺北', '六家', ['北新竹']], ['臺中', '車埕', ['二水', '彰化']], ['臺北', '八斗子', ['瑞芳']]] as const) {
  test(`real timetable: ${from}→${to} has one-transfer plans via ${via.join('／')}`, () => {
    const plans = realPlans(from, to);
    assert.ok(plans.length >= 5, `only ${plans.length} plans`);
    for (const p of plans) {
      assert.ok((via as readonly string[]).includes(p.via.stationName), `unexpected via ${p.via.stationName}`);
      assert.notEqual(p.first.DailyTrainInfo.TrainNo, p.second.DailyTrainInfo.TrainNo);
      assert.ok(p.waitMinutes >= p.via.minTransferMinutes);
      assert.ok(p.arriveMin > p.departMin);
    }
    // Sorted and non-dominated: departures and arrivals both strictly increase.
    for (let i = 1; i < plans.length; i++) {
      assert.ok(plans[i].departMin > plans[i - 1].departMin && plans[i].arriveMin > plans[i - 1].arriveMin);
    }
  });
}
