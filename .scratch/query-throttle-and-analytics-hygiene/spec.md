Status: ready-for-agent

# Spec: Query throttle & analytics hygiene

Domain vocabulary from `CONTEXT.md`. Architectural intent from `docs/adr/0001-query-throttle-and-page-view-log-filter.md`.

## Problem Statement

Operators see large spikes of **Page Views** that do not correspond to real product use. Most of that volume is **Synthetic traffic** (automated opens of the app shell, often with a fixed browser fingerprint) that never submits a **Query**. Real **Users** do submit Queries, and Query logging works — so raw Page View counts are a misleading KPI and waste database writes.

Separately, if something (or someone) submits Queries in a tight burst, the product should stay calm: no hostile redirects, no full-site bot walls that harm Crawlers or SEO/AI discovery, and no punishment that feels like the site is broken. Operators want soft protection for Query submission and for Query analytics writes, without harming normal exploration (retries, route changes, multi-mode search).

## Solution

Treat **Query** as the primary signal of **Engaged use**. Treat **Page View** as secondary and filter obvious Synthetic traffic at write time via a configurable **Log filter** (no geo-based deny, no blocking of page access or Crawlers).

For burst Query behavior, apply a shared **Query throttle** with a **Sliding window** of **10 seconds / 8 submitted searches**:

- **Frontend (session-scoped):** when over limit, do not run the search; show a neutral bilingual message; re-enable automatically when the window allows again (no fixed lockout).
- **Backend (IP-scoped, best-effort):** when over limit on Query log intake, skip inserting the analytics row; still return success so the client UX is unchanged.

Static timetable assets and normal page loads remain unrestricted by this throttle. Crawlers continue to fetch public HTML as today.

## User Stories

1. As an operator, I want Page View analytics to exclude obvious Synthetic traffic, so that dashboards reflect plausible human opens.
2. As an operator, I want Query counts to remain the source of truth for Engaged use, so that I do not mistake Page View spikes for growth.
3. As an operator, I want Log filter rules in a static config I can edit and redeploy, so that I can retune fingerprints without rewriting application logic.
4. As an operator, I want Log filters to ignore country/region/city even if misconfigured, so that overseas Users and travel use are never denied analytics or access by geography.
5. As a User, I want the site to open and search normally under typical use, so that throttle and filters never notice me.
6. As a User, I want to change origin/destination and search several times in a minute, so that planning a trip is not interrupted by false positives.
7. As a User, I want zero-result retries to still work within reason, so that I can correct stations without being locked out.
8. As a User, when I search too quickly in a burst, I want a calm in-app message, so that I understand I should wait without thinking the app crashed.
9. As a User, I want search to work again as soon as the sliding window allows, so that I am not stuck in a fixed penalty timer.
10. As a User, I never want to be redirected to an external site because of search rate, so that trust and UX stay intact.
11. As a User on mobile, I want the throttle message and disabled control to be usable on small screens, so that the soft limit is clear.
12. As a User on desktop, I want the same throttle rules as mobile, so that behavior is predictable.
13. As a bilingual User, I want the throttle message in Traditional Chinese or English according to the app language, so that the notice is readable.
14. As a User searching TRA/HSR, I want throttle to apply when I actually submit a search, so that merely changing filters or dates without searching does not burn my budget.
15. As a User searching metro, I want the same shared throttle bucket, so that switching transport modes does not reset abuse limits unfairly — and so normal multi-mode use still fits under 8/10s.
16. As a User using journey planner, I want planner searches to share the same bucket, so that one product-wide policy applies.
17. As a User, I want incomplete attempts (missing stations, guard returns before search) not to count, so that UI glitches do not throttle me.
18. As a User, I want static timetable data to keep loading without throttle, so that legitimate searches that need `/data/*` still work.
19. As a User behind shared NAT (school/office/café), I want session-based UI throttle to be primary, so that strangers on the same IP rarely block my button.
20. As an operator, I want a coarse IP limit on Query log writes, so that scripted log spam cannot fill the database even if the UI is bypassed.
21. As an operator, I accept best-effort IP limiting on serverless, so that we still get protection without introducing a shared Redis dependency in v1.
22. As a User, when backend log intake is throttled, I still want my search results, so that analytics limits never break the product.
23. As a Crawler (search or AI), I want HTML landing pages and robots policy unchanged by this work, so that SEO and AI citations keep working.
24. As a Crawler, I want `/api` and huge timetable JSON to remain disallowed in robots as today, so that crawl budget is not wasted.
25. As Synthetic traffic that only opens `/`, I should not create Page View rows when matching Log filter rules, so that operator cost and noise drop.
26. As Synthetic traffic that only opens `/`, I should still receive normal HTTP responses, so that we do not play detection cat-and-mouse via status codes.
27. As a User with HeadlessChrome or unusual automation for accessibility tooling, I understand extreme automation fingerprints may skip Page View logging, so that product use (Query) still works.
28. As an operator, I want enabling/disabling Log filters via config, so that I can turn filtering off quickly if we over-filter.
29. As an operator, I want fingerprint rules to be AND within a rule and OR across rule types, so that retuning is predictable.
30. As a developer, I want one pure policy module for the sliding-window decision, so that frontend and tests share the same definition of “8 in 10 seconds.”
31. As a developer, I want Page View skip decisions testable against config + signal fixtures, so that we do not regress TW/User keep-rates.
32. As a developer, I want throttle unit tests without mounting the full React app, so that AFK agents can verify policy quickly.
33. As a User who double-taps search, I want the second tap ignored while loading or over limit, so that I do not get duplicate work.
34. As a User, I want the search button disabled (or equivalent) while throttled, so that the affordance matches the state.
35. As an operator, I want Query log schema unchanged, so that existing exports and SQL keep working.
36. As an operator, I want Page View schema unchanged, so that only write volume changes, not shape.
37. As a User on localhost, I want existing “no page view log on localhost” behavior preserved, so that local dev noise stays down.
38. As a User, I want recent-search one-click search to respect the same throttle, so that automation of clicks cannot bypass the bucket.
39. As an operator, I want no new dependency on Vercel Firewall for this v1, so that the feature ships in-app/config only.
40. As an operator, I want documentation in domain language (Query vs Page View vs Log filter vs Query throttle), so that future changes do not reopen rejected options (external redirect, geo block).

