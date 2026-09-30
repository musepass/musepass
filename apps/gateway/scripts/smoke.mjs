#!/usr/bin/env node
/**
 * Drives a running gateway the way an ENS client would: build the same
 * OffchainLookup callData the L1 resolver produces, fetch the signed response,
 * and verify it recovers to the gateway's signer with the expected hash.
 *
 *   node apps/gateway/scripts/smoke.mjs \
 *     --url http://127.0.0.1:3104 --resolver 0x... --registry 0x... \
 *     --chain-id 31337 --label aguang
 */
import {
  decodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  keccak256,
  namehash,
  parseAbiParameters,
  recoverAddress,
  toBytes,
} from 'viem';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}

const gatewayUrl = arg('url', 'http://127.0.0.1:3104');
const resolver = arg('resolver');
const registry = arg('registry');
const chainId = BigInt(arg('chain-id', '31337'));
const label = arg('label', 'aguang');
const root = arg('root', 'musepass.eth');
const expect = arg('expect', '');

const STUFFED_ABI = [
  {
    type: 'function',
    name: 'stuffedResolveCall',
    stateMutability: 'view',
    inputs: [
      { name: 'name', type: 'bytes' },
      { name: 'data', type: 'bytes' },
      { name: 'targetChainId', type: 'uint64' },
      { name: 'targetRegistryAddress', type: 'address' },
    ],
    outputs: [
      { name: 'result', type: 'bytes' },
      { name: 'expires', type: 'uint64' },
      { name: 'sig', type: 'bytes' },
    ],
  },
];

const ADDR_ABI = [
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
];

// DNS encode "label.root" the way the resolver does before the lookup.
const dnsName = (() => {
  const labels = `${label}.${root}`.split('.');
  const parts = [];
  for (const part of labels) {
    const bytes = toBytes(part);
    parts.push(Uint8Array.from([bytes.length]), bytes);
  }
  parts.push(Uint8Array.from([0]));
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return `0x${[...out].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
})();

const coinType = BigInt(0x80000000) | chainId;
const node = namehash(`${label}.${root}`);
const encodedResolveCall = encodeFunctionData({
  abi: ADDR_ABI,
  functionName: 'addr',
  args: [node, coinType],
});

const callerData = encodeFunctionData({
  abi: STUFFED_ABI,
  functionName: 'stuffedResolveCall',
  args: [dnsName, encodedResolveCall, chainId, registry],
});

const endpoint = `${gatewayUrl.replace(/\/$/, '')}/${resolver}/${callerData}`;
const response = await fetch(endpoint);
if (!response.ok) {
  console.error(`FAIL: gateway answered ${response.status}`);
  console.error(await response.text());
  process.exit(1);
}

const { data } = await response.json();
const [result, expires, signature] = decodeAbiParameters(
  parseAbiParameters('bytes result, uint64 expires, bytes sig'),
  data,
);

// Recompute the hash exactly as the L1 resolver does, then recover.
const hash = keccak256(
  encodePacked(
    ['bytes', 'address', 'uint64', 'bytes32', 'bytes32'],
    ['0x1900', resolver, expires, keccak256(callerData), keccak256(result)],
  ),
);
const recovered = await recoverAddress({ hash, signature });

// `result` is the raw return data of the L2 call, which is ABI encoded: for
// addr(bytes32,uint256) that means offset + length + the 20 byte address.
const [addressBytes] = decodeAbiParameters(parseAbiParameters('bytes'), result);

const checks = [
  ['gateway answered with a payload', typeof data === 'string' && data.length > 2],
  // ENSIP-9/11: for EVM coin types the record is the 20 byte address, not a
  // 32 byte word.
  ['result decodes to a 20 byte EVM address', addressBytes.length === 42],
  ['expiry is in the future', expires > BigInt(Math.floor(Date.now() / 1000))],
  ['signature recovers to a signer', /^0x[0-9a-fA-F]{40}$/.test(recovered)],
];

if (expect) {
  checks.push([
    `returned record is the expected owner (${expect})`,
    addressBytes.toLowerCase().endsWith(expect.slice(2).toLowerCase()),
  ]);
}

console.log(`gateway ${gatewayUrl}`);
console.log(`  label    ${label}.${root}`);
console.log(`  node     ${node}`);
console.log(`  record   ${addressBytes}`);
console.log(`  expires  ${expires}`);
console.log(`  signer   ${recovered}`);
console.log('');
for (const [name, ok] of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);

if (checks.some(([, ok]) => !ok)) process.exit(1);
console.log('\nGateway smoke test passed.');
