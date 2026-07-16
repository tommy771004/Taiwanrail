import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
  assert.ok(result.headers['Set-Cookie']?.includes(GATE_COOKIE_NAME));
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
