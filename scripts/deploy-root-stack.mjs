#!/usr/bin/env node
/**
 * Deploy the L2 half of a new root name.
 *
 * A Durin registry is created per root — it mints the root as its own ERC-721 and
 * stamps `baseNode` in at initialisation, so a new root needs a new registry, and
 * our registrar reads `baseNode` from the registry it is given. Four steps, all
 * from the operator key:
 *
 *   factory.deployRegistry(name, symbol, baseURI, admin)   → a registry for the root
 *   new MusePassRegistrar(registry, ...)                   → the contract that issues names
 *   registry.addRegistrar(registrar)                       → let it write records
 *   registrar.setRelayer(issuer, true)                     → let the API pay the gas
 *
 * The L1 half is separate and mostly not ours: the resolver we already deployed
 * is root-agnostic (it stores a registry per node), so registering a new root
 * there is one transaction from the resolver's owner, and pointing the new root
 * at it is one transaction from whoever owns the name.
 *
 *   node scripts/deploy-root-stack.mjs --root musepass.eth
 *   node scripts/deploy-root-stack.mjs --root musepass.eth --send
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  formatEther,
  http,
  parseAbi,
  parseAbiParameters,
  zeroAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const root = arg('root', 'musepass.eth');
const label = root.split('.')[0];
const send = process.argv.includes('--send');
const chains = JSON.parse(readFileSync(resolve(repoRoot, 'config/chains.json'), 'utf8'));
const rpcUrl = arg('rpc', process.env.ROBINHOOD_RPC_URL ?? chains.l2.rpcDefault);
const factory = arg('factory', chains.l2.durinRegistryFactory);

const keyText = readFileSync(arg('key-file', resolve(repoRoot, '.secrets/robinhood-deployer.txt')), 'utf8')
  .match(/0x[0-9a-fA-F]{64}/)?.[0];
if (!keyText) throw new Error('no deployer key');

const account = privateKeyToAccount(keyText);
const chain = {
  id: chains.l2.chainId,
  name: chains.l2.name,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });

const FACTORY_ABI = parseAbi([
  'function deployRegistry(string name, string symbol, string baseURI, address admin) returns (address)',
  'event RegistryDeployed(string name, address admin, address registry)',
]);
const REGISTRY_ABI = parseAbi([
  'function baseNode() view returns (bytes32)',
  'function owner() view returns (address)',
  'function addRegistrar(address registrar)',
  'function registrars(address) view returns (bool)',
]);
const REGISTRAR_ABI = parseAbi([
  'constructor(address registry_, string name_, string version_, address owner_, uint256 minLabelBytes_)',
  'function setRelayer(address relayer, bool allowed)',
  'function baseNode() view returns (bytes32)',
  'function registry() view returns (address)',
]);

const artifact = JSON.parse(
  readFileSync(resolve(repoRoot, 'contracts/out/MusePassRegistrar.sol/MusePassRegistrar.json'), 'utf8'),
);

// The issuer key the API uses to pay for registrations. It is a relayer on the
// registrar and nothing else (see deployments/robinhood.json).
const issuer = (() => {
  const path = resolve(repoRoot, '.secrets/issuer.txt');
  if (!existsSync(path)) return null;
  const match = readFileSync(path, 'utf8').match(/0x[0-9a-fA-F]{64}/);
  return match ? privateKeyToAccount(match[0]).address : null;
})();

console.log('Deploy the stack for a root name');
console.log(`  root      ${root}`);
console.log(`  chain     ${chains.l2.name} (${chains.l2.chainId})`);
console.log(`  factory   ${factory}`);
console.log(`  admin     ${account.address}`);
console.log(`  issuer    ${issuer ?? '(unknown — setRelayer will be skipped)'}`);

const balance = await publicClient.getBalance({ address: account.address });
console.log(`  balance   ${formatEther(balance)} ETH`);

if (!send) {
  console.log('\ndry run. Add --send to deploy.');
  process.exit(0);
}

// 1. The registry, which mints the root and stamps baseNode in. Pass
//    `--registry` to resume after a run that already created one.
let registry = arg('registry', '');
let registryTx = '';
if (registry) {
  console.log(`\n  registry  ${registry}   (existing, not redeployed)`);
} else {
registryTx = await wallet.writeContract({
  address: factory,
  abi: FACTORY_ABI,
  functionName: 'deployRegistry',
  args: [root, label.toUpperCase(), '', account.address],
});
const registryReceipt = await publicClient.waitForTransactionReceipt({ hash: registryTx });
// Decode the log by hand: `RegistryDeployed(string name, address admin, address
// registry)` is entirely in the data, and a factory deployed from an earlier
// Durin revision can carry a slightly different event hash than the current
// source. The argument layout is the thing that matters, and it is stable.
const deployed = registryReceipt.logs
  .map((log) => {
    try {
      const [name, admin, created] = decodeAbiParameters(
        parseAbiParameters('string, address, address'),
        log.data,
      );
      return { name, admin, created };
    } catch {
      return null;
    }
  })
  .find((entry) => entry && entry.created !== zeroAddress);
registry = deployed?.created;
if (!registry) throw new Error('the factory did not emit a registry address');
console.log(`\n  registry  ${registry}   tx ${registryTx}`);
}

// 2. Our registrar, bound to that registry.
const registrarTx = await wallet.deployContract({
  abi: REGISTRAR_ABI,
  bytecode: artifact.bytecode.object,
  args: [registry, 'MusePass', '1', account.address, 3n],
});
const registrarReceipt = await publicClient.waitForTransactionReceipt({ hash: registrarTx });
const registrar = registrarReceipt.contractAddress;
if (!registrar) throw new Error('the registrar deployment produced no address');
console.log(`  registrar ${registrar}   tx ${registrarTx}`);

// 3. Let it write records in the registry.
const addTx = await wallet.writeContract({
  address: registry,
  abi: REGISTRY_ABI,
  functionName: 'addRegistrar',
  args: [registrar],
});
await publicClient.waitForTransactionReceipt({ hash: addTx });
console.log(`  addRegistrar tx ${addTx}`);

// 4. Let the API's issuer key pay for registrations.
if (issuer) {
  const relayerTx = await wallet.writeContract({
    address: registrar,
    abi: REGISTRAR_ABI,
    functionName: 'setRelayer',
    args: [issuer, true],
  });
  await publicClient.waitForTransactionReceipt({ hash: relayerTx });
  console.log(`  setRelayer tx ${relayerTx}`);
}

// Verify what the chain says, rather than what we think we sent.
const [registryBaseNode, registrarBaseNode, registrarRegistry, isRegistrar] = await Promise.all([
  publicClient.readContract({ address: registry, abi: REGISTRY_ABI, functionName: 'baseNode' }),
  publicClient.readContract({ address: registrar, abi: REGISTRAR_ABI, functionName: 'baseNode' }),
  publicClient.readContract({ address: registrar, abi: REGISTRAR_ABI, functionName: 'registry' }),
  publicClient.readContract({ address: registry, abi: REGISTRY_ABI, functionName: 'registrars', args: [registrar] }),
]);
const { namehash } = await import('viem');
const expected = namehash(root);
console.log('\nverified on chain');
console.log(`  baseNode matches namehash(${root}): ${registryBaseNode === expected && registrarBaseNode === expected}`);
console.log(`  registrar points at the registry:   ${registrarRegistry.toLowerCase() === registry.toLowerCase()}`);
console.log(`  registry accepts the registrar:     ${isRegistrar}`);

const recordPath = resolve(repoRoot, `deployments/${label}.json`);
writeFileSync(
  recordPath,
  `${JSON.stringify(
    {
      $comment: 'Real deployment. Chain is the source of truth; this file is the record.',
      chain: { name: chains.l2.name, chainId: chains.l2.chainId, explorer: chains.l2.explorer },
      root,
      baseNode: expected,
      admin: account.address,
      registry,
      registryTx,
      registrar,
      registrarTx,
      addRegistrarTx: addTx,
      issuer,
    },
    null,
    2,
  )}\n`,
);
console.log(`\nrecord ${recordPath.replace(`${repoRoot}/`, '')}`);
