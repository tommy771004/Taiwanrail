/**
 * 功能更新記錄 (src/lib/changelog.ts) is hand-written and shown to riders as-is, so its
 * shape is pinned here: the modal sorts nothing and validates nothing.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHANGELOG, CHANGELOG_LANGS, changeKey, changelogBundle, type ChangelogLang } from '../src/lib/changelog';

const KINDS = new Set(['added', 'changed', 'removed']);

test('days are real dates, unique, newest first', () => {
  assert.ok(CHANGELOG.length > 0, 'the changelog is empty');
  const dates = CHANGELOG.map((d) => d.date);
  for (const date of dates) {
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/, `not YYYY-MM-DD: ${date}`);
    // A real calendar day: 2026-02-30 parses to March and would not round-trip.
    assert.equal(new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10), date, `not a real date: ${date}`);
  }
  assert.equal(new Set(dates).size, dates.length, 'a date appears twice; merge its entries into one day');
  assert.deepEqual(dates, [...dates].sort().reverse(), 'days must be listed newest first');
});

test('every day has entries, each with a kind and both languages', () => {
  for (const day of CHANGELOG) {
    assert.ok(day.items.length > 0, `${day.date} has no entries`);
    for (const item of day.items) {
      assert.ok(KINDS.has(item.kind), `${day.date}: unknown kind ${item.kind}`);
      for (const text of [item.zh, item.en]) {
        assert.ok(text.trim().length >= 8, `${day.date}: an entry is missing a language or is too short to mean anything`);
        assert.equal(text, text.trim(), `${day.date}: stray whitespace around "${text}"`);
      }
      assert.match(item.zh, /[一-鿿]/, `${day.date}: the zh text has no Chinese: ${item.zh}`);
      assert.doesNotMatch(item.en, /[一-鿿]/, `${day.date}: the en text contains Chinese: ${item.en}`);
    }
  }
});

test('within a day entries read added → changed → removed', () => {
  const order = { added: 0, changed: 1, removed: 2 } as const;
  for (const day of CHANGELOG) {
    const ranks = day.items.map((i) => order[i.kind]);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), `${day.date}: group entries as added, changed, removed`);
  }
});

test('each language becomes an i18next bundle with a text for every entry', () => {
  const langs = Object.keys(CHANGELOG_LANGS) as ChangelogLang[];
  assert.deepEqual(langs.sort(), ['en', 'zh-TW'], 'the i18n languages are zh-TW and en (src/i18n.ts)');
  for (const lang of langs) {
    const bundle = changelogBundle(lang);
    for (const day of CHANGELOG) {
      day.items.forEach((item, i) => {
        // The modal looks an entry up as `<date>.<index>`, which i18next splits on the dot.
        const [date, index] = changeKey(day.date, i).split('.');
        assert.equal(bundle[date]?.[index], item[CHANGELOG_LANGS[lang]], `${lang}: ${day.date} #${i} is not in the bundle`);
      });
      assert.equal(Object.keys(bundle[day.date]).length, day.items.length, `${lang}: ${day.date} has stray keys`);
    }
    assert.equal(Object.keys(bundle).length, CHANGELOG.length, `${lang}: the bundle has stray days`);
  }
});
