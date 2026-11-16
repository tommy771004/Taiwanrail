import assert from 'node:assert/strict';
import test from 'node:test';
import { IP_GEO_CACHE_CONTROL, ipLocationFromHeaders, parseIpLocation } from '../src/lib/ipLocation';

const headers = (h: Record<string, string>) => (name: string) => h[name];

test('reads Vercel IP coordinates and decodes the city', () => {
  assert.deepEqual(
    ipLocationFromHeaders(headers({
      'x-vercel-ip-latitude': '24.1469',
      'x-vercel-ip-longitude': '120.6839',
      'x-vercel-ip-city': 'Taichung%20City',
    })),
    { lat: 24.1469, lon: 120.6839, city: 'Taichung City' },
  );
});

test('missing, broken or empty coordinates give nothing, never a default', () => {
  assert.equal(ipLocationFromHeaders(headers({})), null); // localhost / server.ts
  assert.equal(ipLocationFromHeaders(headers({ 'x-vercel-ip-latitude': '25.03' })), null);
  assert.equal(ipLocationFromHeaders(headers({ 'x-vercel-ip-latitude': 'abc', 'x-vercel-ip-longitude': '121.5' })), null);
  assert.equal(ipLocationFromHeaders(headers({ 'x-vercel-ip-latitude': '0', 'x-vercel-ip-longitude': '0' })), null);
  assert.equal(ipLocationFromHeaders(headers({ 'x-vercel-ip-latitude': '95', 'x-vercel-ip-longitude': '121.5' })), null);
});

test('a city header that is not valid URI encoding is kept raw', () => {
  const loc = ipLocationFromHeaders(headers({
    'x-vercel-ip-latitude': '25.03', 'x-vercel-ip-longitude': '121.56', 'x-vercel-ip-city': 'Bad%E0',
  }));
  assert.equal(loc?.city, 'Bad%E0');
});

test('client parser rejects anything that is not a coordinate pair', () => {
  assert.deepEqual(parseIpLocation({ lat: 25.03, lon: 121.56 }), { lat: 25.03, lon: 121.56, city: null });
  assert.equal(parseIpLocation(null), null);
  assert.equal(parseIpLocation({ lat: '25', lon: 121 }), null);
  assert.equal(parseIpLocation({ lat: 25, lon: 200 }), null);
});

test('the answer is per visitor, so the CDN must never share it', () => {
  assert.match(IP_GEO_CACHE_CONTROL, /private/);
  assert.match(IP_GEO_CACHE_CONTROL, /no-store/);
});
