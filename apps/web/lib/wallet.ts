import { REGISTER_TYPES as CORE_REGISTER_TYPES } from '@musename/core/browser';
import { createWalletClient, custom, getAddress, type Address, type Hex } from 'viem';

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export class WalletError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'WalletError';
    this.code = code;
  }
}

interface ChainSpec {
  name: string;
  rpcUrls: string[];
  explorer?: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
}

/** Enough metadata to add a network the wallet has never seen before. */
export const KNOWN_CHAINS: Record<number, ChainSpec> = {
  1: {
    name: 'Ethereum',
    rpcUrls: ['https://ethereum-rpc.publicnode.com'],
    explorer: 'https://etherscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  8453: {
    name: 'Base',
    rpcUrls: ['https://mainnet.base.org'],
    explorer: 'https://basescan.org',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  84532: {
    name: 'Base Sepolia',
    rpcUrls: ['https://sepolia.base.org'],
    explorer: 'https://sepolia.basescan.org',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  31337: {
    name: 'Anvil (local)',
    rpcUrls: ['http://127.0.0.1:8545'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  4663: {
    name: 'Robinhood Chain',
    rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'],
    explorer: 'https://robinhoodchain.blockscout.com',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
};

export function getProvider(): Eip1193Provider {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new WalletError(
      'NO_WALLET',
      'No browser wallet found. Install MetaMask or Coinbase Wallet, or just tell your AI: “register a name for yourself”.',
    );
  }
  return window.ethereum;
}

export function hasWallet(): boolean {
  return typeof window !== 'undefined' && Boolean(window.ethereum);
}

export async function currentChainId(provider: Eip1193Provider = getProvider()): Promise<number> {
  const hex = (await provider.request({ method: 'eth_chainId' })) as string;
  return Number.parseInt(hex, 16);
}

export async function connect(): Promise<Address> {
  const accounts = (await getProvider().request({
    method: 'eth_requestAccounts',
  })) as string[];
  if (!accounts?.length) throw new WalletError('NO_ACCOUNT', 'The wallet returned no accounts.');
  return getAddress(accounts[0]);
}

export async function ensureChain(
  chainId: number,
  provider: Eip1193Provider = getProvider(),
): Promise<void> {
  if ((await currentChainId(provider)) === chainId) return;

  const spec = KNOWN_CHAINS[chainId];
  const hexChainId = `0x${chainId.toString(16)}`;

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexChainId }],
    });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 4902 || !spec) {
      throw new WalletError(
        'WRONG_CHAIN',
        `Switch your wallet to ${spec?.name ?? `chainId ${chainId}`} and try again.`,
      );
    }
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: hexChainId,
          chainName: spec.name,
          nativeCurrency: spec.nativeCurrency,
          rpcUrls: spec.rpcUrls,
          blockExplorerUrls: spec.explorer ? [spec.explorer] : undefined,
        },
      ],
    });
  }
}

/** The same struct packages/core signs and MusePassRegistrar verifies. */
export const REGISTER_TYPES = CORE_REGISTER_TYPES;

export interface RegisterTypedData {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: Address;
  };
  types: typeof REGISTER_TYPES;
  primaryType: 'Register';
  /** viem maps `uint256` to bigint; it serialises to hex for the wallet. */
  message: { label: string; owner: Address; deadline: bigint };
}

/**
 * The same signing as `signRegister`, against any EIP-1193 provider — the
 * browser extension's `window.ethereum` or a Privy embedded wallet's
 * `getEthereumProvider()`. The signature is identical from either, which is
 * why the API never learns which kind of wallet signed.
 */
export async function signRegisterWithProvider(
  account: Address,
  typedData: RegisterTypedData,
  provider: Eip1193Provider,
): Promise<Hex> {
  const client = createWalletClient({ account, transport: custom(provider as never) });
  try {
    return await client.signTypedData({
      account,
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });
  } catch (error) {
    if ((error as { code?: number }).code === 4001) {
      throw new WalletError('REJECTED', 'You cancelled the signature.');
    }
    throw new WalletError('SIGN_FAILED', 'The signature did not complete. You can try again.');
  }
}

