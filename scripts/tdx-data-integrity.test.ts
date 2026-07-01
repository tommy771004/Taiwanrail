import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

async function loadIntegrityModule() {
  try {
    return await import('./tdx-data-integrity.js');
  } catch {
    return null;
  }
}

test('rejects a truncated JSON download', async () => {
  const integrity = await loadIntegrityModule();
  assert.ok(integrity, 'TDX data integrity module must exist');

  assert.throws(
    () => integrity.validateJsonPayload(Buffer.from('{"TrainTimetables":[{"TrainInfo":')),
    /invalid JSON/i,
  );
});

test('does not replace a valid file with an invalid download', async () => {
  const integrity = await loadIntegrityModule();
  assert.ok(integrity, 'TDX data integrity module must exist');

  const filePath = join(tmpdir(), `tdx-integrity-${process.pid}-${Date.now()}.json`);
  const original = '{"TrainTimetables":[{"TrainInfo":{"TrainNo":"1"}}]}';
  await writeFile(filePath, original);

  await assert.rejects(
    integrity.writeValidatedJsonAtomically(
      filePath,
      Buffer.from('{"TrainTimetables":[{"TrainInfo":'),
    ),
    /invalid JSON/i,
  );

  assert.equal(await readFile(filePath, 'utf8'), original);
});

test('atomically replaces a file after validating the complete download', async () => {
  const integrity = await loadIntegrityModule();
  assert.ok(integrity, 'TDX data integrity module must exist');

  const filePath = join(tmpdir(), `tdx-integrity-${process.pid}-${Date.now()}-valid.json`);
  const replacement = '{"TrainTimetables":[{"TrainInfo":{"TrainNo":"2"}}]}';
  await writeFile(filePath, '{"old":true}');

  await integrity.writeValidatedJsonAtomically(filePath, Buffer.from(replacement));

  assert.equal(await readFile(filePath, 'utf8'), replacement);
});
