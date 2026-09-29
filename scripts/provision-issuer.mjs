#!/usr/bin/env node
/**
 * Give the API a key it can issue names with — and nothing else.
 *
 * The API needs to submit sponsored `register()` transactions. The obvious move
 * is to hand it the key we already use, which is exactly the wrong one: that key
 * is the Durin registry's admin, so it can add itself as a registrar and rewrite
 * any name's records (this is written up in config/claims-gates.json, and it is
 * why the product may not claim "the platform cannot change your name" yet).
 * Putting it on an internet-facing server would widen that.
 *
 * So: a fresh key, added as a relayer on our registrar, funded with pocket change
 * for gas. If it leaks, the blast radius is "somebody spends a fraction of a cent
 * submitting registrations that owners already signed".
 *
 *   node scripts/provision-issuer.mjs            # check only
 *   node scripts/provision-issuer.mjs --apply    # add relayer + fund it
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPublicClient, createWalletClient, formatEther, http, parseAbi } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const apply = process.argv.includes('--apply');

const configDir = resolve(repoRoot, 'config');
const chains = JSON.parse(readFileSync(resolve(configDir, 'chains.json'), 'utf8'));
const registrar = chains.l2.registrar;
const rpc = chains.l2.rpcDefault;

/** Enough for a few hundred registrations at this chain's gas prices. */
const FUNDING_ETH = 0.0005;
const MIN_BALANCE_ETH = 0.00015;

const ABI = parseAbi([
  'function owner() view returns (address)',
  'function relayers(address) view returns (bool)',
  'function setRelayer(address relayer, bool allowed)',
]);

const chain = {
  id: chains.l2.chainId,
  name: chains.l2.name,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
};
const publicClient = createPublicClient({ chain, transport: http(rpc) });

// The issuer key lives beside the other secrets, with the same 0600 handling.
mkdirSync(resolve(repoRoot, '.secrets'), { recursive: true });
const issuerPath = resolve(repoRoot, '.secrets/issuer.txt');
let issuerKey;
let created = false;
if (existsSync(issuerPath)) {
  issuerKey = readFileSync(issuerPath, 'utf8').match(/0x[0-9a-fA-F]{64}/)?.[0];
  if (!issuerKey) throw new Error(`${issuerPath} exists but holds no key`);
} else if (apply) {
  issuerKey = generatePrivateKey();
  writeFileSync(issuerPath, `# MuseName API issuer key — relayer on the registrar, nothing else\n${issuerKey}\n`, {
    mode: 0o600,
  });
  created = true;
} else {
  console.log(`no issuer key yet (${issuerPath} does not exist)`);
  console.log('run with --apply to create one, add it as a relayer and fund it');
  process.exit(0);
}

const issuer = privateKeyToAccount(issuerKey);
const adminKey = readFileSync(resolve(repoRoot, '.secrets/robinhood-deployer.txt'), 'utf8').match(
  /0x[0-9a-fA-F]{64}/,
)[0];
const admin = privateKeyToAccount(adminKey);
const adminWallet = createWalletClient({ account: admin, chain, transport: http(rpc) });

const [owner, isRelayer, issuerBalance, adminBalance] = await Promise.all([
  publicClient.readContract({ address: registrar, abi: ABI, functionName: 'owner' }),
  publicClient.readContract({ address: registrar, abi: ABI, functionName: 'relayers', args: [issuer.address] }),
  publicClient.getBalance({ address: issuer.address }),
  publicClient.getBalance({ address: admin.address }),
]);

console.log('MuseName issuer provisioning');
console.log(`  registrar      ${registrar}`);
console.log(`  registrar owner${owner === admin.address ? ' = admin key (we hold it)' : ` = ${owner}`}`);
console.log(`  issuer key     ${issuer.address}${created ? '  (created just now)' : ''}`);
console.log(`  is a relayer   ${isRelayer}`);
console.log(`  issuer balance ${formatEther(issuerBalance)} ETH`);
console.log(`  admin balance  ${formatEther(adminBalance)} ETH`);

if (!apply) {
  console.log('\ncheck only. Add --apply to make changes.');
  process.exit(0);
}
if (owner.toLowerCase() !== admin.address.toLowerCase()) {
  throw new Error('the admin key is not the registrar owner; cannot add a relayer');
}

if (!isRelayer) {
  const hash = await adminWallet.writeContract({
    address: registrar,
    abi: ABI,
    functionName: 'setRelayer',
    args: [issuer.address, true],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`\n  setRelayer     ${hash}`);
} else {
  console.log('\n  setRelayer     already allowed, nothing to do');
}

if (Number(formatEther(issuerBalance)) < MIN_BALANCE_ETH) {
  const hash = await adminWallet.sendTransaction({
    to: issuer.address,
    value: BigInt(Math.round(FUNDING_ETH * 1e18)),
    gas: 21_000n,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  fund           ${hash} (${FUNDING_ETH} ETH)`);
} else {
  console.log(`  fund           balance is above ${MIN_BALANCE_ETH} ETH, skipping`);
}

console.log(`\nnext: put this in the API's environment (server side, not in git):`);
console.log(`  MUSENAME_ISSUER_KEY=${issuerKey.slice(0, 10)}…  (the value in .secrets/issuer.txt)`);
console.log(`then restart the API and run: node scripts/live-claim-probe.mjs`);
