# Sitemap Validation Report

- Audit date: 2026-07-01
- Sitemap: `public/sitemap.xml`
- Canonical production URL: `https://taiwanrail.vercel.app/sitemap.xml`
- Generator: `scripts/generate-route-pages.mjs`
- Result: pass — sitemap and required source datasets are valid

## Summary

| Check | Result |
| --- | --- |
| XML parsing | Pass |
| URL count | Pass — 19 of 50,000 maximum |
| Production HTTP responses | Pass — all 19 URLs returned HTTP 200 without redirects |
| Canonical HTTPS host | Pass |
| robots.txt sitemap reference | Pass |
| API/data/query URLs excluded | Pass |
| Route file exists for each route URL | Pass — 17 static route pages |
| Indexability markers | Pass — local route pages are canonical and do not contain `noindex` |
| hreflang on locale entry points | Pass — `zh-Hant`, `en`, and `x-default` are reciprocal |
| Deprecated tags | Fixed — `priority` and `changefreq` removed |
| lastmod format | Pass — ISO `YYYY-MM-DD` |
| Generator source integrity | Pass — required datasets parse and meet minimum item counts |

## Findings

### Resolved high — TRA source data was truncated

The 2026-07-01 version of `public/data/tra-timetable.json` ended inside a `TrainInfo` object at position 1,925,059. Before this audit, the fetch process accepted any HTTP 200 body, wrote directly to the production path, and did not validate the resulting JSON. The route generator then logged the parse error and continued, which could overwrite useful TRA landing pages with thin fallback content.

The last known-good 2026-06-29 dataset has been restored with 902 timetables. Downloads are now parsed before use and written through a same-directory temporary file followed by an atomic rename. Invalid downloads leave the existing file untouched. The route generator also aborts before writing any route page or sitemap when required timetable data is invalid.

The scheduled data workflow now runs `npm run verify:data` before committing. It checks JSON syntax and minimum collection sizes for TRA/THSR station and timetable datasets.

### Info — ignored sitemap hints were present

The generator emitted `<priority>` and `<changefreq>` for every URL, and the verifier required them. Search engines do not use these hints for crawling decisions. They have been removed from the generator, generated sitemap, and verification contract.

### Info — shared lastmod date is intentional

The current 17 route pages are generated from the same committed timetable release, so a shared `2026-06-30` modification date is accurate for the preserved artifacts. Do not advance this date unless the generated page content or source data actually changes. The `SITEMAP_LASTMOD` override remains available for reproducible data releases.

## URL organization

- 2 locale entry points: `/` and `/en/`
- 9 TRA route guides under `/routes/train/`
- 8 THSR route guides under `/routes/hsr/`
- No sitemap index is needed at the current scale.

## Verification evidence

- `npm run seo:verify` — passed: 19 sitemap URLs, 17 route pages, 9 source docs.
- `npm run verify:data` — passed: 245 TRA stations, 12 THSR stations, 902 TRA timetables, and 217 THSR timetables.
- `npm run test:data-integrity` — passed: 3 tests covering truncated payload rejection, preservation of an existing file, and atomic valid replacement.
- `npm run lint` — passed: TypeScript `--noEmit`.
- `npm run build` — passed: route generation and Vite production build.
- Production URL sweep — passed: 19/19 returned HTTP 200.
- `git diff --check` — passed.

## Remaining risk

The restored TRA snapshot is valid but is not newer than the failed 2026-07-01 download. The next credentialed scheduled refresh should replace it only after passing the new integrity gate. Production builds now fail safely instead of publishing partial route content when required data is invalid.
