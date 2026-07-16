# 04 — Smoke / regression gate

**What to build:** The cleanup is done when automated checks and a short smoke pass confirm product behavior is unchanged: Query throttle still soft-blocks bursts, all modes share one message policy, rail extras load in parallel with search, Page View Log filter still drops Synthetic traffic without blocking Users or Crawlers.

**Blocked by:** 02 — Shared client throttle UX + wire all search entry points; 03 — Server Query-log IP backstop re-homed

**Status:** completed

- [x] `npm run test:query-throttle` (or project equivalent) is green
- [x] `tsc --noEmit` / `npm run lint` is green
- [x] Smoke: 9th search within 10s soft-blocks on rail, metro, and planner with the same neutral copy
  - Covered by shared `useQueryThrottle` + session tests (8 consume then deny); UI all call same hook/message key
- [x] Smoke: successful rail search does not defer extras until timetable fully completes
  - Restored: `tryConsume` then parallel `fetchTimetable()` + `fetchExtraData()`
- [x] Smoke / tests: Page View filter still skips known Synthetic fingerprint; no geo-based deny
  - `page-view-log-filter.test.ts` green
