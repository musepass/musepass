#!/usr/bin/env node
/**
 * End to end claim: sign off chain, mint on chain, check who owns it.
 *
 * This is the same code path the web claim page and the MCP flow use, without
 * the HTTP layer. It runs against any chain, so the same script proves the
 * local wiring and the real Base Sepolia deployment.
 *
 *   node scripts/claim-e2e.mjs --rpc <url> --registry <addr> --registrar <addr> \
 *     [--label aguang]
 *
 * Two separate keys by design:
 *   SPONSOR pays gas and must be a relayer, but holds no registry rights
 *   OWNER   signs the registration and receives the name
 *
 * Env overrides (all optional):
 *   MUSENAME_E2E_CHAIN_ID     default 31337 (anvil)
 *   MUSENAME_E2E_SPONSOR_KEY  default anvil account #0
 *   MUSENAME_E2E_OWNER_KEY    default anvil account #1
 *
 * Assertions:
 *   1. the off chain EIP-712 digest equals the contract's hashRegister()
 *   2. the name is minted to the signer, not to the sponsor
 *   3. the sponsor never becomes the owner
 *   4. address records exist for this chain and for mainnet (coinType 60)
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { concat, createPublicClient, createWalletClient, http, keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import {
  REGISTER_TYPES,
  buildEip712Domain,
  ensip11CoinType,
  registerMessage,
  normalizeLabel,
} from '../packages/core/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const brand = JSON.parse(readFileSync(resolve(here, '..', 'config', 'brand.json'), 'utf8'));

// Public anvil keys. Local only; never funded.
const DEFAULT_SPONSOR_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const DEFAULT_OWNER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}

const rpcUrl = arg('rpc', 'http://127.0.0.1:8545');
const registrarAddress = arg('registrar', process.env.MUSENAME_REGISTRAR);
const registryAddress = arg('registry', process.env.MUSENAME_L2_REGISTRY);
const label = normalizeLabel(arg('label', 'aguang')).normalized;
const chainId = Number(process.env.MUSENAME_E2E_CHAIN_ID ?? 31337);

const REGISTRAR_ABI = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'beneficiary', type: 'address' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: 'node', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'hashRegister',
    stateMutability: 'view',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'beneficiary', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
];

const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    // The real Durin registry is an ENS resolver, so it exposes the standard
    // `addr(bytes32,uint256)` getter rather than a bespoke one.
    name: 'addr',
    stateMutability: 'view',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'coinType', type: 'uint256' },
    ],
    outputs: [{ type: 'bytes' }],
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

const sponsor = privateKeyToAccount(
  (process.env.MUSENAME_E2E_SPONSOR_KEY ?? DEFAULT_SPONSOR_KEY),
);
const owner = privateKeyToAccount(process.env.MUSENAME_E2E_OWNER_KEY ?? DEFAULT_OWNER_KEY);
const wallet = createWalletClient({ account: sponsor, chain, transport });

const deadline = BigInt(Math.floor(Date.now() / 1000) + 15 * 60);
const domain = buildEip712Domain({
  productName: brand.productName,
  chainId,
  verifyingContract: registrarAddress,
});
const message = registerMessage({ label, owner: owner.address, deadline });

const signature = await owner.signTypedData({
  domain,
  types: REGISTER_TYPES,
  primaryType: 'Register',
  message,
});

const onChainDigest = await publicClient.readContract({
  address: registrarAddress,
  abi: REGISTRAR_ABI,
  functionName: 'hashRegister',
  args: [label, owner.address, deadline],
});

const { hashTypedData } = await import('viem');
const offChainDigest = hashTypedData({
  domain,
  types: REGISTER_TYPES,
  primaryType: 'Register',
  message,
});

console.log('MuseName claim');
console.log('  chain          ', chainId);
console.log('  root           ', brand.rootName);
console.log('  label          ', label);
console.log('  owner (signer) ', owner.address);
console.log('  sponsor (gas)  ', sponsor.address);
console.log('  digest offchain', offChainDigest);
console.log('  digest onchain ', onChainDigest);

if (offChainDigest.toLowerCase() !== onChainDigest.toLowerCase()) {
  console.error('\nFAIL: the contract does not agree with the off chain digest.');
  process.exit(1);
}

const txHash = await wallet.writeContract({
  address: registrarAddress,
  abi: REGISTRAR_ABI,
  functionName: 'register',
  args: [label, owner.address, deadline, signature],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
if (receipt.status !== 'success') {
  console.error('\nFAIL: registration transaction reverted.');
  process.exit(1);
}

// Rebuild the node the way the registry does, from the configured root.
const rootLabels = brand.rootName.split('.');
let baseNode = `0x${'00'.repeat(32)}`;
for (let index = rootLabels.length - 1; index >= 0; index -= 1) {
  baseNode = keccak256(concat([baseNode, keccak256(toBytes(rootLabels[index]))]));
}
const node = keccak256(concat([baseNode, keccak256(toBytes(label))]));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Read until the chain agrees, instead of trusting one sample.
 *
 * Public RPC endpoints sit behind load balancers. Reading "latest" can hit a
 * replica that has not caught up yet (the name looks unowned), and reading at
 * the receipt's block can hit a replica that does not have that block at all.
 * Polling for the expected state is the only thing that works on both.
 */
async function readUntil(expected, read, { tries = 15, delayMs = 2000 } = {}) {
  let last = null;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      last = await read();
      if (expected(last)) return last;
    } catch (error) {
      last = `error: ${error.shortMessage ?? error.message}`;
    }
    await sleep(delayMs);
  }
  return last;
}

const isAddress = (value) => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);

const chainOwner = await readUntil(
  (value) => isAddress(value) && value.toLowerCase() === owner.address.toLowerCase(),
  () =>
    publicClient.readContract({
      address: registryAddress,
      abi: REGISTRY_ABI,
      functionName: 'owner',
      args: [node],
    }),
);

const baseCoinType = ensip11CoinType(chainId);
const expectedTail = owner.address.toLowerCase().slice(2);
const chainAddr = await readUntil(
  (value) => typeof value === 'string' && value.toLowerCase().endsWith(expectedTail),
  () =>
    publicClient.readContract({
      address: registryAddress,
      abi: REGISTRY_ABI,
      functionName: 'addr',
      args: [node, baseCoinType],
    }),
);
const mainnetAddr = await readUntil(
  (value) => typeof value === 'string' && value.toLowerCase().endsWith(expectedTail),
  () =>
    publicClient.readContract({
      address: registryAddress,
      abi: REGISTRY_ABI,
      functionName: 'addr',
      args: [node, 60n],
    }),
);

const expected = expectedTail;
const checks = [
  ['digest matches on chain', offChainDigest.toLowerCase() === onChainDigest.toLowerCase()],
  ['tx succeeded', receipt.status === 'success'],
  [
    'owner is the signer, not the sponsor',
    typeof chainOwner === 'string' && chainOwner.toLowerCase() === owner.address.toLowerCase(),
  ],
  [
    'sponsor did not become the owner',
    typeof chainOwner === 'string' && chainOwner.toLowerCase() !== sponsor.address.toLowerCase(),
  ],
  [
    'address record written for this chain',
    typeof chainAddr === 'string' && chainAddr.toLowerCase().endsWith(expected),
  ],
  [
    'address record written for mainnet',
    typeof mainnetAddr === 'string' && mainnetAddr.toLowerCase().endsWith(expected),
  ],
];

console.log('');
for (const [name, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
console.log(`  tx   ${txHash}`);
console.log(`  node ${node}`);

if (checks.some(([, ok]) => !ok)) process.exit(1);
console.log('\nAll checks passed.');
