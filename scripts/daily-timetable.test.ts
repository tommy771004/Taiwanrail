import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { encodeDailyTimetable, pruneDailyDirectory } from './tdx-daily-timetable.js';
import {
  DAILY_MIN_TRAINS,
  DAILY_WINDOW_DAYS,
  decodeCompactDaily,
  parseCompactDaily,
  taipeiDateString,
  taipeiDateWindow,
} from '../src/lib/dailyTimetable.js';

const DATE = '2026-07-30';

function v3Train(trainNo: string) {
  return {
    TrainDate: DATE,
    TrainInfo: {
      TrainNo: trainNo,
      TrainTypeID: '1132',
      TrainTypeCode: '10',
      TrainTypeName: { Zh_tw: '區間快', En: 'Fast Local Train' },
      StartingStationID: '1110',
      EndingStationID: '0930',
      Direction: 0,
      TripLine: 1,
      OverNightStationID: '',
      WheelChairFlag: 1,
      BikeFlag: 1,
      DiningFlag: 0,
      BreastFeedFlag: 0,
      Note: '加開列車。',
    },
    StopTimes: [
      { StopSequence: 1, StationID: '1110', StationName: { Zh_tw: '埔心', En: 'Puxin' }, ArrivalTime: '10:27', DepartureTime: '10:27' },
      { StopSequence: 2, StationID: '1100', StationName: { Zh_tw: '中壢', En: 'Zhongli' }, ArrivalTime: '10:33', DepartureTime: '10:35' },
      { StopSequence: 3, StationID: '0930', StationName: { Zh_tw: '七堵', En: 'Qidu' }, ArrivalTime: '11:40', DepartureTime: '11:40', SuspendedFlag: 1 },
    ],
  };
}

const lookup = (id: string) =>
  ({
    '1110': { Zh_tw: '埔心', En: 'Puxin' },
    '1100': { Zh_tw: '中壢', En: 'Zhongli' },
    '0930': { Zh_tw: '七堵', En: 'Qidu' },
  })[id];

test('round-trips a TDX v3 daily timetable through the compact format', () => {
  const encoded = encodeDailyTimetable('TRA', DATE, {
    UpdateTime: '2026-07-30T04:00:00+08:00',
    TrainTimetables: [v3Train('1004')],
  });

  assert.equal(encoded.Rail, 'TRA');
  assert.equal(encoded.TrainDate, DATE);
  assert.equal(encoded.UpdateTime, '2026-07-30T04:00:00+08:00');
  assert.deepEqual(encoded.Trains[0].st, ['1110,10:27,10:27', '1100,10:33,10:35', '0930,11:40,11:40,1']);

  const [train] = decodeCompactDaily(encoded, lookup);
  assert.equal(train.TrainDate, DATE);
  assert.equal(train.TrainInfo.TrainNo, '1004');
  assert.equal(train.TrainInfo.TrainTypeID, '1132');
  assert.equal(train.TrainInfo.TrainTypeName.Zh_tw, '區間快');
  assert.equal(train.TrainInfo.Direction, 0);
  assert.equal(train.TrainInfo.TripLine, 1);
  assert.equal(train.TrainInfo.Note.Zh_tw, '加開列車。');
  assert.equal(train.TrainInfo.StartingStationName.Zh_tw, '埔心');
  assert.equal(train.TrainInfo.EndingStationName.Zh_tw, '七堵');
  // App.tsx 讀 WheelchairFlag / BreastFeedingFlag，全週時刻表用的是 WheelChairFlag / BreastFeedFlag
  assert.equal(train.TrainInfo.WheelchairFlag, 1);
  assert.equal(train.TrainInfo.WheelChairFlag, 1);
  assert.equal(train.TrainInfo.BreastFeedingFlag, 0);
  assert.equal(train.TrainInfo.BikeFlag, 1);
  assert.deepEqual(train.StopTimes[1], {
    StopSequence: 2,
    StationID: '1100',
    StationName: { Zh_tw: '中壢', En: 'Zhongli' },
    ArrivalTime: '10:33',
    DepartureTime: '10:35',
    SuspendedFlag: 0,
  });
  assert.equal(train.StopTimes[2].SuspendedFlag, 1);
});

