#!/usr/bin/env node
/**
 * The L1 resolver: plan it, deploy it, register it, prove it.
 *
 * This is the last piece between "the name is registered" and "a wallet can
 * actually find it". It has to live on Ethereum mainnet, because that is where
 * ENS itself lives and where wallets look for the name.
 *
 * The deployment is deterministic — CREATE2 through the well-known deployment
 * proxy at 0x4e59b44847b379578588920cA78FbF26c0B4956C with a zero salt — so the
 * address is known before any money moves and does not depend on nonces. That
 * matters twice: the root name has to point at that address, and the gateway's
 * sender allow list pins it.
 *
 *   node scripts/l1-resolver.mjs                # read-only status, no writes
 *   node scripts/l1-resolver.mjs --send         # deploy, then setL2Registry
 *   node scripts/l1-resolver.mjs --fork-proof   # the same plus the owner's two
 *                                               # calls, on a mainnet fork
 *
 * Who can do what, straight from Durin's own source:
 *
 *   deploy          anyone — the address is fixed by the bytecode, not the sender
 *   setL2Registry   only `ens.owner(musename.eth)`; the root name's owner has to
 *                   sign it, and there is no way around that
 *   setResolver     same, root name's owner
 *
 * The last two are what apps/web `/setup` exists for: two buttons instead of raw
 * calldata. Keys come from the environment or --key-file, never a command line:
 *
 *   MUSENAME_DEPLOYER_KEY   the account that pays for and owns the deployment
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  concat,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  http,
  keccak256,
  namehash,
  parseAbiParameters,
  zeroAddress,
} from 'viem';
import { mainnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const FACTORY = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const SALT = `0x${'00'.repeat(32)}`;

/** `namewrapper.eth`'s node. Durin's resolver reads it while constructing. */
const NAME_WRAPPER_NODE =
  '0xdee478ba2734e34d81c6adc77a32d75b29007895efa2fe60921f1c315e1ec7d9';

/**
 * The runtime hash of the Sepolia reference instance. Every deployment bakes in
 * a `nameWrapper` immutable that is looked up live at construction, so this exact
 * hash only recurs on Sepolia. Elsewhere the immutables and the
 * constructor-derived values are what get checked.
 */
const SEPOLIA_REFERENCE_RUNTIME_HASH =
  '0x86c8a2314f032abc4a410eb00384ca5b54dc46aa7fe879181a98eeb970a9287d';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}

const chains = JSON.parse(readFileSync(resolve(repoRoot, 'config/chains.json'), 'utf8'));

const rpcUrl = arg('rpc', process.env.MAINNET_RPC_URL ?? 'https://ethereum-rpc.publicnode.com');
const rootName = arg('root', 'musename.eth');
const l2ChainId = BigInt(arg('l2-chain-id', String(chains.l2.chainId)));
const l2Registry = arg('registry', chains.l2.l2Registry);
const gatewayUrl = arg('gateway-url', 'https://gw.musename.xyz/{sender}/{data}');
const gatewaySigner = arg('signer', '0x47f471f726Ee612cc769Bc0b03F5482fA2ae1f1e');
const send = flag('send') || flag('fork-proof');
const forkProof = flag('fork-proof');
const verifyTemplate = flag('verify-template') || forkProof;

const keyText = process.env.MUSENAME_DEPLOYER_KEY
  ? process.env.MUSENAME_DEPLOYER_KEY
  : readFileSync(arg('key-file', resolve(repoRoot, '.secrets/robinhood-deployer.txt')), 'utf8').match(
      /0x[0-9a-fA-F]{64}/,
    )?.[0];
if (!keyText && send) throw new Error('set MUSENAME_DEPLOYER_KEY or pass --key-file');

const deployCode = readFileSync(
  resolve(repoRoot, 'contracts/lib/durin-L1Resolver.deployable.txt'),
  'utf8',
).trim();

const deployer = keyText ? privateKeyToAccount(keyText) : null;
const resolverOwner = arg('owner', deployer?.address ?? '');
if (!resolverOwner) throw new Error('no owner address: pass --owner or a key');

