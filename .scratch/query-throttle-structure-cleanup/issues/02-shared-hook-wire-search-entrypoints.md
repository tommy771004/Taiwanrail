# 02 — Shared client throttle UX + wire all search entry points

**What to build:** Users get one consistent Query throttle experience on TRA/HSR, metro, and journey planner: same session bucket, same neutral i18n message, control disables while the sliding window is full and re-enables when it allows again. Rail shows a single notice (not error + toast together). Accepting a rail search starts timetable work and extras in parallel again (extras must not wait for the full timetable path). The main app shell only calls a shared client abstraction—no third copy of timer/state machine.

**Blocked by:** 01 — Pure policy + module split

**Status:** completed

- [x] One shared client hook (or equivalent) owns consume, `throttled` state, retry timer, and unmount cleanup
- [x] Rail, metro, and planner all use that abstraction; hard-coded throttle strings removed in favor of i18n
- [x] Rail throttle feedback is a single channel (toast or inline—not both)
- [x] Rail search start restores parallel extras loading after a successful consume
- [x] Incomplete searches (missing stations) still do not consume a slot
- [x] Typecheck passes
