# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-07-01
- Primary product surfaces: TRA timetable search, THSR timetable search, metro search, multimodal journey planning, route landing pages, expanded train details, station/transfer tools, and offline/reliability states.
- Evidence reviewed: `CLAUDE.md`, `metadata.json`, `index.html`, `src/App.tsx`, `src/index.css`, `src/components/`, `src/lib/`, `public/logo.svg`, `public/manifest.webmanifest`, `public/routes/`, `docs/superpowers/specs/2026-06-29-metro-search-results-redesign-design.md`, and `docs/superpowers/specs/2026-06-29-metro-transfer-routing-design.md`.
- Governance: this file is the durable product and UI contract. Feature-specific specs may add detail but should not contradict it without refreshing this file.

## Brand

- Personality: trustworthy, practical, calm under time pressure, locally fluent, and quietly modern.
- Trust signals: government TDX data attribution, explicit live/static/offline status, visible delay and cancellation states, transparent fare and stop details, bilingual terminology, and clear external-link disclosure.
- Avoid: novelty over legibility, decorative motion that competes with departure information, ambiguous transport colors, hidden data freshness, fake precision, and dense dashboard styling on small screens.

## Product goals

- Goals: make a correct Taiwan rail or metro decision quickly; expose the information needed at the platform; support complete door-to-door planning; remain useful on weak networks; and make popular route information indexable.
- Non-goals: ticket sales, account-centric social features, replacing operator alerts, guaranteeing platform assignments, or presenting heuristic reliability as official data.
- Success signals: users can select a mode and route without instruction, understand the next viable departure at a glance, recover from empty/error/offline states, and reach details or official booking with deliberate actions.

## Personas and jobs

- Primary personas: daily commuters, occasional domestic travelers, tourists using English, travelers making transfers, and users checking a journey while already in transit.
- User jobs: compare departures; check delays, fares, stops, transfers, and journey duration; plan across modes; revisit recent or favorite trips; and act despite intermittent connectivity.
- Key contexts of use: one-handed mobile use, bright outdoor platforms, time pressure, low bandwidth, dark mode, bilingual station-name lookup, and desktop trip planning.

## Information architecture

- Primary navigation: persistent mode tabs for 台鐵/TRA, 高鐵/THSR, 捷運/Metro, and 規劃/Plan; utility controls for feedback, favorites/watchlist, language, text size, and theme.
- Core routes/screens: `/`, `/en/`, canonical `/routes/train/*/` pages, canonical `/routes/hsr/*/` pages, station pickers, search results, expanded journey details, transfer maps, platform mode, and journey-planner results.
- Content hierarchy: mode and origin/destination first; date/time and search action second; result count and disruption status third; departure/arrival/duration as the primary card scan path; fare, stops, transfers, reliability, and external actions as secondary detail.

## Design principles

- Decision first: emphasize the next useful travel decision, not every available datum.
- Mode continuity: keep each transport mode visually distinct while preserving the same search-to-results mental model.
- Progressive disclosure: show departure, arrival, duration, and status immediately; reveal stops, transfer detail, platform guidance, and supporting data on demand.
- Resilient truth: label live, cached, inferred, unavailable, and offline information honestly.
- Tradeoffs: favor scanning and touch clarity over compact density; favor consistent components over route-specific novelty; allow richer desktop layouts without changing mobile information order.

## Visual language

- Color: slate is the neutral base; TRA uses blue, THSR orange, Metro cyan, and Plan emerald. Red is reserved for cancellation/error, amber for warning or transfer risk, and green for positive/on-time status. Dark mode uses near-black mode-tinted surfaces.
- Typography: system sans-serif via Tailwind; heavy weights for times, station names, and key amounts; restrained uppercase/tracking for labels; tabular numerals for times, fares, durations, and counts.
- Spacing/layout rhythm: compact 4/8/12/16px internal rhythm, generous 24/32px section separation, pill controls, and result content capped around `max-w-5xl`.
- Shape/radius/elevation: rounded-xl through rounded-[2.5rem] surfaces, subtle borders, mode-tinted shadows, and stronger elevation only for dialogs, sticky controls, and active cards.
- Motion: short color/scale/expand transitions; marquee content pauses on hover/focus and becomes horizontally scrollable under reduced motion; never animate essential status continuously except a restrained live indicator.
- Imagery/iconography: Lucide icons and transport symbols support labels; photography is atmospheric and subordinate to search controls; icons do not replace text for unfamiliar actions.

## Components