## Implementation Decisions

### Scope of this delivery

1. **In scope:** complete **Query throttle** (client session + server Query-log IP window) and ensure **Page View Log filter** behavior matches the agreed config-driven design (already partially present — finish/align tests and any missing wiring).
2. **Out of scope for behavior change:** Crawler access, robots, static SEO routes, geo blocking, CAPTCHA, external redirects, throttling of static data files.

### Domain rules (normative)

3. **Primary KPI:** Query / Engaged use — not Page View.
4. **Query throttle window:** sliding **10_000 ms**, max **8** submitted Queries per identity bucket.
5. **No extra cooldown** after breach; allowance returns as old events fall out of the window.
6. **Shared product bucket:** TRA, HSR, metro, and journey planner submissions share one counter per identity.
7. **Count only real submissions** that would perform a search (not mere UI interaction or failed guards before search starts).
8. **UI copy (neutral):** zh “操作較頻繁，請稍候再查。” / en “You're searching a bit quickly — try again in a moment.”
9. **Log filter:** never use country/region/city/IP geo fields as deny conditions; ignore such keys if present in a fingerprint rule.
10. **Filtered Page View or throttled Query log:** HTTP success to client; no insert (and no success telemetry for that skipped write).

### Modules & seams

11. **Preferred single policy seam (new, pure):** a small **Query throttle policy** module that only decides allow/deny given timestamps + now + `{ windowMs, max }` and returns the updated timestamp list. UI and tests depend on this; no React, no HTTP inside the policy.
12. **Page View Log filter seam:** pure evaluation of (client signals + filter config) → skip/keep. Keep config loaded from the static filters file already used by the Page View logging endpoint. Prefer testing this pure evaluation over testing the HTTP handler.
13. **Frontend integration:** rail/HSR search entry, metro search entry, and journey planner search entry all call the same session-scoped throttle before running search / before logging a Query. On deny: show message, do not search, do not log Query.
14. **Backend integration:** Query logging endpoint applies IP sliding window (best-effort in-memory on the serverless instance). On deny: return ok without DB insert. Do not require the client to handle a new error shape.
15. **Page View endpoint:** keep write-time Log filter; do not block response; do not filter by geo.

### Identity

16. **UI identity:** browser tab session already used for analytics session id (or equivalent sessionStorage key) — one sliding window per tab session.
17. **Log identity:** client IP from the platform request headers (with a safe unknown fallback bucket). No User accounts exist.

