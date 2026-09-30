'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Address } from 'viem';
import { WalletError, connect, currentChainId, ensureChain } from '@/lib/wallet';

interface WalletState {
  address: Address | null;
  chainId: number | null;
  connecting: boolean;
  error: string | null;
}

interface WalletContextValue extends WalletState {
  connectWallet: () => Promise<Address>;
  disconnect: () => void;
  switchTo: (chainId: number) => Promise<void>;
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

  const connectWallet = useCallback(async () => {
    setState((prev) => ({ ...prev, connecting: true, error: null }));
    try {
      const address = await connect();
      const chainId = await currentChainId();
      setState({ address, chainId, connecting: false, error: null });
      return address;
    } catch (error) {
      const message =
        error instanceof WalletError ? error.message : 'Could not connect the wallet. Try again.';
      setState({ address: null, chainId: null, connecting: false, error: message });
      throw error;
    }
  }, []);

  const disconnect = useCallback(() => {
    setState({ address: null, chainId: null, connecting: false, error: null });
  }, []);

  const switchTo = useCallback(async (chainId: number) => {
    try {
      await ensureChain(chainId);
      setState((prev) => ({ ...prev, chainId, error: null }));
    } catch (error) {
      const message = error instanceof WalletError ? error.message : 'Could not switch networks.';
      setState((prev) => ({ ...prev, error: message }));
      throw error;
    }
  }, []);

  const clearError = useCallback(() => setState((prev) => ({ ...prev, error: null })), []);

  const value = useMemo<WalletContextValue>(
    () => ({ ...state, connectWallet, disconnect, switchTo, clearError }),
    [state, connectWallet, disconnect, switchTo, clearError],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) throw new Error('useWallet must be used inside <WalletProvider>');
  return context;
}
