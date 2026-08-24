// Inventory of executable inline <script> bodies across every HTML document we ship,
// and their CSP source-expression hashes.
//
// Why hashes and not a nonce: a nonce has to be regenerated per response, and these
// pages are static files served straight off Vercel's CDN with headers declared in
// vercel.json — there is no per-request render step to mint one. Hashes are the
// correct static equivalent, and they let script-src drop 'unsafe-inline', which
// otherwise defeats most of what the CSP is for.
//
// Only executable scripts are hashed. A <script type="application/ld+json"> block is
// a data block: the HTML spec never executes it, so CSP's script-src does not apply
// and the JSON-LD on the route pages needs no hash.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const EXECUTABLE_TYPES = new Set([
  '',
  'text/javascript',
  'application/javascript',
  'module',
]);

/** Bodies of inline (src-less) executable <script> elements, in document order. */
export function extractInlineScripts(html) {
  const bodies = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    if (/\ssrc\s*=/i.test(attrs)) continue; // external: covered by the host allowlist
    const type = (attrs.match(/\stype\s*=\s*["']([^"']*)["']/i)?.[1] ?? '')
      .trim()
      .toLowerCase();
    if (!EXECUTABLE_TYPES.has(type)) continue; // data block, not script-src's business
    bodies.push(m[2]);
  }
  return bodies;
}

export function hashInlineScript(body) {
  return `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`;
}

async function* htmlFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(full);
    else if (entry.name.endsWith('.html')) yield full;
  }
}

/**
 * @returns {Promise<Map<string, string[]>>} hash → the files that need it
 */
export async function collectInlineScriptHashes(root = process.cwd()) {
  const found = new Map();
  const record = (hash, file) => {
    const files = found.get(hash) ?? [];
    files.push(relative(root, file));
    found.set(hash, files);
  };

  const sources = [join(root, 'index.html')];
  for await (const file of htmlFiles(join(root, 'public'))) sources.push(file);
  // dist/ only exists after a build; include it when present so we verify what ships.
  for await (const file of htmlFiles(join(root, 'dist'))) sources.push(file);

  for (const file of sources) {
    let html;
    try {
      html = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    for (const body of extractInlineScripts(html)) record(hashInlineScript(body), file);
  }
  return found;
}

// `node scripts/csp-inline-hashes.mjs` prints the script-src hash list to paste into
// vercel.json, with the files each hash comes from.
if (import.meta.url === `file://${process.argv[1]}`) {
  const found = await collectInlineScriptHashes();
  for (const [hash, files] of found) {
    console.log(`${hash}\n    ${files.length} file(s), e.g. ${files[0]}`);
  }
  console.log(`\nscript-src hashes: ${[...found.keys()].join(' ')}`);
}