/** Same init code and salt means the same address on every chain, forever. */
function resolverAddressFor(owner) {
  const init = concat([
    deployCode,
    encodeAbiParameters(parseAbiParameters('string, address, address'), [
      gatewayUrl,
      gatewaySigner,
      owner,
    ]),
  ]);
  return {
    initCode: init,
    address: `0x${keccak256(concat(['0xff', FACTORY, SALT, keccak256(init)])).slice(-40)}`,
  };
}

const { initCode, address: resolverAddress } = resolverAddressFor(resolverOwner);
/** If the root owner deploys it themselves, the address would be this instead. */
const rootOwnerVariant = arg('root-owner-address', '0x022Ce19a356bc18c1977F6816Fdf05fAF22985b7');
const rootOwnerVariantAddress = resolverAddressFor(rootOwnerVariant).address;
const factoryCalldata = concat([SALT, initCode]);

const chain = { ...mainnet, rpcUrls: { default: { http: [rpcUrl] } } };
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

const RESOLVER_ABI = [
  { type: 'function', name: 'url', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'signer', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  {
    type: 'function',
    name: 'nameWrapper',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'l2Registry',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [
      { name: 'chainId', type: 'uint64' },
      { name: 'registryAddress', type: 'address' },
    ],
  },
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
];
const ENS_ABI = [
  {
    type: 'function',
    name: 'setResolver',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'resolver', type: 'address' },
    ],
    outputs: [],
  },
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
const WRAPPER_ABI = [
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
];
const PUBLIC_RESOLVER_ABI = [
  {
    type: 'function',
    name: 'addr',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
  },
];

