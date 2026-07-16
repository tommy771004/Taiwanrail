# 02 — 意圖旗標只在 consume 成功後提交

**What to build:** A User who taps a recent search or lands on a deep-link/SEO auto-search while the Query throttle window is full does not permanently lose that search intent. Pending recent-search and one-shot auto-fire flags commit only after a successful consume; on failure the User sees the normal soft message and can complete the search once the window allows. Manual search button behavior stays correct.

**Blocked by:** None — can start immediately.

**Status:** completed

- [x] Recent-search auto-run does not clear pending intent until Query throttle consume succeeds
- [x] After a throttled recent-search attempt, the intended search can still complete when the window allows (retry or retained pending)
- [x] Deep-link / route auto-fire does not set the one-shot “already fired” flag until consume succeeds
- [x] After a throttled auto-fire attempt, a later eligible run can still start the search
- [x] Manual search button still: consume then parallel timetable + extras; missing stations do not consume
