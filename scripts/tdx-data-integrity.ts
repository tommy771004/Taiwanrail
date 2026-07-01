import { rename, unlink, writeFile } from 'node:fs/promises';

export function validateJsonPayload(buffer: Buffer): unknown {
  let parsed: unknown;

  try {
    parsed = JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON download: ${message}`);
  }

  if (parsed === null || (typeof parsed !== 'object' && !Array.isArray(parsed))) {
    throw new Error('Invalid JSON download: expected an object or array root');
  }

  return parsed;
}

export async function writeValidatedJsonAtomically(filePath: string, buffer: Buffer): Promise<void> {
  validateJsonPayload(buffer);

  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporaryPath, buffer, { flag: 'wx' });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}
