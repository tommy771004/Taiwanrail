import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GATE_CHAIN_COOKIE_NAME,
  GATE_CHAIN_GAP_MS,
  GATE_CHAIN_LIMIT_MS,
  GATE_COOKIE_NAME,
  GATE_TICKET_TTL_MS,
  GATE_REFRESH_WINDOW_MS,
  buildSetCookieHeader,
  mintClaims,
  parseCookieJti,
  shouldRefresh,
  signGateTicket,
  verifyGateTicket,
} from '../src/lib/gateTicketCrypto.ts';
import { allowLiveGatewayAuth } from '../src/lib/gateTicketAuth.ts';
import {
  GATE_MINT_MAX,
  GATE_MINT_WINDOW_MS,
  recordApiAbuseThrottleHit,
  resetGateStoresForTests,
  tryConsumeGateMint,
  isGateEscalated,
} from '../src/lib/gateTicketStore.ts';
import { runTdxProxyHttp } from '../src/lib/tdxProxyHttp.ts';
import { runGateMintHttp } from '../src/lib/gateHttp.ts';
import { resolveGateSecret } from '../src/lib/gateSecret.ts';
import { denyUnlessLiveGatewayAllowed } from '../src/lib/liveGatewayGuard.ts';
import {
  ensureGateTicket,
  GATE_RELOAD_EVENT,
  isReloadRequired,
  resetGateTicketClientForTests,
} from '../src/lib/gateTicketClient.ts';
import { LIVE_CLIENT_VERSION } from '../src/lib/liveClientVersion.ts';
import { fetchTDXApi } from '../src/lib/api.ts';

const SECRET = 'test-gate-secret-do-not-use-in-prod';

test('sign/verify round-trips a ticket within TTL', () => {
  const now = 1_700_000_000_000;
  const claims = mintClaims(now);
  const ticket = signGateTicket(claims, SECRET);
  const verified = verifyGateTicket(ticket, SECRET, now + 1_000);
  assert.ok(verified);
  assert.equal(verified.jti, claims.jti);
  assert.equal(verified.exp, claims.exp);
  assert.equal(claims.exp - claims.iat, GATE_TICKET_TTL_MS);
});

test('verify rejects expired tickets', () => {
  const now = 1_700_000_000_000;
  const claims = mintClaims(now);
  const ticket = signGateTicket(claims, SECRET);
  const verified = verifyGateTicket(ticket, SECRET, claims.exp + 1);
  assert.equal(verified, null);
});

