/**
 * The one-time setup of the L1 resolver, expressed as a list of steps.
 *
 * Everything here is pure: the chain is read through an injected reader, and the
 * UI never invents a transaction. That keeps the dangerous part - two mainnet
 * transactions only the root name's owner can sign - inspectable and testable
 * without a wallet.
 *
 * Why the resolver address is what it is: it is deployed with CREATE2 through
 * the well-known deployment proxy, zero salt, so the address follows from the
 * init code alone. The init code carries (gatewayUrl, gatewaySigner, owner), so
 * changing any of the three changes the address. That `owner` is only the
 * resolver's Ownable owner, who may change the gateway URL later; it is NOT what
 * gates `setL2Registry`. Durin's source gates that one on ENS ownership of the
 * root name, which is why it cannot be delegated through this contract.
 */
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  namehash,
  parseAbiParameters,
  type Address,
  type Hex,
} from 'viem';

export const L1_RESOLVER = {
  /** The deployment proxy, at the same address on every major chain. */
  factory: '0x4e59b44847b379578588920cA78FbF26c0B4956C' as Address,
  ensRegistry: '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as Address,
  salt: `0x${'00'.repeat(32)}` as Hex,
  gatewayUrl: 'https://gw.musename.xyz/{sender}/{data}',
  gatewaySigner: '0x47f471f726Ee612cc769Bc0b03F5482fA2ae1f1e' as Address,
  /** The account MuseName deploys and administers the resolver with. */
  operator: '0x66F499e8F0A92e44A0F9c59a305E73a12b5684e7' as Address,
} as const;

/** namewrapper.eth, used to see past wrapping when reading the real owner. */
export const NAME_WRAPPER_NODE =
  '0xdee478ba2734e34d81c6adc77a32d75b29007895efa2fe60921f1c315e1ec7d9' as Hex;

export const ENS_REGISTRY_ABI = [
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
] as const;

