Status: ready-for-agent

# Spec: Query throttle structure cleanup (post–code-review)

Domain vocabulary from `CONTEXT.md`. Product rules unchanged from ADR-0001 and the prior analytics-hygiene delivery. This spec is a **structure-only** follow-up: keep Query throttle and Page View Log filter **behavior**, remove duplicated wiring and layering mistakes introduced in the first implementation.

## Problem Statement

Query throttle and Page View analytics hygiene already ship, but the first wiring made the codebase harder to maintain:

- The same “search blocked by Query throttle” UI handling is copy-pasted across rail search, metro search, and journey planner (state, timer, message), with inconsistent i18n.
- Extra logic was bolted into the already-giant main app shell instead of a shared abstraction.
- Client session buckets and serverless IP buckets live in one module, blurring browser vs API boundaries.
- The rail search button was re-orchestrated so side work that used to run in parallel with a Query now waits until the timetable fetch finishes — a regression unrelated to throttle product rules.
- Double messaging (error surface + toast) on rail only is noisy and inconsistent with other modes.

Operators and Users should see the same soft throttle product; developers should not maintain three special-case branches or accidental search-timing changes.

## Solution

Refactor toward one clear policy seam and one shared client UX seam:

- Keep the pure sliding-window **Query throttle** policy (10s / 8) as the single definition of allow/deny.
- Expose one client hook (or equivalent single helper) that owns session consume, `throttled` UI state, retry timer, and cleanup — used by all search entry points.
- Use one i18n message for the neutral throttle copy everywhere.
- Restore parallel “start Query + load extras” orchestration on rail search; only gate *whether* a search starts, not *when* secondary loads run after a long await.
- Keep IP-based Query-log backstop on the server, but do not share browser global session state with the API module surface.
- Leave Page View **Log filter** product behavior as-is; only tidy types/loading if touched.

No change to product thresholds, no geo deny, no external redirect, no full-site crawler block, no static `/data` throttle.

## User Stories

1. As a User, I want Query throttle limits to stay 10 seconds / 8 searches, so that normal trip planning still works.
2. As a User, I want the same neutral message in Chinese or English on every transport mode when throttled, so that the product feels consistent.
3. As a User, I want only one clear notice when throttled (not error banner and toast at once on rail), so that the UI does not feel broken or spammy.
4. As a User, I want the search control disabled only while the sliding window is full, then re-enabled automatically, so that I am not stuck in a fixed lockout.
5. As a User on TRA/HSR, I want secondary data (fares/extras) to start loading as soon as a search is accepted, not only after the full timetable path finishes, so that results feel as fast as before the first throttle wiring.
6. As a User on metro, I want throttle behavior to match rail and planner, so that switching modes does not change the rules.
7. As a User on journey planner, I want the same shared session bucket, so that rapid multi-mode abuse cannot reset limits by switching tabs of the product.
8. As a User, I want incomplete attempts (missing stations) still not to consume a Query slot, so that UI mistakes do not punish me.
9. As a User, I want recent-search one-click search to still respect the shared throttle, so that automation of clicks cannot bypass the bucket.
10. As a User, I never want to be redirected off-site when throttled, so that trust stays intact.
11. As an operator, I want Query log IP sliding-window backstop to remain, so that raw POSTs to the log endpoint cannot fill the database as easily.
12. As an operator, I want skipped log writes to still return success to the client, so that analytics limits never break search UX.
13. As an operator, I want Page View Log filter rules and no-geo policy unchanged, so that Synthetic traffic noise stays filtered without blocking Crawlers.
14. As a developer, I want a single pure policy function for the sliding window, so that tests and production cannot drift.
15. As a developer, I want one client abstraction for throttle UX, so that I do not edit three components to change timer or messaging behavior.
16. As a developer, I want the main app shell not to grow more ad-hoc throttle state machines, so that the monolith does not absorb more cross-cutting concerns.
17. As a developer, I want browser session state not bundled conceptually with serverless IP maps, so that client/server boundaries stay obvious.
18. As a developer, I want rail search orchestration to gate only “may start search,” so that throttle does not invent new async sequencing.
19. As a developer, I want i18n keys to be the only source of throttle copy, so that Metro/Planner hard-coded strings disappear.
20. As a developer, I want unmount-safe timer cleanup in the shared client abstraction, so that we do not setState on unmounted trees.
21. As a developer, I want existing unit tests for pure policy and Log filter evaluation to keep passing, so that cleanup does not regress product rules.
22. As a developer, I want optional thin cleanup of fingerprint rule typing (no index catch-all if easy), so that geo keys are not “typed in then ignored.”
23. As a developer, I want API handlers to avoid fragile multi-file import patterns where the project already documents runtime import pain, so that deploys stay reliable (inline pure IP window or proven bundle path).
24. As a developer, I want no new database schema, so that this cleanup is deploy-safe.
25. As a Crawler, I want HTML and robots behavior untouched, so that SEO/AI discovery is unaffected.
26. As an operator, I want documentation/commits for agent notes and scratch specs not required to mix with runtime cleanup, so that review stays focused (optional hygiene).
27. As a User on a slow network, I want accepting a search to still mark the UI as searching promptly, so that throttle refactors do not add perceived latency beyond the real fetch.
28. As a developer, I want `retryAfterMs` to share the same “recent events” definition as allow/deny, so that window math cannot diverge.
29. As a developer, I want public exports of the throttle module minimized to what production needs, so that test-only helpers do not look like product API.
30. As an operator, I want Log filter config file and deploy include behavior preserved, so that retuning Synthetic traffic rules still works after cleanup.

## Implementation Decisions