export async function signRegister(
  account: Address,
  typedData: RegisterTypedData,
): Promise<Hex> {
  return signRegisterWithProvider(account, typedData, getProvider());
}

/**
 * Signs the raw 32 byte hash the registry's `setTextWithSignature` compares
 * against, via personal_sign.
 *
 * Do NOT hand it the already EIP-191 wrapped hash: personal_sign wraps what it
 * is given, so a wrapped input ends up wrapped twice and every publish reverts
 * with Unauthorized. That mistake cost a real testnet transaction to find.
 */
export async function signCardPayload(account: Address, payload: Hex): Promise<Hex> {
  const client = createWalletClient({ account, transport: custom(getProvider() as never) });
  try {
    return await client.signMessage({ account, message: { raw: payload } });
  } catch (error) {
    if ((error as { code?: number }).code === 4001) {
      throw new WalletError('REJECTED', 'You cancelled the signature.');
    }
    throw new WalletError('SIGN_FAILED', 'The signature did not complete. You can try again.');
  }
}

export function shortAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/* ------------------------------------------------------------------ */
/* D19: paying for a name in USDG                                      */
/* ------------------------------------------------------------------ */

/** ABI-encode `transfer(address,uint256)` without pulling in a codec. */
function erc20TransferData(to: Address, amountBaseUnits: bigint): `0x${string}` {
  const address = to.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const amount = amountBaseUnits.toString(16).padStart(64, '0');
  return `0xa9059cbb${address}${amount}` as `0x${string}`;
}

/**
 * Sends the USDG payment from the connected wallet. Works with any EIP-1193
 * provider — a browser extension or a Privy embedded wallet — because it is
 * just eth_sendTransaction with ERC-20 calldata; wallets render it as an
 * ordinary token transfer.
 */
export async function sendErc20TransferWithProvider(
  account: Address,
  token: Address,
  to: Address,
  amountBaseUnits: bigint,
  provider: Eip1193Provider,
): Promise<Hex> {
  try {
    return (await provider.request({
      method: 'eth_sendTransaction',
      params: [
        {
          from: account,
          to: token,
          value: '0x0',
          data: erc20TransferData(to, amountBaseUnits),
        },
      ],
    })) as Hex;
  } catch (error) {
    if ((error as { code?: number }).code === 4001) {
      throw new WalletError('REJECTED', 'You cancelled the payment.');
    }
    throw new WalletError('SEND_FAILED', 'The payment did not send. You can try again.');
  }
}

export async function sendErc20Transfer(
  account: Address,
  token: Address,
  to: Address,
  amountBaseUnits: bigint,
): Promise<Hex> {
  return sendErc20TransferWithProvider(account, token, to, amountBaseUnits, getProvider());
}

/**
 * The wallet's USDG balance, via a plain eth_call so no RPC endpoint needs to
 * be configured in the browser. Returns null when the call fails for any
 * reason — an unknown balance must not block a payment the wallet may still
 * allow.
 */
export async function readErc20BalanceWithProvider(
  account: Address,
  token: Address,
  provider: Eip1193Provider,
): Promise<bigint | null> {
  try {
    const owner = account.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const result = (await provider.request({
      method: 'eth_call',
      params: [{ to: token, data: `0x70a08231${owner}` }, 'latest'],
    })) as string;
    if (!result || result === '0x') return null;
    return BigInt(result);
  } catch {
    return null;
  }
}

export async function readErc20Balance(account: Address, token: Address): Promise<bigint | null> {
  return readErc20BalanceWithProvider(account, token, getProvider());
}

export function deadlineInSeconds(minutes = 15): number {
  return Math.floor(Date.now() / 1000) + minutes * 60;
}
