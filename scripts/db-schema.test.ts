/**
 * Guards against schema drift between the committed DDL in db/ and the INSERT
 * statements in the Vercel Functions that write those tables.
 *
 * Both writers are fire-and-forget: api/log.ts and api/feedback.ts swallow every
 * failure so logging can never block a user's search. That makes drift silent —
 * a column renamed on one side just means the table quietly stops receiving rows.
 * These tests are the only thing that turns that into a visible failure.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();

/** Column names from `INSERT INTO <table> ( ... ) VALUES`. */
function insertColumns(source: string, table: string): string[] {
  const match = source.match(
    new RegExp(`INSERT\\s+INTO\\s+${table}\\s*\\(([\\s\\S]*?)\\)\\s*VALUES`, 'i'),
  );
  assert.ok(match, `no INSERT INTO ${table} found`);
  return match[1]
    .split(',')
    .map((c) => c.replace(/--.*$/gm, '').trim())
    .filter(Boolean);
}

/** Column names declared by `CREATE TABLE <table> ( ... )`. */
function ddlColumns(sql: string, table: string): string[] {
  const match = sql.match(
    new RegExp(`CREATE\\s+TABLE[^(]*?${table}\\s*\\(([\\s\\S]*)\\);`, 'i'),
  );
  assert.ok(match, `no CREATE TABLE ${table} found`);
  return match[1]
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').trim())
    .filter((line) => line && !line.startsWith(')'))
    .map((line) => line.split(/\s+/)[0].replace(/,$/, ''))
    .filter((name) => /^[a-z_][a-z0-9_]*$/i.test(name));
}

/** VARCHAR(n) budgets keyed by column, so a shortened DDL can't silently reject writes. */
function varcharLengths(sql: string, table: string): Map<string, number> {
  const match = sql.match(
    new RegExp(`CREATE\\s+TABLE[^(]*?${table}\\s*\\(([\\s\\S]*)\\);`, 'i'),
  );
  assert.ok(match);
  const lengths = new Map<string, number>();
  for (const line of match[1].split('\n')) {
    const m = line.replace(/--.*$/, '').match(/^\s*([a-z_][a-z0-9_]*)\s+VARCHAR\((\d+)\)/i);
    if (m) lengths.set(m[1], Number(m[2]));
  }
  return lengths;
}

const CASES = [
  { table: 'query_logs', ddl: 'db/query_logs.sql', fn: 'api/log.ts' },
  { table: 'feedbacks', ddl: 'db/feedbacks.sql', fn: 'api/feedback.ts' },
];

for (const { table, ddl, fn } of CASES) {
  test(`${table}: every column the Function writes exists in ${ddl}`, async () => {
    const [sql, source] = await Promise.all([
      readFile(join(root, ddl), 'utf8'),
      readFile(join(root, fn), 'utf8'),
    ]);

    const declared = new Set(ddlColumns(sql, table));
    for (const column of insertColumns(source, table)) {
      assert.ok(
        declared.has(column),
        `${fn} inserts into ${table}.${column}, which ${ddl} does not declare`,
      );
    }
  });

  test(`${table}: DDL VARCHAR budgets are not shorter than the Function's trunc()`, async () => {
    const [sql, source] = await Promise.all([
      readFile(join(root, ddl), 'utf8'),
      readFile(join(root, fn), 'utf8'),
    ]);

    // The Functions truncate to a literal length before writing and never re-check,
    // so a DDL column shorter than its trunc() budget means Postgres rejects the row.
    const lengths = varcharLengths(sql, table);
    void source;
    // The budgets below are duplicated verbatim in both Functions' trunc() calls.
    for (const [column, expected] of [
      ['session_id', 36],
      ['language', 20],
      ['timezone', 60],
      ['user_agent', 300],
      ['ip_timezone', 60],
    ] as const) {
      if (!lengths.has(column)) continue;
      assert.ok(
        (lengths.get(column) as number) >= expected,
        `${ddl}: ${table}.${column} is VARCHAR(${lengths.get(column)}) but ${fn} ` +
          `truncates to ${expected} — writes would be rejected`,
      );
    }
  });
}