- Existing components to reuse: `StationPickerModal`, `MetroSearch`, `JourneyPlanner`, `TransferMapModal`, `PlatformMode`, `TrainCard`, `JourneyProgressBar`, `ReliabilityBadge`, `RecentSearches`, `NetworkStatus`, `OfflineModeBanner`, `ExternalLinkModal`, `AffiliateMarquee`, and primitives under `src/components/ui/`.
- New/changed components: extract from `src/App.tsx` only when a feature boundary is stable and reuse or testing materially improves; prefer extending current result-card and modal patterns.
- Variants and states: transport mode, light/dark, zh-TW/en, compact/expanded, selected/unselected, favorite/watchlisted, live/cached/offline, loading/empty/error/success/disabled, delayed/cancelled, and reduced motion.
- Token/component ownership: Tailwind utility patterns and `src/index.css` are canonical today. Preserve the mode palette and shared class conventions; do not add a parallel token or component system without a migration plan.

## Accessibility

- Target standard: WCAG 2.2 AA for user-facing flows.
- Keyboard/focus behavior: all actions must be native controls or expose equivalent semantics; dialogs trap and restore focus; visible `focus-visible` rings are required; expanded controls expose `aria-expanded`.
- Contrast/readability: validate mode accents and muted text in both themes, retain large readable times, and do not encode delay, cancellation, selection, or mode by color alone.
- Screen-reader semantics: use ordered headings, landmarks, labelled dialogs, real lists/tables where appropriate, descriptive link purpose, and hidden decorative icons.
- Reduced motion and sensory considerations: honor `prefers-reduced-motion`, pause moving content on focus/hover, avoid parallax for opted-out users, and do not rely on vibration or animation as the only feedback.

## Responsive behavior

- Supported breakpoints/devices: mobile-first from 320px, common tablet and desktop widths, modern evergreen browsers, PWA standalone display, and safe-area insets on notched devices.
- Layout adaptations: search inputs remain touch-friendly and stack or compress before truncating meaning; results keep the same reading order; desktop may widen and align columns up to `max-w-5xl`/`max-w-7xl`.
- Touch/hover differences: minimum practical touch target is 44px; hover effects are enhancements only; marquees and horizontal strips must remain manually scrollable; sticky elements must not obscure results or browser zoom.

## Interaction states

- Loading: preserve layout, identify what is loading, and avoid indefinite animation without text.
- Empty: distinguish “search not started,” “no matching service,” filters hiding results, and missing data.
- Error: explain the failed source or action, retain user inputs, offer a retry or safe alternative, and do not expose credentials or raw upstream payloads.
- Success: move focus or scroll context predictably to results, show the result count and route, and preserve selected mode/date.
- Disabled: state why an action is unavailable where it is not obvious; disabled styling must remain legible.
- Offline/slow network: prefer committed static datasets and cached snapshots, show freshness/status, and degrade live-only features without blocking timetable use.

## Content voice

- Tone: concise, reassuring, factual, and action-oriented; urgency is reserved for real service impact.
- Terminology: use official Traditional Chinese transport and station names with natural English equivalents; keep TRA, THSR, Metro, platform, fare, delay, cancellation, and transfer terms consistent.
- Microcopy rules: lead with the outcome, include units, qualify estimates, label external destinations, avoid blaming the user, and keep bilingual strings semantically equivalent rather than literally mirrored.

## Implementation constraints

- Framework/styling system: React 19, TypeScript, Vite 6, Tailwind CSS 4, Motion, Lucide React, i18next, and Vercel/Express dual runtime.
- Design-token constraints: extend the existing slate + blue/orange/cyan/emerald mode system and Tailwind patterns; no additional UI framework or design-system dependency without explicit approval.
- Performance constraints: static-data-first, live API fallback; keep the initial interaction responsive on mobile; avoid layout-thrashing animation and unnecessary route-data downloads.
- Compatibility constraints: preserve zh-TW/en behavior, dark mode, reduced motion, PWA safe areas, local Express and Vercel paths, and SEO-renderable route pages.
- Test/screenshot expectations: run `npm run lint`, `npm run build`, and `npm run seo:verify` for relevant changes; test primary flows at mobile and desktop widths in light/dark mode; include keyboard and reduced-motion checks for interaction changes.

## Open questions

- [ ] Product owner: confirm whether WCAG 2.2 AA is the formal release requirement or the working target; impact: acceptance criteria and audit depth.
- [ ] Product owner: decide when Metro graduates from any remaining environment gating; impact: navigation, QA surface, and SEO copy.
- [ ] Product owner: define freshness language for static timetable snapshots versus live delay data; impact: trust copy across result cards and offline states.
- [ ] Design/engineering: decide whether to incrementally extract stable sections from `src/App.tsx`; impact: component governance and visual regression scope.
