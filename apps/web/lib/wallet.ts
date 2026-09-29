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
};

export function getProvider(): Eip1193Provider {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new WalletError(
      'NO_WALLET',
      '没有检测到浏览器钱包。装一个 MetaMask 或 Coinbase Wallet，或者直接对你的 AI 说“帮你自己注册个名字”。',
    );
  }
  return window.ethereum;
}

export function hasWallet(): boolean {
  return typeof window !== 'undefined' && Boolean(window.ethereum);
}

export async function currentChainId(): Promise<number> {
  const hex = (await getProvider().request({ method: 'eth_chainId' })) as string;
  return Number.parseInt(hex, 16);
}

export async function connect(): Promise<Address> {
  const accounts = (await getProvider().request({
    method: 'eth_requestAccounts',
  })) as string[];
  if (!accounts?.length) throw new WalletError('NO_ACCOUNT', '钱包没有返回任何账户。');
  return getAddress(accounts[0]);
}

export async function ensureChain(chainId: number): Promise<void> {
  const provider = getProvider();
  if ((await currentChainId()) === chainId) return;

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
        `请把钱包切到 ${spec?.name ?? `chainId ${chainId}`} 再试。`,
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

/** The same struct packages/core signs and MuseNameRegistrar verifies. */
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

export async function signRegister(
  account: Address,
  typedData: RegisterTypedData,
): Promise<Hex> {
  const client = createWalletClient({ account, transport: custom(getProvider() as never) });
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
      throw new WalletError('REJECTED', '你取消了签名。');
    }
    throw new WalletError('SIGN_FAILED', '签名没有完成，可以再试一次。');
  }
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
      throw new WalletError('REJECTED', '你取消了签名。');
    }
    throw new WalletError('SIGN_FAILED', '签名没有完成，可以再试一次。');
  }
}

export function shortAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function deadlineInSeconds(minutes = 15): number {
  return Math.floor(Date.now() / 1000) + minutes * 60;
}
