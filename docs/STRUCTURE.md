# Sitemap Structure

## Scope

- Canonical host: `https://taiwanrail.vercel.app`
- Generator: `scripts/generate-route-pages.mjs`
- Output: `public/sitemap.xml`
- Discovery: `public/robots.txt`
- Current organization: one sitemap with 19 canonical URLs, well below the 50,000-URL protocol limit.

## URL groups

| Group | Count | Pattern | Purpose |
| --- | ---: | --- | --- |
| Locale entry points | 2 | `/`, `/en/` | Bilingual application entry points with reciprocal hreflang links |
| TRA route guides | 9 | `/routes/train/{origin}-to-{destination}/` | Data-rich static landing pages for popular conventional-rail journeys |
| THSR route guides | 8 | `/routes/hsr/{origin}-to-{destination}/` | Data-rich static landing pages for popular high-speed-rail journeys |

## Inclusion rules

- Include only absolute HTTPS URLs on the canonical host.
- Include only indexable, canonical URLs that return a successful response.
- Include reciprocal `zh-Hant`, `en`, and `x-default` hreflang links for locale-equivalent entry points.
- Include `<lastmod>` only when it reflects the generated content/data version.
- Omit ignored `<priority>` and `<changefreq>` tags.
- Keep route pages backed by real timetable, stop, frequency, duration, and fare data where reliable.

## Exclusion rules

- Exclude `/api/`, `/data/`, query-string tab variants, station deep-link parameters, redirects, noindexed pages, and non-canonical duplicates.
- Do not add thin location or route combinations by swapping place names. New route pages require distinct, useful journey data and human-reviewable copy.
- Do not publish TRA fares on route pages until the underlying source is reliable enough for that use.

## Growth policy

- Keep a single sitemap while the total stays comfortably below 50,000 URLs.
- If the inventory grows materially, split by content type into locale entry points, TRA routes, THSR routes, and any future editorial content, then publish a sitemap index.
- At 30+ scaled location/route pages, review unique-value coverage. At 50+, require an explicit content and quality justification before expansion.

## Maintenance

1. Update the curated route catalogue in `scripts/generate-route-pages.mjs`.
2. Run `npm run generate-routes`.
3. Run `npm run seo:verify`.
4. Confirm `public/robots.txt` still references the canonical sitemap.
5. Verify changed URLs in production after deployment and submit the sitemap in Google Search Console.
