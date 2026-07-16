# 04 — Smoke / regression gate

**What to build:** Correctness work is done when automated checks and a short smoke pass confirm: shared disabled state across modes, recent/deep-link intent not lost on throttle, 10s/8 and soft messaging unchanged, structure cleanup tests still green.

**Blocked by:** 01 — Shared session store → 全模式 throttled 同源; 02 — 意圖旗標只在 consume 成功後提交; 03 — Rail 接受搜尋路徑收斂

**Status:** ready-for-agent

- [ ] Query throttle / session store unit tests green
- [ ] Typecheck (`tsc --noEmit` / project lint) green
- [ ] Smoke: fill window on one mode → other modes’ search controls disabled; after window frees → re-enabled
- [ ] Smoke: throttled recent-search and deep-link do not permanently drop intent; search can complete after wait
- [ ] Smoke: product limits and neutral copy unchanged; no off-site redirect
