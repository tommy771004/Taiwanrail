Status: ready-for-agent

# Spec: Query throttle correctness fixes

Domain vocabulary from `CONTEXT.md`. Product rules unchanged (ADR-0001; 10s / 8 Sliding window; soft Query throttle; no geo deny; no external redirect). Builds on the structure cleanup (shared hook + policy/session/ip split). This spec fixes **correctness and shared disabled-state** issues found in code review — not new product features.

## Problem Statement

Query throttle structure was cleaned up (one hook, split modules, parallel rail extras), but three issues remain:

1. **Recent search can be lost:** when a User taps a recent search while the session Query throttle window is full, the pending entry is cleared *before* consume fails, so the auto-search never runs and will not retry after the window frees.
2. **Deep-link / SEO-route auto-search can be lost forever:** the one-shot auto-fire flag is set *before* a successful consume; if throttled, that deep-linked Query never starts on a later effect tick.
3. **Disabled state is not shared across modes:** the sliding-window bucket is shared tab-wide, but each `useQueryThrottle` instance keeps its own local `throttled` flag. After rail hits the limit, metro/planner search controls can still look enabled until the User clicks — conflicting with “controls disable while the window is full.”

Users should not lose intentional searches to throttle ordering bugs, and should see consistent disabled controls whenever the shared session cannot accept another Query.

## Solution

Keep the soft throttle product (neutral message, sliding window, no off-site redirect). Fix ordering so **consume success is required before** clearing one-shot / pending intent. Make **throttled UI state derive from the shared session bucket** (all rail/metro/planner instances agree). Optionally collapse rail’s three “start after throttle” call sites into one helper so the bug class cannot reappear as a fourth copy.

No change to thresholds, Log filter rules, server IP backstop behavior, or Crawler access.

## User Stories

1. As a User, I want my recent-search tap to still run once the Query throttle window allows, so that a brief burst does not permanently drop my intended route.
2. As a User, I want a deep-linked or SEO landing auto-search to retry or remain eligible if the first attempt was throttled, so that opening a shared link still shows trains after I wait.
3. As a User, I never want the app to “forget” a search I clearly requested solely because throttle failed once.
4. As a User on TRA/HSR, I want the search button disabled when the shared session window is full, even if I just came from metro or planner.
5. As a User on metro, I want the search control disabled when the shared session window is full after heavy rail searching, without needing a failed click first.
6. As a User on journey planner, I want the same shared disabled state, so modes feel like one product.
7. As a User, when the window frees, I want disabled controls to re-enable across all modes without remounting the tab.
8. As a User, I still want a single neutral message (i18n) when a consume fails, so feedback stays calm and consistent.
9. As a User, I want incomplete forms (missing stations) to still not consume a Query slot.
10. As a User, I want successful consume on rail to still start timetable and extras in parallel.
11. As a User who only uses the main search button, I want no regression in click-to-results behavior.
12. As a User who opens a route URL with from/to already set, I want auto-search to honor throttle without burning the one-shot flag on failure.
13. As a User who selects a recent search while throttled, I want either a deferred retry when allowed or a clear path to search again without re-picking stations from scratch (pending retained until success or explicit discard).
14. As an operator, I want Query log IP backstop and Page View Log filter behavior unchanged by this fix.
15. As a developer, I want throttled UI state to have one source of truth (the session bucket), so three hook instances cannot drift.
16. As a developer, I want intent flags (pending recent search, auto-fire) updated only after a successful consume, so ordering bugs are impossible by construction.
17. As a developer, I prefer rail search start paths to share one “after throttle accepted” helper, so future entry points do not reintroduce clear-before-consume.
18. As a developer, I want pure sliding-window policy tests to remain the primary automated seam.
19. As a developer, I want new tests for session “peek / subscribe” behavior if a shared store is introduced, without mounting the full app shell.
20. As a developer, I want no new DB schema or API response shapes.
21. As a Crawler, I want HTML and robots behavior untouched.
22. As a User, I still must not be redirected off-site when throttled.
23. As a User, I still want no fixed lockout beyond the sliding window.
24. As a User, I want 10s / 8 product limits unchanged.
25. As a developer, I want IP Map update logic left alone unless a one-line clarity fix is free and tested.
26. As a developer, I want dead re-export barrels removable if nothing production imports them.
27. As a User on a multi-mode session, I want one shared Query budget across train, HSR, metro, and planner (already true for consume; disabled state must match).
28. As a User who was throttled, I want re-enable timing consistent with `retryAfterMs` / window expiry across modes.
29. As a developer, I want review blockers from the correctness pass closed with acceptance checklists.
30. As an operator, I want dashboards and Query definitions unchanged (Query remains Engaged use signal).

