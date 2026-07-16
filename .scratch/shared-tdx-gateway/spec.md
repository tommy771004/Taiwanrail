Status: ready-for-agent

# Spec: Shared TDX gateway with Vercel and Express adapters

## Problem Statement

Users expect the same rail data behavior in production and local development, but the TDX gateway is implemented twice: once for the Vercel runtime and once inside the Express runtime. Both implementations independently own token acquisition, path correction, caching, stale fallback, upstream error handling, and response shaping.

The copies have already drifted. Production deduplicates concurrent upstream work while local development does not; production uses path-specific cache lifetimes while local development uses one generic lifetime; Alert failures degrade differently; and missing credentials produce different status codes. A fix made in one runtime can therefore appear correct locally but fail after deployment, or work in production while remaining difficult to reproduce locally.

This duplication also makes critical TDX quirks harder to protect. The original OData query string must reach TDX without percent-encoding `$`, booking links must never be cached, authentication bursts must be deduplicated, and stale data should remain available during rate limits or transient upstream failures. Today those behaviors must be remembered and maintained in multiple places.

## Solution

Users receive one consistent TDX gateway behavior regardless of runtime. Authentication, path correction, endpoint classification, cache policy, in-flight deduplication, stale fallback, and upstream response classification move into one deep shared module. Vercel and Express retain thin adapters that translate runtime-specific requests into the shared interface and translate the result back into their native response objects.

The shared gateway interface is the primary seam for behavior and testing. It accepts the raw TDX path and original raw query string plus the request facts required by gateway policy, and produces an observable result containing status, JSON body, and response headers. The interface hides token state, cache state, retries, endpoint versions, and fallback decisions.

The production TDX behavior is normative where the existing implementations disagree. Local Express adopts the production path-specific cache policy, request deduplication, `503` credential behavior, stale response behavior, and Alert degradation. Runtime-only concerns, including Vercel origin checks and Express routing mechanics, stay in their adapters.

## User Stories

