import assert from 'node:assert/strict';
import test from 'node:test';
import { createTdxGateway } from '../src/lib/tdxGateway.ts';

test('Alert 上游失敗時降級為成功的空資料', async () => {
  const gateway = createTdxGateway({
    tdx: {
      request: async () => ({ status: 500, body: { error: 'upstream failed' } }),
    },
  });

  const result = await gateway.execute({
    path: 'basic/v3/Rail/TRA/Alert',
    rawQuery: '?$format=JSON',
  });

  assert.deepEqual(result, {
    status: 200,
    body: [],
    headers: { 'X-Fallback': 'ALERT_EMPTY_UPSTREAM' },
  });
});

test('OData query 的 $ 參數原樣送往 TDX', async () => {
  let outboundUrl = '';
  const gateway = createTdxGateway({
    tdx: {
      request: async (request: { url: string }) => {
        outboundUrl = request.url;
        return { status: 200, body: [] };
      },
    },
  });

  await gateway.execute({
    path: 'basic/v3/Rail/TRA/DailyTrainTimetable',
    rawQuery: "?$filter=TrainNo%20eq%20'123'&$format=JSON&$top=5",
  });

  assert.equal(
    outboundUrl,
    "https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/DailyTrainTimetable?$filter=TrainNo%20eq%20'123'&$format=JSON&$top=5",
  );
});

test('TRA Alert 使用已知可用的 v3 endpoint', async () => {
  let outboundUrl = '';
  const gateway = createTdxGateway({
    tdx: {
      request: async ({ url }) => {
        outboundUrl = url;
        return { status: 200, body: [] };
      },
    },
  });

  await gateway.execute({
    path: 'basic/v2/Rail/TRA/Alert',
    rawQuery: '?$format=JSON',
  });

  assert.equal(
    outboundUrl,
    'https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/Alert?$format=JSON',
  );
});

test('TRA station LiveBoard 使用已知可用的 v2 endpoint', async () => {
  let outboundUrl = '';
  const gateway = createTdxGateway({
    tdx: {
      request: async ({ url }) => {
        outboundUrl = url;
        return { status: 200, body: [] };
      },
    },
  });

  await gateway.execute({
    path: 'basic/v3/Rail/TRA/LiveBoard/Station/1000',
    rawQuery: '?$format=JSON',
  });

  assert.equal(
    outboundUrl,
    'https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/LiveBoard/Station/1000?$format=JSON',
  );
});

test('TRA LiveBoard 集合使用已知可用的 v2 endpoint', async () => {
  let outboundUrl = '';
  const gateway = createTdxGateway({
    tdx: {
      request: async ({ url }) => {
        outboundUrl = url;
        return { status: 200, body: [] };
      },
    },
  });

  await gateway.execute({
    path: 'basic/v3/Rail/TRA/LiveBoard',
    rawQuery: '?$format=JSON',
  });

  assert.equal(
    outboundUrl,
    'https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/LiveBoard?$format=JSON',
  );
});

test('附近公車站查詢使用 advanced tier', async () => {
  let outboundUrl = '';
  const gateway = createTdxGateway({
    tdx: {
      request: async ({ url }) => {
        outboundUrl = url;
        return { status: 200, body: [] };
      },
    },
  });

  await gateway.execute({
    path: 'basic/v2/Bus/Station/NearBy',
    rawQuery: '?$spatialFilter=nearby(25.0478,121.5170,500)&$format=JSON',
  });

  assert.equal(
    outboundUrl,
    'https://tdx.transportdata.tw/api/advanced/v2/Bus/Station/NearBy?$spatialFilter=nearby(25.0478,121.5170,500)&$format=JSON',
  );
});

test('TDX 對 Alert 限流時回傳空的成功回應', async () => {
  const gateway = createTdxGateway({
    tdx: {
      request: async () => ({
        status: 429,
        body: { error: 'rate limited' },
      }),
    },
  });

  const response = await gateway.execute({
    path: 'basic/v3/Rail/TRA/Alert',
    rawQuery: '?$format=JSON',
  });

  assert.deepEqual(response, {
    status: 200,
    body: [],
    headers: {
      'X-Fallback': 'ALERT_EMPTY_UPSTREAM',
    },
  });
});

test('TDX 找不到 Alert endpoint 時回傳空的成功回應', async () => {
  const gateway = createTdxGateway({
    tdx: {
      request: async () => ({
        status: 404,
        body: { error: 'not found' },
      }),
    },
  });

  const response = await gateway.execute({
    path: 'basic/v3/Rail/TRA/Alert',
    rawQuery: '?$format=JSON',
  });

  assert.deepEqual(response, {
    status: 200,
    body: [],
    headers: {
      'X-Fallback': 'ALERT_EMPTY_UPSTREAM',
    },
  });
});