test('accepts the TDX v2 array shape and its DailyTrainInfo/Note object', () => {
  const encoded = encodeDailyTimetable('THSR', DATE, [
    {
      TrainDate: DATE,
      DailyTrainInfo: {
        TrainNo: '0108',
        Direction: 1,
        StartingStationID: '1070',
        EndingStationID: '0990',
        Note: { Zh_tw: '本車次加掛。' },
        WheelchairFlag: 1,
      },
      StopTimes: [
        { StopSequence: 1, StationID: '1070', ArrivalTime: '07:25', DepartureTime: '07:55' },
        { StopSequence: 2, StationID: '0990', ArrivalTime: '09:20', DepartureTime: '09:20' },
      ],
    },
  ]);

  assert.equal(encoded.Trains.length, 1);
  assert.equal(encoded.Trains[0].nz, '本車次加掛。');

  const [train] = decodeCompactDaily(encoded);
  assert.equal(train.TrainInfo.TrainNo, '0108');
  assert.equal(train.TrainInfo.Note.Zh_tw, '本車次加掛。');
  assert.equal(train.TrainInfo.WheelchairFlag, 1);
  // 站名不在壓縮檔內，沒有 lookup 就留空字串（時刻仍然正確）
  assert.equal(train.StopTimes[0].StationName.Zh_tw, '');
  assert.equal(train.StopTimes[0].DepartureTime, '07:55');
});

test('drops trains without a train number or stops, and de-duplicates train numbers', () => {
  const encoded = encodeDailyTimetable('TRA', DATE, {
    TrainTimetables: [
      v3Train('1004'),
      v3Train('1004'),
      { TrainInfo: { TrainNo: '' }, StopTimes: [{ StationID: '1110', DepartureTime: '10:00' }] },
      { TrainInfo: { TrainNo: '9999' }, StopTimes: [] },
    ],
  });

  assert.deepEqual(encoded.Trains.map((t) => t.n), ['1004']);
});

test('rejects payloads that are thin, mislabelled or for the wrong date', () => {
  const thin = encodeDailyTimetable('TRA', DATE, { TrainTimetables: [v3Train('1004')] });
  assert.equal(parseCompactDaily(thin, { rail: 'TRA', date: DATE }), null, '低於門檻的快照不可採用');

  const trains = Array.from({ length: DAILY_MIN_TRAINS.TRA }, (_, i) => ({ n: String(1000 + i), st: ['1110,10:00,10:00'] }));
  const full = { Rail: 'TRA' as const, TrainDate: DATE, Trains: trains };

  assert.ok(parseCompactDaily(full, { rail: 'TRA', date: DATE }));
  assert.equal(parseCompactDaily(full, { rail: 'THSR', date: DATE }), null);
  assert.equal(parseCompactDaily(full, { rail: 'TRA', date: '2026-07-31' }), null);
  assert.equal(parseCompactDaily({ ...full, Rail: 'MRT' }), null);
  assert.equal(parseCompactDaily({ ...full, TrainDate: '20260730' }), null);
  assert.equal(parseCompactDaily(trains), null);
  assert.equal(parseCompactDaily(null), null);
});

test('encodes a two-week window of Taipei dates', () => {
  const window = taipeiDateWindow(DAILY_WINDOW_DAYS, new Date('2026-07-30T16:30:00Z'));

  assert.equal(DAILY_WINDOW_DAYS, 14);
  assert.equal(window.length, 14);
  // 16:30Z 已經是台灣 7/31 凌晨，視窗必須從台灣的「今天」起算
  assert.equal(window[0], '2026-07-31');
  assert.equal(window[13], '2026-08-13');
  assert.deepEqual([...window].sort(), window);
  assert.equal(taipeiDateString(new Date('2026-07-30T15:59:00Z')), '2026-07-30');
});

test('prunes only the dates that fell out of the window', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tra-daily-'));
  const keep = ['2026-07-30', '2026-07-31'];
  for (const date of [...keep, '2026-07-28', '2026-07-29']) {
    await writeFile(join(directory, `${date}.json`), '{}');
  }
  await writeFile(join(directory, 'README.md'), 'not a snapshot');

  const removed = await pruneDailyDirectory(directory, keep);

  assert.deepEqual(removed.sort(), ['2026-07-28.json', '2026-07-29.json']);
  assert.deepEqual((await readdir(directory)).sort(), ['2026-07-30.json', '2026-07-31.json', 'README.md']);
  assert.deepEqual(await pruneDailyDirectory(join(directory, 'missing'), keep), []);
});
