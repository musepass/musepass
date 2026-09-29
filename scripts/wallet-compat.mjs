#!/usr/bin/env node
/**
 * What a wallet does when somebody types a MuseName name into it.
 *
 * Phase 1's acceptance asks for four mainstream wallets, by hand, because the
 * thing being tested is the wallet's own resolution path, not ours. This script
 * does the part a machine can do honestly: it runs the same four call shapes
 * through independent, widely used implementations and four unrelated public
 * RPC providers, and records exactly what each returned.
 *
 * What it cannot do is pretend to be a wallet app. The four human rows stay in
 * docs/wallet-compat/README.md.
 *
 *   node scripts/wallet-compat.mjs [--name xiaoming.musename.eth] [--expect 0x…]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JsonRpcProvider } from 'ethers';
import {
  createPublicClient,
  decodeAbiParameters,
  decodeErrorResult,
  encodePacked,
  encodeFunctionData,
  http,
  keccak256,
  namehash,
  recoverAddress,
} from 'viem';
import { mainnet } from 'viem/chains';
import { getEnsAddress } from 'viem/ens';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const name = arg('name', 'xiaoming.musename.eth');
const expected = arg('expect', '0x603b8B1f7a0Bc152b7D0Dcd7bFfBF1f2Af115f6d');
const MAINNET_COIN_TYPE = 60n;
/** ENSIP-11: 0x80000000 | chainId, as BigInt so JS cannot sign-flip it. */
const ROBINHOOD_COIN_TYPE = BigInt(0x80000000) | 4663n;

const RPCS = {
  'publicnode': 'https://ethereum-rpc.publicnode.com',
  'blastapi': 'https://eth-mainnet.public.blastapi.io',
  'drpc': 'https://eth.drpc.org',
  '1rpc': 'https://1rpc.io/eth',
};

const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const OWNER = '0x603b8B1f7a0Bc152b7D0Dcd7bFfBF1f2Af115f6d';
const GATEWAY_SIGNER = '0x47f471f726Ee612cc769Bc0b03F5482fA2ae1f1e';

const resolverAbi = [
  { type: 'function', name: 'resolver', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'addr', stateMutability: 'view', inputs: [{ type: 'bytes32' }, { type: 'uint256' }], outputs: [{ type: 'bytes' }] },
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'string' }] },
];

const results = [];
const add = (check, target, value, note = '') => {
  results.push({ check, target, value, note });
  const ok = note.startsWith('FAIL') ? 'FAIL' : 'ok  ';
  console.log(`  ${ok} ${check.padEnd(34)} ${String(target).padEnd(34)} ${value ?? ''}  ${note}`);
};

/**
 * Public RPC providers differ in how they treat the multi-step CCIP-Read flow:
 * some cache `eth_call`, some block the callback, some just rate limit a burst.
 * A wallet is only as good as the node behind it, so each provider gets a few
 * tries and the attempt count is recorded rather than hidden.
 */
async function withRetries(attempts, run) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const started = Date.now();
    try {
      return { value: await run(), attempts: attempt, ms: Date.now() - started };
    } catch (error) {
      last = error;
      if (attempt < attempts) await new Promise((done) => setTimeout(done, 2000));
    }
  }
  throw Object.assign(last, { attempts });
}

console.log(`MuseName wallet compatibility`);
console.log(`  name     ${name}`);
console.log(`  expected ${expected}`);
console.log('');

// 1. viem, the stack behind RainbowKit (Rainbow, Coinbase Wallet dapps, and
//    most other modern front ends). Both coin types, four providers.
console.log('viem getEnsAddress (RainbowKit / wagmi stack)');
for (const [label, rpc] of Object.entries(RPCS)) {
  const client = createPublicClient({ chain: mainnet, transport: http(rpc) });
  for (const [coin, coinType] of [['mainnet ETH', MAINNET_COIN_TYPE], ['Robinhood Chain', ROBINHOOD_COIN_TYPE]]) {
    try {
      const { value: address, attempts, ms } = await withRetries(3, () => getEnsAddress(client, { name, coinType }));
      add(`viem ${coin}`, label, address ?? 'null',
        address?.toLowerCase() === expected.toLowerCase() ? `${ms}ms, try ${attempts}` : `FAIL got ${address}`);
    } catch (error) {
      add(`viem ${coin}`, label, 'no answer',
        `FAIL after ${error.attempts ?? 1} tries: ${(error.shortMessage ?? error.message ?? '').split('\n')[0].slice(0, 60)}`);
    }
  }
}

