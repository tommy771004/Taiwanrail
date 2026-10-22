import assert from 'node:assert/strict';
import test from 'node:test';
import { createTdxGateway } from '../src/lib/tdxGateway.ts';

test('拒絕不在產品允許範圍的 path，且不呼叫 TDX transport', async () => {
  let requestCount = 0;
  let tokenCount = 0;
  const gateway = createTdxGateway({
    credentials: () => ({ clientId: 'client', clientSecret: 'secret' }),
    tdx: {
      requestToken: async () => {
        tokenCount += 1;
        return { token: 'should-not-be-issued', expiresInSeconds: 3_600 };
      },
      request: async () => {
        requestCount += 1;
        return { status: 200, body: [{ leaked: true }] };
      },
    },
  });

  const result = await gateway.execute({
    path: 'basic/v2/Rail/SomeOtherOperator/Secret',
    rawQuery: '?$format=JSON',
  });

  assert.deepEqual(result, {
    status: 403,
    body: { error: 'Forbidden path' },
    headers: { 'X-Gateway': 'PATH_DENIED' },
  });
  assert.equal(requestCount, 0);
  assert.equal(tokenCount, 0);
});

test('拒絕含 path traversal 的 path，且不呼叫 TDX transport', async () => {
  let requestCount = 0;
  let tokenCount = 0;
  const gateway = createTdxGateway({
    credentials: () => ({ clientId: 'client', clientSecret: 'secret' }),
    tdx: {
      requestToken: async () => {
        tokenCount += 1;
        return { token: 'should-not-be-issued', expiresInSeconds: 3_600 };
      },
      request: async () => {
        requestCount += 1;
        return { status: 200, body: [{ leaked: true }] };
      },
    },
  });

  const result = await gateway.execute({
    path: 'basic/v2/Rail/TRA/../../Secret',
    rawQuery: '?$format=JSON',
  });

  assert.deepEqual(result, {
    status: 403,
    body: { error: 'Forbidden path' },
    headers: { 'X-Gateway': 'PATH_DENIED' },
  });
  assert.equal(requestCount, 0);
  assert.equal(tokenCount, 0);
});

test('拒絕空 path，且不呼叫 TDX transport', async () => {
  let requestCount = 0;
  let tokenCount = 0;
  const gateway = createTdxGateway({
    credentials: () => ({ clientId: 'client', clientSecret: 'secret' }),
    tdx: {
      requestToken: async () => {
        tokenCount += 1;
        return { token: 'should-not-be-issued', expiresInSeconds: 3_600 };
      },
      request: async () => {
        requestCount += 1;
        return { status: 200, body: [{ leaked: true }] };
      },
    },
  });

  const result = await gateway.execute({
    path: '',
    rawQuery: '?$format=JSON',
  });

  assert.deepEqual(result, {
    status: 403,
    body: { error: 'Forbidden path' },
    headers: { 'X-Gateway': 'PATH_DENIED' },
  });
  assert.equal(requestCount, 0);
  assert.equal(tokenCount, 0);
});

test('Metro path 在產品允許範圍內並轉發 TDX transport', async () => {
  let outboundUrl = '';
  const gateway = createTdxGateway({
    tdx: {
      request: async ({ url }) => {
        outboundUrl = url;
        return { status: 200, body: [{ StationID: 'BL01' }] };
      },
    },
  });

  const result = await gateway.execute({
    path: 'basic/v2/Rail/Metro/Station/TRTC',
    rawQuery: '?$format=JSON',
  });

  assert.deepEqual(result, {
    status: 200,
    body: [{ StationID: 'BL01' }],
    headers: { 'X-Cache': 'MISS', 'Vercel-CDN-Cache-Control': 'max-age=86400' },
  });
  assert.equal(
    outboundUrl,
    'https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/Station/TRTC?$format=JSON',
  );
});

test('拒絕含 scheme 的 path，且不呼叫 TDX transport', async () => {
  let requestCount = 0;
  let tokenCount = 0;
  const gateway = createTdxGateway({
    credentials: () => ({ clientId: 'client', clientSecret: 'secret' }),
    tdx: {
      requestToken: async () => {
        tokenCount += 1;
        return { token: 'should-not-be-issued', expiresInSeconds: 3_600 };
      },
      request: async () => {
        requestCount += 1;
        return { status: 200, body: [{ leaked: true }] };
      },
    },
  });

  const result = await gateway.execute({
    path: 'https://evil.example/x',
    rawQuery: '',
  });

  assert.deepEqual(result, {
    status: 403,
    body: { error: 'Forbidden path' },
    headers: { 'X-Gateway': 'PATH_DENIED' },
  });
  assert.equal(requestCount, 0);
  assert.equal(tokenCount, 0);
});

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

