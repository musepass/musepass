'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Address, Hex } from 'viem';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import {
  WalletError,
  connect,
  currentChainId,
  ensureChain,
  readErc20BalanceWithProvider,
  sendErc20TransferWithProvider,
  signRegister as signRegisterInjected,
  signRegisterWithProvider,
  type Eip1193Provider,
  type RegisterTypedData,
} from '@/lib/wallet';
import { privyEnabled } from './PrivyGate';

/** Just the surface WalletProvider needs from a Privy embedded wallet. */
interface PrivyWalletLike {
  address: string;
  getEthereumProvider(): Promise<Eip1193Provider | null>;
}

interface PrivySnapshot {
  authenticated: boolean;
  wallet: PrivyWalletLike | null;
  xHandle: string | null;
  login: () => void | Promise<void>;
  logout: () => void | Promise<void>;
  getAccessToken: () => Promise<string | null>;
}

interface WalletState {
  address: Address | null;
  chainId: number | null;
  connecting: boolean;
  error: string | null;
}

interface WalletContextValue extends WalletState {
  /** Which kind of wallet `address` came from. */
  source: 'injected' | 'privy' | null;
  /** The X username Privy verified, when the visitor logged in with X. */
  xHandle: string | null;
  privyEnabled: boolean;
  connectWallet: () => Promise<Address>;
  loginWithX: () => Promise<Address | null>;
  disconnect: () => void;
  switchTo: (chainId: number) => Promise<void>;
  signRegister: (typedData: RegisterTypedData) => Promise<Hex>;
  /**
   * D19: the one thing this site asks a wallet to *send* rather than sign —
   * the USDG payment for a purchase. Works for the extension and the embedded
   * wallet alike, and makes sure whichever it is sits on the payment chain.
   */
  payErc20: (input: {
    chainId: number;
    token: Address;
    to: Address;
    amountBaseUnits: bigint;
  }) => Promise<Hex>;
  /** The connected wallet's balance of an ERC-20, null when unreadable. */
  readErc20Balance: (token: Address) => Promise<bigint | null>;
  getAccessToken: () => Promise<string | null>;
  clearError: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WalletState>({
    address: null,
    chainId: null,
    connecting: false,
    error: null,
  });
  // Privy state arrives from <PrivySync> below; the API handle lives in a ref
  // so a new function identity never re-renders the tree.
  const [privyState, setPrivyState] = useState<PrivySnapshot | null>(null);
  const privyRef = useRef<PrivySnapshot | null>(null);

  // Restore an existing connection without prompting, and follow the wallet if
  // the user switches account or network in the extension.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum) return;
    let cancelled = false;

    (async () => {
      try {
        const accounts = (await window.ethereum!.request({ method: 'eth_accounts' })) as string[];
        if (cancelled || !accounts?.length) return;
        const chainId = await currentChainId();
        setState((prev) => ({ ...prev, address: accounts[0] as Address, chainId }));
      } catch {
        // A wallet that refuses eth_accounts is not connected, which is fine.
      }
    })();

    const provider = window.ethereum as unknown as {
      on?: (event: string, handler: (...args: never[]) => void) => void;
      removeListener?: (event: string, handler: (...args: never[]) => void) => void;
    };

    const onAccountsChanged = (...args: never[]) => {
      const accounts = args[0] as unknown as string[];
      setState((prev) => ({ ...prev, address: (accounts?.[0] as Address) ?? null }));
    };
    const onChainChanged = (...args: never[]) => {
      const hex = args[0] as unknown as string;
      setState((prev) => ({ ...prev, chainId: Number.parseInt(hex, 16) }));
    };

