#!/usr/bin/env node
/**
 * Publish an ERC-8004 card to a name's on-chain text record.
 *
 * The owner signs; the platform pays the gas. That is the whole point of
 * Durin's `setTextWithSignature`: the write is authorised by a signature, so
 * whoever submits it does not need to be the owner.
 *
 *   node scripts/card-publish-e2e.mjs \
 *     --rpc <url> --registry <addr> --label xiaoming [--root musename.eth]
 *
 * Keys come from the environment so nothing is passed on a command line:
 *   MUSENAME_E2E_OWNER_KEY    signs the card (must be the name's owner)
 *   MUSENAME_E2E_SPONSOR_KEY  submits the transaction
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createPublicClient,
  createWalletClient,
  http,
  namehash,
  recoverMessageAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import {
  CARD_TEXT_KEY,
  cardContentHash,
  cardDataUri,
  cardTextSignaturePayload,
  canonicalJson,
  parseCardDataUri,
  ERC8004_CARD_TYPE,
  normalizeLabel,
} from '../packages/core/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const brand = JSON.parse(readFileSync(resolve(here, '..', 'config', 'brand.json'), 'utf8'));

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}

const rpcUrl = arg('rpc', 'http://127.0.0.1:8545');
const registryAddress = arg('registry', process.env.MUSENAME_L2_REGISTRY);
const label = normalizeLabel(arg('label', 'xiaoming')).normalized;
const chainId = Number(process.env.MUSENAME_E2E_CHAIN_ID ?? 31337);
const ownerKey = process.env.MUSENAME_E2E_OWNER_KEY;
const sponsorKey = process.env.MUSENAME_E2E_SPONSOR_KEY;
if (!ownerKey || !sponsorKey) throw new Error('set MUSENAME_E2E_OWNER_KEY and MUSENAME_E2E_SPONSOR_KEY');

const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'setTextWithSignature',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
      { name: 'expiration', type: 'uint256' },
      { name: 'signer', type: 'address' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'text',
    stateMutability: 'view',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
  },
];

const chain = {
  id: chainId,
  name: `chain-${chainId}`,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const transport = http(rpcUrl);
const publicClient = createPublicClient({ chain, transport });
const owner = privateKeyToAccount(ownerKey);
const sponsor = privateKeyToAccount(sponsorKey);
const wallet = createWalletClient({ account: sponsor, chain, transport });

const fullName = `${label}.${brand.rootName}`;
const node = namehash(fullName);

// 1. The card itself, in the ERC-8004 shape.
const card = {
  type: ERC8004_CARD_TYPE,
  name: fullName,
  description: '婚礼与风光摄影，接受档期咨询。',
  image: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
  services: [{ name: 'web', endpoint: `https://${label}.${brand.siteUrl.replace(/^https?:\/\//, '')}` }],
  x402Support: false,
  active: true,
  registrations: [],
  musename: {
    ensName: fullName,
    host: 'MuseName',
    updatedAt: new Date().toISOString(),
    cardVersion: 1,
  },
};

// 2. The value that goes on chain: a self-contained data URI, so the record
//    cannot rot when a pinning service disappears.
const value = cardDataUri(card);
const expectedHash = cardContentHash(card);
const expiration = BigInt(Math.floor(Date.now() / 1000) + 3600);

// 3. The owner signs; the sponsor submits.
const signaturePayload = cardTextSignaturePayload({
  registry: registryAddress,
  node,
  key: CARD_TEXT_KEY,
  value,
  expiration,
});
// personal_sign wraps this hash in the EIP-191 prefix, which is exactly what
// the contract compares against. Signing the wrapped hash would wrap it twice.
const signature = await owner.signMessage({ message: { raw: signaturePayload } });

// Pre-flight: never broadcast a signature the contract will reject.
const recovered = await recoverMessageAddress({
  message: { raw: signaturePayload },
  signature,
});
if (recovered.toLowerCase() !== owner.address.toLowerCase()) {
  console.error(`\nFAIL: signature recovers to ${recovered}, expected ${owner.address}`);
  process.exit(1);
}
console.log('  recovers to', recovered);

console.log('MuseName card publish');
console.log('  chain      ', chainId);
console.log('  name       ', fullName);
console.log('  registry   ', registryAddress);
console.log('  owner      ', owner.address);
console.log('  sponsor    ', sponsor.address);
console.log('  card bytes ', canonicalJson(card).length);
console.log('  content    ', expectedHash);
console.log('  signature  ', `${signature.slice(0, 18)}…`);

const chainOwner = await publicClient.readContract({
  address: registryAddress,
  abi: REGISTRY_ABI,
  functionName: 'owner',
  args: [node],
});
if (chainOwner.toLowerCase() !== owner.address.toLowerCase()) {
  console.error(
    `\nFAIL: ${fullName} is owned by ${chainOwner}, but the signing key is ${owner.address}.`,
  );
  process.exit(1);
}

const txHash = await wallet.writeContract({
  address: registryAddress,
  abi: REGISTRY_ABI,
  functionName: 'setTextWithSignature',
  args: [node, CARD_TEXT_KEY, value, expiration, owner.address, signature],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

// Public RPCs are load balanced, so read until the chain agrees with itself.
let stored = '';
for (let attempt = 0; attempt < 15; attempt += 1) {
  stored = await publicClient.readContract({
    address: registryAddress,
    abi: REGISTRY_ABI,
    functionName: 'text',
    args: [node, CARD_TEXT_KEY],
  });
  if (stored) break;
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

const parsed = parseCardDataUri(stored);
const roundTripped = parsed ? cardContentHash(parsed) : '';

const checks = [
  ['tx succeeded', receipt.status === 'success'],
  ['the record is stored under musename.card', stored.length > 0],
  ['the record is a data URI', stored.startsWith('data:application/json;base64,')],
  ['the card decodes back', parsed !== null],
  ['the content hash survives the round trip', roundTripped === expectedHash],
  ['the owner never sent a transaction', receipt.from.toLowerCase() === sponsor.address.toLowerCase()],
];

console.log('');
for (const [name, ok] of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
console.log(`  tx     ${txHash}`);
console.log(`  record ${stored.length} bytes`);

if (checks.some(([, ok]) => !ok)) process.exit(1);
console.log('\nAll checks passed.');
