#!/usr/bin/env node
/**
 * The website must not contain Chinese characters.
 *
 * That is a product requirement, not a style preference, and a requirement that
 * lives only in someone's head gets broken the next time somebody adds a
 * sentence. So it is a build step: this walks the web app's own source and fails
 * if it finds a CJK character outside the allow list below.
 *
 * Checked: everything the site can render or send — pages, components, lib
 * helpers, route handlers, the plain-text /ask.txt, and the JSON the site serves.
 * Not checked: generated build output, and the API's own bilingual responses
 * (the API may answer in several languages; the page chooses which to show).
 *
 *   node scripts/check-web-english.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const WEB = resolve(repoRoot, 'apps/web');

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'coverage', '.turbo']);
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.css', '.json', '.txt']);

/**
 * CJK ideographs, kana, hangul, full-width forms and CJK punctuation. Em dashes
 * and ellipses are deliberately NOT in here: they are punctuation, not Chinese.
 */
const CJK =
  /[\u1100-\u11ff\u2e80-\u2fdf\u3000-\u303f\u3040-\u30ff\u3130-\u318f\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/;

/**
 * No exceptions. If something here genuinely needs Chinese — a test fixture for
 * a Chinese label, say — add it here with the reason, and expect the reviewer to
 * ask why it is not in a fixture file instead.
 */
const ALLOW = [];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.well-known') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...walk(path));
      continue;
    }
    const dot = entry.name.lastIndexOf('.');
    if (dot === -1 || !EXTENSIONS.has(entry.name.slice(dot))) continue;
    out.push(path);
  }
  return out;
}

const offenders = [];
let scanned = 0;

for (const file of walk(WEB)) {
  const repoPath = relative(repoRoot, file);
  if (ALLOW.some((allowed) => repoPath === allowed)) continue;
  const text = readFileSync(file, 'utf8');
  scanned += 1;
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (CJK.test(line)) offenders.push({ file: repoPath, line: index + 1, text: line.trim().slice(0, 120) });
  });
}

console.log('web English check');
console.log(`  scanned ${scanned} file(s) under apps/web`);

if (offenders.length === 0) {
  console.log('  no CJK characters found — the site is English-only');
  process.exit(0);
}

console.error(`\n${offenders.length} line(s) contain CJK characters:\n`);
for (const offender of offenders.slice(0, 80)) {
  console.error(`  ${offender.file}:${offender.line}  ${offender.text}`);
}
if (offenders.length > 80) console.error(`  …and ${offenders.length - 80} more`);
console.error('\nThe website must not contain Chinese. Translate these strings to English.');
process.exit(1);
