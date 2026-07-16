import assert from 'node:assert/strict';
import test from 'node:test';
import { runTdxProxyHttp } from '../src/lib/tdxProxyHttp.ts';

test('shared TDX proxy HTTP allows missing Origin on GET and still reaches the gateway', async () => {
  let executeCount = 0;
  const response = await runTdxProxyHttp(
    {
      method: 'GET',
      origin: '',
      requestHost: 'taiwanrail.vercel.app',
      pathname: '/api/tdx/basic/v2/Rail/TRA/Station',
      rawQuery: '?$format=JSON',
    },
    {
      execute: async () => {
        executeCount += 1;
        return {
          status: 200,
          body: [{ StationID: '1000' }],
          headers: { 'X-Cache': 'MISS' },
        };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, [{ StationID: '1000' }]);
  assert.equal(executeCount, 1);
});

test('shared TDX proxy HTTP denies foreign Origin without calling the gateway', async () => {
  let executeCount = 0;
  const response = await runTdxProxyHttp(
    {
      method: 'GET',
      origin: 'https://evil.example',
      requestHost: 'taiwanrail.vercel.app',
      pathname: '/api/tdx/basic/v2/Rail/TRA/Station',
      rawQuery: '?$format=JSON',
    },
    {
      execute: async () => {
        executeCount += 1;
        return { status: 200, body: [{ leaked: true }], headers: {} };
      },
    },
  );

  assert.deepEqual(response, {
    status: 403,
    body: { error: 'Forbidden' },
    headers: {},
  });
  assert.equal(executeCount, 0);
});

test('shared TDX proxy HTTP forwards an allowed request to the gateway', async () => {
  let seenPath = '';
  let seenQuery = '';
  const response = await runTdxProxyHttp(
    {
      method: 'GET',
      origin: 'https://taiwanrail.vercel.app',
      requestHost: 'taiwanrail.vercel.app',
      pathname: '/api/tdx/basic/v2/Rail/TRA/Station',
      rawQuery: '?$format=JSON',
    },
    {
      execute: async ({ path, rawQuery }) => {
        seenPath = path;
        seenQuery = rawQuery;
        return {
          status: 200,
          body: [{ StationID: '1000' }],
          headers: { 'X-Cache': 'MISS' },
        };
      },
    },
  );

  assert.equal(seenPath, 'basic/v2/Rail/TRA/Station');
  assert.equal(seenQuery, '?$format=JSON');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, [{ StationID: '1000' }]);
  assert.equal(response.headers['X-Cache'], 'MISS');
  assert.equal(
    response.headers['Access-Control-Allow-Origin'],
    'https://taiwanrail.vercel.app',
  );
});

test('shared TDX proxy HTTP returns a generic 500 body when the gateway throws', async () => {
  const response = await runTdxProxyHttp(
    {
      method: 'GET',
      origin: 'https://taiwanrail.vercel.app',
      requestHost: 'taiwanrail.vercel.app',
      pathname: '/api/tdx/basic/v2/Rail/TRA/Station',
      rawQuery: '?$format=JSON',
    },
    {
      execute: async () => {
        throw new Error('secret credential detail leaked');
      },
    },
  );

  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: 'Internal Server Error' });
  assert.equal(
    JSON.stringify(response.body).includes('secret credential'),
    false,
  );
});

test('shared TDX proxy HTTP returns 429 without gateway when abuse gate denies', async () => {
  let executeCount = 0;
  const response = await runTdxProxyHttp(
    {
      method: 'GET',
      origin: 'https://taiwanrail.vercel.app',
      requestHost: 'taiwanrail.vercel.app',
      pathname: '/api/tdx/basic/v2/Rail/TRA/Station',
      rawQuery: '?$format=JSON',
      clientKey: '1.2.3.4',
    },
    {
      execute: async () => {
        executeCount += 1;
        return { status: 200, body: [], headers: {} };
      },
    },
    {
      tryConsume: () => false,
    },
  );

  assert.deepEqual(response, {
    status: 429,
    body: { error: 'Too Many Requests' },
    headers: { 'Retry-After': '60' },
  });
  assert.equal(executeCount, 0);
});
