import { createPublicClient, http, type Address, type Chain, type Hex } from 'viem';
import { base, baseSepolia, foundry } from 'viem/chains';

export class GatewayError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
    this.status = status;
  }
}

const KNOWN_CHAINS: Record<number, Chain> = {
  [base.id]: base,
  [baseSepolia.id]: baseSepolia,
  [foundry.id]: foundry,
};

export interface L2ReadRequest {
  chainId: bigint;
  registryAddress: Address;
  callData: Hex;
}

export interface L2Reader {
  read(request: L2ReadRequest): Promise<Hex>;
  chains(): number[];
}

export interface L2ReaderOptions {
  /** Overrides per chain id, e.g. { 84532: 'http://127.0.0.1:8545' }. */
  rpcUrls?: Record<number, string>;
  timeoutMs?: number;
  /** Cache resolved reads for this long. Signed responses expire anyway. */
  cacheTtlMs?: number;
}

/**
 * Reads the L2 registry on behalf of the client.
 *
 * The registry *is* an ENS resolver, so the inner call from the L1 query can be
 * forwarded unchanged: there is no translation layer to get wrong. Results are
 * cached briefly because a page load fans out into several identical queries,
 * and because the signed response carries its own expiry.
 */
export function createL2Reader(options: L2ReaderOptions = {}): L2Reader {
  const cache = new Map<string, { value: Hex; expiresAt: number }>();
  const clients = new Map<number, ReturnType<typeof createPublicClient>>();
  const timeout = options.timeoutMs ?? 6000;
  const cacheTtl = options.cacheTtlMs ?? 2000;

  const clientFor = (chainId: number) => {
    const existing = clients.get(chainId);
    if (existing) return existing;
    const chain = KNOWN_CHAINS[chainId];
    if (!chain) {
      throw new GatewayError(
        'UNSUPPORTED_CHAIN',
        `chain ${chainId} is not configured on this gateway`,
        400,
      );
    }
    const url = options.rpcUrls?.[chainId] ?? chain.rpcUrls.default.http[0];
    const client = createPublicClient({
      chain,
      transport: http(url, { timeout }),
    }) as unknown as ReturnType<typeof createPublicClient>;
    clients.set(chainId, client);
    return client;
  };

  return {
    chains: () => Object.keys(KNOWN_CHAINS).map(Number),

    async read({ chainId, registryAddress, callData }) {
      const key = `${chainId}:${registryAddress}:${callData}`;
      const cached = cache.get(key);
      const now = Date.now();
      if (cached && cached.expiresAt > now) return cached.value;

      const client = clientFor(Number(chainId));
      try {
        const response = await client.call({
          to: registryAddress,
          data: callData,
        });
        const result = response.data;
        if (!result) {
          throw new GatewayError(
            'EMPTY_RESULT',
            `chain ${chainId} returned no data for ${registryAddress}`,
            502,
          );
        }
        cache.set(key, { value: result, expiresAt: now + cacheTtl });
        return result;
      } catch (error) {
        if (error instanceof GatewayError) throw error;
        throw new GatewayError(
          'L2_CALL_FAILED',
          `reading ${registryAddress} on chain ${chainId} failed: ${
            error instanceof Error
              ? ((error as { shortMessage?: string }).shortMessage ?? error.message)
              : String(error)
          }`,
          502,
        );
      }
    },
  };
}
