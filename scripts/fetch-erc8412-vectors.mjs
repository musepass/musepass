#!/usr/bin/env node
/**
 * Vendor the ERC-8412 conformance vectors, pinned to one commit.
 *
 * The draft is an open PR, so the encoding can still change under us. Pinning
 * the commit is the difference between "we implemented a draft" and "we
 * implemented the draft as of this exact revision". Everything downloaded is
 * CC0, like the specification.
 *
 *   node scripts/fetch-erc8412-vectors.mjs [--commit <sha>]
 *
 * Writes:
 *   packages/verify/test/fixtures/erc8412/*.json   the 23 off-chain vectors
 *   packages/verify/test/fixtures/erc8412/manifest.json
 *   docs/reference/erc-8412-<short sha>.md         the specification itself
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

/** Current head of ethereum/ERCs#2002 when this was written (2026-09-29). */
const COMMIT = process.argv.includes('--commit')
  ? process.argv[process.argv.indexOf('--commit') + 1]
  : 'ff9fbc7e2de497d3dec2595a90b262aecd576f5d';

const RAW = `https://raw.githubusercontent.com/ethereum/ERCs/${COMMIT}`;
const FIXTURES = resolve(repoRoot, 'packages/verify/test/fixtures/erc8412');
const REFERENCE = resolve(repoRoot, `docs/reference/erc-8412-${COMMIT.slice(0, 7)}.md`);

async function get(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.text();
}

const listing = await (
  await fetch(`https://api.github.com/repos/ethereum/ERCs/contents/assets/erc-8412/vectors/offchain?ref=${COMMIT}`)
).json();
if (!Array.isArray(listing)) throw new Error(`could not list the vectors: ${JSON.stringify(listing)}`);

const names = listing.filter((entry) => entry.name.endsWith('.json')).map((entry) => entry.name).sort();
mkdirSync(FIXTURES, { recursive: true });

const files = {};
for (const name of names) {
  const text = await get(`${RAW}/assets/erc-8412/vectors/offchain/${name}`);
  // Parse before writing: a truncated download must not become a fixture.
  const parsed = JSON.parse(text);
  writeFileSync(resolve(FIXTURES, name), `${JSON.stringify(parsed, null, 2)}\n`);
  files[name] = createHash('sha256').update(text).digest('hex');
  console.log(`${name}  ${parsed.name}  expect.valid=${parsed.expect?.valid}`);
}

const spec = await get(`${RAW}/ERCS/erc-8412.md`);
mkdirSync(dirname(REFERENCE), { recursive: true });
writeFileSync(REFERENCE, spec);

writeFileSync(
  resolve(FIXTURES, 'manifest.json'),
  `${JSON.stringify(
    {
      source: 'ethereum/ERCs#2002 assets/erc-8412/vectors/offchain',
      commit: COMMIT,
      licence: 'CC0',
      spec: `docs/reference/erc-8412-${COMMIT.slice(0, 7)}.md`,
      fetchedAt: new Date().toISOString(),
      count: names.length,
      files,
    },
    null,
    2,
  )}\n`,
);

console.log(`\n${names.length} vectors + the specification written from ${COMMIT}`);
console.log(`fixtures  ${FIXTURES}`);
console.log(`spec      ${REFERENCE}`);
