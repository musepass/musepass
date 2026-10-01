'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { defineChain } from 'viem';
import type { ReactNode } from 'react';

/**
 * The Robinhood Chain (4663) object for the browser. The API builds the same
 * chain from config/chains.json (`resolveChainDefinition`); this copy keeps the
 * web bundle independent of server config at runtime.
 */
export const robinhoodChain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' },
  },
});

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

/** False until a Privy app id is set at build time; every Privy UI hides. */
export const privyEnabled = Boolean(appId);

/**
 * Wraps the app in Privy when (and only when) an app id exists. Without one the
 * tree is unchanged: no script loads, no button renders, and the injected
 * wallet flow works exactly as before.
 */
export function PrivyGate({ children }: { children: ReactNode }) {
  if (!appId) return <>{children}</>;
  return (
    <PrivyProvider
      appId={appId}
      config={{
        // X first: the audience this exists for arrives from X without a
        // wallet. Email and external wallets stay available in the same modal.
        loginMethods: ['twitter', 'email', 'wallet'],
        embeddedWallets: {
          ethereum: { createOnLogin: 'all-users' },
        },
        supportedChains: [robinhoodChain],
        defaultChain: robinhoodChain,
        appearance: {
          theme: 'light',
          showWalletLoginFirst: false,
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
