/**
 * The gateway cache must stay bounded: server.ts keeps one gateway for the whole
 * life of a long-running Express process, so an unbounded Map keyed by
 * `path?query` (i.e. by OD pair and date) is a slow memory leak.
 *
 * Eviction is LRU, not by expiry, because expired entries are still served as
 * `X-Cache: STALE` when TDX returns 429/5xx — that fallback is what keeps the
 * site up during an outage, so the second test pins that a hot key survives.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTdxGateway } from '../src/lib/tdxGateway.js';

function gw(max: number) {
  let served = 0;
  const g = createTdxGateway({
    tdx: {
      async requestToken() { return { token: 't', expiresInSeconds: 3600 }; },
      async request() { served += 1; return { status: 200, body: { n: served } }; },
    },
    credentials: () => ({ clientId: 'a', clientSecret: 'b' }),
    maxCacheEntries: max,
  });
  return { g, upstream: () => served };
}

const p = (i: number) => `basic/v2/Rail/TRA/DailyTimetable/OD/${i}/to/9999`;

test('cache is bounded', async () => {
  const { g } = gw(10);
  for (let i = 0; i < 500; i += 1) await g.execute({ path: p(i), rawQuery: '?$format=JSON' });
  // Oldest keys must have been evicted: re-requesting key 0 must hit upstream again.
  const before = (await g.execute({ path: p(499), rawQuery: '?$format=JSON' })).headers['X-Cache'];
  const evicted = (await g.execute({ path: p(0), rawQuery: '?$format=JSON' })).headers['X-Cache'];
  assert.equal(before, 'HIT', 'most recent entry should still be cached');
  assert.equal(evicted, 'MISS', 'oldest entry should have been evicted');
});

test('LRU keeps a repeatedly-used entry alive', async () => {
  const { g } = gw(10);
  const hot = { path: p(1000), rawQuery: '?$format=JSON' };
  await g.execute(hot);
  for (let i = 0; i < 50; i += 1) {
    await g.execute({ path: p(i), rawQuery: '?$format=JSON' });
    await g.execute(hot); // keep touching it
  }
  assert.equal((await g.execute(hot)).headers['X-Cache'], 'HIT');
});
