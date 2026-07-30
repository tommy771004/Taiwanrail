/**
 * scripts/affiliates.test.ts
 * 釘住聯盟／合作推廣資料契約的行為 — docs/affiliate-integration-spec.md
 *
 *   npm run test:affiliates
 *
 * 這裡測的是 src/lib/affiliates.ts 的純邏輯：單筆驗證（§8 / §6.4）、
 * `{crop}` 套版（§4.1）、內容版位與跑馬燈的挑選排序（§4.2 / §4.3）。
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  AFFILIATE_LINK_REL,
  affiliateDisclosureLabel,
  affiliateDisplayName,
  isAllowedAffiliateUrl,
  parseAffiliateOffer,
  parseAffiliateOffers,
  renderAffiliateText,
  renderAffiliateUrl,
  selectContextOffers,
  selectMarqueeOffers,
  type AffiliateOffer,
} from '../src/lib/affiliates.ts';

/** §6.2 的查詢結果形狀（camelCase 別名）。 */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    projectName: 'taiwanrail',
    id: 'demo-offer',
    enabled: true,
    sponsored: false,
    title: '示範檔位',
    description: '示範描述',
    ctaLabel: '前往',
    url: 'https://example.com/offer',
    icon: 'hotel',
    categories: ['all'],
    crops: null,
    priority: 0,
    partner: '示範夥伴',
    ...overrides,
  };
}

function offer(overrides: Partial<AffiliateOffer> = {}): AffiliateOffer {
  const parsed = parseAffiliateOffer(row());
  assert.ok(parsed, 'base row must parse');
  return { ...parsed, ...overrides };
}

test('a valid row parses into the §6.3 response shape', () => {
  const parsed = parseAffiliateOffer(row({ priority: '7', sponsored: true }));
  assert.deepEqual(parsed, {
    projectName: 'taiwanrail',
    id: 'demo-offer',
    enabled: true,
    sponsored: true,
    title: '示範檔位',
    description: '示範描述',
    ctaLabel: '前往',
    url: 'https://example.com/offer',
    icon: 'hotel',
    categories: ['all'],
    crops: [],
    priority: 7,
    partner: '示範夥伴',
  });
});

test('Postgres TEXT[] literals are accepted as well as JS arrays', () => {
  const parsed = parseAffiliateOffer(row({ categories: '{train,hsr}', crops: '{花蓮,"台東"}' }));
  assert.deepEqual(parsed?.categories, ['train', 'hsr']);
  assert.deepEqual(parsed?.crops, ['花蓮', '台東']);
});

test('§8: only http/https URLs are allowed', () => {
  assert.equal(isAllowedAffiliateUrl('https://example.com'), true);
  assert.equal(isAllowedAffiliateUrl('http://example.com'), true);
  // `{crop}` 樣板不影響協定檢查。
  assert.equal(isAllowedAffiliateUrl('https://example.com/s?q={crop}'), true);
  for (const bad of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    '/relative/path',
    '',
  ]) {
    assert.equal(isAllowedAffiliateUrl(bad), false, `${bad} must be rejected`);
  }
  assert.equal(parseAffiliateOffer(row({ url: 'javascript:alert(1)' })), null);
});

test('§6.4: a malformed row is dropped, the rest still return', () => {
  const rows = [
    row({ id: 'ok-1' }),
    row({ id: 'has space' }), // §8: id 不含空白
    row({ id: 'html-title', title: '<b>粗體</b>' }), // §8: 不可放 HTML
    row({ id: 'no-desc', description: '' }),
    row({ id: 'bad-cat', categories: ['vegetable'] }), // 非本專案字彙 → 無合法值
    row({ id: 'disabled', enabled: false }),
    row({ id: 'no-project', projectName: '' }),
    row({ id: 'ok-2' }),
    'not-an-object',
    null,
  ];
  assert.deepEqual(
    parseAffiliateOffers(rows).map((o) => o.id),
    ['ok-1', 'ok-2'],
  );
});

test('unknown extra categories are kept as long as one value is recognised', () => {
  const parsed = parseAffiliateOffer(row({ categories: ['train', 'seasonal-promo'] }));
  assert.deepEqual(parsed?.categories, ['train', 'seasonal-promo']);
});

test('duplicate (project_name, id) rows collapse to the first', () => {
  const rows = [row({ id: 'dup', title: '第一筆' }), row({ id: 'dup', title: '第二筆' })];
  const parsed = parseAffiliateOffers(rows);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, '第一筆');
});