1. As a User, I want a Route Search to behave the same locally and in production, so that environment differences do not hide failures.
2. As a User, I want transient TDX failures to use safe fallback behavior, so that a temporary upstream problem does not unnecessarily empty my results.
3. As a User, I want cached rail data returned during TDX rate limits when available, so that a `429` does not interrupt an otherwise usable Route Search.
4. As a User, I want cached rail data returned during transient TDX server failures when available, so that upstream instability has less effect on my journey planning.
5. As a User, I want Alert failures to appear as an empty Alert state, so that a non-critical endpoint does not break timetable use.
6. As a User, I want timetable data to remain fresher than station reference data, so that cache behavior reflects how quickly each kind of information changes.
7. As a User, I want LiveBoard data to use a short cache lifetime, so that displayed delays are not held for an entire static-data interval.
8. As a User, I want booking links to remain uncached, so that short-lived or User-specific links are never replayed from gateway state.
9. As a User, I want booking responses marked `no-store`, so that browsers and intermediate systems do not retain them.
10. As a User, I want timetable and fare Queries containing OData parameters to reach TDX unchanged, so that valid searches are not rejected by the TDX WAF.
11. As a User, I want multiple simultaneous requests for the same TDX resource to share one upstream operation, so that page-load bursts are less likely to trigger a rate limit.
12. As a User, I want authentication bursts to share one token operation, so that a cold start does not create avoidable failures.
13. As a User, I want a temporarily unavailable token endpoint to back off before retrying, so that repeated authentication attempts do not amplify the failure.
14. As a User, I want a clear temporary-unavailability response when credentials are absent or authentication fails and no stale data exists, so that the application can degrade predictably.
15. As a User, I want the gateway to distinguish missing credentials from upstream authentication failure, so that operators can diagnose configuration without exposing secrets.
16. As a User, I want TRA Alert paths corrected to the working TDX version, so that published Alerts can be displayed when available.
17. As a User, I want TRA LiveBoard station paths corrected to the working TDX version, so that live delays can be retrieved.
18. As a User, I want nearby bus station paths corrected to the appropriate TDX tier, so that station onward-travel information keeps working.
19. As a User, I want TDX response status codes preserved when no gateway fallback applies, so that callers receive an honest result.
20. As a User, I want an invalid or failed non-critical Alert response to degrade consistently, so that local development reproduces production behavior.
21. As a User, I want an expired cache entry retained as a stale fallback candidate, so that previously successful data can survive brief upstream outages.
22. As a User, I want successful fresh responses labelled consistently as cache misses, so that behavior can be diagnosed without changing the body.
23. As a User, I want fresh cached responses labelled consistently as cache hits, so that operators can understand gateway behavior.
24. As a User, I want stale fallback responses labelled consistently, so that operators can distinguish resilience from fresh upstream success.
25. As a developer, I want one gateway implementation shared by Vercel and Express, so that each reliability fix has leverage across both runtimes.
26. As a developer, I want runtime adapters to know only request and response translation, so that TDX policy has locality in the shared module.
27. As a developer, I want token acquisition hidden behind the gateway interface, so that callers do not learn authentication ordering or cache state.
28. As a developer, I want path correction hidden behind the gateway interface, so that callers do not need to know TDX endpoint-version quirks.
29. As a developer, I want cache keys normalized independently of outbound query strings, so that equivalent Queries share cache entries without corrupting OData syntax.
30. As a developer, I want the original raw query string forwarded to TDX, so that sorting the cache key never rewrites the outbound request.
31. As a developer, I want cache lifetimes defined once by endpoint classification, so that local and production behavior cannot drift.
32. As a developer, I want concurrent request deduplication defined once, so that every runtime receives the same protection.
33. As a developer, I want stale fallback rules defined once, so that `429` and upstream `5xx` handling cannot diverge.
34. As a developer, I want Alert degradation defined once, so that non-critical failures have one observable outcome.
35. As a developer, I want booking exclusions defined once, so that later gateway changes cannot accidentally cache booking links.
36. As a developer, I want a deterministic clock at the external test seam, so that token expiry, backoff, and cache expiry tests do not sleep.
37. As a developer, I want a fake TDX transport adapter at the external seam, so that tests never require credentials or network access.
38. As a developer, I want tests to assert observable gateway results, so that the implementation can change without rewriting specifications.
39. As a developer, I want raw-query fidelity covered by a known literal, so that a future URL utility cannot silently encode `$` as `%24`.
40. As a developer, I want the first tracer test to cover Alert degradation, so that the red-green loop starts with a small behavior that currently differs by runtime.
41. As a developer, I want one failing test followed by the smallest passing implementation, so that the shared module grows in vertical slices rather than from imagined behavior.
42. As a developer, I want the existing runtime behavior migrated incrementally, so that a large proxy rewrite is not required before the first verified slice.
43. As an operator, I want missing TDX credentials reported once per process with no secret values, so that configuration failures are diagnosable and safe.
44. As an operator, I want a `Retry-After` response when authentication is temporarily unavailable, so that callers receive useful backoff information.
45. As an operator, I want gateway failures to keep concise public bodies and detailed server logs, so that diagnostics do not expose sensitive configuration.
46. As an operator, I want in-memory cache and token state isolated per process, so that this refactor does not introduce new infrastructure or deployment dependencies.
47. As an operator, I want production behavior to remain the reference during parity work, so that local alignment does not weaken deployed resilience.
48. As an operator, I want the Express LiveBoard polling path to reuse the shared authentication and cache implementation, so that background polling cannot drift from HTTP gateway behavior.
49. As an operator, I want the static-data-first product architecture unchanged, so that ordinary timetable and fare searches continue to use committed datasets before the live gateway.
50. As an operator, I want TDX credentials to remain server-side, so that no secret is introduced into browser configuration or bundles.

## Implementation Decisions

