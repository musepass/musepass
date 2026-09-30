#!/usr/bin/env node
/**
 * Register the names the site shows as examples, for real.
 *
 * A demo name is not a fixture: it lives on chain, anyone can look it up, and
 * the site links to it. So each one gets its own owner wallet, kept in
 * .secrets/demo-owners.json so the names stay manageable instead of being
 * stranded behind a throwaway key nobody saved.
 *
 * Free names are limited per wallet, which is why one wallet per name.
 *
 *   node scripts/register-demo-names.mjs tom bruce
 *   node scripts/register-demo-names.mjs --base http://localhost:3001 tom
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { REGISTER_TYPES, buildEip712Domain, registerMessage } from '../packages/core/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const base = arg('base', 'https://musename.xyz');
const names = process.argv.slice(2).filter((value) => !value.startsWith('--') && !value.startsWith('http'));
if (names.length === 0) throw new Error('give at least one label, e.g. tom bruce');

const chains = JSON.parse(readFileSync(resolve(repoRoot, 'config/chains.json'), 'utf8'));
const brand = JSON.parse(readFileSync(resolve(repoRoot, 'config/brand.json'), 'utf8'));

const ownersPath = resolve(repoRoot, '.secrets/demo-owners.json');
mkdirSync(resolve(repoRoot, '.secrets'), { recursive: true });
const owners = existsSync(ownersPath) ? JSON.parse(readFileSync(ownersPath, 'utf8')) : {};
const results = [];

for (const label of names) {
  // One wallet per demo name, created once and reused on later runs.
  if (!owners[label]) {
    owners[label] = generatePrivateKey();
    writeFileSync(ownersPath, `${JSON.stringify(owners, null, 2)}\n`, { mode: 0o600 });
    console.log(`created a wallet for ${label}`);
  }
  const account = privateKeyToAccount(owners[label]);
  const deadline = Math.floor(Date.now() / 1000) + 900;
  const signature = await account.signTypedData({
    domain: buildEip712Domain({
      productName: brand.productName,
      chainId: chains.l2.chainId,
      verifyingContract: chains.l2.registrar,
    }),
    types: REGISTER_TYPES,
    primaryType: 'Register',
    message: registerMessage({ label, owner: account.address, deadline: BigInt(deadline) }),
  });

  const response = await fetch(`${base}/v1/names/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label, owner: account.address, deadline, signature }),
  });
  const body = await response.json().catch(() => ({}));
  const code = body?.errors?.[0]?.code ?? '';

  if (response.status >= 400 && code !== 'NAME_TAKEN') {
    console.log(`  ${label.padEnd(8)} HTTP ${response.status} ${code} ${body?.errors?.[0]?.message ?? ''}`);
    continue;
  }

  const entry = {
    label,
    fullName: `${label}.${brand.rootName}`,
    owner: account.address,
    txHash: body?.data?.txHash ?? null,
    alreadyRegistered: Boolean(body?.data?.alreadyRegistered),
  };
  results.push(entry);
  console.log(
    `  ${label.padEnd(8)} ${entry.alreadyRegistered ? 'already on chain' : `registered ${entry.txHash}`}`,
  );
}

const ledgerPath = resolve(repoRoot, 'deployments/demo-names.json');
const previous = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : [];
const merged = [...previous.filter((entry) => !results.some((next) => next.label === entry.label)), ...results];
writeFileSync(ledgerPath, `${JSON.stringify(merged, null, 2)}\n`);
console.log(`\nledger ${ledgerPath.replace(`${repoRoot}/`, '')}`);
