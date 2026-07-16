# 01 — Shared session store → 全模式 throttled 同源

**What to build:** In one browser tab, when the shared Query throttle window is full, search controls on TRA/HSR, metro, and journey planner all show disabled together; when the sliding window allows another Query, they re-enable together. Consume remains the only way to add events to the bucket; UI `throttled` is derived from the shared session, not a per-component local flag.

**Blocked by:** None — can start immediately.

**Status:** completed

- [x] Client session exposes peek/subscribe (or equivalent) so multiple UI instances share one throttled truth
- [x] Shared Query-throttle hook reports `throttled` from that session source and still owns tryConsume + neutral i18n message
- [x] After the window is filled via one mode, other modes’ search controls are disabled without requiring a failed click first
- [x] When the window allows again, controls re-enable across modes
- [x] Unit tests cover full window / after expiry / subscribe-on-consume (policy math unchanged)
