# 01 — Pure policy + module split

**What to build:** Developers and tests share one pure Query throttle policy (10s / 8 sliding window, shared “events in window” math for allow and retry-after). Browser session state and serverless IP buckets are no longer one mixed public surface. Existing throttle and Page View Log filter unit tests stay green after the split. Product thresholds and Log filter rules are unchanged.

**Blocked by:** None — can start immediately.

**Status:** completed

- [x] Pure sliding-window allow/deny and retry-after share one definition of “recent events in window”
- [x] Client session bucket is not exported from the same surface as serverless IP maps (or IP lives only server-side)
- [x] Existing Query throttle / Page View filter tests pass (imports updated if needed)
- [x] No change to 10s / 8 product rule, no geo deny, no schema changes