### Product rules (frozen — do not reopen)

1. Query throttle: sliding window **10s / 8** submitted Queries; shared bucket across train, HSR, metro, planner.
2. No fixed lockout beyond the sliding window.
3. Neutral copy only (existing i18n key); no external redirect.
4. Query log IP window: best-effort per serverless instance; success response when skipped.
5. Page View Log filter: config-driven; never deny by country/region/city; filter writes only.
6. Static timetable assets are not rate-limited by this work.

### Structural goals

7. **Pure policy module** remains the single definition of sliding-window allow/deny and retry-after. Prefer a small internal helper for “events still in window” used by both allow and retry-after.
8. **Client session bucket** lives next to client usage only (module used by the hook, or inside the hook module), not beside IP maps for the server.
9. **One React hook** (recommended name in prose: shared Query-throttle hook) owns:
   - calling session consume
   - `throttled` boolean for disabling controls
   - scheduling clear via retry-after
   - clearing timeout on unmount
   - optionally resolving the i18n message string once for callers
10. **Rail, metro, planner** each call the hook; on deny they set their existing error surface **once** (pick one channel on rail: prefer a single toast *or* single inline error — not both). Do not reimplement timers in each file.
11. **Do not grow the main app shell** with more throttle machinery beyond hook usage and a one-line guard at search start.
12. **Rail search button / start path:** restore parallel start of timetable Query work and extra data loading after a successful consume. Do not chain extras behind full timetable completion solely to plumb a boolean. Prefer: consume → if ok, fire timetable and extras without awaiting timetable before extras.
13. **`fetchTimetable` (or equivalent) need not return boolean** for orchestration if the guard sits at the click/effect boundary; avoid Promise re-plumbing that changes timing.
14. **Server Query log:** keep IP sliding window; implement via pure policy function (shared) with an in-handler Map, or a server-only helper that does not export browser session globals. Prefer not importing a “session + IP mega module” into the client graph.
15. **Page View path:** keep pure filter evaluation; keep config load in the page-view logging handler; no product change required unless a one-line type tidy is free.
16. **No schema / API contract changes** for clients; POST bodies and success-shaped responses stay the same.
17. **Docs already in repo** (CONTEXT, ADR-0001, prior spec) stay authoritative for *why*; this spec only covers cleanup *how*.

### Prototype-shaped contracts (decision-rich)

Sliding window (unchanged product math):

```text
recent = times.filter(t => now - t < windowMs)
if recent.length >= max → deny, keep recent
else → allow, times' = recent + [now]
retryAfter = max(0, min(recent) + windowMs - now) when at capacity
```

Client hook surface (conceptual):

```text
useQueryThrottle():
  throttled: boolean
  tryConsume(): boolean   // false → already updated throttled + scheduled clear
  message: string         // localized neutral copy
```

### Explicit non-goals for “clever” alternatives

18. Do not introduce Redis/KV for global IP limits in this cleanup.
19. Do not add Vercel Firewall rules as part of this spec (edge protection is a separate decision tree).
20. Do not throttle static data files.

## Testing Decisions

### What good tests look like

- Assert pure policy external behavior (allow/deny, window expiry, retry-after consistency).
- Assert Page View filter fixtures against real config where already covered.
- Do not require full React Testing Library coverage for the hook in v1 unless already cheap; if hook is thin, policy tests remain the primary gate.
- Do not assert private React state shapes inside the monolith.

### What to test / keep green

1. Existing Query throttle policy tests (8 in window, 9th deny, expiry, IP bucket independence if IP helper remains testable without browser).
2. Existing Page View Log filter tests (synthetic cluster skip, HeadlessChrome, Taipei keep, geo-key rules ignored, enabled false).
3. After split modules: point tests at the pure policy module only; session/IP wrappers tested only if still exported and non-trivial.
4. Manual smoke (agent or human): rail search still loads extras without waiting for full timetable; metro/planner show same message key behavior; rapid 9th search soft-blocks.

### Prior art

- `tsx --test` scripts for data integrity, station footfall, and the existing throttle/filter tests.
- Project typecheck via `tsc --noEmit`.

### Seams (confirm)

| Priority | Seam | Role |
|----------|------|------|
| **Primary (ideal single seam)** | Pure Query throttle policy | Window math + constants; unit-tested |
| **Secondary** | Page View filter evaluation | Already pure; keep tests |
| **Not a unit seam** | Hook + three UIs | Integration/smoke; avoid duplicating policy tests in components |

If maintainers want only one automated seam, keep **pure Query throttle policy** and treat the hook as a thin adapter.

## Out of Scope

- Changing 10s / 8 thresholds or product copy meaning.
- Edge / Vercel Firewall / Attack Mode / CAPTCHA / geo blocking.
- Redirecting Users off-site.
- Blocking or reconfiguring Crawlers, robots.txt, llms.txt, SEO routes.
- Rate limiting static `/data/*`.
- Distributed rate-limit infrastructure.
- Deleting historical noisy Page View rows.
- Large-scale decomposition of the entire main app shell beyond extracting throttle wiring.
- Rewriting Page View filter rule DSL.
- Unrelated docs-only churn (optional separate commit).

## Further Notes

- Prior delivery spec: `.scratch/query-throttle-and-analytics-hygiene/spec.md` (feature intro). This cleanup spec supersedes **implementation structure** guidance from the code review without reopening product decisions in ADR-0001.
- Code review blockers to close: triple UI copy-paste, App shell growth, client/server module mix, fetch-extras sequencing regression, dual toast+error, hard-coded Metro/Planner strings.
- Issue tracker: local markdown under `.scratch/` with `Status: ready-for-agent`.
