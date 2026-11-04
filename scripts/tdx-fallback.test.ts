import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { getTRATrainTimetable } from '../src/lib/api.ts';
import { getMetroODFare } from '../src/lib/metro.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Serve `/data/...` from `files`; everything else counts as one API call. */
function stubFetch(
  files: Record<string, unknown>,
  api: () => { status: number; body: unknown },
) {
  const apiCalls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/data/')) {
      const path = url.slice('/data/'.length);
      // Vercel rewrites a missing file to index.html: 200, but not JSON.
      if (!(path in files)) return new Response('<!doctype html>', { status: 200 });
      return new Response(JSON.stringify(files[path]), { status: 200 });
    }
    apiCalls.push(url);
    const { status, body } = api();
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return apiCalls;
}

const fareRow = (origin: string, dest: string, price: number) => ({
  OriginStationID: origin,
  DestinationStationID: dest,
  Fares: [{ TicketType: '全票', Price: price }],
});
const noApi = () => ({ status: 200, body: [] });

test('快照沒有這個起站：系統本來就沒票價，不打 API', async () => {
  const apiCalls = stubFetch({ 'metro_NTMC/fares/index.json': ['Y07'] }, noApi);
  assert.deepEqual(await getMetroODFare('NTMC', 'LB01', 'LB05'), []);
  assert.deepEqual(apiCalls, []);
});

test('起站檔案在、目的地不在：沒有這筆票價，不打 API', async () => {
  const apiCalls = stubFetch({
    'metro_KRTC/fares/index.json': ['O5'],
    'metro_KRTC/fares/O5.json': [fareRow('O5', 'R11', 20)],
  }, noApi);
  assert.deepEqual(await getMetroODFare('KRTC', 'O5', 'R10'), []);
  assert.deepEqual(apiCalls, []);
});

test('索引列了起站但檔案讀不到：快照壞了，才打 API', async () => {
  const apiCalls = stubFetch(
    { 'metro_TYMC/fares/index.json': ['A1'] },
    () => ({ status: 200, body: [fareRow('A1', 'A3', 35)] }),
  );
  const fares = await getMetroODFare('TYMC', 'A1', 'A3');
  assert.equal(fares[0]?.price, 35);
  assert.equal(apiCalls.length, 1);
});

test('整個系統沒有票價快照：維持即時查詢', async () => {
  const apiCalls = stubFetch({}, () => ({ status: 200, body: [fareRow('X1', 'X2', 25)] }));
  const fares = await getMetroODFare('TMRT', 'X1', 'X2');
  assert.equal(fares[0]?.price, 25);
  assert.equal(apiCalls.length, 1);
});

const noTimetable = { 'tra-timetable.json': { TrainTimetables: [] } };

test('台鐵車次不在靜態資料：只打一次 API，查無時回空陣列', async () => {
  const apiCalls = stubFetch(noTimetable, () => ({
    status: 200,
    body: { TrainDate: '2026-11-05', TrainTimetables: [] },
  }));
  assert.deepEqual(await getTRATrainTimetable('9999', '2026-11-05'), []);
  assert.equal(apiCalls.length, 1);
  assert.match(apiCalls[0], /DailyTrainTimetable\/TrainNo\/9999/);
});

test('台鐵車次由 API 取得時回傳真實停靠站', async () => {
  stubFetch(noTimetable, () => ({
    status: 200,
    body: {
      TrainTimetables: [{
        TrainInfo: { TrainNo: '191' },
        StopTimes: [{ StationID: '1000', DepartureTime: '08:00' }],
      }],
    },
  }));
  const [train] = await getTRATrainTimetable('191', '2026-11-05');
  assert.equal(train.TrainInfo.TrainNo, '191');
  assert.equal(train.StopTimes[0].ArrivalTime, '08:00');
  assert.notEqual((train.TrainInfo as { IsMock?: boolean }).IsMock, true);
});

test('API 回了別的車次時不當成這班車的停靠站', async () => {
  stubFetch(noTimetable, () => ({
    status: 200,
    body: { TrainTimetables: [{ TrainInfo: { TrainNo: '1006' }, StopTimes: [] }] },
  }));
  assert.deepEqual(await getTRATrainTimetable('193', '2026-11-05'), []);
});

test('API 失敗改用假資料時保留 IsMock，畫面才能標示', async () => {
  stubFetch(noTimetable, () => ({ status: 429, body: { message: 'API rate limit exceeded' } }));
  const [train] = await getTRATrainTimetable('192', '2026-11-05');
  assert.equal((train.TrainInfo as { IsMock?: boolean }).IsMock, true);
});