## Implementation Decisions

### Frozen product rules

1. Sliding window **10s / 8** submitted Queries; shared session bucket across modes.
2. Soft UX: neutral i18n message; no external redirect; no geo deny.
3. Static `/data/*` not throttled; server Query-log IP window stays best-effort and success-shaped.

### Correctness: intent before / after consume

4. **Recent search auto-run:** do not clear the pending recent-search intent until Query throttle consume **succeeds**. On failure: keep pending (or equivalent deferred intent), show the single rail notice channel, and allow a later effect tick or user action to succeed when the window allows.
5. **Deep-link / path auto-fire:** do not set the one-shot “already auto-fired” flag until consume **succeeds**. On failure: leave the flag unset so a future run can try again when stations/state allow and the window has capacity.
6. Manual search button path already consumes then starts work; keep that order; do not clear unrelated one-shot flags there.

### Shared disabled state

7. **`throttled` must reflect the shared session bucket**, not only “this component instance last failed consume.”
8. Preferred approach: expose session subscription / snapshot from the client session module and have the shared hook use an external store pattern (e.g. subscribe + getSnapshot) so all hook instances re-render when the bucket changes (consume success, consume deny, or window expiry timer).
9. When the window is full, search controls that already key off `throttled` stay disabled across rail/metro/planner until the window allows again.
10. Re-enable when the sliding window would allow another Query (same math as `retryAfterMs` / recent events), not a separate per-instance guess.
11. `tryConsume` remains the only way to add a timestamp to the bucket; peek/subscribe must not consume.

### Rail start-path consolidation (recommended, same PR if small)

12. Collapse button / recent-search / deep-link “after successful consume, start timetable + extras + UI flags” into one rail-local helper where practical, so clear-before-consume cannot be re-copied.
13. Helper must preserve parallel timetable + extras after accept.

### Out of scope for redesign

14. Do not move throttle back inside the core timetable fetch function as a hidden side effect if that re-couples loading and analytics intent incorrectly; keep gate at “User accepted search” boundaries.
15. Do not change server IP throttle product behavior in this spec except optional readability of Map updates.
16. Optional: delete unused pure-policy-only re-export barrel if unused.

### Conceptual contracts (decision-rich)

Intent ordering:

```text
on auto/recent trigger:
  if !tryConsume → show message; leave intent flags as before attempt; stop
  else → mark intent consumed / one-shot done; start search work
```

Shared throttled:

```text
throttled ⇔ recentEventsInWindow(sessionTimes, now).length >= MAX
// all hook instances read the same sessionTimes via store subscription
```

## Testing Decisions

### Good tests

- Behavior through public session/policy APIs; known-good timestamps; no full App mount required for store/peek.
- Tests that would have caught clear-before-consume: “pending remains after failed consume” can be expressed at session + small pure helper level if intent logic is extracted; otherwise a focused unit on a tiny rail intent helper.

### Seams (confirm)

| Priority | Seam | Role |
|----------|------|------|
| **Primary** | Pure Query throttle policy | Unchanged window math |
| **Primary (new)** | Client session store: peek + subscribe + consume | Shared throttled truth |
| **Secondary** | Small intent/order helpers if extracted | pending/auto-fire only clear on success |
| **Not required** | Full React App e2e | Manual smoke OK for button/deep-link |

### What to cover

1. Existing policy tests stay green.
2. Session: after N consumes fill the window, peek/store snapshot reports not allowed; after time advances, reports allowed; subscribers notified on consume (and on scheduled expiry if implemented).
3. If intent helpers are pure: “failed consume does not clear pending / does not set one-shot.”
4. Manual smoke: fill window → recent search kept or retryable; deep link still works after wait; metro button disabled while rail exhausted the window.

### Prior art

- `tsx --test` for throttle/filter; `tsc --noEmit`.

## Out of Scope

- Changing 10s / 8 or message wording meaning.
- Edge Firewall / CAPTCHA / geo blocking / off-site redirect.
- Throttling static data files.
- Distributed rate limits / Redis.
- Page View Log filter rule changes.
- Full decomposition of the main app shell.
- New analytics events.

## Further Notes

- Parent structure work: `.scratch/query-throttle-structure-cleanup/` (completed tickets).
- Feature intro: `.scratch/query-throttle-and-analytics-hygiene/spec.md`.
- Code review residual blockers this spec closes: pending cleared before consume; auto-fire flag set before consume; per-instance `throttled` vs shared bucket.
- Tracker: local `.scratch/` with `Status: ready-for-agent`.