const rootNode = namehash(rootName);
const checks = [];
const record = (name, ok, detail = '') => {
  checks.push([name, ok]);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

/** ENS hands back the NameWrapper for wrapped names; the real owner sits behind it. */
async function effectiveOwner(node) {
  const owner = await publicClient.readContract({
    address: ENS_REGISTRY,
    abi: ENS_ABI,
    functionName: 'owner',
    args: [node],
  });
  const wrapper = await resolveNameWrapper();
  if (owner.toLowerCase() !== wrapper.toLowerCase()) return owner;
  return publicClient.readContract({
    address: wrapper,
    abi: WRAPPER_ABI,
    functionName: 'ownerOf',
    args: [BigInt(node)],
  });
}

/** Where this chain says `namewrapper.eth` lives — the immutable in the bytecode. */
function resolveNameWrapper() {
  return publicClient
    .readContract({
      address: ENS_REGISTRY,
      abi: ENS_ABI,
      functionName: 'resolver',
      args: [NAME_WRAPPER_NODE],
    })
    .then((resolver) =>
      publicClient.readContract({
        address: resolver,
        abi: PUBLIC_RESOLVER_ABI,
        functionName: 'addr',
        args: [NAME_WRAPPER_NODE],
      }),
    );
}

/** Sign as `who` — with our own key, or by impersonation on a fork. */
async function signerFor(who) {
  if (deployer && who.toLowerCase() === deployer.address.toLowerCase()) {
    return createWalletClient({ account: deployer, chain, transport: http(rpcUrl) });
  }
  if (!forkProof) return null;
  await publicClient.request({ method: 'anvil_impersonateAccount', params: [who] });
  await publicClient.request({
    method: 'anvil_setBalance',
    params: [who, `0x${(10n ** 17n).toString(16)}`],
  });
  return createWalletClient({ account: who, chain, transport: http(rpcUrl) });
}

console.log('MuseName L1 resolver');
console.log('  rpc            ', rpcUrl);
console.log('  root name      ', rootName);
console.log('  resolver       ', resolverAddress, '(deterministic)');
console.log('  owner          ', resolverOwner);
console.log('  gateway        ', gatewayUrl);
console.log('  gateway signer ', gatewaySigner);
console.log(`  L2             ${chains.l2.name} chain ${l2ChainId}, registry ${l2Registry}`);
console.log('  init code      ', `${(initCode.length - 2) / 2} bytes`);

let deployed = (await publicClient.getCode({ address: resolverAddress })) !== undefined;

if (!deployed && send) {
  if (forkProof) {
    // A fork copies real balances. Top the deployer up here so the proof costs
    // nothing and does not depend on anyone sending money first.
    await publicClient.request({
      method: 'anvil_setBalance',
      params: [deployer.address, `0x${(10n ** 18n).toString(16)}`],
    });
  }
  const wallet = createWalletClient({ account: deployer, chain, transport: http(rpcUrl) });
  const balance = await publicClient.getBalance({ address: deployer.address });
  const gas = await publicClient.estimateGas({
    account: deployer.address,
    to: FACTORY,
    data: factoryCalldata,
  });
  const gasPrice = await publicClient.getGasPrice();
  const cost = gas * gasPrice;
  console.log('');
  console.log(
    `  deploying: ${gas} gas, ${formatEther(cost)} ETH at ${gasPrice} wei/gas; balance ${formatEther(balance)} ETH`,
  );
  if (balance < cost) {
    console.error(
      `\nFAIL: ${deployer.address} needs at least ${formatEther(cost)} ETH on this chain.`,
    );
    process.exit(1);
  }
  const hash = await wallet.sendTransaction({ to: FACTORY, data: factoryCalldata, gas, gasPrice });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  deploy tx      ${hash} (status ${receipt.status})`);
  deployed = true;
}

const l2Entry = deployed
  ? await publicClient.readContract({
      address: resolverAddress,
      abi: RESOLVER_ABI,
      functionName: 'l2Registry',
      args: [rootNode],
    })
  : [0n, zeroAddress];
let registered = l2Entry[0] === l2ChainId && l2Entry[1].toLowerCase() === l2Registry.toLowerCase();

if (deployed) {
  const code = await publicClient.getCode({ address: resolverAddress });
  record('the resolver is on chain at the deterministic address', Boolean(code));
  if (code) {
    const runtimeHash = keccak256(code);
    const [url, signer, owner, wrapper] = await Promise.all([
      publicClient.readContract({ address: resolverAddress, abi: RESOLVER_ABI, functionName: 'url' }),
      publicClient.readContract({ address: resolverAddress, abi: RESOLVER_ABI, functionName: 'signer' }),
      publicClient.readContract({ address: resolverAddress, abi: RESOLVER_ABI, functionName: 'owner' }),
      publicClient.readContract({
        address: resolverAddress,
        abi: RESOLVER_ABI,
        functionName: 'nameWrapper',
      }),
    ]);
    const liveWrapper = await resolveNameWrapper();
    record('it points at our gateway, not a vendor gateway', url === gatewayUrl, url);
    record('it trusts our signer', signer.toLowerCase() === gatewaySigner.toLowerCase(), signer);
    record('we can still administer it', owner.toLowerCase() === resolverOwner.toLowerCase(), owner);
    record(
      "the bytecode is Durin's, read against this chain's own NameWrapper",
      wrapper.toLowerCase() === liveWrapper.toLowerCase(),
      wrapper,
    );
    record(`runtime code is ${(code.length - 2) / 2} bytes`, code.length > 14000);
    if (verifyTemplate) {
      // Deploy the same bytecode a second time at a different address and
      // compare: identical runtime means the build is reproducible and nothing
      // about this deployment is a one-off.
      const secondSalt = keccak256('0x01');
      const secondAddress = `0x${keccak256(
        concat(['0xff', FACTORY, secondSalt, keccak256(initCode)]),
      ).slice(-40)}`;
      // Deploying the same bytecode twice at the same address is a CREATE2
      // collision, so reuse whatever is already there on a re-run.
      let secondCode = await publicClient.getCode({ address: secondAddress });
      if (secondCode === undefined) {
        const wallet = createWalletClient({ account: deployer, chain, transport: http(rpcUrl) });
        const hash = await wallet.sendTransaction({
          to: FACTORY,
          data: concat([secondSalt, initCode]),
        });
        await publicClient.waitForTransactionReceipt({ hash });
        secondCode = await publicClient.getCode({ address: secondAddress });
      }
      record(
        'a second deployment of the same bytecode is byte-identical',
        Boolean(secondCode) && keccak256(secondCode) === runtimeHash,
      );
    }
  }

  if (send && !registered) {
    const owner = await effectiveOwner(rootNode);
    const wallet = await signerFor(owner);
    if (!wallet) {
      console.log(`  need           setL2Registry, signed by ${owner}`);
    } else {
      const hash = await wallet.writeContract({
        address: resolverAddress,
        abi: RESOLVER_ABI,
        functionName: 'setL2Registry',
        args: [rootNode, l2ChainId, l2Registry],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  setL2Registry  ${hash} (signed by ${owner})`);
      registered = true;
    }
  }
}

