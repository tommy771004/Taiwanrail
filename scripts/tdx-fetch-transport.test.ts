import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTdxFetchTransport } from '../src/lib/tdxFetchTransport';
import { createTdxGateway } from '../src/lib/tdxGateway';

const quiet = { error() {} };

/** A fetch that never answers until its signal aborts, like TDX's token endpoint on 2026-11-18. */
const hangingFetch = ((_url: string, init?: RequestInit) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
  })) as unknown as typeof fetch;

test('a hanging token endpoint fails within the token timeout', async () => {
  const transport = createTdxFetchTransport({ fetch: hangingFetch, logger: quiet, tokenTimeoutMs: 30 });
  const started = Date.now();
  await assert.rejects(transport.requestToken!({ clientId: 'a', clientSecret: 'b' }));
  assert.ok(Date.now() - started < 1_000);
});

test('a hanging data request becomes 504, not a throw', async () => {
  const transport = createTdxFetchTransport({ fetch: hangingFetch, logger: quiet, requestTimeoutMs: 30 });
  const result = await transport.request({ url: 'https://tdx.transportdata.tw/api/x' });
  assert.equal(result.status, 504);
});

test('a network failure becomes 502', async () => {
  const failing = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
  const transport = createTdxFetchTransport({ fetch: failing, logger: quiet });
  const result = await transport.request({ url: 'https://tdx.transportdata.tw/api/x' });
  assert.equal(result.status, 502);
});

test('a timed-out request falls back to the stale cache and is not cached itself', async () => {
  let now = 1_000_000;
  let hang = false;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (String(url).includes('openid-connect')) {
      return new Response(JSON.stringify({ access_token: 't', expires_in: 86_400 }), { status: 200 });
    }
    if (hang) return hangingFetch(url, init);
    return new Response(JSON.stringify([{ ok: 1 }]), { status: 200 });
  }) as unknown as typeof fetch;
  const gateway = createTdxGateway({
    tdx: createTdxFetchTransport({ fetch: fetchImpl, logger: quiet, requestTimeoutMs: 30 }),
    credentials: () => ({ clientId: 'a', clientSecret: 'b' }),
    clock: { now: () => now },
    logger: { error() {}, warn() {} } as unknown as Console,
  });
  const req = { path: 'basic/v2/Rail/THSR/AvailableSeatStatusList', rawQuery: '?$format=JSON' };
  assert.equal((await gateway.execute(req)).status, 200);
  now += 11 * 60_000; // past the 10-minute TTL
  hang = true;
  const stale = await gateway.execute(req);
  assert.equal(stale.status, 200);
  assert.equal(stale.headers['X-Cache'], 'STALE');
  assert.deepEqual(stale.body, [{ ok: 1 }]);
});
