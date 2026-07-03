import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const distDir = resolve(process.cwd(), 'dist');
const indexPath = resolve(distDir, 'index.html');

if (!existsSync(indexPath)) {
  console.error('Bundle verification failed: dist/index.html is missing; run npm run build first.');
  process.exit(1);
}

const html = readFileSync(indexPath, 'utf8');
const entryMatch = html.match(/<script[^>]+src="\/assets\/([^"]+\.js)"/);
if (!entryMatch) {
  console.error('Bundle verification failed: could not find the JavaScript entry in dist/index.html.');
  process.exit(1);
}

const assetsDir = resolve(distDir, 'assets');
const jsFiles = readdirSync(assetsDir).filter((file) => file.endsWith('.js'));
const entryFile = resolve(assetsDir, basename(entryMatch[1]));
const entryBytes = statSync(entryFile).size;
const maxEntryBytes = 750_000;
const maxChunkBytes = 500_000;

const failures = [];
if (jsFiles.length < 3) {
  failures.push(`expected at least 3 JavaScript chunks, found ${jsFiles.length}`);
}
if (entryBytes > maxEntryBytes) {
  failures.push(`entry chunk is ${(entryBytes / 1000).toFixed(1)} kB; limit is ${(maxEntryBytes / 1000).toFixed(0)} kB`);
}
for (const file of jsFiles) {
  const bytes = statSync(resolve(assetsDir, file)).size;
  if (bytes > maxChunkBytes) {
    failures.push(`${file} is ${(bytes / 1000).toFixed(1)} kB; per-chunk limit is ${(maxChunkBytes / 1000).toFixed(0)} kB`);
  }
}

if (failures.length) {
  console.error('Bundle verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Bundle verification passed: ${jsFiles.length} JS chunks; entry ${(entryBytes / 1000).toFixed(1)} kB.`);
