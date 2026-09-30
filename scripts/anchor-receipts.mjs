#!/usr/bin/env node
/**
 * Anchor a batch of records on chain: one transaction, no contract.
 *
 *   node scripts/anchor-receipts.mjs --records deployments/receipts-genesis.json
 *   node scripts/anchor-receipts.mjs --records <file> --send
 *
 * The transaction is zero value, addressed to the sender itself, with
 *
 *   keccak256("musename.receipts.v1") ‖ merkleRoot ‖ count ‖ anchoredAt
 *
 * as its input data. The root is built with the OpenZeppelin-compatible pairing
 * in packages/verify, so any single record can be proven later with a merkle
 * proof, offline.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPublicClient, createWalletClient, formatEther, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { ANCHOR_TAG, batchRoot, encodeAnchorPayload, leafOf, verifyAnchor } from '../packages/verify/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

const chains = JSON.parse(readFileSync(resolve(repoRoot, 'config/chains.json'), 'utf8'));
const rpcUrl = arg('rpc', process.env.ROBINHOOD_RPC_URL ?? chains.l2.rpcDefault);
const recordsPath = arg('records', resolve(repoRoot, 'deployments/receipts-genesis.json'));
const anchoredAt = Number(arg('anchored-at', String(Math.floor(Date.now() / 1000))));
const send = process.argv.includes('--send');

const records = JSON.parse(readFileSync(recordsPath, 'utf8'));
if (!Array.isArray(records) || records.length === 0) throw new Error(`${recordsPath} must be a non-empty array`);

const leaves = records.map(leafOf);
const root = batchRoot(records);
const payload = encodeAnchorPayload({ root, count: records.length, anchoredAt });

const chain = {
  id: chains.l2.chainId,
  name: 'robinhood',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

console.log('MusePass receipt anchor');
console.log(`  chain      ${chains.l2.name} (${chains.l2.chainId})`);
console.log(`  records    ${recordsPath}`);
console.log(`  count      ${records.length}`);
console.log(`  root       ${root}`);
console.log(`  anchoredAt ${anchoredAt} (${new Date(anchoredAt * 1000).toISOString()})`);
console.log(`  tag        ${ANCHOR_TAG}`);
console.log(`  payload    ${payload}`);
console.log('');
records.forEach((record, index) => console.log(`  leaf ${index}  ${leaves[index]}  ${record.kind ?? ''} ${record.tx ?? ''}`.trimEnd()));

if (!send) {
  console.log('\ndry run — nothing sent. Add --send to anchor this batch.');
  process.exit(0);
}

const keyText = process.env.MUSENAME_DEPLOYER_KEY
  ? process.env.MUSENAME_DEPLOYER_KEY
  : readFileSync(arg('key-file', resolve(repoRoot, '.secrets/robinhood-deployer.txt')), 'utf8').match(/0x[0-9a-fA-F]{64}/)?.[0];
if (!keyText) throw new Error('set MUSENAME_DEPLOYER_KEY or pass --key-file');

const account = privateKeyToAccount(keyText);
const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
const gas = await publicClient.estimateGas({ account: account.address, to: account.address, data: payload });
// Let the node price it. Robinhood Chain's base fee moves and an explicit
// `gasPrice` below it is rejected outright, so hand over the EIP-1559 fields
// viem gets from `eth_feeHistory` instead of guessing.
const fees = await publicClient.estimateFeesPerGas();
const balance = await publicClient.getBalance({ address: account.address });
console.log('');
console.log(
  `  sending: ${gas} gas, up to ${formatEther(gas * (fees.maxFeePerGas ?? 0n))} ETH at ${fees.maxFeePerGas} wei/gas, balance ${formatEther(balance)} ETH`,
);

const hash = await wallet.sendTransaction({ to: account.address, data: payload, gas });
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== 'success') throw new Error(`anchor transaction failed: ${hash}`);

// Read the transaction back and check it against the batch we just built. If
// these ever disagree, the anchor is not what we think it is.
const sent = await publicClient.getTransaction({ hash });
const check = verifyAnchor({ data: sent.input, records });
if (!check.ok) throw new Error(`the anchored data does not verify: ${check.reason}`);

console.log(`  tx         ${hash}`);
console.log(`  explorer   ${chains.l2.explorer}/tx/${hash}`);
console.log(`  verified   ${check.reason}`);

const ledgerPath = resolve(repoRoot, 'deployments/receipt-anchors.json');
let ledger = [];
try {
  ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
} catch {
  ledger = [];
}
ledger.push({
  chainId: chains.l2.chainId,
  tx: hash,
  root,
  count: records.length,
  anchoredAt,
  records: recordsPath.replace(`${repoRoot}/`, ''),
  block: Number(receipt.blockNumber),
});
writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(`  ledger     ${ledgerPath.replace(`${repoRoot}/`, '')}`);
