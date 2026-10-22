import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSeatLevel, seatTrainKey, seatsFromOD, seatsFromStationBoard } from '../src/lib/thsrSeats';

test('board (O/L/X) and OD (Available/Limited/Full) codes map to the same three levels', () => {
  assert.equal(parseSeatLevel('O'), 'available');
  assert.equal(parseSeatLevel('L'), 'limited');
  assert.equal(parseSeatLevel('X'), 'full');
  assert.equal(parseSeatLevel('Available'), 'available');
  assert.equal(parseSeatLevel('Limited'), 'limited');
  assert.equal(parseSeatLevel('Full'), 'full');
  // An unknown code is "no reading", never a guess of "available".
  assert.equal(parseSeatLevel(''), undefined);
  assert.equal(parseSeatLevel('?'), undefined);
  assert.equal(parseSeatLevel(1), undefined);
});

test('train numbers match with or without leading zeros', () => {
  assert.equal(seatTrainKey('0803'), '803');
  assert.equal(seatTrainKey(803), '803');
  assert.equal(seatTrainKey(' 1203 '), '1203');
  assert.equal(seatTrainKey(null), '');
});

test('today: picks the origin row and the destination stop from the station board', () => {
  const board = {
    UpdateTime: '2026-10-22T10:21:00+08:00',
    AvailableSeats: [
      {
        TrainNo: '0803', StationID: '1000',
        StopStations: [
          { StationID: '1010', StandardSeatStatus: 'X', BusinessSeatStatus: 'X' },
          { StationID: '1040', StandardSeatStatus: 'L', BusinessSeatStatus: 'O' },
        ],
      },
      // Same train seen from another station: must not overwrite the origin's row.
      { TrainNo: '0803', StationID: '1010', StopStations: [{ StationID: '1040', StandardSeatStatus: 'O', BusinessSeatStatus: 'O' }] },
      // Does not stop at the destination.
      { TrainNo: '0111', StationID: '1000', StopStations: [{ StationID: '1070', StandardSeatStatus: 'O', BusinessSeatStatus: 'O' }] },
    ],
  };

  const result = seatsFromStationBoard(board, '1000', '1040');
  assert.deepEqual(result.seats, { '803': { standard: 'limited', business: 'available' } });
  assert.equal(result.updateTime, '2026-10-22T10:21:00+08:00');
});

test('the pre-2026-07 Items envelope is still read', () => {
  const board = { Items: [{ TrainNo: '0803', StationID: '1000', StopStations: [{ StationID: '1040', StandardSeatStatus: 'O' }] }] };
  assert.deepEqual(seatsFromStationBoard(board, '1000', '1040').seats, { '803': { standard: 'available', business: undefined } });
});

test('other dates: OD rows are indexed by train, foreign OD rows and unreadable rows dropped', () => {
  const od = {
    AvailableSeats: [
      { TrainNo: '0121', OriginStationID: '1000', DestinationStationID: '1070', StandardSeatStatus: 'Available', BusinessSeatStatus: 'Full' },
      { TrainNo: '0123', OriginStationID: '1000', DestinationStationID: '1060', StandardSeatStatus: 'Full', BusinessSeatStatus: 'Full' },
      { TrainNo: '0125', OriginStationID: '1000', DestinationStationID: '1070', StandardSeatStatus: '', BusinessSeatStatus: null },
    ],
  };
  assert.deepEqual(seatsFromOD(od, '1000', '1070').seats, { '121': { standard: 'available', business: 'full' } });
});

test('empty or failed responses give no seat data', () => {
  assert.deepEqual(seatsFromOD([], '1000', '1070').seats, {});
  assert.deepEqual(seatsFromOD(null, '1000', '1070').seats, {});
  assert.deepEqual(seatsFromStationBoard({ error: 'x' }, '1000', '1070').seats, {});
});