test('verify rejects tampered payload', () => {
  const claims = mintClaims(1_700_000_000_000);
  const ticket = signGateTicket(claims, SECRET);
  const [payload] = ticket.split('.');
  const tampered = `${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
  assert.equal(verifyGateTicket(tampered, SECRET, claims.iat), null);
});

test('shouldRefresh is true only in the last refresh window', () => {
  const now = 1_700_000_000_000;
  const claims = mintClaims(now);
  assert.equal(shouldRefresh(claims, now + 1_000), false);
  assert.equal(
    shouldRefresh(claims, claims.exp - GATE_REFRESH_WINDOW_MS + 1),
    true,
  );
});

test('cookie parse/build use tr_gate_jti and HttpOnly', () => {
  const header = buildSetCookieHeader('abc123', 600, true);
  assert.match(header, new RegExp(`^${GATE_COOKIE_NAME}=abc123;`));
  assert.match(header, /HttpOnly/i);
  assert.match(header, /Secure/i);
  assert.match(header, /SameSite=Lax/i);
  assert.equal(
    parseCookieJti(`${GATE_COOKIE_NAME}=abc123; other=1`),
    'abc123',
  );
  assert.equal(parseCookieJti('other=1'), null);
});

test('live gateway dual-auth denies missing ticket even when Origin is missing on GET', () => {
  const decision = allowLiveGatewayAuth({
    origin: '',
    requestHost: 'taiwanrail.vercel.app',
    method: 'GET',
    authorization: '',
    cookieHeader: '',
    secret: SECRET,
    now: 1_700_000_000_000,
  });
  assert.equal(decision.allow, false);
  assert.equal(decision.reason, 'missing_ticket');
});

test('live gateway dual-auth allows valid ticket + matching cookie + allowed Origin', () => {
  const now = 1_700_000_000_000;
  const claims = mintClaims(now);
  const ticket = signGateTicket(claims, SECRET);
  const decision = allowLiveGatewayAuth({
    origin: 'https://taiwanrail.vercel.app',
    requestHost: 'taiwanrail.vercel.app',
    method: 'GET',
    authorization: `Bearer ${ticket}`,
    cookieHeader: `${GATE_COOKIE_NAME}=${claims.jti}`,
    secret: SECRET,
    now,
  });
  assert.equal(decision.allow, true);
  assert.equal(decision.reason, 'ok');
});

test('live gateway dual-auth denies ticket when cookie jti mismatches', () => {
  const now = 1_700_000_000_000;
  const claims = mintClaims(now);
  const ticket = signGateTicket(claims, SECRET);
  const decision = allowLiveGatewayAuth({
    origin: 'https://taiwanrail.vercel.app',
    requestHost: 'taiwanrail.vercel.app',
    method: 'GET',
    authorization: `Bearer ${ticket}`,
    cookieHeader: `${GATE_COOKIE_NAME}=other-jti`,
    secret: SECRET,
    now,
  });
  assert.equal(decision.allow, false);
  assert.equal(decision.reason, 'cookie_mismatch');
});

test('live gateway dual-auth denies foreign Origin even with valid ticket', () => {
  const now = 1_700_000_000_000;
  const claims = mintClaims(now);
  const ticket = signGateTicket(claims, SECRET);
  const decision = allowLiveGatewayAuth({
    origin: 'https://evil.example',
    requestHost: 'taiwanrail.vercel.app',
    method: 'GET',
    authorization: `Bearer ${ticket}`,
    cookieHeader: `${GATE_COOKIE_NAME}=${claims.jti}`,
    secret: SECRET,
    now,
  });
  assert.equal(decision.allow, false);
  assert.equal(decision.reason, 'origin_not_allowed');
});

test('live gateway dual-auth allows missing Origin on GET when ticket+cookie valid', () => {
  const now = 1_700_000_000_000;
  const claims = mintClaims(now);
  const ticket = signGateTicket(claims, SECRET);
  const decision = allowLiveGatewayAuth({
    origin: '',
    requestHost: 'taiwanrail.vercel.app',
    method: 'GET',
    authorization: `Bearer ${ticket}`,
    cookieHeader: `${GATE_COOKIE_NAME}=${claims.jti}`,
    secret: SECRET,
    now,
  });
  assert.equal(decision.allow, true);
});

test('gate mint store enforces 60s / 10', () => {
  resetGateStoresForTests();
  const now = 2_000_000;
  const key = 'mint-ip';
  for (let i = 0; i < GATE_MINT_MAX; i += 1) {
    assert.equal(tryConsumeGateMint(key, now + i).allow, true);
  }
  assert.equal(tryConsumeGateMint(key, now + GATE_MINT_MAX).allow, false);
  assert.equal(GATE_MINT_WINDOW_MS, 60_000);
  assert.equal(GATE_MINT_MAX, 10);
});

test('gate escalation refuses mint after 3 abuse hits within 10 minutes', () => {
  resetGateStoresForTests();
  const now = 3_000_000;
  const key = 'esc-ip';
  recordApiAbuseThrottleHit(key, now);
  recordApiAbuseThrottleHit(key, now + 1_000);
  recordApiAbuseThrottleHit(key, now + 2_000);
  assert.equal(isGateEscalated(key, now + 3_000), true);
  assert.equal(tryConsumeGateMint(key, now + 3_000).allow, false);
  assert.equal(tryConsumeGateMint(key, now + 3_000).reason, 'escalated');
});

test('runGateMintHttp mints ticket and Set-Cookie for allowed Origin', () => {
  resetGateStoresForTests();
  const result = runGateMintHttp(
    {
      method: 'POST',
      origin: 'https://taiwanrail.vercel.app',
      requestHost: 'taiwanrail.vercel.app',
      clientKey: 'mint-client',
      cookieHeader: '',
      authorization: '',
    },
    { secret: SECRET, now: 1_700_000_000_000, secureCookie: true },
  );
  assert.equal(result.status, 200);
  assert.equal(typeof (result.body as { ticket: string }).ticket, 'string');
  assert.ok(String(result.headers['Set-Cookie']).includes(GATE_COOKIE_NAME));
  const claims = verifyGateTicket(
    (result.body as { ticket: string }).ticket,
    SECRET,
    1_700_000_000_000,
  );
  assert.ok(claims);
});

test('runGateMintHttp denies foreign Origin', () => {
  resetGateStoresForTests();
  const result = runGateMintHttp(
    {
      method: 'POST',
      origin: 'https://evil.example',
      requestHost: 'taiwanrail.vercel.app',
      clientKey: 'x',
      cookieHeader: '',
      authorization: '',
    },
    { secret: SECRET, now: 1_700_000_000_000, secureCookie: true },
  );
  assert.equal(result.status, 403);
});

test('runTdxProxyHttp denies missing gate ticket without calling gateway', async () => {
  let executeCount = 0;
  const response = await runTdxProxyHttp(
    {
      method: 'GET',
      origin: 'https://taiwanrail.vercel.app',
      requestHost: 'taiwanrail.vercel.app',
      pathname: '/api/tdx/basic/v2/Rail/TRA/Station',
      rawQuery: '?$format=JSON',
      authorization: '',
      cookieHeader: '',
    },
    {
      execute: async () => {
        executeCount += 1;
        return { status: 200, body: [], headers: {} };
      },
    },
    undefined,
    { secret: SECRET, now: 1_700_000_000_000 },
  );
  assert.equal(response.status, 401);
  assert.equal(executeCount, 0);
});

test('runTdxProxyHttp allows dual-auth request through to gateway', async () => {
  const now = 1_700_000_000_000;
  const claims = mintClaims(now);
  const ticket = signGateTicket(claims, SECRET);
  let executeCount = 0;
  const response = await runTdxProxyHttp(
    {
      method: 'GET',
      origin: 'https://taiwanrail.vercel.app',
      requestHost: 'taiwanrail.vercel.app',
      pathname: '/api/tdx/basic/v2/Rail/TRA/Station',
      rawQuery: '?$format=JSON',
      authorization: `Bearer ${ticket}`,
      cookieHeader: `${GATE_COOKIE_NAME}=${claims.jti}`,
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
    undefined,
    { secret: SECRET, now },
  );
  assert.equal(response.status, 200);
  assert.equal(executeCount, 1);
});

test('runTdxProxyHttp OPTIONS still succeeds without ticket (CORS preflight)', async () => {
  const response = await runTdxProxyHttp(
    {
      method: 'OPTIONS',
      origin: 'https://taiwanrail.vercel.app',
      requestHost: 'taiwanrail.vercel.app',
      pathname: '/api/tdx/basic/v2/Rail/TRA/Station',
      rawQuery: '',
    },
    {
      execute: async () => ({ status: 200, body: [], headers: {} }),
    },
    undefined,
    { secret: SECRET, now: 1_700_000_000_000 },
  );
  assert.equal(response.status, 204);
  assert.match(
    response.headers['Access-Control-Allow-Headers'] || '',
    /Authorization/i,
  );
});

test('resolveGateSecret fails closed in production without GATE_SECRET', () => {
  assert.equal(
    resolveGateSecret({ NODE_ENV: 'production', VERCEL_ENV: 'production' }),
    '',
  );
});

test('resolveGateSecret uses configured GATE_SECRET', () => {
  assert.equal(
    resolveGateSecret({ GATE_SECRET: '  abc  ', VERCEL_ENV: 'production' }),
    'abc',
  );
});

test('live gateway guard denies without ticket and allows with dual auth', () => {
  resetGateStoresForTests();
  const now = 1_700_000_000_000;
  const denied = denyUnlessLiveGatewayAllowed({
    method: 'GET',
    origin: 'https://taiwanrail.vercel.app',
    requestHost: 'taiwanrail.vercel.app',
    secret: SECRET,
    clientKey: 'guard-ip',
    now,
  });
  assert.ok(denied);
  assert.equal(denied.status, 401);

  const claims = mintClaims(now);
  const ticket = signGateTicket(claims, SECRET);
  const allowed = denyUnlessLiveGatewayAllowed({
    method: 'GET',
    origin: 'https://taiwanrail.vercel.app',
    requestHost: 'taiwanrail.vercel.app',
    authorization: `Bearer ${ticket}`,
    cookieHeader: `${GATE_COOKIE_NAME}=${claims.jti}`,
    secret: SECRET,
    clientKey: 'guard-ip',
    now,
  });
  assert.equal(allowed, null);
});

/** A browser against the gate: keeps cookies and, like every bundle, retries with no token after a refusal. */
function gateBrowser(start: number) {
  const cookies = new Map<string, string>();
  let token = '';
  let now = start;
  return {
    advance(ms: number) { now += ms; },
    forgeChainCookie(value: string) { cookies.set(GATE_CHAIN_COOKIE_NAME, value); },
    mint(newPage = false) {
      resetGateStoresForTests(); // 這裡只測連續使用上限，不測 60 秒的簽發次數
      const result = runGateMintHttp(
        {
          method: 'POST',
          origin: 'https://taiwanrail.vercel.app',
          requestHost: 'taiwanrail.vercel.app',
          clientKey: 'chain-test',
          cookieHeader: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
          authorization: token ? `Bearer ${token}` : '',
          newPage,
        },
        { secret: SECRET, now },
      );
      for (const line of [result.headers['Set-Cookie'] ?? []].flat()) {
        const [pair] = line.split(';');
        const eq = pair.indexOf('=');
        cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
      }
      token = result.status === 200 ? (result.body as { ticket: string }).ticket : '';
      return result;
    },
  };
}

/** 舊分頁的節奏：每 8 分鐘續一次票。 */
function refreshFor(browser: ReturnType<typeof gateBrowser>, ms: number) {
  const step = 8 * 60_000;
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    browser.advance(step);
    const result = browser.mint();
    if (result.status !== 200) return result;
  }
  return null;
}

test('a page that keeps refreshing is refused once its chain reaches the limit', () => {
  const browser = gateBrowser(1_700_000_000_000);
  assert.equal(browser.mint(true).status, 200);
  assert.equal(refreshFor(browser, GATE_CHAIN_LIMIT_MS - 10 * 60_000), null);

  const refused = refreshFor(browser, 20 * 60_000);
  assert.equal(refused?.status, 403);
  assert.deepEqual(refused?.body, { error: 'Reload required', code: 'reload_required' });
});

test('an old tab cannot restart its chain by retrying without a token', () => {
  // 舊版被拒絕後會清掉票券重新索取，只靠票券內容記上限的話 2 分鐘後就重新起算。
  const browser = gateBrowser(1_700_000_000_000);
  browser.mint(true);
  refreshFor(browser, GATE_CHAIN_LIMIT_MS + 10 * 60_000);

  for (let i = 0; i < 40; i += 1) {
    browser.advance(2 * 60_000);
    assert.equal(browser.mint().status, 403);
  }
});

test('a page load starts a new chain, so a reload always recovers', () => {
  const browser = gateBrowser(1_700_000_000_000);
  browser.mint(true);
  refreshFor(browser, GATE_CHAIN_LIMIT_MS + 10 * 60_000);
  browser.advance(2 * 60_000);
  assert.equal(browser.mint(true).status, 200);
  assert.equal(refreshFor(browser, GATE_CHAIN_LIMIT_MS - 10 * 60_000), null);
});

test('a break longer than the gap starts a new chain', () => {
  const browser = gateBrowser(1_700_000_000_000);
  browser.mint(true);
  refreshFor(browser, GATE_CHAIN_LIMIT_MS + 10 * 60_000);
  browser.advance(GATE_CHAIN_GAP_MS + 1);
  assert.equal(browser.mint().status, 200);
});

test('a forged chain cookie counts as no chain', () => {
  const browser = gateBrowser(1_700_000_000_000);
  browser.forgeChainCookie('1.1.not-a-signature');
  assert.equal(browser.mint().status, 200);
  assert.equal(refreshFor(browser, GATE_CHAIN_LIMIT_MS - 10 * 60_000), null);
});

test('a browser with no chain cookie starts counting now', () => {
  // 部署前就開著的分頁沒有 chain cookie：上限從第一次續票算起。
  const browser = gateBrowser(1_700_000_000_000);
  assert.equal(browser.mint().status, 200);
  assert.equal(refreshFor(browser, GATE_CHAIN_LIMIT_MS - 10 * 60_000), null);
  assert.equal(refreshFor(browser, 20 * 60_000)?.status, 403);
});

test('the gate reports the live client version', () => {
  const body = gateBrowser(1_700_000_000_000).mint(true).body as { minClientVersion: number };
  assert.equal(body.minClientVersion, LIVE_CLIENT_VERSION);
});

function fakeGate(respond: (init: RequestInit) => Response) {
  const calls: RequestInit[] = [];
  const events: string[] = [];
  const target = new EventTarget();
  target.addEventListener(GATE_RELOAD_EVENT, (e) => events.push(e.type));
  (globalThis as { window?: unknown }).window = target;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    calls.push(init);
    return respond(init);
  }) as typeof fetch;
  resetGateTicketClientForTests();
  return { calls, events };
}

const gateOk = (ticket: string, minClientVersion = LIVE_CLIENT_VERSION, expiresAt = Date.now()) =>
  new Response(JSON.stringify({ ticket, expiresAt, minClientVersion }), { status: 200 });

test('only the first mint of a page says it is a new page', async () => {
  const { calls } = fakeGate(() => gateOk('t'));
  await ensureGateTicket();
  await ensureGateTicket();
  const newPage = calls.map((c) => (c.headers as Record<string, string>)['X-Gate-New-Page']);
  assert.deepEqual(newPage, ['1', undefined]);
});

test('a refused mint stops the page and asks for a reload', async () => {
  const { calls, events } = fakeGate(() =>
    new Response(JSON.stringify({ error: 'Reload required', code: 'reload_required' }), { status: 403 }));
  assert.equal(await ensureGateTicket(), null);
  assert.equal(isReloadRequired(), true);
  assert.deepEqual(events, [GATE_RELOAD_EVENT]);

  assert.equal(await ensureGateTicket(), null);
  assert.equal(calls.length, 1);
});

test('another 403 is not a reload request', async () => {
  fakeGate(() => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }));
  await ensureGateTicket();
  assert.equal(isReloadRequired(), false);
});

test('a newer live client version stops the page', async () => {
  const { events } = fakeGate(() => gateOk('t', LIVE_CLIENT_VERSION + 1));
  await ensureGateTicket();
  assert.equal(isReloadRequired(), true);
  assert.deepEqual(events, [GATE_RELOAD_EVENT]);
});

test('a page waiting for a reload makes no live calls and keeps no stale reading', async () => {
  const { calls } = fakeGate(() => gateOk('t', LIVE_CLIENT_VERSION + 1));
  await ensureGateTicket();
  const before = calls.length;
  const url = 'https://tdx.transportdata.tw/api/basic/v2/Rail/TRA/LiveTrainDelay?$format=JSON';
  assert.deepEqual(await fetchTDXApi(url), []);
  assert.equal(calls.length, before);
});