### Config

18. **Log filter config** remains a static JSON file deployable with the app; editable without code changes to rule data (redeploy still required).
19. **Throttle numeric thresholds** may live as named constants next to the policy module for v1 (they are product-fixed from grilling). Optional later: move next to log-filters config if operators need hot retune.

### API contracts

20. **POST Query log:** unchanged request body; response remains success-shaped when throttled or when DB is absent.
21. **POST Page View log:** unchanged request body; response remains success-shaped when filtered or when DB is absent.
22. **No new public endpoints** required for v1.

### Schema

23. **No database migrations.** No new tables for throttle state in v1 (in-memory / in-tab only).

### Telemetry

24. Skipped Page Views and throttled Query logs should not emit “success” product telemetry that would re-inflate counts.

### Serverless caveat (explicit)

25. IP window state is **best-effort per instance** on serverless. This is accepted for v1; it is a backstop for log spam, not a global distributed rate limiter.

### Prototype-shaped policy (decision-rich)

Sliding window decision (conceptual):

```text
allow(times[], now, windowMs=10000, max=8):
  times' = times.filter(t => now - t < windowMs)
  if times'.length >= max → { allow: false, times: times' }
  else → { allow: true, times: times' + [now] }
```

## Testing Decisions

### What good tests look like

- Test **external behavior of pure policy and filter evaluation**: given inputs, allow/skip and updated window state.
- Do **not** require full browser e2e for v1 unless already cheap in-repo.
- Do **not** assert internal React state structure or private variable names.
- Prefer fixtures (UA strings, screen sizes, timestamp lists) over live network/DB.

### What to test

1. **Query throttle policy**
   - Under 8 events in 10s → allow; length increases.
   - 8th allowed, 9th denied within window.
   - After oldest events expire → allow again without fixed cooldown.
   - Events outside window dropped from the list.
2. **Page View Log filter evaluation**
   - Known Synthetic Linux Chrome fingerprint cluster → skip.
   - HeadlessChrome → skip.
   - Asia/Taipei / zh-TW User-like signals → keep.
   - Fingerprint rule containing geo keys → rule ignored (not applied as deny).
   - `enabled: false` → never skip by rules.
3. Optional light test: Query log handler returns ok and does not throw when throttle would fire (mock DB not called) — only if handler testing pattern is already ergonomic; otherwise policy tests suffice.

### Prior art in this repo

- Node’s built-in test runner via `tsx --test` (e.g. data-integrity and station-footfall tests under `scripts/`).
- No heavy React Testing Library suite; do not introduce one solely for this feature.
- `tsc --noEmit` remains the project-wide typecheck gate.

### Seam check (for implementers / maintainer)

**Primary seam:** pure Query throttle policy (one function/module).  
**Secondary seam:** pure Page View filter evaluation against static config.  

If this seam split is wrong, adjust before coding UI wiring — do not scatter window arithmetic across three components.

## Out of Scope

- Redirecting Users to Google or any external URL when throttled.
- Full-site CAPTCHA, Vercel Bot attack mode, or WAF rule packs as part of this spec.
- Blocking or challenging Crawlers (GPTBot, Googlebot, etc.).
- Geo / country / region deny lists for page access or analytics.
- Rate limiting static `/data/*` timetable JSON.
- Distributed rate limit store (Redis, KV, Upstash) for global IP windows.
- Changing robots.txt, llms.txt, SEO route generation, or CSP for this feature.
- Throttling TDX proxy traffic (separate concern).
- User accounts, auth, or per-account quotas.
- Deleting or migrating historical noisy Page View rows already in the database.
- Client-side ad or third-party bot mitigation.

## Further Notes

- Historical analysis: most recent Page View volume matched a repeated Synthetic fingerprint; Queries were almost entirely Taiwan Users and never matched that fingerprint. Log filter targets that class of noise; Query throttle is a separate soft guardrail.
- Normal User bursts (e.g. correcting a station after zero results) stay under 8/10s if they pause even briefly; start with this threshold and retune only with evidence.
- Glossary and ADR already capture “why not block Crawlers / why not redirect”; implementers should not reopen those without a new decision record.
- Issue tracker for this repo is **local markdown** under `.scratch/` (`Status: ready-for-agent` on this spec).
