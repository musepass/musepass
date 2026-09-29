#!/usr/bin/env node
/**
 * What is inside the repository that should not be.
 *
 *   node scripts/hygiene-scan.mjs              # tracked + untracked-but-not-ignored
 *   node scripts/hygiene-scan.mjs --history    # every blob in git history as well
 *   node scripts/hygiene-scan.mjs --json
 *
 * Two questions, both from the 2026-09-29 review of the project:
 *
 *   1. Does a machine-local detail (internal IP, hostname, an operator's home
 *      directory) appear in something we ship?
 *   2. Did one of the keys we keep locally end up pasted into a tracked file?
 *
 * The answer to (2) is computed by reading the files we keep secrets in, then
 * looking for those exact strings in everything else. A value that appears in
 * both places is a leak by definition: git already published it.
 *
 * Fixtures are exempt by path (any directory named `test`), which is why the
 * rate-limit test can keep using a private address on purpose. Everything else
 * exits 1.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractSecretCandidates, scanForLeaks, violationsOnly } from '../packages/core/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const asJson = process.argv.includes('--json');
const withHistory = process.argv.includes('--history');

const SKIP_BINARY = /\.(png|jpe?g|gif|webp|zip|gz|woff2?|ttf|otf|pdf|mp4|mov|wasm|so|dylib)$/i;

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, maxBuffer: 512 * 1024 * 1024 });
}

function listFiles() {
  const tracked = git(['ls-files', '-z']).toString('utf8').split('\0').filter(Boolean);
  const untracked = git(['ls-files', '-z', '--others', '--exclude-standard'])
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  return [...new Set([...tracked, ...untracked])].sort();
}

function readIfText(relativePath) {
  const absolute = resolve(repoRoot, relativePath);
  let stats;
  try {
    stats = statSync(absolute);
  } catch {
    return null;
  }
  if (!stats.isFile() || stats.size > 4 * 1024 * 1024) return null;
  const buffer = readFileSync(absolute);
  if (buffer.includes(0)) return null;
  return buffer.toString('utf8');
}

/** Files we keep secrets in. They are never scanned as targets, only as sources. */
function secretSources() {
  const sources = [];
  const push = (relativePath) => {
    const text = readIfText(relativePath);
    if (text) sources.push(text);
  };
  for (const root of ['.secrets', 'contracts/.sepolia-keys']) {
    const absolute = resolve(repoRoot, root);
    if (!existsSync(absolute)) continue;
    const stats = statSync(absolute);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(absolute)) push(join(root, entry));
    } else {
      push(root);
    }
  }
  for (const entry of readdirSync(repoRoot)) {
    if (/^\.env(\..+)?$/.test(entry) && !entry.endsWith('.example')) push(entry);
  }
  return sources;
}

/**
 * Runtime droppings are git-ignored but still sit on the disk, and the review
 * asked for them to be out of anything that leaves the machine. Listing them
 * here keeps the exclusion in `package-review.mjs` from silently regressing.
 */
function runtimeResidue() {
  return ['log', 'pid'].flatMap((extension) =>
    readdirSync(repoRoot)
      .filter((entry) => entry.endsWith(`.${extension}`))
      .map((entry) => ({ file: entry, bytes: statSync(resolve(repoRoot, entry)).size })),
  );
}

const secrets = extractSecretCandidates(secretSources());
const files = listFiles();

const leaks = [];
for (const file of files) {
  if (SKIP_BINARY.test(file)) continue;
  const text = readIfText(file);
  if (text === null) continue;
  leaks.push(...scanForLeaks(file, text, secrets));
}

const violations = violationsOnly(leaks);
const benign = leaks.filter((leak) => leak.benign);

let history;
if (withHistory) {
  history = { secrets: [], network: [], commits: 0 };
  const log = git(['log', '--all', '--no-color', '--format=commit %H', '-p']).toString('utf8');
  let current = '';
  for (const line of log.split('\n')) {
    if (line.startsWith('commit ')) {
      current = line.slice(7, 19);
      history.commits += 1;
      continue;
    }
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')) continue;
    if (!line.startsWith('+')) continue;
    const text = line.slice(1);
    for (const secret of secrets) {
      if (text.includes(secret)) history.secrets.push({ commit: current, value: `${secret.slice(0, 6)}…` });
    }
    for (const leak of scanForLeaks('history', text, [])) {
      history.network.push({ commit: current, kind: leak.kind, value: leak.value });
    }
  }
}

const residue = runtimeResidue();

if (asJson) {
  console.log(
    JSON.stringify(
      {
        scanned: files.length,
        secretCandidates: secrets.length,
        violations,
        benign,
        runtimeResidue: residue,
        history,
      },
      null,
      2,
    ),
  );
} else {
  console.log('hygiene scan');
  console.log(`  files: ${files.length} tracked/untracked · secret candidates read: ${secrets.length}`);
  console.log('');

  if (violations.length > 0) {
    console.log(`violations — ${violations.length}:`);
    for (const leak of violations) {
      console.log(`  ${leak.file}:${leak.line}:${leak.column}  ${leak.kind}  ${leak.value}`);
      console.log(`    ${leak.text.slice(0, 140)}`);
    }
    console.log('');
  } else {
    console.log('violations — none: no private address, hostname, home path or key in a shipped file');
  }

  if (benign.length > 0) {
    console.log('');
    console.log(`fixtures (reported, not failures) — ${benign.length}:`);
    for (const leak of benign.slice(0, 10)) {
      console.log(`  ${leak.file}:${leak.line}  ${leak.kind}  ${leak.value}`);
    }
  }

  if (residue.length > 0) {
    console.log('');
    console.log(`runtime files on disk (git-ignored, must stay out of packages) — ${residue.length}:`);
    for (const file of residue) console.log(`  ${file.file}  ${file.bytes} bytes`);
  }

  if (history) {
    console.log('');
    console.log(`history — ${history.commits} commit(s):`);
    console.log(`  secrets in a diff: ${history.secrets.length}`);
    console.log(`  private addresses in a diff: ${history.network.length}`);
    for (const hit of [...history.secrets, ...history.network].slice(0, 20)) {
      console.log(`  ${hit.commit}  ${hit.kind ?? 'secret'}  ${hit.value}`);
    }
  }

  console.log('');
  const failed = violations.length > 0 || (history?.secrets.length ?? 0) > 0;
  console.log(failed ? 'FAIL — something that should not ship is in the tree' : 'ok');
}

process.exit(violations.length > 0 || (history?.secrets.length ?? 0) > 0 ? 1 : 0);