test('TDX Alert 發生網路錯誤時回傳空的成功回應', async () => {
  const gateway = createTdxGateway({
    tdx: {
      request: async () => {
        throw new Error('network unavailable');
      },
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

test('TDX Alert 回傳無效內容時回傳空的成功回應', async () => {
  const gateway = createTdxGateway({
    tdx: {
      request: async () => ({ status: 200, body: 'not-json-content' }),
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

test('等價 query 共用 fresh cache 且不改寫 outbound query', async () => {
  const outboundUrls: string[] = [];
  const gateway = createTdxGateway({
    tdx: {
      request: async ({ url }) => {
        outboundUrls.push(url);
        return { status: 200, body: [{ TrainNo: '123' }] };
      },
    },
  });

  const first = await gateway.execute({
    path: 'basic/v3/Rail/TRA/DailyTrainTimetable',
    rawQuery: '?$top=5&$format=JSON',
  });
  const second = await gateway.execute({
    path: 'basic/v3/Rail/TRA/DailyTrainTimetable',
    rawQuery: '?$format=JSON&$top=5',
  });

  assert.deepEqual(first, {
    status: 200,
    body: [{ TrainNo: '123' }],
    headers: { 'X-Cache': 'MISS', 'Vercel-CDN-Cache-Control': 'max-age=3600' },
  });
  assert.deepEqual(second, {
    status: 200,
    body: [{ TrainNo: '123' }],
    headers: { 'X-Cache': 'HIT', 'Vercel-CDN-Cache-Control': 'max-age=3600' },
  });
  assert.deepEqual(outboundUrls, [
    'https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/DailyTrainTimetable?$top=5&$format=JSON',
  ]);
});

test('不同 endpoint 使用 production cache TTL', async () => {
  const cases = [
    { path: 'basic/v2/Rail/TRA/LiveBoard/Station/1000', ttl: 30_000 },
    { path: 'basic/v3/Rail/TRA/Alert', ttl: 300_000 },
    { path: 'basic/v3/Rail/TRA/DailyTrainTimetable', ttl: 3_600_000 },
    { path: 'basic/v2/Rail/TRA/ODFare', ttl: 86_400_000 },
    { path: 'basic/v2/Rail/TRA/Station', ttl: 86_400_000 },
    { path: 'maas/routing', ttl: 60_000 },
    { path: 'basic/v2/Rail/THSR/AvailableSeatStatusList', ttl: 600_000 },
    { path: 'basic/v2/Rail/THSR/AvailableSeatStatus/Train/OD/1000/to/1070/TrainDate/2026-10-30', ttl: 3_600_000 },
    // 測試時鐘 now = 1_000 ms → 台北 1970-01-01：今天的 OD 座位與看板同樣 10 分鐘。
    { path: 'basic/v2/Rail/THSR/AvailableSeatStatus/Train/OD/1000/to/1070/TrainDate/1970-01-01', ttl: 600_000 },
    { path: 'basic/v2/Rail/TRA/Shape', ttl: 120_000 },
  ];

  for (const { path, ttl } of cases) {
    let now = 1_000;
    let requests = 0;
    const gateway = createTdxGateway({
      clock: { now: () => now },
      tdx: {
        request: async () => {
          requests += 1;
          return { status: 200, body: [] };
        },
      },
    });

    await gateway.execute({ path, rawQuery: '?$format=JSON' });
    now += ttl - 1;
    const fresh = await gateway.execute({ path, rawQuery: '?$format=JSON' });
    now += 1;
    const expired = await gateway.execute({ path, rawQuery: '?$format=JSON' });

    assert.equal(fresh.headers['X-Cache'], 'HIT', `${path} 應在 TTL 內命中`);
    assert.equal(expired.headers['X-Cache'], 'MISS', `${path} 應在 TTL 時到期`);
    assert.equal(requests, 2, `${path} 應只執行兩次 upstream request`);
  }
});

test('booking response 不快取並標記 no-store', async () => {
  let requests = 0;
  const gateway = createTdxGateway({
    tdx: {
      request: async () => {
        requests += 1;
        return { status: 200, body: { url: `https://booking/${requests}` } };
      },
    },
  });
  const input = {
    path: 'maas-tra/booking/deeplink/direct/tra',
    rawQuery: '?from=1000&to=1020',
  };

  const first = await gateway.execute(input);
  const second = await gateway.execute(input);

  assert.deepEqual(first, {
    status: 200,
    body: { url: 'https://booking/1' },
    headers: { 'Cache-Control': 'no-store', 'X-Cache': 'MISS' },
  });
  assert.deepEqual(second, {
    status: 200,
    body: { url: 'https://booking/2' },
    headers: { 'Cache-Control': 'no-store', 'X-Cache': 'MISS' },
  });
  assert.equal(requests, 2);
});

test('相同請求共用 in-flight operation，但 booking 不共用', async () => {
  let requests = 0;
  const gateway = createTdxGateway({
    tdx: {
      request: async () => {
        requests += 1;
        await Promise.resolve();
        return { status: 200, body: [{ request: requests }] };
      },
    },
  });
  const timetable = {
    path: 'basic/v3/Rail/TRA/DailyTrainTimetable',
    rawQuery: '?$format=JSON',
  };

  const timetableResults = await Promise.all([
    gateway.execute(timetable),
    gateway.execute(timetable),
  ]);
  const bookingResults = await Promise.all([
    gateway.execute({ path: 'maas-tra/booking/deeplink/direct/tra', rawQuery: '?trip=1' }),
    gateway.execute({ path: 'maas-tra/booking/deeplink/direct/tra', rawQuery: '?trip=1' }),
  ]);

  assert.equal(requests, 3);
  assert.deepEqual(timetableResults[0], timetableResults[1]);
  assert.equal(bookingResults[0].headers['Cache-Control'], 'no-store');
  assert.equal(bookingResults[1].headers['Cache-Control'], 'no-store');
});

test('過期 cache 在 upstream 429 或 5xx 時作為 stale fallback', async () => {
  for (const status of [429, 503]) {
    let now = 0;
    let requests = 0;
    const gateway = createTdxGateway({
      clock: { now: () => now },
      tdx: {
        request: async () => {
          requests += 1;
          return requests === 1
            ? { status: 200, body: [{ TrainNo: 'cached' }] }
            : { status, body: { error: 'upstream unavailable' } };
        },
      },
    });
    const input = {
      path: 'basic/v3/Rail/TRA/DailyTrainTimetable',
      rawQuery: '?$format=JSON',
    };

    await gateway.execute(input);
    now = 3_600_000;
    const response = await gateway.execute(input);

    assert.deepEqual(response, {
      status: 200,
      body: [{ TrainNo: 'cached' }],
      headers: { 'X-Cache': 'STALE' },
    });
    assert.equal(requests, 2);
  }
});

test('缺少 TDX credentials 時回傳可重試的 503', async () => {
  let requests = 0;
  const gateway = createTdxGateway({
    credentials: () => ({ clientId: '   ', clientSecret: 'secret' }),
    tdx: {
      request: async () => {
        requests += 1;
        return { status: 200, body: [] };
      },
    },
  });

  const response = await gateway.execute({
    path: 'basic/v3/Rail/TRA/DailyTrainTimetable',
    rawQuery: '?$format=JSON',
  });

  assert.deepEqual(response, {
    status: 503,
    body: { error: 'Token Error', reason: 'missing_credentials' },
    headers: { 'Retry-After': '15' },
  });
  assert.equal(requests, 0);
});

test('TDX credentials 會 trim，且有效 token 在到期前重用', async () => {
  let tokenRequests = 0;
  const dataTokens: Array<string | undefined> = [];
  const gateway = createTdxGateway({
    clock: { now: () => 1_000 },
    credentials: () => ({
      clientId: ' client-id\n',
      clientSecret: ' secret-value ',
    }),
    tdx: {
      requestToken: async (credentials) => {
        tokenRequests += 1;
        assert.deepEqual(credentials, {
          clientId: 'client-id',
          clientSecret: 'secret-value',
        });
        return { token: 'token-1', expiresInSeconds: 3_600 };
      },
      request: async ({ accessToken }) => {
        dataTokens.push(accessToken);
        return { status: 200, body: [] };
      },
    },
  });

  await gateway.execute({ path: 'basic/v2/Rail/TRA/Station', rawQuery: '' });
  await gateway.execute({ path: 'basic/v2/Rail/TRA/Shape', rawQuery: '' });

  assert.equal(tokenRequests, 1);
  assert.deepEqual(dataTokens, ['token-1', 'token-1']);
});

test('並行冷啟動只執行一次 token operation', async () => {
  let tokenRequests = 0;
  let dataRequests = 0;
  const gateway = createTdxGateway({
    credentials: () => ({ clientId: 'client', clientSecret: 'secret' }),
    tdx: {
      requestToken: async () => {
        tokenRequests += 1;
        await Promise.resolve();
        return { token: 'shared-token', expiresInSeconds: 3_600 };
      },
      request: async ({ accessToken }) => {
        assert.equal(accessToken, 'shared-token');
        dataRequests += 1;
        return { status: 200, body: [] };
      },
    },
  });

  await Promise.all([
    gateway.execute({ path: 'basic/v2/Rail/TRA/Station', rawQuery: '' }),
    gateway.execute({ path: 'basic/v2/Rail/TRA/Shape', rawQuery: '' }),
  ]);

  assert.equal(tokenRequests, 1);
  assert.equal(dataRequests, 2);
});

test('token 失敗重試一次並在 15 秒內退避', async () => {
  let now = 0;
  let tokenRequests = 0;
  const sleeps: number[] = [];
  const gateway = createTdxGateway({
    clock: { now: () => now },
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
    credentials: () => ({ clientId: 'client', clientSecret: 'secret' }),
    tdx: {
      requestToken: async () => {
        tokenRequests += 1;
        return null;
      },
      request: async () => ({ status: 200, body: [] }),
    },
  });
  const input = { path: 'basic/v2/Rail/TRA/Station', rawQuery: '' };

  const first = await gateway.execute(input);
  now = 1_000;
  const duringBackoff = await gateway.execute(input);
  now = 15_000;
  await gateway.execute(input);

  assert.deepEqual(first, {
    status: 503,
    body: { error: 'Token Error', reason: 'auth_failed' },
    headers: { 'Retry-After': '15' },
  });
  assert.deepEqual(duringBackoff, first);
  assert.equal(tokenRequests, 4);
  assert.deepEqual(sleeps, [500, 500]);
});

test('token 暫時不可用時回傳過期 cache', async () => {
  let now = 0;
  let tokenRequests = 0;
  let dataRequests = 0;
  const gateway = createTdxGateway({
    clock: { now: () => now },
    sleep: async () => {},
    credentials: () => ({ clientId: 'client', clientSecret: 'secret' }),
    tdx: {
      requestToken: async () => {
        tokenRequests += 1;
        return tokenRequests === 1
          ? { token: 'short-token', expiresInSeconds: 61 }
          : null;
      },
      request: async () => {
        dataRequests += 1;
        return { status: 200, body: [{ TrainNo: 'cached' }] };
      },
    },
  });
  const input = {
    path: 'basic/v3/Rail/TRA/DailyTrainTimetable',
    rawQuery: '?$format=JSON',
  };

  await gateway.execute(input);
  now = 3_600_000;
  const response = await gateway.execute(input);

  assert.deepEqual(response, {
    status: 200,
    body: [{ TrainNo: 'cached' }],
    headers: { 'X-Cache': 'STALE' },
  });
  assert.equal(tokenRequests, 3);
  assert.equal(dataRequests, 1);
});

test('沒有 gateway fallback 時保留 upstream status 與 body', async () => {
  const gateway = createTdxGateway({
    tdx: {
      request: async () => ({
        status: 418,
        body: { error: 'upstream response' },
      }),
    },
  });

  const response = await gateway.execute({
    path: 'basic/v2/Rail/TRA/Station',
    rawQuery: '?$format=JSON',
  });

  assert.deepEqual(response, {
    status: 418,
    body: { error: 'upstream response' },
    headers: { 'X-Cache': 'MISS' },
  });
});

test('CDN 快取時間等於記憶體快取剩餘秒數，STALE 與錯誤不交給 CDN', async () => {
  let now = 0;
  let requests = 0;
  const gateway = createTdxGateway({
    clock: { now: () => now },
    tdx: {
      request: async () => {
        requests += 1;
        return requests === 1
          ? { status: 200, body: [{ TrainNo: '1' }] }
          : { status: 503, body: { error: 'down' } };
      },
    },
  });
  const input = { path: 'basic/v2/Rail/TRA/LiveBoard/Station/1000', rawQuery: '?$format=JSON' };

  const miss = await gateway.execute(input);
  now = 20_000;
  const hit = await gateway.execute(input);
  now = 31_000;
  const stale = await gateway.execute(input);

  assert.equal(miss.headers['Vercel-CDN-Cache-Control'], 'max-age=30');
  assert.equal(hit.headers['Vercel-CDN-Cache-Control'], 'max-age=10');
  assert.equal(stale.headers['X-Cache'], 'STALE');
  assert.equal(stale.headers['Vercel-CDN-Cache-Control'], undefined);
});

test('404 也快取（上限 5 分鐘），過期 404 不會被當成 200 回傳', async () => {
  let now = 0;
  const statuses = [404, 429];
  let requests = 0;
  const gateway = createTdxGateway({
    clock: { now: () => now },
    tdx: {
      request: async () => {
        const status = statuses[requests] ?? 404;
        requests += 1;
        return { status, body: { message: 'not published' } };
      },
    },
  });
  const input = { path: 'basic/v2/Rail/Metro/Station/NTDLRT', rawQuery: '?$format=JSON' };

  const first = await gateway.execute(input);
  now = 5 * 60_000 - 1;
  const cached = await gateway.execute(input);
  now = 5 * 60_000;
  const limited = await gateway.execute(input);

  assert.equal(first.status, 404);
  assert.equal(first.headers['Vercel-CDN-Cache-Control'], 'max-age=300');
  assert.equal(cached.headers['X-Cache'], 'HIT');
  assert.equal(requests, 2, 'TTL 內的 404 不應再打 TDX');
  assert.equal(limited.status, 404, '429 時的過期 fallback 應保留原本的 404');
  assert.equal(limited.headers['X-Cache'], 'STALE');
});

test('捷運單站 LiveBoard 由整系統看板篩出，所有車站共用一次 TDX 呼叫', async () => {
  const outboundUrls: string[] = [];
  const board = [
    { StationID: 'BL12', DestinationStationID: 'BL23', EstimateTime: 2 },
    { StationID: 'R10', DestinationStationID: 'R28', EstimateTime: 1 },
    { StationID: 'BL11', DestinationStationID: 'BL01', EstimateTime: 4 },
    { StationID: 'BL1', DestinationStationID: 'BL23', EstimateTime: 3 },
  ];
  const gateway = createTdxGateway({
    clock: { now: () => 0 },
    tdx: {
      request: async ({ url }) => {
        outboundUrls.push(url);
        return { status: 200, body: board };
      },
    },
  });
  const path = 'basic/v2/Rail/Metro/LiveBoard/TRTC';

  const interchange = await gateway.execute({
    path,
    rawQuery: "?$filter=StationID%20eq%20%27BL12%27%20or%20StationID%20eq%20%27R10%27&$format=JSON",
  });
  const single = await gateway.execute({ path, rawQuery: "?$filter=StationID eq 'BL11'&$format=JSON" });

  assert.deepEqual(interchange.body, [board[0], board[1]]);
  assert.deepEqual(single.body, [board[2]], '只回傳 StationID 完全相同的列（BL1 ≠ BL11）');
  assert.equal(single.headers['X-Cache'], 'HIT');
  assert.equal(single.headers['Vercel-CDN-Cache-Control'], 'max-age=30');
  assert.deepEqual(outboundUrls, [
    'https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/LiveBoard/TRTC?$format=JSON',
  ]);
});

test('捷運 LiveBoard 的其他 query 形式原樣轉發，整系統失敗時保留錯誤', async () => {
  const outboundUrls: string[] = [];
  const gateway = createTdxGateway({
    tdx: {
      request: async ({ url }) => {
        outboundUrls.push(url);
        return url.includes('$top')
          ? { status: 200, body: [{ StationID: 'BL12' }] }
          : { status: 503, body: { error: 'down' } };
      },
    },
  });
  const path = 'basic/v2/Rail/Metro/LiveBoard/TRTC';

  await gateway.execute({ path, rawQuery: "?$filter=StationID eq 'BL12'&$top=1&$format=JSON" });
  await gateway.execute({ path, rawQuery: "?$filter=LineID eq 'BL'&$format=JSON" });
  const failed = await gateway.execute({ path, rawQuery: "?$filter=StationID eq 'BL12'&$format=JSON" });

  assert.deepEqual(outboundUrls.slice(0, 2), [
    "https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/LiveBoard/TRTC?$filter=StationID eq 'BL12'&$top=1&$format=JSON",
    "https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/LiveBoard/TRTC?$filter=LineID eq 'BL'&$format=JSON",
  ]);
  assert.equal(failed.status, 503);
  assert.deepEqual(failed.body, { error: 'down' });
});
