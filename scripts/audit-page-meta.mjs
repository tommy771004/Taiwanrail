/**
 * Audits the SERP-facing metadata of every generated static page under public/.
 *
 * "Missing" is not only an absent tag. A <title> or meta description that Google
 * truncates is missing from the search result just as surely as one that was never
 * written, and a description Google judges too long is often discarded entirely in
 * favour of a snippet synthesised from the page body. So this reports four defect
 * classes, ranked by how much of the tag the searcher never sees:
 *
 *   missing    — the tag is absent, empty, or whitespace only
 *   duplicate  — the exact same value on more than one URL (Google folds these)
 *   overflow   — longer than the locale's budget, so the tail is cut
 *   thin       — so short it wastes the slot
 *
 * Budgets are the character equivalent of Google's pixel width, per locale: a CJK
 * glyph is about twice the width of a Latin one, so zh gets roughly half the
 * characters. They are the same constants the generator enforces at build time
 * (scripts/generate-route-pages.mjs), duplicated here only as a check on output —
 * this script reads the shipped HTML and never the source that produced it, so it
 * also catches a page written by anything other than the generator.
 *
 * Run: npm run seo:audit-meta   (add --json for machine-readable output)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const ROOT = process.cwd();
const PUBLIC = resolve(ROOT, 'public');

const BUDGET = {
  zh: { titleMax: 34, titleMin: 10, descMax: 84, descMin: 30 },
  en: { titleMax: 62, titleMin: 20, descMax: 158, descMin: 70 },
};

const TAGS = [
  { key: 'title', label: '<title>', re: /<title>([\s\S]*?)<\/title>/ },
  { key: 'description', label: 'meta description', re: /<meta name="description" content="([\s\S]*?)"\s*\/?>/ },
  { key: 'ogTitle', label: 'og:title', re: /<meta property="og:title" content="([\s\S]*?)"\s*\/?>/ },
  { key: 'ogDescription', label: 'og:description', re: /<meta property="og:description" content="([\s\S]*?)"\s*\/?>/ },
  { key: 'h1', label: '<h1>', re: /<h1[^>]*>([\s\S]*?)<\/h1>/ },
];

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name === 'index.html') out.push(full);
  }
  return out;
}

/** Decode the five entities esc() produces, so lengths measure what a user sees. */
const unescape = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');

const urlPathOf = (file) => `/${relative(PUBLIC, file).split(sep).join('/').replace(/index\.html$/, '')}`;

const pages = walk(PUBLIC).map((file) => {
  const html = readFileSync(file, 'utf8');
  const urlPath = urlPathOf(file);
  const locale = urlPath.startsWith('/en/') ? 'en' : 'zh';
  const tags = {};
  for (const tag of TAGS) {
    const raw = html.match(tag.re)?.[1];
    // Strip inline markup before measuring — an <h1> may legitimately contain some.
    tags[tag.key] = raw == null ? null : unescape(raw.replace(/<[^>]*>/g, '')).trim();
  }
  return { file, urlPath, locale, tags };
});

// --- Duplicate detection (across the whole site, both locales) --------------
const seen = { title: new Map(), description: new Map() };
for (const page of pages) {
  for (const key of ['title', 'description']) {
    const value = page.tags[key];
    if (!value) continue;
    const bucket = seen[key].get(value) ?? [];
    bucket.push(page.urlPath);
    seen[key].set(value, bucket);
  }
}

const findings = [];
const add = (page, tag, kind, detail, lost) =>
  findings.push({ url: page.urlPath, tag, kind, detail, lost, locale: page.locale });

for (const page of pages) {
  const budget = BUDGET[page.locale];
  for (const tag of TAGS) {
    const value = page.tags[tag.key];
    if (!value) {
      // A page with no <h1> or no description cannot be repaired by shortening it —
      // rank these above every truncation by giving them the largest possible loss.
      add(page, tag.label, 'missing', 'tag is absent or empty', Number.POSITIVE_INFINITY);
      continue;
    }
    if (tag.key === 'title' || tag.key === 'description') {
      const max = tag.key === 'title' ? budget.titleMax : budget.descMax;
      const min = tag.key === 'title' ? budget.titleMin : budget.descMin;
      const chars = [...value].length;
      if (chars > max) {
        add(page, tag.label, 'overflow', `${chars} chars, budget ${max} (${page.locale}) — "${value.slice(0, 70)}…"`, chars - max);
      } else if (chars < min) {
        add(page, tag.label, 'thin', `${chars} chars, expected at least ${min} (${page.locale})`, min - chars);
      }
      const dupes = seen[tag.key].get(value) ?? [];
      if (dupes.length > 1 && dupes[0] === page.urlPath) {
        add(page, tag.label, 'duplicate', `shared with ${dupes.length - 1} other page(s): ${dupes.slice(1, 4).join(', ')}`, dupes.length);
      }
    }
  }
}

const RANK = { missing: 0, duplicate: 1, overflow: 2, thin: 3 };
findings.sort((a, b) => RANK[a.kind] - RANK[b.kind] || b.lost - a.lost || a.url.localeCompare(b.url));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ pagesAudited: pages.length, findings }, (_k, v) => (v === Infinity ? null : v), 2));
} else {
  const counts = findings.reduce((acc, f) => ({ ...acc, [f.kind]: (acc[f.kind] ?? 0) + 1 }), {});
  console.log(`Audited ${pages.length} generated pages under public/.\n`);
  for (const kind of ['missing', 'duplicate', 'overflow', 'thin']) {
    console.log(`  ${kind.padEnd(10)} ${counts[kind] ?? 0}`);
  }
  if (findings.length) {
    console.log('\nTop 10 by severity:');
    for (const [i, f] of findings.slice(0, 10).entries()) {
      console.log(`  ${String(i + 1).padStart(2)}. [${f.kind}] ${f.tag} — ${f.url}\n      ${f.detail}`);
    }
  } else {
    console.log('\nNo missing, duplicate, over-long or thin title/description tags.');
  }
}

// Exit non-zero on the two classes that are unambiguous defects, so this can gate a
// build. Overflow and thin are budget judgements and only report.
const blocking = findings.filter((f) => f.kind === 'missing' || f.kind === 'duplicate');
if (blocking.length) process.exit(1);