    provider.on?.('accountsChanged', onAccountsChanged);
    provider.on?.('chainChanged', onChainChanged);
    return () => {
      cancelled = true;
      provider.removeListener?.('accountsChanged', onAccountsChanged);
      provider.removeListener?.('chainChanged', onChainChanged);
    };
  }, []);

  const injected = state.address;

  // Whichever the user last acted on wins. An X login is an explicit choice,
  // so after it the embedded wallet is used even when a browser extension is
  // also connected (the passive `eth_accounts` restore never overrides it);
  // clicking "Connect wallet" switches back to the extension.
  const [activeSource, setActiveSource] = useState<'injected' | 'privy' | null>(null);
  const privyAddress = (privyState?.wallet?.address as Address | undefined) ?? null;
  const address: Address | null =
    activeSource === 'privy'
      ? privyAddress
      : activeSource === 'injected' && injected
        ? injected
        : injected ?? privyAddress;
  const usingInjected = Boolean(injected) && address === injected;
  const source: 'injected' | 'privy' | null = address
    ? usingInjected
      ? 'injected'
      : 'privy'
    : null;
  const chainId = usingInjected ? state.chainId : privyAddress ? 4663 : null;

  const connectWallet = useCallback(async () => {
    setState((prev) => ({ ...prev, connecting: true, error: null }));
    try {
      const connected = await connect();
      const chain = await currentChainId();
      setActiveSource('injected');
      setState({ address: connected, chainId: chain, connecting: false, error: null });
      return connected;
    } catch (error) {
      const message =
        error instanceof WalletError ? error.message : 'Could not connect the wallet. Try again.';
      setState({ address: null, chainId: null, connecting: false, error: message });
      throw error;
    }
  }, []);

  const loginWithX = useCallback(async (): Promise<Address | null> => {
    const privy = privyRef.current;
    if (!privy) {
      setState((prev) => ({ ...prev, error: 'Signing in with X is not available here.' }));
      return null;
    }
    setState((prev) => ({ ...prev, connecting: true, error: null }));
    try {
      await privy.login();
    } catch {
      setState((prev) => ({ ...prev, error: 'Could not sign in with X. Try again.' }));
      return null;
    }
    // The login can resolve a beat before the embedded wallet finishes being
    // created; wait for it so the caller can sign right away.
    for (let waited = 0; waited < 120; waited += 1) {
      const found = privyRef.current?.wallet?.address;
      if (found) {
        setActiveSource('privy');
        setState((prev) => ({ ...prev, connecting: false, error: null }));
        return found as Address;
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    setState((prev) => ({
      ...prev,
      connecting: false,
      error: 'Your wallet is still being created. Give it a moment and try again.',
    }));
    return null;
  }, []);

  const disconnect = useCallback(() => {
    setState({ address: null, chainId: null, connecting: false, error: null });
    setActiveSource(null);
    const logout = privyRef.current?.logout;
    if (logout) Promise.resolve(logout()).catch(() => {});
  }, []);

  const switchTo = useCallback(
    async (target: number) => {
      // A Privy embedded wallet never sends transactions on this site — the
      // issuer sponsors every claim — so there is nothing to switch.
      if (!usingInjected) return;
      try {
        await ensureChain(target);
        setState((prev) => ({ ...prev, chainId: target, error: null }));
      } catch (error) {
        const message =
          error instanceof WalletError ? error.message : 'Could not switch networks.';
        setState((prev) => ({ ...prev, error: message }));
        throw error;
      }
    },
    [usingInjected],
  );

  const signRegister = useCallback(
    async (typedData: RegisterTypedData): Promise<Hex> => {
      if (usingInjected && injected) return signRegisterInjected(injected, typedData);
      const wallet = privyState?.wallet;
      if (!wallet) throw new WalletError('NO_WALLET', 'Connect a wallet first.');
      const provider = await wallet.getEthereumProvider();
      if (!provider) throw new WalletError('NO_WALLET', 'The embedded wallet is not ready yet.');
      return signRegisterWithProvider(wallet.address as Address, typedData, provider);
    },
    [usingInjected, injected, privyState],
  );

  const getAccessToken = useCallback(async () => privyRef.current?.getAccessToken() ?? null, []);

  // The provider behind the active wallet. Claims only need a signature, but a
  // purchase sends a real transaction, and for an embedded wallet that is a
  // different provider than window.ethereum.
  const activeProvider = useCallback(async (): Promise<Eip1193Provider | null> => {
    if (usingInjected && injected) {
      const { getProvider } = await import('@/lib/wallet');
      try {
        return getProvider();
      } catch {
        return null;
      }
    }
    const wallet = privyRef.current?.wallet;
    if (!wallet?.address) return null;
    return wallet.getEthereumProvider();
  }, [usingInjected, injected]);

  const payErc20 = useCallback(
    async (input: {
      chainId: number;
      token: Address;
      to: Address;
      amountBaseUnits: bigint;
    }): Promise<Hex> => {
      const address = usingInjected && injected ? injected : (privyRef.current?.wallet?.address as Address | undefined);
      if (!address) throw new WalletError('NO_WALLET', 'Connect a wallet first.');
      const provider = await activeProvider();
      if (!provider) throw new WalletError('NO_WALLET', 'The wallet is not ready yet. Try again.');
      await ensureChain(input.chainId, provider);
      return sendErc20TransferWithProvider(address, input.token, input.to, input.amountBaseUnits, provider);
    },
    [usingInjected, injected, activeProvider],
  );

  const readErc20Balance = useCallback(
    async (token: Address): Promise<bigint | null> => {
      const address = usingInjected && injected ? injected : (privyRef.current?.wallet?.address as Address | undefined);
      if (!address) return null;
      const provider = await activeProvider();
      if (!provider) return null;
      return readErc20BalanceWithProvider(address, token, provider);
    },
    [usingInjected, injected, activeProvider],
  );

  const clearError = useCallback(() => setState((prev) => ({ ...prev, error: null })), []);

  // Stable identity on purpose: PrivySync's effect depends on this callback, so
  // an inline arrow here re-runs the effect on every render — and because the
  // effect calls setPrivyState with a fresh object, that is a render loop. A
  // pending React transition never commits inside that loop, which silently
  // killed every client-side <Link> navigation while Privy was enabled.
  const handlePrivyChange = useCallback((snapshot: PrivySnapshot) => {
    const hadWallet = privyRef.current?.wallet != null;
    // Nothing meaningful moved (Privy can hand out fresh object identities on
    // every render) — skip the state write or the tree renders in a circle.
    const prev = privyRef.current;
    if (
      prev &&
      prev.authenticated === snapshot.authenticated &&
      prev.wallet?.address === snapshot.wallet?.address &&
      prev.xHandle === snapshot.xHandle
    ) {
      return;
    }
    privyRef.current = snapshot;
    setPrivyState(snapshot);
    // A restored or fresh Privy session takes over the active wallet —
    // unless the user has since explicitly connected an extension.
    if (snapshot.authenticated && snapshot.wallet && !hadWallet) {
      setActiveSource((prev) => (prev === 'injected' ? prev : 'privy'));
    } else if (!snapshot.authenticated) {
      setActiveSource((prev) => (prev === 'privy' ? null : prev));
    }
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      address,
      chainId,
      connecting: state.connecting,
      error: state.error,
      source,
      xHandle: privyState?.xHandle ?? null,
      privyEnabled,
      connectWallet,
      loginWithX,
      disconnect,
      switchTo,
      signRegister,
      payErc20,
      readErc20Balance,
      getAccessToken,
      clearError,
    }),
    [
      address,
      chainId,
      state.connecting,
      state.error,
      source,
      privyState,
      connectWallet,
      loginWithX,
      disconnect,
      switchTo,
      signRegister,
      payErc20,
      readErc20Balance,
      getAccessToken,
      clearError,
    ],
  );

  return (
    <WalletContext.Provider value={value}>
      {/* Rendered only when Privy is configured, and must stay inside
          <PrivyGate>; it mirrors Privy's state into this context. */}
      {privyEnabled ? <PrivySync onChange={handlePrivyChange} /> : null}
      {children}
    </WalletContext.Provider>
  );
}

/** Reads Privy and pushes a plain snapshot up into WalletProvider's state. */
function PrivySync({ onChange }: { onChange: (snapshot: PrivySnapshot) => void }) {
  const { authenticated, login, logout, getAccessToken, user } = usePrivy();
  const { wallets } = useWallets();
  const wallet = wallets.find((w) => w.walletClientType === 'privy') ?? null;
  const xAccount = user?.linkedAccounts?.find((account) => account.type === 'twitter_oauth') as
    | { username?: string }
    | undefined;
  const xHandle = xAccount?.username?.replace(/^@/, '').toLowerCase() || null;

  useEffect(() => {
    onChange({
      authenticated,
      wallet: authenticated && wallet ? wallet : null,
      xHandle,
      login,
      logout,
      getAccessToken,
    });
  }, [authenticated, wallet, xHandle, login, logout, getAccessToken, onChange]);

  return null;
}

export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) throw new Error('useWallet must be used inside <WalletProvider>');
  return context;
}
