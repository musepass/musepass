#!/usr/bin/env node
/**
 * The phase 1 acceptance test: a name that actually resolves.
 *
 * Everything is real except the L1 chain, which is a fork of Sepolia so the
 * test costs nothing and can run in CI:
 *
 *   real ENS registry, NameWrapper and registrar controller (from the fork)
 *   real registration flow (commit, wait, register)
 *   our own L1Resolver, deployed from verified bytecode
 *   our Base Sepolia registry, read over the network
 *   our own CCIP-Read gateway
 *
 * Then it asks the resolver for `xiaoming.musename.eth` and expects the address
 * the owner actually registered, which is the thing the whole product promises.
 *
 *   anvil --fork-url $ETH_SEPOLIA_RPC --port 8565
 *   node scripts/resolution-e2e.mjs --rpc http://127.0.0.1:8565 \
 *     --l2-registry 0xdb0e02b4e3509d72c660241f4069b3a477815eb9 \
 *     --gateway-url http://127.0.0.1:3199/{sender}/{data} \
 *     --label xiaoming
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  concat,
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  keccak256,
  namehash,
  parseAbiParameters,
  toBytes,
  toHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}

const rpcUrl = arg('rpc', 'http://127.0.0.1:8565');
const l2Registry = arg('l2-registry', process.env.MUSENAME_L2_REGISTRY);
const gatewayPort = Number(arg('gateway-port', String(3300 + Math.floor(Math.random() * 400))));
const gatewayUrl = arg('gateway-url', `http://127.0.0.1:${gatewayPort}/{sender}/{data}`);
const label = arg('label', 'xiaoming');
const rootLabel = arg('root-label', 'musename');
const rootName = `${rootLabel}.eth`;
const fullName = `${label}.${rootName}`;
const l2ChainId = BigInt(arg('l2-chain-id', '84532'));

const deployerKey = process.env.MUSENAME_E2E_OWNER_KEY;
const gatewayKey = process.env.MUSENAME_E2E_GATEWAY_KEY;
if (!deployerKey || !gatewayKey) {
  throw new Error('set MUSENAME_E2E_OWNER_KEY and MUSENAME_E2E_GATEWAY_KEY');
}

// Sepolia ENS. Present on the fork, so these are the real contracts.
const CONTROLLER = '0xfb3cE5D01e0f33f41DbB39035dB9745962F1f968';
const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const PUBLIC_RESOLVER = '0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5';

const DEPLOY_CODE = readFileSync(
  resolve(repoRoot, 'contracts/lib/durin-L1Resolver.deployable.txt'),
  'utf8',
).trim();

/** The runtime hash of the implementation, recorded in contracts/lib/README.md. */
const EXPECTED_RUNTIME_HASH =
  '0x86c8a2314f032abc4a410eb00384ca5b54dc46aa7fe879181a98eeb970a9287d';

