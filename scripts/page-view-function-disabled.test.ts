import assert from 'node:assert/strict';
import test from 'node:test';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();

test('the client does not call the Page View Function', async () => {
  const sources = await Promise.all([
    readFile(join(root, 'src/App.tsx'), 'utf8'),
    readFile(join(root, 'src/lib/queryLogger.ts'), 'utf8'),
  ]);

  assert.doesNotMatch(sources.join('\n'), /logPageView|\/api\/log-pageview/);
});

test('Vercel does not deploy a Page View Function', async () => {
  await assert.rejects(access(join(root, 'api/log-pageview.ts')));

  const config = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8')) as {
    functions?: Record<string, unknown>;
  };
  assert.equal(config.functions?.['api/log-pageview.ts'], undefined);
});
