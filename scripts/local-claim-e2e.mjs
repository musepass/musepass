#!/usr/bin/env node
/**
 * End to end claim against a local stack: the same code path the web claim page
 * and the MCP "one sentence" flow use, minus the HTTP layer.
 *
 *   anvil
 *   cd contracts && forge script script/DeployLocalStack.s.sol --rpc-url ... --broadcast
 *   pnpm --filter @musename/core build   # produces packages/core/dist
 *   node scripts/local-claim-e2e.mjs --registry <addr> --registrar <addr> --label aguang
 *
 * What it proves:
 *   1. an off chain EIP-712 signature made by the future owner is accepted
 *   2. the name is minted to the owner, not to the platform
 *   3. the platform's sponsoring key never gains rights over the name
 *   4. address records were written for this chain and for mainnet
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  concat,
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';

import {
  REGISTER_TYPES,
  buildEip712Domain,
  ensip11CoinType,
  registerMessage,
  normalizeLabel,
} from '../packages/core/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const configDir = resolve(here, '..', 'config');
const brand = JSON.parse(readFileSync(resolve(configDir, 'brand.json'), 'utf8'));

// Public anvil keys. Local only.
const SPONSOR_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const OWNER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}

const rpcUrl = arg('rpc', process.env.MUSENAME_LOCAL_RPC ?? 'http://127.0.0.1:8545');
const registrarAddress = arg('registrar', process.env.MUSENAME_REGISTRAR);
const registryAddress = arg('registry', process.env.MUSENAME_L2_REGISTRY);
const label = normalizeLabel(arg('label', 'aguang')).normalized;

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
    name: 'addrRecords',
    stateMutability: 'view',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'coinType', type: 'uint256' },
    ],
    outputs: [{ type: 'bytes' }],
  },
];

const chain = { ...foundry, rpcUrls: { default: { http: [rpcUrl] } } };
const transport = http(rpcUrl);
const publicClient = createPublicClient({ chain, transport });

const sponsor = privateKeyToAccount(SPONSOR_KEY);
const owner = privateKeyToAccount(OWNER_KEY);
const wallet = createWalletClient({ account: sponsor, chain, transport });

const deadline = BigInt(Math.floor(Date.now() / 1000) + 15 * 60);
const domain = buildEip712Domain({
  productName: brand.productName,
  chainId: chain.id,
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

console.log('MuseName local claim');
console.log('  brand          ', brand.productName);
console.log('  root           ', brand.rootName);
console.log('  label          ', label);
console.log('  owner (future) ', owner.address);
console.log('  sponsor (gas)  ', sponsor.address);
console.log('  deadline       ', deadline.toString());
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

// Namehash of the configured root, built label by label from the right.
const rootLabels = brand.rootName.split('.');
let baseNode = `0x${'00'.repeat(32)}`;
for (let index = rootLabels.length - 1; index >= 0; index -= 1) {
  baseNode = keccak256(concat([baseNode, keccak256(toBytes(rootLabels[index]))]));
}
const node = keccak256(concat([baseNode, keccak256(toBytes(label))]));

const chainOwner = await publicClient.readContract({
  address: registryAddress,
  abi: REGISTRY_ABI,
  functionName: 'owner',
  args: [node],
});

const baseCoinType = ensip11CoinType(chain.id);
const baseAddr = await publicClient.readContract({
  address: registryAddress,
  abi: REGISTRY_ABI,
  functionName: 'addrRecords',
  args: [node, baseCoinType],
});
const mainnetAddr = await publicClient.readContract({
  address: registryAddress,
  abi: REGISTRY_ABI,
  functionName: 'addrRecords',
  args: [node, 60n],
});

const expected = owner.address.toLowerCase().slice(2);
const checks = [
  ['tx succeeded', receipt.status === 'success'],
  ['owner is the signer, not the sponsor', chainOwner.toLowerCase() === owner.address.toLowerCase()],
  ['sponsor did not become the owner', chainOwner.toLowerCase() !== sponsor.address.toLowerCase()],
  ['address record written for this chain', baseAddr.toLowerCase().endsWith(expected)],
  ['address record written for mainnet', mainnetAddr.toLowerCase().endsWith(expected)],
];

console.log('');
for (const [name, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
console.log(`  tx ${txHash}`);
console.log(`  node ${node}`);

if (checks.some(([, ok]) => !ok)) process.exit(1);
console.log('\nAll checks passed.');