test('§4.1: {crop} is substituted verbatim in text and URL-encoded in urls', () => {
  assert.equal(renderAffiliateText('想吃{crop}料理', '高麗菜'), '想吃高麗菜料理');
  assert.equal(
    renderAffiliateUrl('https://example.com/search?q={crop}', '高麗菜'),
    'https://example.com/search?q=%E9%AB%98%E9%BA%97%E8%8F%9C',
  );
  // 沒有關鍵字時樣板被清成空字串，不會留下 "{crop}" 字面值。
  assert.equal(renderAffiliateText('{crop}住宿', null), '住宿');
  assert.equal(renderAffiliateUrl('https://example.com/?q={crop}', null), 'https://example.com/?q=');
});

test('§4.2: category filtering keeps `all` and the exact category only', () => {
  const offers = [
    offer({ id: 'a-all', categories: ['all'] }),
    offer({ id: 'b-train', categories: ['train'] }),
    offer({ id: 'c-metro', categories: ['metro'] }),
  ];
  assert.deepEqual(
    selectContextOffers(offers, { category: 'train' }).map((o) => o.id),
    ['a-all', 'b-train'],
  );
});

test('§4.2: crops-targeted offers need a keyword hit unless the category is explicit', () => {
  const offers = [
    // 只掛 all + crops：關鍵字沒命中就不該亂入。
    offer({ id: 'crop-only', categories: ['all'], crops: ['花蓮'] }),
    // 明確列出類別：即使關鍵字沒命中也可顯示。
    offer({ id: 'crop-and-cat', categories: ['train'], crops: ['台東'] }),
  ];
  assert.deepEqual(
    selectContextOffers(offers, { category: 'train', keyword: '台北' }).map((o) => o.id),
    ['crop-and-cat'],
  );
  assert.deepEqual(
    selectContextOffers(offers, { category: 'train', keyword: '花蓮' }).map((o) => o.id),
    ['crop-only', 'crop-and-cat'],
  );
});

test('§4.2: crops fragments match by containment, case-insensitively', () => {
  const offers = [offer({ id: 'hual', categories: ['all'], crops: ['hualien'] })];
  assert.equal(selectContextOffers(offers, { category: 'train', keyword: 'Hualien Station' }).length, 1);
  assert.equal(selectContextOffers(offers, { category: 'train', keyword: 'Taipei' }).length, 0);
});

test('§4.2: sort order is crops hit → priority DESC → id ASC', () => {
  const offers = [
    offer({ id: 'z-low', categories: ['all'], priority: 1 }),
    offer({ id: 'a-low', categories: ['all'], priority: 1 }),
    offer({ id: 'high', categories: ['all'], priority: 9 }),
    offer({ id: 'hit', categories: ['all'], crops: ['花蓮'], priority: 0 }),
  ];
  assert.deepEqual(
    selectContextOffers(offers, { category: 'train', keyword: '花蓮' }).map((o) => o.id),
    ['hit', 'high', 'a-low', 'z-low'],
  );
});

test('§4.2: limit caps the result count', () => {
  const offers = [
    offer({ id: 'a', categories: ['all'], priority: 3 }),
    offer({ id: 'b', categories: ['all'], priority: 2 }),
    offer({ id: 'c', categories: ['all'], priority: 1 }),
  ];
  assert.deepEqual(
    selectContextOffers(offers, { category: 'train', limit: 2 }).map((o) => o.id),
    ['a', 'b'],
  );
});

test('§4.3: the marquee ignores categories and sorts by priority DESC, id ASC', () => {
  const offers = [
    offer({ id: 'b-mid', categories: ['metro'], priority: 5 }),
    offer({ id: 'a-mid', categories: ['planner'], priority: 5 }),
    offer({ id: 'top', categories: ['train'], crops: ['花蓮'], priority: 8 }),
  ];
  assert.deepEqual(
    selectMarqueeOffers(offers).map((o) => o.id),
    ['top', 'a-mid', 'b-mid'],
  );
});

test('§4.3: the marquee has no crop context, so {crop} templates render empty', () => {
  const offers = [offer({ id: 'tpl', categories: ['all'], title: '{crop}住宿', url: 'https://e.com/?q={crop}' })];
  const [rendered] = selectMarqueeOffers(offers);
  assert.equal(rendered.title, '住宿');
  assert.equal(rendered.url, 'https://e.com/?q=');
});

test('rendered offers keep the raw record so tracking uses the stable id', () => {
  const source = offer({ id: 'stable-id', categories: ['all'], title: '想去{crop}' });
  const [rendered] = selectContextOffers([source], { category: 'train', keyword: '花蓮' });
  assert.equal(rendered.title, '想去花蓮');
  assert.equal(rendered.raw.title, '想去{crop}');
  assert.equal(rendered.raw.id, 'stable-id');
});

test('§4.3: display name falls back from partner to title', () => {
  assert.equal(affiliateDisplayName(offer({ partner: 'KKday', title: '旅遊體驗' })), 'KKday');
  assert.equal(affiliateDisplayName(offer({ partner: null, title: '旅遊體驗' })), '旅遊體驗');
});

