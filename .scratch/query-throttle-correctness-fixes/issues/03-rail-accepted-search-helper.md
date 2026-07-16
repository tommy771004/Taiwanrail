# 03 — Rail 接受搜尋路徑收斂

**What to build:** TRA/HSR search starts (main button, recent search, deep-link auto-fire) share one “after successful consume, start search work” path so clear-before-consume and divergent extras timing cannot reappear as a fourth copy. User-visible behavior matches ticket 02: soft throttle message on deny; on accept, timetable and extras run in parallel and UI search state updates consistently.

**Blocked by:** 02 — 意圖旗標只在 consume 成功後提交

**Status:** completed

- [x] Button, recent-search, and deep-link auto-fire go through one shared rail “accepted start” flow (or equivalent single helper)
- [x] That flow only runs search work after successful consume; intent flags follow ticket 02 rules
- [x] Accepted start still runs timetable work and extras in parallel
- [x] No regression vs ticket 02 acceptance scenarios