1. Build one deep TDX gateway module with one external interface. Its implementation owns authentication, endpoint correction, endpoint classification, caching, in-flight deduplication, stale fallback, upstream response classification, and gateway response headers.
2. Keep Vercel and Express as thin runtime adapters. They translate their request objects into the shared gateway input and apply the returned status, JSON body, and headers to their response objects.
3. Use the shared gateway interface as the only behavioral seam for this delivery. Runtime adapters do not grow independent cache, token, rewrite, or fallback policy.
4. Treat production behavior as normative where the two current implementations disagree. Express adopts production request deduplication, path-specific cache lifetimes, Alert degradation, stale-cache policy, and temporary-authentication response behavior.
5. Preserve the original raw query string for the outbound TDX request. Do not rebuild it with `URLSearchParams.toString()` or any operation that percent-encodes `$`.
6. Build the cache key separately by normalizing and sorting query keys. Cache-key normalization must never modify the outbound query string.
7. Keep path correction in the shared implementation. TRA Alert uses its known-good v3 path; TRA LiveBoard station access uses its known-good v2 path; nearby bus station access uses the advanced tier.
8. Preserve the existing client-side rule that THSR has no LiveBoard or Alert endpoint. The browser data module continues returning empty arrays for those operations and does not introduce live THSR calls.
9. Classify Alert requests in the shared implementation. Authentication failure, upstream `404`, upstream `429`, upstream `5xx`, invalid upstream content, and gateway exceptions degrade to `200` with an empty JSON array and a diagnostic fallback header.
10. Classify booking-link requests in the shared implementation. They bypass response caching and in-flight response reuse where reuse could replay a short-lived link, and they return `Cache-Control: no-store`.
11. Preserve path-specific cache lifetimes from the production implementation for station data, Alerts, LiveBoard data, daily timetables, fares, and routing results. The generic lifetime remains the fallback for unclassified cacheable paths.
12. Keep expired entries available as stale candidates. Expiry controls freshness, not immediate eviction.
13. Serve a stale cached body for cacheable requests when TDX returns `429` or `5xx`, or when token acquisition is temporarily unavailable.
14. Return the production temporary-unavailability contract when credentials are missing or authentication fails and no stale or Alert fallback applies: status `503`, a concise reason, and `Retry-After` derived from the authentication backoff.
15. Trim credential environment values before use. Never log the credential values.
16. Deduplicate concurrent token acquisition and concurrent identical upstream requests inside the shared module.
17. Preserve the short authentication retry policy and failure backoff already used in production. Time enters through an injected clock so tests remain deterministic.
18. Inject the external TDX transport at the gateway seam. Production uses the real network adapter; tests use a fake adapter with predetermined responses.
19. Keep runtime-only origin checks in the Vercel adapter. Origin policy is not part of TDX path, cache, or fallback behavior and need not be imposed on local development.
20. Let Express LiveBoard polling call the same shared gateway interface rather than retaining a second token/cache implementation.
21. Keep cache and token state in memory per process. Do not add Redis, KV, a database table, or cross-instance coordination.
22. Do not alter browser-facing TDX getter interfaces as part of this delivery. The static-data-first, live-gateway-fallback behavior remains intact.
23. Do not reintroduce browser-exposed TDX credentials or deprecated public environment variables.
24. Preserve JSON response bodies and diagnostic headers expected by current callers wherever production already defines them.
25. Migrate behavior in vertical TDD slices. Each slice adds one failing test, the smallest shared implementation needed to pass it, and then moves only the corresponding runtime behavior behind the shared seam.
26. Do not perform a broad cleanup or refactor during the red-green cycles. Structural polishing is deferred to a later review stage after behavior is green.
27. No database schema, public route, SEO, sitemap, or analytics contract changes are part of this work.
28. ADR-0001 remains unchanged. The shared gateway does not alter the Query throttle, Page View Log filter, Crawler access, or static timetable asset rules.

## Testing Decisions