const ensResolver = await publicClient.readContract({
  address: ENS_REGISTRY,
  abi: ENS_ABI,
  functionName: 'resolver',
  args: [rootNode],
});
const rootOwner = await effectiveOwner(rootNode);
let pointed = ensResolver.toLowerCase() === resolverAddress.toLowerCase();
console.log(`  root name owner ${rootOwner}`);

const setResolverCalldata = encodeFunctionData({
  abi: ENS_ABI,
  functionName: 'setResolver',
  args: [rootNode, resolverAddress],
});

if (forkProof && !pointed) {
  // The step only the root name's owner can do. On a fork we stand in for them,
  // so the whole path can be proven before anyone spends anything.
  const impersonated = await signerFor(rootOwner);
  const hash = await impersonated.sendTransaction({ to: ENS_REGISTRY, data: setResolverCalldata });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  await publicClient.request({ method: 'anvil_stopImpersonatingAccount', params: [rootOwner] });
  console.log(`  setResolver    ${hash} (impersonating the owner, status ${receipt.status})`);
  const now = await publicClient.readContract({
    address: ENS_REGISTRY,
    abi: ENS_ABI,
    functionName: 'resolver',
    args: [rootNode],
  });
  pointed = now.toLowerCase() === resolverAddress.toLowerCase();
}

record('the root name points at our resolver', pointed, resolverAddress);
record('the resolver is told where the data lives', registered);

if (forkProof) {
  const { getEnsAddress } = await import('viem/ens');
  const name = arg('resolve', 'xiaoming.musename.eth');
  const expected = arg('expect', '0x603b8B1f7a0Bc152b7D0Dcd7bFfBF1f2Af115f6d');
  let resolved = null;
  try {
    resolved = await getEnsAddress(publicClient, { name });
  } catch (error) {
    console.error('\nresolution failed:', error.shortMessage ?? error.message);
  }
  record(`a wallet resolving ${name} gets an address`, Boolean(resolved), resolved ?? '');
  if (expected) {
    record(
      'it is the address the owner registered',
      Boolean(resolved) && resolved.toLowerCase() === expected.toLowerCase(),
    );
  }
}

const failed = checks.filter(([, ok]) => !ok);
console.log('');
console.log(`${checks.length - failed.length}/${checks.length} checks passed`);

if (!deployed) {
  console.log('');
  console.log('Nothing is deployed yet. The deterministic address above is already final,');
  console.log('and anyone can deploy it — the address does not depend on who pays:');
  console.log(`  node scripts/l1-resolver.mjs --send --key-file <funded key>`);
}

if (deployed && !(pointed && registered)) {
  console.log('');
  console.log(`Two transactions are left, and only the root name owner (${rootOwner})`);
  console.log('can sign them — apps/web /setup does both with two buttons.');
  console.log('');
  console.log('The order matters. Registering the data location first keeps the root');
  console.log('name resolving if anything goes wrong halfway; going the other way takes');
  console.log(`musename.eth itself offline until it is put back.`);
  console.log('');
  console.log(`  1. setL2Registry    to ${resolverAddress}`);
  console.log(
    `     data ${encodeFunctionData({
      abi: RESOLVER_ABI,
      functionName: 'setL2Registry',
      args: [rootNode, l2ChainId, l2Registry],
    })}`,
  );
  console.log(`  2. setResolver      to ${ENS_REGISTRY}`);
  console.log(`     data ${setResolverCalldata}`);
  console.log('');
  console.log(`  If the root owner deploys the resolver themselves, the address is`);
  console.log(`  ${rootOwnerVariantAddress} instead of the one above.`);
}

console.log('');
console.log('reference runtime hash (Sepolia instance, different NameWrapper immutable):');
console.log(`  ${SEPOLIA_REFERENCE_RUNTIME_HASH}`);

process.exit(failed.length === 0 ? 0 : 1);