export const RESOLVER_ABI = [
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
    name: 'l2Registry',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [
      { name: 'chainId', type: 'uint64' },
      { name: 'registryAddress', type: 'address' },
    ],
  },
  { type: 'function', name: 'url', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'signer', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const;

const WRAPPER_ABI = [
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
] as const;

const PUBLIC_RESOLVER_ABI = [
  {
    type: 'function',
    name: 'addr',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
  },
] as const;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

export interface ReadCall {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
}

/** The little bit of a viem public client this module needs. */
export interface SetupChainReader {
  getCode(args: { address: Address }): Promise<Hex | undefined>;
  readContract(args: ReadCall): Promise<unknown>;
}

export function resolverInitCode(bytecode: Hex, owner: Address): Hex {
  return concat([
    bytecode,
    encodeAbiParameters(parseAbiParameters('string, address, address'), [
      L1_RESOLVER.gatewayUrl,
      L1_RESOLVER.gatewaySigner,
      owner,
    ]),
  ]);
}

/** The address the proxy will produce. Known before anyone pays for anything. */
export function resolverAddressFor(bytecode: Hex, owner: Address): Address {
  const digest = keccak256(
    concat([
      '0xff',
      L1_RESOLVER.factory,
      L1_RESOLVER.salt,
      keccak256(resolverInitCode(bytecode, owner)),
    ]),
  );
  return `0x${digest.slice(-40)}` as Address;
}

/** Bare calldata for the deployment proxy: the salt, then the init code. */
export function deployResolverCalldata(bytecode: Hex, owner: Address): Hex {
  return concat([L1_RESOLVER.salt, resolverInitCode(bytecode, owner)]);
}

export function setResolverCalldata(rootName: string, resolver: Address): Hex {
  return encodeFunctionData({
    abi: ENS_REGISTRY_ABI,
    functionName: 'setResolver',
    args: [namehash(rootName), resolver],
  });
}

export function setL2RegistryCalldata(rootName: string, chainId: number, registry: Address): Hex {
  return encodeFunctionData({
    abi: RESOLVER_ABI,
    functionName: 'setL2Registry',
    args: [namehash(rootName), BigInt(chainId), registry],
  });
}

export interface SetupObservation {
  /** The wallet the visitor connected, if any. */
  connected: Address | null;
  /** Who ENS says owns the root name, with wrapping resolved. */
  rootOwner: Address | null;
  /** Which candidate deployment exists on chain, if either. */
  deployedResolver: Address | null;
  /** The address to use: the deployed one, or the planned one. */
  resolver: Address;
  hasBytecode: boolean;
  l2RegistrySet: boolean;
  ensPointsAtResolver: boolean;
}

export interface SetupStep {
  id: 'deploy' | 'setL2Registry' | 'setResolver';
  title: string;
  detail: string;
  done: boolean;
  /** Sendable right now, from the connected wallet. */
  sendable: boolean;
  /** Why not, in one sentence, when it is neither done nor sendable. */
  blocker: string | null;
  to: Address;
  data: Hex;
  value: bigint;
}

/**
 * The steps, in the only order that cannot break a working name.
 *
 * `setResolver` comes last: the moment the root name points at our resolver,
 * ENS stops answering from the default one, so the resolver has to know where
 * the data lives first. Backwards, `musename.eth` itself stops resolving until
 * someone puts it back.
 */
export function buildSetupSteps(
  observation: SetupObservation,
  bytecode: Hex,
  chains: { rootName: string; l2ChainId: number; l2Registry: Address },
): SetupStep[] {
  const { connected, rootOwner, deployedResolver, resolver } = observation;
  const isRootOwner = Boolean(
    connected && rootOwner && connected.toLowerCase() === rootOwner.toLowerCase(),
  );
  const ownerHint = rootOwner ? `The name owner is ${rootOwner}.` : 'The name owner could not be read.';

  return [
    {
      id: 'deploy',
      title: 'Deploy the L1 resolver',
      detail: `A one-time deployment at the precomputed address ${resolver}. The address is the same no matter who pays.`,
      done: Boolean(deployedResolver),
      sendable: !deployedResolver && Boolean(connected && observation.hasBytecode),
      blocker: !observation.hasBytecode
        ? 'This server has no copy of the contract bytecode; deploy from the command line instead — see docs/remaining-mainnet-steps.md.'
        : connected
          ? null
          : 'Connect a wallet first.',
      to: L1_RESOLVER.factory,
      data: deployResolverCalldata(bytecode, connected ?? L1_RESOLVER.operator),
      value: 0n,
    },
    {
      id: 'setL2Registry',
      title: 'Register which chain holds the data',
      detail:
        'Tell the resolver that subnames of musename.eth live in the Robinhood Chain registry. Only the name owner can sign this one.',
      done: observation.l2RegistrySet,
      sendable: !observation.l2RegistrySet && isRootOwner && Boolean(deployedResolver),
      blocker: !deployedResolver
        ? 'The resolver is not deployed yet.'
        : !isRootOwner
          ? `The name owner has to sign this one — connect with that account. ${ownerHint}`
          : null,
      to: resolver,
      data: setL2RegistryCalldata(chains.rootName, chains.l2ChainId, chains.l2Registry),
      value: 0n,
    },
    {
      id: 'setResolver',
      title: 'Point the name at our resolver',
      detail:
        'The last step. Only after this do subnames of musename.eth resolve in a wallet. It comes last because doing it the other way around would leave the root name itself unresolvable in the meantime.',
      done: observation.ensPointsAtResolver,
      sendable: !observation.ensPointsAtResolver && isRootOwner && observation.l2RegistrySet,
      blocker: !observation.l2RegistrySet
        ? 'Finish the previous step first: the resolver does not yet know where the data lives.'
        : !isRootOwner
          ? `The name owner has to sign this one. ${ownerHint}`
          : null,
      to: L1_RESOLVER.ensRegistry,
      data: setResolverCalldata(chains.rootName, resolver),
      value: 0n,
    },
  ];
}

/** Read the chain and turn it into the inputs of `buildSetupSteps`. */
export async function observeSetup(
  client: SetupChainReader,
  input: {
    rootName: string;
    connected: Address | null;
    bytecode: Hex;
    plannedOwner: Address;
    l2ChainId: number;
    l2Registry: Address;
  },
): Promise<SetupObservation> {
  const rootNode = namehash(input.rootName);
  const operatorResolver = resolverAddressFor(input.bytecode, L1_RESOLVER.operator);
  const plannedResolver = resolverAddressFor(input.bytecode, input.plannedOwner);

  const [ensResolver, rawOwner, operatorCode] = await Promise.all([
    client.readContract({
      address: L1_RESOLVER.ensRegistry,
      abi: ENS_REGISTRY_ABI,
      functionName: 'resolver',
      args: [rootNode],
    }),
    client.readContract({
      address: L1_RESOLVER.ensRegistry,
      abi: ENS_REGISTRY_ABI,
      functionName: 'owner',
      args: [rootNode],
    }),
    client.getCode({ address: operatorResolver }),
  ]);

  const holder = (rawOwner as Address | undefined) ?? null;
  const rootOwner = await resolveOwner(client, holder, rootNode);

  const plannedCode =
    plannedResolver.toLowerCase() === operatorResolver.toLowerCase()
      ? operatorCode
      : await client.getCode({ address: plannedResolver });
  const deployedResolver =
    operatorCode !== undefined ? operatorResolver : plannedCode !== undefined ? plannedResolver : null;
  const resolver = deployedResolver ?? operatorResolver;

  const entry = deployedResolver
    ? ((await client.readContract({
        address: deployedResolver,
        abi: RESOLVER_ABI,
        functionName: 'l2Registry',
        args: [rootNode],
      })) as readonly [bigint, Address])
    : ([0n, ZERO_ADDRESS] as const);

  return {
    connected: input.connected,
    rootOwner,
    deployedResolver,
    resolver,
    hasBytecode: input.bytecode.length > 2,
    l2RegistrySet:
      entry[0] === BigInt(input.l2ChainId) &&
      entry[1].toLowerCase() === input.l2Registry.toLowerCase(),
    ensPointsAtResolver:
      Boolean(ensResolver) && (ensResolver as Address).toLowerCase() === resolver.toLowerCase(),
  };
}

/** ENS answers with the NameWrapper for wrapped names; the owner sits behind it. */
async function resolveOwner(
  client: SetupChainReader,
  holder: Address | null,
  rootNode: Hex,
): Promise<Address | null> {
  if (!holder || holder === ZERO_ADDRESS) return null;
  const wrapperResolver = (await client.readContract({
    address: L1_RESOLVER.ensRegistry,
    abi: ENS_REGISTRY_ABI,
    functionName: 'resolver',
    args: [NAME_WRAPPER_NODE],
  })) as Address;
  const wrapper = (await client.readContract({
    address: wrapperResolver,
    abi: PUBLIC_RESOLVER_ABI,
    functionName: 'addr',
    args: [NAME_WRAPPER_NODE],
  })) as Address;
  if (holder.toLowerCase() !== wrapper.toLowerCase()) return holder;
  return (await client.readContract({
    address: wrapper,
    abi: WRAPPER_ABI,
    functionName: 'ownerOf',
    args: [BigInt(rootNode)],
  })) as Address;
}