// 2. ethers, the library most older and mobile wallets still use.
console.log('\nethers resolveName (mobile and older wallet stacks)');
for (const [label, rpc] of Object.entries(RPCS).slice(0, 2)) {
  const provider = new JsonRpcProvider(rpc);
  try {
    const { value: address, attempts } = await withRetries(3, () => provider.resolveName(name));
    add('ethers resolveName', label, address ?? 'null',
      address?.toLowerCase() === expected.toLowerCase() ? `try ${attempts}` : `FAIL got ${address}`);
  } catch (error) {
    add('ethers resolveName', label, 'no answer',
      `FAIL after ${error.attempts ?? 1} tries: ${(error.shortMessage ?? error.message ?? '').split('\n')[0].slice(0, 60)}`);
  }
}

// 3. The narrow path: ask the name's resolver directly for addr(node, 60), which
//    is what a wallet does when it does not use the ENS Universal Resolver. It
//    should refuse with ERC-3668 and hand over the gateway URL.
console.log('\nclassic resolver call, addr(node, 60)');
const client = createPublicClient({ chain: mainnet, transport: http(RPCS.publicnode) });
const rootResolver = await client.readContract({
  address: ENS_REGISTRY,
  abi: resolverAbi,
  functionName: 'resolver',
  args: [namehash('musename.eth')],
});
const callData = encodeFunctionData({
  abi: resolverAbi,
  functionName: 'addr',
  args: [namehash(name), MAINNET_COIN_TYPE],
});
/** DNS wire format: length-prefixed labels, terminated by a zero byte. */
const dnsName = `0x${name
  .split('.')
  .map((label) => label.length.toString(16).padStart(2, '0') + Buffer.from(label, 'utf8').toString('hex'))
  .join('')}00`;

async function rawCall(to, data) {
  // Straight JSON-RPC, not through a client: the revert payload is the whole
  // answer here, and libraries hide it at different depths (or drop it).
  return (
    await fetch(RPCS.publicnode, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
    })
  ).json();
}

// Legacy path: the shape every wallet used before ENSIP-10. Durin's resolver
// does not implement it — there is nothing at this selector — so a wallet that
// only knows this path cannot resolve a MuseName. Worth stating, not hiding.
const legacy = await rawCall(rootResolver, callData);
add(
  'legacy addr(node,60) on resolver',
  rootResolver.slice(0, 10) + '…',
  typeof legacy.result === 'string' ? 'answered' : 'reverted, no data',
  typeof legacy.result === 'string' ? 'legacy wallets work too' : 'expected: resolver only speaks ENSIP-10',
);

// The path wallets actually use: ENSIP-10 `resolve`, which must answer with an
// OffchainLookup pointing at our gateway.
const ensip10 = await rawCall(
  rootResolver,
  encodeFunctionData({
    abi: [{ type: 'function', name: 'resolve', stateMutability: 'view', inputs: [{ type: 'bytes' }, { type: 'bytes' }], outputs: [{ type: 'bytes' }] }],
    functionName: 'resolve',
    args: [dnsName, callData],
  }),
);
let offchainLookup = null;
if (typeof ensip10.error?.data === 'string' && ensip10.error.data.startsWith('0x556f1830')) {
  offchainLookup = ensip10.error.data;
  const offchainDecoded = decodeErrorResult({
    abi: [
      {
        type: 'error',
        name: 'OffchainLookup',
        inputs: [
          { name: 'sender', type: 'address' },
          { name: 'urls', type: 'string[]' },
          { name: 'callData', type: 'bytes' },
          { name: 'callbackFunction', type: 'bytes4' },
          { name: 'extraData', type: 'bytes' },
        ],
      },
    ],
    data: offchainLookup,
  });
  add('ENSIP-10 resolve(bytes,bytes)', 'OffchainLookup', offchainDecoded.args[1][0], 'the path wallets use');
} else {
  add('ENSIP-10 resolve(bytes,bytes)', String(ensip10.error?.message ?? 'no answer').slice(0, 24), 'reverted',
    'FAIL expected an OffchainLookup');
}


