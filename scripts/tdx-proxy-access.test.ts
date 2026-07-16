import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowBrowserOrigin,
  allowTdxProxyAccess,
} from '../src/lib/tdxProxyAccessPolicy.ts';

// Browsers omit Origin on same-origin GET/HEAD (MDN / Fetch). Safe methods must still work.

test('browser Origin policy allows missing Origin on GET (same-origin SPA reads)', () => {
  const decision = allowBrowserOrigin({
    origin: '',
    requestHost: 'taiwanrail.vercel.app',
    method: 'GET',
  });
  assert.equal(decision.allow, true);
  assert.equal(decision.reason, 'ok');
});

test('browser Origin policy denies missing Origin on POST (API writes)', () => {
  const decision = allowBrowserOrigin({
    origin: '',
    requestHost: 'taiwanrail.vercel.app',
    method: 'POST',
  });
  assert.equal(decision.allow, false);
  assert.equal(decision.reason, 'missing_origin');
});

test('browser Origin policy denies foreign Origin against production Host', () => {
  const decision = allowBrowserOrigin({
    origin: 'https://evil.example',
    requestHost: 'taiwanrail.vercel.app',
    method: 'GET',
  });
  assert.equal(decision.allow, false);
  assert.equal(decision.reason, 'origin_not_allowed');
});

test('browser Origin policy allows canonical production Origin', () => {
  const decision = allowBrowserOrigin({
    origin: 'https://taiwanrail.vercel.app',
    requestHost: 'taiwanrail.vercel.app',
    method: 'GET',
  });
  assert.equal(decision.allow, true);
  assert.equal(decision.reason, 'ok');
});

test('TDX proxy allows missing Origin on GET so live timetable features keep working', () => {
  const decision = allowTdxProxyAccess({
    origin: '',
    requestHost: 'taiwanrail.vercel.app',
    method: 'GET',
  });
  assert.equal(decision.allow, true);
  assert.equal(decision.reason, 'ok');
});

test('TDX proxy denies foreign Origin against production Host', () => {
  const decision = allowTdxProxyAccess({
    origin: 'https://evil.example',
    requestHost: 'taiwanrail.vercel.app',
    method: 'GET',
  });
  assert.equal(decision.allow, false);
  assert.equal(decision.reason, 'origin_not_allowed');
});

test('TDX proxy allows canonical production Origin on production Host', () => {
  const decision = allowTdxProxyAccess({
    origin: 'https://taiwanrail.vercel.app',
    requestHost: 'taiwanrail.vercel.app',
    method: 'GET',
  });
  assert.equal(decision.allow, true);
  assert.equal(decision.reason, 'ok');
});

test('TDX proxy denies other vercel.app Origin on production Host', () => {
  const decision = allowTdxProxyAccess({
    origin: 'https://attacker-preview.vercel.app',
    requestHost: 'taiwanrail.vercel.app',
    method: 'GET',
  });
  assert.equal(decision.allow, false);
  assert.equal(decision.reason, 'origin_not_allowed');
});

test('TDX proxy allows Origin that matches the request Host (preview)', () => {
  const decision = allowTdxProxyAccess({
    origin: 'https://taiwanrail-git-feat.vercel.app',
    requestHost: 'taiwanrail-git-feat.vercel.app',
    method: 'GET',
  });
  assert.equal(decision.allow, true);
  assert.equal(decision.reason, 'ok');
});

test('TDX proxy denies malformed Origin (fail-closed)', () => {
  const decision = allowTdxProxyAccess({
    origin: 'not-a-url',
    requestHost: 'taiwanrail.vercel.app',
    method: 'GET',
  });
  assert.equal(decision.allow, false);
  assert.equal(decision.reason, 'malformed_origin');
});

test('TDX proxy denies non-GET methods', () => {
  const decision = allowTdxProxyAccess({
    origin: 'https://taiwanrail.vercel.app',
    requestHost: 'taiwanrail.vercel.app',
    method: 'POST',
  });
  assert.equal(decision.allow, false);
  assert.equal(decision.reason, 'method_not_allowed');
});