test('§3.1: sponsored drives the 贊助 / 合作推薦 disclosure', () => {
  assert.equal(affiliateDisclosureLabel(offer({ sponsored: true }), true), '贊助');
  assert.equal(affiliateDisclosureLabel(offer({ sponsored: false }), true), '合作推薦');
  assert.equal(affiliateDisclosureLabel(offer({ sponsored: true }), false), 'Sponsored');
  assert.equal(affiliateDisclosureLabel(offer({ sponsored: false }), false), 'Partner');
});

test('§8: outbound links carry sponsored, nofollow and noopener', () => {
  for (const token of ['sponsored', 'nofollow', 'noopener', 'noreferrer']) {
    assert.match(AFFILIATE_LINK_REL, new RegExp(`\\b${token}\\b`));
  }
});

// ── SQL 契約：schema、Vercel Function 與 dev middleware 三處欄位必須一致 ─────
// 沒有本機 PostgreSQL 也能擋住最現實的失誤：改了 schema 卻漏改查詢（或反之）。

const root = process.cwd();

/** 從 db/affiliates.sql 的 CREATE TABLE 取出欄位名稱。 */
function schemaColumns(sql: string): Set<string> {
  const body = sql.match(/CREATE TABLE IF NOT EXISTS affiliates \(([\s\S]*?)\n\);/);
  assert.ok(body, 'db/affiliates.sql must declare the affiliates table');
  const columns = new Set<string>();
  for (const line of body[1].split('\n')) {
    const m = line.match(/^\s+([a-z_]+)\s+(TEXT|BOOLEAN|INTEGER|TIMESTAMPTZ)\b/);
    if (m) columns.add(m[1]);
  }
  return columns;
}

/** 從 `SELECT … FROM affiliates` 取出被讀取的來源欄位（去掉 AS 別名）。 */
function selectedColumns(source: string): Set<string> {
  const block = source.match(/SELECT([\s\S]*?)FROM affiliates/);
  assert.ok(block, 'the query must select FROM affiliates');
  const withoutAliases = block[1].replace(/AS\s+"[^"]+"/g, '');
  const keywords = new Set(['select', 'from', 'as']);
  const columns = new Set<string>();
  for (const token of withoutAliases.match(/[a-z_]{2,}/g) ?? []) {
    if (!keywords.has(token)) columns.add(token);
  }
  return columns;
}

test('the API and the dev middleware read exactly the columns db/affiliates.sql declares', async () => {
  const [schemaSql, apiSource, viteSource] = await Promise.all([
    readFile(join(root, 'db/affiliates.sql'), 'utf8'),
    readFile(join(root, 'api/affiliates.ts'), 'utf8'),
    readFile(join(root, 'vite.config.ts'), 'utf8'),
  ]);

  const columns = schemaColumns(schemaSql);
  // 規格 §3 的完整欄位表。
  assert.deepEqual(
    [...columns].sort(),
    [
      'categories', 'created_at', 'crops', 'cta_label', 'description', 'enabled',
      'icon', 'id', 'partner', 'priority', 'project_name', 'sponsored', 'title',
      'updated_at', 'url',
    ],
  );

  const apiColumns = selectedColumns(apiSource);
  const devColumns = selectedColumns(viteSource);

  // 兩處必須讀同一組欄位（api/proxy.ts 與 server.ts 也有同樣的同步要求）。
  assert.deepEqual([...apiColumns].sort(), [...devColumns].sort());

  for (const column of apiColumns) {
    assert.ok(columns.has(column), `selected column "${column}" is not in db/affiliates.sql`);
  }

  // §6.2 回傳的 13 個欄位；created_at / updated_at 不對外曝光。
  assert.equal(apiColumns.has('created_at'), false);
  assert.equal(apiColumns.has('updated_at'), false);
  assert.equal(apiColumns.size, 13);
});

test('the seed INSERT only writes columns db/affiliates.sql declares', async () => {
  const schemaSql = await readFile(join(root, 'db/affiliates.sql'), 'utf8');
  const columns = schemaColumns(schemaSql);

  const insert = schemaSql.match(/INSERT INTO affiliates \(([\s\S]*?)\)\s*\nVALUES/);
  assert.ok(insert, 'db/affiliates.sql must seed this project with an INSERT');
  for (const column of insert[1].split(',').map((c) => c.trim()).filter(Boolean)) {
    assert.ok(columns.has(column), `seeded column "${column}" is not in the schema`);
  }
});