// 4. Following the ERC-3668 handshake by hand, the way a CCIP-Read capable
//    wallet does: fetch the gateway, then check the signature recovers to the
//    signer the resolver trusts.
if (offchainLookup) {
  console.log('\nfollow the offchain lookup (ERC-3668 capable wallets)');
  const decoded = decodeErrorResult({
    abi: [
      {
        type: 'error',
        name: 'OffchainLookup',
        inputs: [
          { name: 'sender', type: 'address' },
          { name: 'urls', type: 'string[]' },
          { name: 'callData', type: 'bytes' },
          { name: 'callbackFunction', type: 'bytes4' },
          { name: 'extraData', type: 'bytes' },
        ],
      },
    ],
    data: offchainLookup,
  });
  const url = decoded.args[1][0];
  // The placeholders take the OffchainLookup's own callData (the call the
  // resolver wants made), not the inner addr() call we started with.
  const gateway = url.replace('{sender}', rootResolver).replace('{data}', decoded.args[2]);
  const response = await fetch(gateway);
  const body = await response.json();
  add('gateway responds', new URL(gateway).host, `HTTP ${response.status}`);
  // The gateway packs result ‖ expires ‖ signature into one blob, which is what
  // the resolver's resolveWithProof decodes. Unpack it and check the signature
  // the way the contract will: keccak(0x1900 ‖ sender ‖ expires ‖
  // keccak(request) ‖ keccak(result)).
  const packed = body?.data;
  if (typeof packed !== 'string' || packed.length < 2 + 65 * 2) {
    add('gateway payload', new URL(gateway).host, JSON.stringify(body).slice(0, 40), 'FAIL no packed payload');
  } else {
    // ABI-encoded (bytes result, uint64 expires, bytes sig) — the shape the
    // resolver's resolveWithProof decodes.
    const [result, expires, signature] = decodeAbiParameters(
      [
        { name: 'result', type: 'bytes' },
        { name: 'expires', type: 'uint64' },
        { name: 'sig', type: 'bytes' },
      ],
      packed,
    );
    const hash = keccak256(
      encodePacked(
        ['bytes', 'address', 'uint64', 'bytes32', 'bytes32'],
        ['0x1900', rootResolver, expires, keccak256(decoded.args[2]), keccak256(result)],
      ),
    );
    const signer = await recoverAddress({ hash, signature });
    // `result` is the resolver's return value, itself ABI-encoded bytes.
    const [inner] = decodeAbiParameters([{ type: 'bytes' }], result);
    const decodedAddress = `0x${inner.slice(-40)}`;
    add(
      'gateway signature',
      GATEWAY_SIGNER,
      signer,
      signer.toLowerCase() === GATEWAY_SIGNER.toLowerCase() ? 'result is trustworthy' : 'FAIL wrong signer',
    );
    add(
      'gateway answered addr',
      decodedAddress,
      decodedAddress.toLowerCase() === expected.toLowerCase() ? 'matches the owner' : 'differs',
      decodedAddress.toLowerCase() === expected.toLowerCase() ? '' : 'FAIL wrong address',
    );
    add('gateway expiry', new Date(Number(expires) * 1000).toISOString().slice(0, 16), 'future',
      expires > BigInt(Math.floor(Date.now() / 1000)) ? '' : 'FAIL already expired');
  }
}

// 5. Reverse: would a wallet show the name instead of the hex address? Only if
//    the owner set a primary name; nothing here can set it for them.
console.log('\nreverse record (what a wallet shows for the address)');
const reverseNode = namehash(`${OWNER.slice(2).toLowerCase()}.addr.reverse`);
const reverseResolver = await client.readContract({
  address: ENS_REGISTRY,
  abi: resolverAbi,
  functionName: 'resolver',
  args: [reverseNode],
});
let primary = '';
try {
  primary = reverseResolver === '0x0000000000000000000000000000000000000000'
    ? ''
    : await client.readContract({
        address: reverseResolver,
        abi: resolverAbi,
        functionName: 'name',
        args: [reverseNode],
      });
} catch {
  primary = '';
}
add('primary name for owner', OWNER, primary || '(not set)',
  primary === name ? '' : 'wallet will show the raw address until the owner sets one');

const failures = results.filter((entry) => entry.note.startsWith('FAIL'));
const outDir = resolve(repoRoot, 'docs/wallet-compat');
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
writeFileSync(
  resolve(outDir, `machine-${stamp}.json`),
  `${JSON.stringify(
    { name, expected, coinTypes: { mainnet: '60', robinhood: ROBINHOOD_COIN_TYPE.toString() }, rpcs: RPCS, results },
    null,
    2,
  )}\n`,
);

console.log('');
console.log(`${results.length - failures.length}/${results.length} machine checks passed`);
console.log(`evidence docs/wallet-compat/machine-${stamp}.json`);
if (primary !== name) {
  console.log('');
  console.log('The four wallet rows in docs/wallet-compat/README.md still need a human.');
}
process.exit(failures.length === 0 ? 0 : 1);
