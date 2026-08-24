# AGENTS.md

**The architecture guide for this repo is [`CLAUDE.md`](./CLAUDE.md). Read that file, not this one.**

This file used to be a second, hand-maintained copy of the same guide. It drifted, and a drifted
guide is worse than no guide: an agent following it made changes that contradicted how the code
actually behaves. Rather than re-sync two copies and wait for them to diverge again, `CLAUDE.md`
is now the single source of truth and this file is a pointer to it.

The stale copy is preserved in git history (`git log --follow AGENTS.md`) if you need to see what
it said, but do not act on it. For the record, these were the ways it was wrong — all of them are
correct in `CLAUDE.md`:

- It said **TRA fares must never be published** on the SEO route pages, "because the dataset has
  unreliable distances/prices". That diagnosis was wrong and has been fixed: TDX ships one
  `ODFare` record per direction around the island, and the consumer was keeping the long-way one
  (hence figures like "Taipei→Taichung 711 km"). `pickShortestRouteFares` resolves it at the data
  layer, and the resulting fares match the operator's published tariff exactly. TRA fares **are**
  published, verified 2026-07-30.
- It was missing entire subsystems that now exist: Metro (7 operators), the MaaS Routing
  door-to-door journey planner, the two-week daily-timetable layer, the affiliate placements and
  their second database, and the gate-ticket flow.
- Its descriptions of `App.tsx`'s size, the serverless function list, and `/api/log-pageview`
  (retired — see `CONTEXT.md`) were out of date.

## If you are adding project documentation

Put it in `CLAUDE.md`, or in a dedicated file under `docs/` that `CLAUDE.md` links to. Do not
start a parallel overview here — that is exactly what went wrong the first time.
