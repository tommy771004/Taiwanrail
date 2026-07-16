import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const execFileAsync = promisify(execFile);

test('Vercel proxy emitted as native ESM resolves the shared gateway imports', async () => {
  const outputDirectory = await mkdtemp(
    join(process.cwd(), '.vercel-esm-import-'),
  );

  try {
    await build({
      absWorkingDir: process.cwd(),
      entryPoints: [
        'api/proxy.ts',
        'src/lib/tdxFetchTransport.ts',
        'src/lib/tdxGateway.ts',
        'src/lib/tdxProxyAccessPolicy.ts',
        'src/lib/tdxProxyHttp.ts',
        'src/lib/apiAbuseThrottlePolicy.ts',
        'src/lib/apiAbuseThrottleStore.ts',
        'src/lib/queryThrottlePolicy.ts',
      ],

      outbase: '.',
      outdir: outputDirectory,
      platform: 'node',
      format: 'esm',
      bundle: false,
    });

    const emittedProxy = pathToFileURL(
      join(outputDirectory, 'api/proxy.js'),
    ).href;
    const { stdout } = await execFileAsync(process.execPath, [
      '-e',
      `import(${JSON.stringify(emittedProxy)}).then(() => console.log('VERCEL_ESM_IMPORT_OK'))`,
    ]);

    assert.match(stdout, /VERCEL_ESM_IMPORT_OK/);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
