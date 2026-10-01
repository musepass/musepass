import {
  createPublicClient,
  createWalletClient,
  http,
  namehash,
  type Address,
  type Chain,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia, foundry } from 'viem/chains';
import type { MusenameConfig } from '@musename/core';
import type { ChainReader } from '../deps.js';

type NamesList = Array<{ label: string; owner: Address; blockNumber: number; txHash: Hex }>;

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

/** The registrar's own event: the only place a minted name is announced. */
export const NAME_REGISTERED_EVENT = {
  type: 'event',
  name: 'NameRegistered',
  inputs: [
    { name: 'node', type: 'bytes32', indexed: true },
    { name: 'label', type: 'string', indexed: false },
    { name: 'owner', type: 'address', indexed: true },
  ],
} as const;

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
 * Which chain the clients should believe they are on.
 *
 * This used to fall back to Base Sepolia for any chain id it did not recognise,
 * and that is a bug you cannot see in the tests: reads keep working, because an
 * `eth_call` carries no chain id, while every write comes back from the node as
 * "Missing or invalid parameters" because the client stamped the wrong chain id
 * onto the transaction. On the live service that meant registration and card
 * publishing were quietly impossible.
 *
 * A chain viem ships is used as is; anything else is built from config, which is
 * where the chain id, name and RPC already live.
 */
export function resolveChainDefinition(
  config: MusenameConfig,
  rpcUrlOverride?: string,
): Chain {
  const { chainId, name, rpcUrl, explorer } = config.chains.l2;
  const known = [base, baseSepolia, foundry].find((candidate) => candidate.id === chainId);
  if (known) return known;

  const url = rpcUrlOverride ?? rpcUrl ?? 'http://localhost:8545';
  return {
    id: chainId,
    name: name || `chain-${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [url] } },
    ...(explorer ? { blockExplorers: { default: { name, url: explorer } } } : {}),
    testnet: false,
  } as Chain;
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

  const chainDefinition = resolveChainDefinition(config, options.rpcUrl);
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

  /**
   * Names read from the registrar's events, cached for five minutes. Walking
   * logs is not a per-request operation, and a public count that changes on
   * every refresh is worse than one that is a few minutes old and says so.
   */
  let namesCache: { value: NamesList; expiresAt: number } | null = null;

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
    /**
     * Names read from the registrar's own events.
     *
     * Cached for five minutes: walking logs is not a per-request operation, and
     * a public count that moves on every refresh is worse than one that is a few
     * minutes old and says so. The scan walks backwards in chunks and stops
     * after consecutive empty chunks, so the cost is a handful of calls.
     */
    async listNames() {
      if (namesCache && namesCache.expiresAt > Date.now()) return namesCache.value;
      const { registrar: registrarAddress } = requireAddresses();
      const CHUNK = 1_000_000n;
      const EMPTY_CHUNKS_TO_STOP = 3;
      const MAX_CHUNKS = 150;

      let toBlock = await publicClient.getBlockNumber();
      let fromBlock = toBlock - CHUNK + 1n > 0n ? toBlock - CHUNK + 1n : 0n;
      const found: Array<{ label: string; owner: Address; blockNumber: number; txHash: Hex }> = [];
      let chunks = 0;
      let emptyChunks = 0;

      while (chunks < MAX_CHUNKS && toBlock >= 0n) {
        chunks += 1;
        const logs = await publicClient
          .getLogs({
            address: registrarAddress,
            event: NAME_REGISTERED_EVENT,
            fromBlock,
            toBlock,
          })
          .catch(() => []);
        if (logs.length === 0) {
          emptyChunks += 1;
          if (emptyChunks >= EMPTY_CHUNKS_TO_STOP) break;
        } else {
          emptyChunks = 0;
          for (const log of logs) {
            const { node: _node, label, owner } = log.args as {
              node?: Hex;
              label?: string;
              owner?: Address;
            };
            if (!label || !owner) continue;
            found.push({
              label,
              owner,
              blockNumber: Number(log.blockNumber ?? 0n),
              txHash: log.transactionHash as Hex,
            });
          }
        }
        if (fromBlock === 0n) break;
        toBlock = fromBlock - 1n;
        fromBlock = toBlock - CHUNK + 1n > 0n ? toBlock - CHUNK + 1n : 0n;
      }

      found.sort((a, b) => a.blockNumber - b.blockNumber || a.label.localeCompare(b.label));
      namesCache = { value: found, expiresAt: Date.now() + 5 * 60 * 1000 };
      return found;
    },

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

    /**
     * D19: verifies a USDG payment by reading the transaction receipt and
     * matching an ERC-20 Transfer event. Read-only, so it works whether or not
     * the issuer key is configured. Indexed `from`/`to` live in the last 20
     * bytes of their topics, which also handles operator-style transfers
     * harmlessly (the operator slot is simply ignored).
     */
    async verifyPayment(input) {
      const receipt = await publicClient.getTransactionReceipt({ hash: input.txHash }).catch(() => null);
      if (!receipt) return { ok: false, reason: 'NOT_FOUND' as const };
      if (receipt.status !== 'success') return { ok: false, reason: 'REVERTED' as const };

      const token = input.token.toLowerCase();
      const from = input.from.toLowerCase();
      const to = input.to.toLowerCase();
      let sawTokenTransfer = false;
      let sawFrom = false;
      let sawTo = false;
      let best = 0n;

      for (const log of receipt.logs) {
        if ((log.address as string).toLowerCase() !== token) continue;
        if (log.topics[0] !== TRANSFER_EVENT_TOPIC) continue;
        sawTokenTransfer = true;
        const logFrom = topicAddress(log.topics[1]);
        const logTo = topicAddress(log.topics[2]);
        if (logFrom === from) sawFrom = true;
        if (logTo === to) sawTo = true;
        if (logFrom === from && logTo === to) {
          const value = BigInt(log.data);
          if (value > best) best = value;
        }
      }

      if (!sawTokenTransfer) return { ok: false, reason: 'WRONG_TOKEN' as const };
      if (!sawFrom) return { ok: false, reason: 'WRONG_FROM' as const };
      if (!sawTo) return { ok: false, reason: 'WRONG_TO' as const };
      if (best < input.minAmount) return { ok: false, reason: 'INSUFFICIENT' as const };
      return { ok: true, amount: best, blockNumber: Number(receipt.blockNumber) };
    },
  };
}

/** keccak256('Transfer(address,address,uint256)') */
export const TRANSFER_EVENT_TOPIC: Hex =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

function topicAddress(topic: Hex | undefined): string {
  if (!topic) return '';
  return ('0x' + topic.slice(-40)).toLowerCase();
}