1. Good tests exercise observable behavior through the shared gateway interface. They assert status, JSON body, and response headers; they do not inspect private token maps, cache maps, timers, or helper functions.
2. The single confirmed test seam is the shared TDX gateway interface. It is higher than token, cache, rewrite, and fallback internals while remaining independent of Vercel and Express framework objects.
3. The external TDX transport and time are the only replaced dependencies. They are true external seams: the fake transport supplies known upstream responses, and the deterministic clock controls expiry without sleeping.
4. Do not mock internal modules or assert internal call order. An external transport invocation count may be asserted only when it is itself part of observable deduplication or caching behavior.
5. Use independent known literals for expected paths, raw OData queries, statuses, bodies, and headers. Do not recompute expectations using the gateway's normalization logic.
6. Follow strict red-green vertical slices: one failing behavior test, the smallest passing implementation, then the next behavior. Do not write the full test matrix before implementation.
7. The first tracer test is: an Alert request whose upstream response fails returns status `200`, body `[]`, and an Alert fallback header through the shared gateway interface.
8. Subsequent slices cover raw `$` query preservation, cache-key normalization without outbound mutation, path correction, fresh cache hits, path-specific expiry, concurrent request deduplication, stale fallback on `429`/`5xx`, booking `no-store`, token deduplication, authentication backoff, and the `503` temporary-unavailability contract.
9. Raw-query fidelity is tested by giving the gateway a literal OData query containing `$filter`, `$format`, or `$top` and observing the literal request received by the fake external TDX adapter.
10. Cache behavior is tested through gateway headers and returned bodies. The fake external adapter may additionally verify that a fresh cache hit avoids a second external operation because avoiding that operation is a documented gateway characteristic.
11. In-flight deduplication is tested with concurrent calls to the public interface and a controllable external adapter, asserting identical observable results and one external operation.
12. Stale fallback tests first seed the gateway through its public interface, advance the deterministic clock beyond freshness, then provide an upstream failure and assert the stale body plus diagnostic header.
13. Booking tests assert that repeated calls do not produce cache-hit behavior and always return `Cache-Control: no-store`.
14. Authentication tests use the external token operation exposed by the TDX adapter rather than mocking private gateway helpers.
15. Runtime adapters receive proportionate smoke verification through the project typecheck and local endpoint smoke checks. Their framework translation is intentionally not a second full behavioral test seam.
16. Use the repository's existing Node built-in test runner through `tsx`, matching the established data-integrity, Query throttle, Page View Log filter, and search-intent tests.
17. Add a focused package command for the gateway behavior tests if needed, while keeping the project-wide TypeScript check as the final compile gate.
18. Network access, real TDX credentials, live TDX availability, and wall-clock sleeps are forbidden in the automated gateway suite.
19. Tests must survive changes to the internal cache representation, token representation, retry implementation, and helper organization.
20. The final verification includes the focused gateway suite, the project TypeScript check, and existing data-integrity checks relevant to static-data-first behavior.

## Out of Scope

- Changing the static-data-first browser architecture or making ordinary Route Searches live-first.
- Changing timetable, fare, station, routing, booking, Alert, or LiveBoard browser-facing interfaces.
- Adding THSR LiveBoard or Alert calls; those TDX endpoints do not exist and remain empty by design.
- Changing the Query throttle, its 10-second / 8-Query sliding window, its shared browser bucket, or its server-side logging backstop.
- Changing the Page View Log filter, analytics schemas, telemetry events, or Neon writes.
- Adding distributed cache, distributed locks, Redis, KV, or database-backed token state.
- Adding a persistent socket runtime to Vercel or changing the existing Express-only Socket.IO capability.
- Changing Vercel origin policy, CORS policy, site access policy, Crawler behavior, or robots directives.
- Rewriting browser data normalization for TDX v2/v3 shapes.
- Changing the data refresh pipeline, committed static datasets, deployment cadence, or SEO generation.
- Broadly decomposing the Express server or the application shell.
- Optimizing cache eviction or memory bounds beyond preserving current production behavior.
- Refactoring unrelated logging, telemetry, feedback, YouBike, or geocoding handlers.

## Further Notes

- This spec follows the top recommendation from the architecture review: unify the TDX gateway implementation before tackling the larger Metro and rail Route Search modules.
- The existing runtime duplication is documented as intentional mirroring, but current observable drift proves the seam is real: Vercel and Express are two adapters that should share one implementation.
- The TDD seam was proposed immediately before this spec and accepted by moving directly to specification: shared gateway input to observable status/body/headers, with a fake external TDX adapter and deterministic clock.
- The first tracer deliberately targets Alert degradation because it is small, User-visible, and currently differs between runtimes.
- ADR-0001 is not contradicted. The gateway refactor does not change how Queries are counted, throttled, or logged.
- Tracker: local Markdown under `.scratch/` with `Status: ready-for-agent`.
