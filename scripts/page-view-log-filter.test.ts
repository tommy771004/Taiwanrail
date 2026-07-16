import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluatePageViewFilter,
  type ClientLogSignals,
  type LogFiltersFile,
} from '../src/lib/pageViewLogFilter.ts';

const repoConfig = JSON.parse(
  readFileSync(join(process.cwd(), 'config/log-filters.json'), 'utf8'),
) as LogFiltersFile;

const baseHuman: ClientLogSignals = {
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1',
  timezone: 'Asia/Taipei',
  language: 'zh-TW',
  deviceType: 'mobile',
  screenWidth: 402,
  screenHeight: 874,
  viewportW: 402,
  viewportH: 714,
  referrer: null,
  pagePath: '/',
};

const syntheticCluster: ClientLogSignals = {
  userAgent:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  timezone: 'America/New_York',
  language: 'en-US',
  deviceType: 'desktop',
  screenWidth: 1920,
  screenHeight: 1080,
  viewportW: 1919,
  viewportH: 992,
  referrer: 'https://www.google.com/',
  pagePath: '/',
};

test('deployed config skips synthetic Linux Chrome/149 cluster', () => {
  const d = evaluatePageViewFilter(syntheticCluster, repoConfig);
  assert.equal(d.skip, true);
  assert.match(d.reason ?? '', /fingerprint:synthetic-linux-chrome-149/);
});

test('deployed config skips HeadlessChrome', () => {
  const d = evaluatePageViewFilter(
    {
      ...baseHuman,
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.7390.0 Safari/537.36',
      timezone: 'UTC',
      language: 'en-US',
    },
    repoConfig,
  );
  assert.equal(d.skip, true);
  assert.match(d.reason ?? '', /HeadlessChrome/);
});

test('keeps Asia/Taipei zh-TW user-like signals', () => {
  const d = evaluatePageViewFilter(baseHuman, repoConfig);
  assert.equal(d.skip, false);
});

test('keeps Windows Chrome/149 (not the Linux synthetic rule)', () => {
  const d = evaluatePageViewFilter(
    {
      ...baseHuman,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
      deviceType: 'desktop',
      screenWidth: 1601,
      screenHeight: 900,
      viewportW: 1601,
      viewportH: 691,
    },
    repoConfig,
  );
  assert.equal(d.skip, false);
});

test('enabled false never skips', () => {
  const d = evaluatePageViewFilter(syntheticCluster, { ...repoConfig, enabled: false });
  assert.equal(d.skip, false);
});

test('fingerprint rule with geo keys is ignored', () => {
  const cfg: LogFiltersFile = {
    enabled: true,
    pageView: {
      fingerprintsAllMatch: [
        {
          id: 'bad-geo',
          country: 'US',
          userAgentIncludes: 'Chrome',
          timezone: 'America/New_York',
        } as never,
      ],
    },
  };
  const d = evaluatePageViewFilter(syntheticCluster, cfg);
  assert.equal(d.skip, false);
});
