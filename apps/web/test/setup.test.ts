/**
 * The setup page sends mainnet transactions that only the root name's owner can
 * sign. These tests pin the parts that must never drift: the addresses, the
 * calldata, and the order the steps are allowed to happen in.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { decodeFunctionData, namehash } from 'viem';
import { describe, expect, it } from 'vitest';

import { L1_RESOLVER_BYTECODE } from '../lib/l1ResolverBytecode';
import {
  ENS_REGISTRY_ABI,
  L1_RESOLVER,
  RESOLVER_ABI,
  buildSetupSteps,
  deployResolverCalldata,
  observeSetup,
  resolverAddressFor,
  setL2RegistryCalldata,
  setResolverCalldata,
} from '../lib/setup';

const ROOT_OWNER = '0x022Ce19a356bc18c1977F6816Fdf05fAF22985b7' as const;
const OPERATOR = L1_RESOLVER.operator;
const REGISTRY = '0x0ca717398428bcae7fae24e656e8444ecd9ba5a5' as const;
const CHAINS = { rootName: 'musepass.eth', l2ChainId: 4663, l2Registry: REGISTRY };

describe('the bytecode the browser deploys', () => {
  it('is byte for byte the vendored Durin bytecode', () => {
    const vendored = readFileSync(
      resolve(__dirname, '../../../contracts/lib/durin-L1Resolver.deployable.txt'),
      'utf8',
    ).trim();
    expect(L1_RESOLVER_BYTECODE).toBe(vendored);
  });
});

describe('resolver address', () => {
  it('is fixed by the init code, not by who pays', () => {
    // Both of these were also produced by scripts/l1-resolver.mjs on a mainnet
    // fork, which is the point: the address never depends on the sender.
    expect(resolverAddressFor(L1_RESOLVER_BYTECODE as `0x${string}`, OPERATOR)).toBe(
      '0x9ea7a8896a68717e587bc1ee17b6b0b80eeeb443',
    );
    expect(resolverAddressFor(L1_RESOLVER_BYTECODE as `0x${string}`, ROOT_OWNER)).toBe(
      '0x6f18ae097a9898ba7f1d4bc4f4a0b771e9ef7e72',
    );
  });

  it('changes when the owner baked into the init code changes', () => {
    const a = resolverAddressFor(L1_RESOLVER_BYTECODE as `0x${string}`, OPERATOR);
    const b = resolverAddressFor(L1_RESOLVER_BYTECODE as `0x${string}`, ROOT_OWNER);
    expect(a).not.toBe(b);
  });

  it('sends bare calldata to the deployment proxy, salt first', () => {
    const data = deployResolverCalldata(L1_RESOLVER_BYTECODE as `0x${string}`, OPERATOR);
    expect(data.startsWith(L1_RESOLVER.salt)).toBe(true);
    expect(data.length).toBeGreaterThan(2 * 8000);
  });
});

describe('calldata', () => {
  it('setResolver encodes the root node and the resolver', () => {
    const resolver = resolverAddressFor(L1_RESOLVER_BYTECODE as `0x${string}`, OPERATOR);
    const data = setResolverCalldata('musepass.eth', resolver);
    expect(data.startsWith('0x1896f70a')).toBe(true); // setResolver(bytes32,address)
    const decoded = decodeFunctionData({ abi: ENS_REGISTRY_ABI, data });
    expect(decoded.functionName).toBe('setResolver');
    expect(decoded.args?.[0]).toBe(namehash('musepass.eth'));
    expect((decoded.args?.[1] as string).toLowerCase()).toBe(resolver.toLowerCase());
  });

  it('setL2Registry encodes the chain and the registry, in that order', () => {
    const data = setL2RegistryCalldata('musepass.eth', 4663, REGISTRY);
    expect(data.startsWith('0xea6f3698')).toBe(true); // setL2Registry(bytes32,uint64,address)
    const decoded = decodeFunctionData({ abi: RESOLVER_ABI, data });
    expect(decoded.args?.[0]).toBe(namehash('musepass.eth'));
    expect(decoded.args?.[1]).toBe(4663n);
    expect((decoded.args?.[2] as string).toLowerCase()).toBe(REGISTRY.toLowerCase());
  });
});

describe('step order', () => {
  const observation = (over: Partial<Parameters<typeof buildSetupSteps>[0]> = {}) => ({
    connected: ROOT_OWNER,
    rootOwner: ROOT_OWNER,
    deployedResolver: null as `0x${string}` | null,
    resolver: '0x9ea7a8896a68717e587bc1ee17b6b0b80eeeb443' as `0x${string}`,
    hasBytecode: true,
    l2RegistrySet: false,
    ensPointsAtResolver: false,
    ...over,
  });
  const steps = (over: Partial<ReturnType<typeof observation>> = {}) =>
    buildSetupSteps(observation(over), L1_RESOLVER_BYTECODE as `0x${string}`, CHAINS);

  it('will not let setResolver run before the data location is registered', () => {
    const [, setRegistry, setResolver] = steps({ deployedResolver: '0x9ea7a8896a68717e587bc1ee17b6b0b80eeeb443' });
    expect(setRegistry.sendable).toBe(true);
    // Pointing ENS at a resolver that does not know where the data lives takes
    // the root name itself offline, so this order is not a preference.
    expect(setResolver.sendable).toBe(false);
    expect(setResolver.blocker).toContain('previous step');
  });

  it('unlocks setResolver once the registry entry exists', () => {
    const [, , setResolver] = steps({
      deployedResolver: '0x9ea7a8896a68717e587bc1ee17b6b0b80eeeb443',
      l2RegistrySet: true,
    });
    expect(setResolver.sendable).toBe(true);
  });

  it('asks for the deploy first, and blocks the rest until it is there', () => {
    const [deploy, setRegistry] = steps();
    expect(deploy.done).toBe(false);
    expect(deploy.sendable).toBe(true);
    expect(setRegistry.sendable).toBe(false);
    expect(setRegistry.blocker).toContain('not deployed');
  });

  it('tells a stranger which account has to sign', () => {
    const [, setRegistry] = steps({
      connected: '0x1111111111111111111111111111111111111111',
      deployedResolver: '0x9ea7a8896a68717e587bc1ee17b6b0b80eeeb443',
    });
    expect(setRegistry.sendable).toBe(false);
    expect(setRegistry.blocker).toContain(ROOT_OWNER);
  });

  it('is finished, and quiet, when everything is done', () => {
    const all = steps({
      deployedResolver: '0x9ea7a8896a68717e587bc1ee17b6b0b80eeeb443',
      l2RegistrySet: true,
      ensPointsAtResolver: true,
    });
    expect(all.every((step) => step.done)).toBe(true);
    expect(all.some((step) => step.sendable)).toBe(false);
  });
});

describe('reading the chain', () => {
  /** A fake chain: a resolver deployed by the operator, nothing else yet. */
  function reader(state: {
    code: Record<string, string>;
    owner: string;
    resolver: string;
    registry?: readonly [bigint, string];
  }) {
    return {
      getCode: async ({ address }: { address: string }) =>
        (state.code[address.toLowerCase()] as `0x${string}`) ?? undefined,
      readContract: async ({ functionName, address }: { functionName: string; address: string }) => {
        if (address.toLowerCase() === L1_RESOLVER.ensRegistry.toLowerCase()) {
          if (functionName === 'owner') return state.owner;
          return state.resolver;
        }
        if (functionName === 'addr') return '0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401';
        if (functionName === 'l2Registry') return state.registry ?? [0n, '0x0000000000000000000000000000000000000000'];
        throw new Error(`unexpected call ${functionName}`);
      },
    };
  }

  const operatorResolver = resolverAddressFor(L1_RESOLVER_BYTECODE as `0x${string}`, OPERATOR);

  it('sees a deployed resolver and points the steps at it', async () => {
    const found = await observeSetup(
      reader({
        code: { [operatorResolver]: '0x6000' },
        owner: ROOT_OWNER,
        resolver: operatorResolver,
      }) as never,
      {
        rootName: 'musepass.eth',
        connected: ROOT_OWNER,
        bytecode: L1_RESOLVER_BYTECODE as `0x${string}`,
        plannedOwner: ROOT_OWNER,
        l2ChainId: 4663,
        l2Registry: REGISTRY,
      },
    );
    expect(found.deployedResolver).toBe(operatorResolver);
    expect(found.resolver).toBe(operatorResolver);
    expect(found.rootOwner).toBe(ROOT_OWNER);
    expect(found.l2RegistrySet).toBe(false);
    expect(found.ensPointsAtResolver).toBe(true);
  });

  it('treats a registry entry for another chain as not registered', async () => {
    const found = await observeSetup(
      reader({
        code: { [operatorResolver]: '0x6000' },
        owner: ROOT_OWNER,
        resolver: '0xF29100983E058B709F3D539b0c765937B804AC15',
        registry: [8453n, REGISTRY],
      }) as never,
      {
        rootName: 'musepass.eth',
        connected: ROOT_OWNER,
        bytecode: L1_RESOLVER_BYTECODE as `0x${string}`,
        plannedOwner: ROOT_OWNER,
        l2ChainId: 4663,
        l2Registry: REGISTRY,
      },
    );
    expect(found.l2RegistrySet).toBe(false);
    expect(found.ensPointsAtResolver).toBe(false);
  });
});