test('§6.2: both queries scope to project_name + enabled and sort deterministically', async () => {
  const [apiSource, viteSource] = await Promise.all([
    readFile(join(root, 'api/affiliates.ts'), 'utf8'),
    readFile(join(root, 'vite.config.ts'), 'utf8'),
  ]);

  for (const [name, source] of [['api/affiliates.ts', apiSource], ['vite.config.ts', viteSource]] as const) {
    // 分區條件不可省略，否則會讀到其他專案的資料（§3.2）。
    assert.match(source, /WHERE project_name = \$\{projectName\}/, `${name} must filter by project_name`);
    assert.match(source, /AND enabled = TRUE/, `${name} must filter enabled rows`);
    assert.match(source, /ORDER BY priority DESC, id ASC/, `${name} must use the §6.2 sort`);
    // 專案名稱一律走參數化，不做字串拼接。
    assert.doesNotMatch(source, /project_name = '/, `${name} must not inline project_name`);
  }
});

test('the event Function writes to the table db/rail_audit_log.sql declares', async () => {
  const [schemaSql, apiSource] = await Promise.all([
    readFile(join(root, 'db/rail_audit_log.sql'), 'utf8'),
    readFile(join(root, 'api/affiliate-event.ts'), 'utf8'),
  ]);

  const created = schemaSql.match(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/);
  assert.ok(created, 'db/rail_audit_log.sql must declare the audit table');
  const [, tableName, tableBody] = created;

  // Unquoted identifiers fold to lower case in Postgres, so the INSERT only has
  // to agree case-insensitively — but it must name the same table.
  const inserted = apiSource.match(/INSERT INTO (\w+) \(([^)]*)\)/);
  assert.ok(inserted, 'api/affiliate-event.ts must INSERT into the audit table');
  assert.equal(inserted[1].toLowerCase(), tableName.toLowerCase());

  // A quoted mixed-case reference would not resolve to the folded table name.
  assert.doesNotMatch(apiSource, /INSERT INTO "/);
  assert.doesNotMatch(schemaSql, /CREATE TABLE IF NOT EXISTS "/);

  const columns = new Set(
    [...tableBody.matchAll(/^\s+(\w+)\s+(BIGSERIAL|TEXT|JSONB|VARCHAR|TIMESTAMPTZ)\b/gm)].map((m) => m[1]),
  );
  for (const column of inserted[2].split(',').map((c) => c.trim()).filter(Boolean)) {
    assert.ok(columns.has(column), `inserted column "${column}" is not in the schema`);
  }
});

test('the seed data passes the same validation the API applies', async () => {
  const schemaSql = await readFile(join(root, 'db/affiliates.sql'), 'utf8');

  // 從 VALUES 區塊抽出每筆 seed 的 id 與 url，確認 §8 的基本規則。
  const ids = [...schemaSql.matchAll(/^\s+\('taiwanrail', '([a-z0-9-]+)'/gm)].map((m) => m[1]);
  assert.ok(ids.length > 0, 'expected taiwanrail seed rows');
  assert.equal(new Set(ids).size, ids.length, 'seed ids must be unique within the project');
  for (const id of ids) {
    assert.doesNotMatch(id, /\s/, `seed id "${id}" must not contain whitespace`);
  }

  const urls = [...schemaSql.matchAll(/^\s+'(https?:\/\/[^']+)',$/gm)].map((m) => m[1]);
  assert.equal(urls.length, ids.length, 'every seed row needs exactly one http(s) URL');
  for (const url of urls) {
    assert.equal(isAllowedAffiliateUrl(url), true, `seed url "${url}" must be http(s)`);
  }
});

test('draft rows with a placeholder URL cannot be enabled = TRUE', async () => {
  const schemaSql = await readFile(join(root, 'db/affiliates.sql'), 'utf8');

  const ids = [...schemaSql.matchAll(/^\s+\('taiwanrail', '([a-z0-9-]+)'/gm)].map((m) => m[1]);
  assert.ok(ids.length > 0, 'expected taiwanrail seed rows');

  // 每筆 seed 都以 `now())` 收尾（updated_at 欄位），且該字串在整筆資料裡只會出現一次，
  // 用它當右邊界就能把單筆的 (…) 區塊完整切出來，不會吃到下一筆。
  for (const id of ids) {
    const row = schemaSql.match(
      new RegExp(`\\('taiwanrail', '${id}',\\s*(TRUE|FALSE),[\\s\\S]*?now\\(\\)\\)`),
    );
    assert.ok(row, `could not isolate the seed row for "${id}"`);
    const [block, enabledLiteral] = row;
    const isPlaceholder = block.includes('REPLACE-WITH-AFFILIATE-LINK.example.com');

    // 避免有人補完真實聯盟連結後忘記把 FALSE 改回 TRUE，或者反過來在沒有真連結時誤開啟。
    if (isPlaceholder) {
      assert.equal(
        enabledLiteral,
        'FALSE',
        `seed "${id}" still has a placeholder URL and must stay enabled = FALSE`,
      );
    } else {
      assert.doesNotMatch(
        block,
        /example\.com/,
        `seed "${id}" is enabled but its URL looks like a placeholder`,
      );
    }
  }
});
