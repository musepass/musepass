#!/usr/bin/env node
/**
 * Manage the invitation allowlist (D17).
 *
 *   node scripts/invite.mjs list
 *   node scripts/invite.mjs add --wallet 0xabc… [--x handle] [--label abcd] [--note "why"]
 *   node scripts/invite.mjs import --file ~/Downloads/invites.txt      # one per line
 *   node scripts/invite.mjs remove --wallet 0xabc…
 *   node scripts/invite.mjs check --wallet 0xabc…
 *
 * Add `--push` to any of these to copy config to the server and restart the units
 * that read it (`scripts/push-config.sh`), which is what makes an invitation live.
 *
 * The file format for `import`, one entry per line, `#` for comments:
 *
 *   0x022ce19a356bc18c1977f6816fdf05faf22985b7
 *   0x022ce19a356bc18c1977f6816fdf05faf22985b7  abcd      # suggested label, optional
 *   @musepass                                    # X handle instead of a wallet
 *
 * Why a script instead of hand-editing JSON: the list changes often, it is the
 * thing that decides who gets a short name for free, and a typo in a file nobody
 * validates is a person turned away at the door.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const file = resolve(repoRoot, 'config/invitations.json');

// A rule that refuses a label is normal operation, not a crash: print the
// sentence and stop. Without this the operator sees a stack trace where the
// message "one and two character names are held by the project" should be.
process.on('uncaughtException', (error) => {
  console.error(`error: ${error.message}`);
  process.exit(2);
});

const args = process.argv.slice(2);
const command = args[0] ?? 'list';
const has = (flag) => args.includes(flag);
const value = (flag, fallback = '') => {
  const index = args.indexOf(flag);
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
};

const isAddress = (text) => /^0x[0-9a-fA-F]{40}$/.test(text);
const normalizeWallet = (text) => text.trim().toLowerCase();
const normalizeHandle = (text) => text.trim().replace(/^@/, '').toLowerCase();

function load() {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function save(document, count) {
  writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`  ${count} invitation(s) in ${file}`);
  if (has('--push')) {
    console.log('  pushing config to the server');
    execFileSync(resolve(repoRoot, 'scripts/push-config.sh'), { stdio: 'inherit' });
  } else {
    console.log('  not pushed yet — add --push, or run pnpm push:config');
  }
}

/** Real entries only: the example row in the file is documentation. */
function entries(document) {
  return (document.invitations ?? []).filter((row) => !row.$example);
}

function upsert(document, next) {
  if (!next.wallet && !next.xHandle) throw new Error('an invitation needs a wallet or an X handle');
  if (next.label && next.label.length < 3) {
    throw new Error('D17: one and two character names are held by the project and are never invited');
  }
  const list = entries(document);
  const clash = list.find(
    (row) =>
      (row.wallet && next.wallet && row.wallet === next.wallet) ||
      (row.xHandle && next.xHandle && row.xHandle === next.xHandle),
  );
  const example = (document.invitations ?? []).filter((row) => row.$example);
  if (clash) {
    if (next.label && !clash.label) clash.label = next.label;
    document.invitations = [...example, ...list];
    return { row: clash, added: false };
  }
  document.invitations = [...example, ...list, next];
  return { row: next, added: true };
}

function makeRow({ wallet, xHandle, label, note }) {
  return {
    wallet: wallet ? normalizeWallet(wallet) : '',
    xHandle: xHandle ? normalizeHandle(xHandle) : '',
    label: (label ?? '').trim().toLowerCase(),
    issuedBy: 'project',
    issuedAt: new Date().toISOString().slice(0, 10),
    note: note ?? '',
    claimedAt: null,
    claimedLabel: null,
    txHash: null,
  };
}

const document = load();
const existing = entries(document);

if (command === 'list') {
  console.log(`campaign ${document.campaign ?? '(unnamed)'} · ${existing.length} invitation(s)`);
  for (const row of existing) {
    const who = row.wallet || `@${row.xHandle}`;
    const state = row.claimedAt ? `claimed ${row.claimedLabel ?? ''} ${row.txHash ?? ''}`.trim() : 'open';
    console.log(`  ${who.padEnd(44)} ${(row.label || '(their choice)').padEnd(12)} ${state}`);
  }
  process.exit(0);
}

if (command === 'check') {
  const wallet = normalizeWallet(value('--wallet'));
  const handle = normalizeHandle(value('--x', ''));
  const row = existing.find(
    (entry) =>
      (wallet && entry.wallet === wallet) || (handle && entry.xHandle === handle),
  );
  console.log(row ? `invited: ${JSON.stringify(row)}` : 'not on the list');
  process.exit(row ? 0 : 1);
}

if (command === 'add') {
  const wallet = value('--wallet');
  if (wallet && !isAddress(wallet)) throw new Error(`--wallet is not an address: ${wallet}`);
  const { row, added } = upsert(
    document,
    makeRow({
      wallet,
      xHandle: value('--x'),
      label: value('--label'),
      note: value('--note'),
    }),
  );
  console.log(`${added ? 'added' : 'already there'}: ${row.wallet || `@${row.xHandle}`}`);
  save(document, entries(document).length);
  process.exit(0);
}

if (command === 'import') {
  const source = value('--file');
  if (!source) throw new Error('import needs --file');
  const lines = readFileSync(resolve(source.replace(/^~/, process.env.HOME ?? '')), 'utf8')
    .split('\n')
    .map((line) => line.split('#')[0].trim())
    .filter(Boolean);

  let added = 0;
  let skipped = 0;
  for (const line of lines) {
    const [first, second] = line.split(/[\s,]+/).filter(Boolean);
    const wallet = isAddress(first) ? first : '';
    const handle = !wallet && first.startsWith('@') ? first : '';
    const label = second ?? '';
    if (!wallet && !handle) {
      console.log(`  skipped (not a wallet or @handle): ${line}`);
      skipped += 1;
      continue;
    }
    const { added: isNew } = upsert(document, makeRow({ wallet, xHandle: handle, label }));
    if (isNew) added += 1;
  }
  console.log(`imported ${added} new, ${lines.length - added} already present or skipped (${skipped} skipped)`);
  if (document.invitations) document.invitations = [...entries(document)];
  save(document, entries(document).length);
  process.exit(0);
}

if (command === 'remove') {
  const wallet = normalizeWallet(value('--wallet'));
  const handle = normalizeHandle(value('--x', ''));
  const kept = existing.filter(
    (row) => !((wallet && row.wallet === wallet) || (handle && row.xHandle === handle)),
  );
  const removed = existing.length - kept.length;
  document.invitations = kept;
  console.log(`removed ${removed}`);
  save(document, kept.length);
  process.exit(0);
}

console.error(`unknown command: ${command}`);
console.error('use: list | add | import | remove | check');
process.exit(2);
