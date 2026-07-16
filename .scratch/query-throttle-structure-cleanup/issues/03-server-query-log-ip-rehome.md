# 03 — Server Query-log IP backstop re-homed

**What to build:** Operators still get a best-effort IP sliding window on Query log intake (skip DB write over 10s / 8, still return success). Implementation uses the pure policy plus a server-local bucket only—not browser session globals from a client-oriented module. Client search UX is unaffected.

**Blocked by:** 01 — Pure policy + module split

**Status:** completed

- [x] Query log endpoint still silently skips inserts when the IP window is full and returns success
- [x] IP window accounting does not depend on browser session module state
- [x] Policy math stays aligned with the pure 10s / 8 definition from ticket 01
- [x] No new response error shapes required for the client