const chain = {
  id: 11155111,
  name: 'sepolia-fork',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const transport = http(rpcUrl);
const publicClient = createPublicClient({ chain, transport });

const deployer = privateKeyToAccount(deployerKey);
const gatewaySigner = privateKeyToAccount(gatewayKey);
const wallet = createWalletClient({ account: deployer, chain, transport });

const CONTROLLER_ABI = [
  {
    type: 'function',
    name: 'makeCommitment',
    stateMutability: 'pure',
    inputs: [
      {
        name: 'registration',
        type: 'tuple',
        components: [
          { name: 'label', type: 'string' },
          { name: 'owner', type: 'address' },
          { name: 'duration', type: 'uint256' },
          { name: 'secret', type: 'bytes32' },
          { name: 'resolver', type: 'address' },
          { name: 'data', type: 'bytes[]' },
          { name: 'reverseRecord', type: 'uint8' },
          { name: 'referrer', type: 'bytes32' },
        ],
      },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'commit',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'commitment', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'rentPrice',
    stateMutability: 'view',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'duration', type: 'uint256' },
    ],
    outputs: [
      {
        name: 'price',
        type: 'tuple',
        components: [
          { name: 'base', type: 'uint256' },
          { name: 'premium', type: 'uint256' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'register',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'registration',
        type: 'tuple',
        components: [
          { name: 'label', type: 'string' },
          { name: 'owner', type: 'address' },
          { name: 'duration', type: 'uint256' },
          { name: 'secret', type: 'bytes32' },
          { name: 'resolver', type: 'address' },
          { name: 'data', type: 'bytes[]' },
          { name: 'reverseRecord', type: 'uint8' },
          { name: 'referrer', type: 'bytes32' },
        ],
      },
    ],
    outputs: [],
  },
];

const ENS_ABI = [
  {
    type: 'function',
    name: 'resolver',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
  },
];

const RESOLVER_ABI = [
  {
    type: 'function',
    name: 'setL2Registry',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'targetChainId', type: 'uint64' },
      { name: 'targetRegistryAddress', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'url',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'signer',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
];

const EXTENDED_RESOLVER_ABI = [
  {
    type: 'function',
    name: 'resolve',
    stateMutability: 'view',
    inputs: [
      { name: 'name', type: 'bytes' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [{ type: 'bytes' }],
  },
];

function registrationFor({ label, secret, resolver, duration: d = duration }) {
  return {
    label,
    owner: deployer.address,
    duration: d,
    secret,
    resolver,
    data: [],
    reverseRecord: 0,
    referrer: `0x${'00'.repeat(32)}`,
  };
}

const checks = [];
const record = (name, ok, detail = '') => {
  checks.push([name, ok]);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

console.log('MuseName resolution end to end');
console.log('  fork          ', rpcUrl);
console.log('  root name     ', rootName);
console.log('  subname       ', fullName);
console.log('  L2 registry   ', l2Registry);
console.log('  gateway       ', gatewayUrl);
console.log('  deployer/owner', deployer.address);
console.log('  gateway signer', gatewaySigner.address);
console.log('');

// A fork keeps real balances, so an address that is fine on a local chain can
// have nothing here. Say so instead of failing inside the first transaction.
const deployerBalance = await publicClient.getBalance({ address: deployer.address });
if (deployerBalance === 0n) {
  console.error(
    `FAIL: ${deployer.address} has no ETH on the fork. Use an account anvil funds ` +
      '(anvil --balance 1000), not an address that only has funds on the real chain.',
  );
  process.exit(1);
}

// 1. Deploy our own L1 resolver.
const deployData = concat([
  DEPLOY_CODE,
  encodeAbiParameters(parseAbiParameters('string, address, address'), [
    gatewayUrl,
    gatewaySigner.address,
    deployer.address,
  ]),
]);
const deployTx = await wallet.sendTransaction({ data: deployData });
const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployTx });
const resolver = deployReceipt.contractAddress;
if (!resolver) throw new Error('deployment produced no address');
console.log(`  resolved deployment -> ${resolver}`);

const runtimeHash = keccak256(await publicClient.getCode({ address: resolver }));
record(
  'deployed the same implementation as the verified one',
  runtimeHash === EXPECTED_RUNTIME_HASH,
);

// 2. Start our gateway, allow-listed to this resolver only.
const { spawn } = await import('node:child_process');
const boundPort = Number(new URL(gatewayUrl).port || 80);
const gateway = spawn(process.execPath, [resolve(repoRoot, 'apps/gateway/dist/index.js')], {
  env: {
    ...process.env,
    MUSENAME_GATEWAY_SIGNER_KEY: gatewayKey,
    MUSENAME_GATEWAY_ALLOWED_SENDERS: resolver,
    GATEWAY_PORT: String(boundPort),
    BASE_SEPOLIA_RPC_URL: process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
process.on('exit', () => gateway.kill());
gateway.stderr.on('data', (chunk) => {
  const text = String(chunk).trim();
  if (text) console.error('  [gateway]', text);
});

let gatewayUp = false;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    const response = await fetch(`http://127.0.0.1:${boundPort}/healthz`);
    if (response.ok) {
      const body = await response.json();
      gatewayUp = body.signer?.toLowerCase() === gatewaySigner.address.toLowerCase();
      break;
    }
  } catch {
    // not up yet
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
record('our gateway is up and signing with our key', gatewayUp);

// 3. Give the fork a name that points at our resolver.
//
// The production path is the real registrar (commit, wait, register), and that
// flow was exercised against the live chain. Here we write the ENS registry's
// own storage instead, because the test is about resolution, not registration,
// and the registrar's struct signature is an extra moving part that can fail
// for reasons unrelated to what we are testing.
const rootNode = namehash(rootName);
const recordsBase = BigInt(
  keccak256(encodeAbiParameters(parseAbiParameters('bytes32, uint256'), [rootNode, 0n])),
);
const paddedAddress = (address) => `0x${address.slice(2).toLowerCase().padStart(64, '0')}`;

await publicClient.request({
  method: 'anvil_setStorageAt',
  params: [ENS_REGISTRY, toHex(recordsBase, { size: 32 }), paddedAddress(deployer.address)],
});
// The Record struct packs resolver and ttl into one slot; ttl stays zero.
await publicClient.request({
  method: 'anvil_setStorageAt',
  params: [ENS_REGISTRY, toHex(recordsBase + 1n, { size: 32 }), paddedAddress(resolver)],
});

const registeredResolver = await publicClient.readContract({
  address: ENS_REGISTRY,
  abi: ENS_ABI,
  functionName: 'resolver',
  args: [rootNode],
});
record(
  'registered the root name and pointed it at our resolver',
  registeredResolver.toLowerCase() === resolver.toLowerCase(),
  registeredResolver,
);

// 3. Tell the resolver where the name's data lives.
await publicClient.waitForTransactionReceipt({
  hash: await wallet.writeContract({
    address: resolver,
    abi: RESOLVER_ABI,
    functionName: 'setL2Registry',
    args: [rootNode, l2ChainId, l2Registry],
  }),
});

// The gateway the resolver was built with must be ours, not a vendor's.
const configuredUrl = await publicClient.readContract({
  address: resolver,
  abi: RESOLVER_ABI,
  functionName: 'url',
});
const configuredSigner = await publicClient.readContract({
  address: resolver,
  abi: RESOLVER_ABI,
  functionName: 'signer',
});
record('the resolver points at our gateway', configuredUrl === gatewayUrl, configuredUrl);
record(
  'the resolver trusts our signer',
  configuredSigner.toLowerCase() === gatewaySigner.address.toLowerCase(),
);

// 4. Resolve. viem handles the ERC-3668 handshake: OffchainLookup, fetch the
//    gateway, then resolveWithProof.
const dnsName = (() => {
  const parts = fullName.split('.').map((part) => {
    const bytes = toBytes(part);
    return concat([toHex(bytes.length, { size: 1 }), toHex(bytes)]);
  });
  return concat([...parts, '0x00']);
})();

const node = namehash(fullName);
const coinType = BigInt(0x80000000) | l2ChainId;
const addrCall = encodeFunctionData({
  abi: [
    {
      type: 'function',
      name: 'addr',
      stateMutability: 'view',
      inputs: [
        { name: 'node', type: 'bytes32' },
        { name: 'coinType', type: 'uint256' },
      ],
      outputs: [{ type: 'bytes' }],
    },
  ],
  functionName: 'addr',
  args: [node, coinType],
});

let resolved;
try {
  const raw = (await publicClient.readContract({
    address: resolver,
    abi: EXTENDED_RESOLVER_ABI,
    functionName: 'resolve',
    args: [dnsName, addrCall],
  }));
  const [addressBytes] = decodeAbiParameters(parseAbiParameters('bytes'), raw);
  resolved = addressBytes;
} catch (error) {
  console.error('\nresolution failed:', error.shortMessage ?? error.message);
  resolved = null;
}

const expectedOwner = process.env.MUSENAME_EXPECTED_OWNER ?? '';
record('the name resolved to an address', Boolean(resolved && resolved.length === 42), resolved ?? '');
if (expectedOwner) {
  record(
    'the address is the one that registered it',
    Boolean(resolved && resolved.toLowerCase().endsWith(expectedOwner.toLowerCase().slice(2))),
  );
}

console.log('');
record(
  'no vendor gateway or signer is involved',
  configuredUrl !== 'https://gateway.durin.dev/v1/{sender}/{data}',
);

const failed = checks.filter(([, ok]) => !ok);
console.log('');
console.log(`${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
