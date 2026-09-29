import {
  createPublicClient,
  createWalletClient,
  http,
  namehash,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia, foundry } from 'viem/chains';
import type { MusenameConfig } from '@musename/core';
import type { ChainReader } from '../deps.js';

export const REGISTRAR_ABI = [
  {
    type: 'function',
    name: 'isAvailable',
    stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }],
    outputs: [{ type: 'bool' }],
  },
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
] as const;

export const L2_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
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
    name: 'makeNode',
    stateMutability: 'pure',
    inputs: [
      { name: 'parentNode', type: 'bytes32' },
      { name: 'label', type: 'string' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
] as const;

export interface ChainReaderOptions {
  config: MusenameConfig;
  rpcUrl?: string;
  /**
   * Absent in read-only mode: availability and lookup still work, claims fail
   * with a clear error instead of a stack trace.
   */
  issuerPrivateKey?: `0x${string}` | null;
}

/**
 * The only module that knows about viem. Clients are created here rather than
 * passed in, so viem's generic client types never cross a module boundary (that
 * is a reliable source of "two unrelated types with the same name" errors).
 */
export function createChainReader(options: ChainReaderOptions): ChainReader {
  const { config } = options;
  const registrar = config.chains.l2.registrar as Address | undefined;
  const l2Registry = config.chains.l2.l2Registry as Address | undefined;
  const baseNode = namehash(config.brand.rootName);

  const chainDefinition =
    config.chains.l2.chainId === base.id
      ? base
      : config.chains.l2.chainId === baseSepolia.id
        ? baseSepolia
        : config.chains.l2.chainId === foundry.id
          ? foundry
          : baseSepolia;
  const rpcUrl = options.rpcUrl ?? config.chains.l2.rpcUrl ?? chainDefinition.rpcUrls.default.http[0];
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: chainDefinition, transport });
  const issuerWallet = options.issuerPrivateKey
    ? createWalletClient({
        account: privateKeyToAccount(options.issuerPrivateKey),
        chain: chainDefinition,
        transport,
      })
    : null;

  const requireAddresses = (): { registrar: Address; l2Registry: Address } => {
    if (!registrar || !l2Registry) {
      throw new Error(
        'config/chains.json (or MUSENAME_L2_REGISTRY / MUSENAME_REGISTRAR) is missing an address; deploy phase 1 before issuing names',
      );
    }
    return { registrar, l2Registry };
  };

  const nodeFor = async (label: string): Promise<Hex> =>
    publicClient.readContract({
      address: requireAddresses().l2Registry,
      abi: L2_REGISTRY_ABI,
      functionName: 'makeNode',
      args: [baseNode, label],
    }) as Promise<Hex>;

  return {
    async isLabelAvailable(label) {
      return (await publicClient.readContract({
        address: requireAddresses().registrar,
        abi: REGISTRAR_ABI,
        functionName: 'isAvailable',
        args: [label],
      })) as boolean;
    },

    async getOwner(label) {
      const owner = (await publicClient.readContract({
        address: requireAddresses().l2Registry,
        abi: L2_REGISTRY_ABI,
        functionName: 'owner',
        args: [await nodeFor(label)],
      })) as Address;
      return owner === '0x0000000000000000000000000000000000000000' ? null : owner;
    },

    async readText(label, key) {
      const value = (await publicClient.readContract({
        address: requireAddresses().l2Registry,
        abi: L2_REGISTRY_ABI,
        functionName: 'text',
        args: [await nodeFor(label), key],
      })) as string;
      return value ? value : null;
    },

    async writeText(input) {
      if (!issuerWallet) {
        throw new Error('issuer wallet is not configured; cannot publish on chain');
      }
      const txHash = await issuerWallet.writeContract({
        address: requireAddresses().l2Registry,
        abi: L2_REGISTRY_ABI,
        functionName: 'setTextWithSignature',
        args: [
          await nodeFor(input.label),
          input.key,
          input.value,
          input.expiration,
          input.signer,
          input.signature,
        ],
        account: issuerWallet.account,
        chain: issuerWallet.chain,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== 'success') {
        throw new Error(`publishing the record reverted: ${txHash}`);
      }
      return { txHash };
    },

    async register(input) {
      if (!issuerWallet) {
        throw new Error('issuer wallet is not configured; cannot submit registrations');
      }
      const txHash = await issuerWallet.writeContract({
        address: requireAddresses().registrar,
        abi: REGISTRAR_ABI,
        functionName: 'register',
        args: [input.label, input.owner, input.deadline, input.signature],
        account: issuerWallet.account,
        chain: issuerWallet.chain,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== 'success') {
        throw new Error(`registration transaction reverted: ${txHash}`);
      }
      return { txHash, node: await nodeFor(input.label) };
    },
  };
}
