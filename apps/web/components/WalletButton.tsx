'use client';

import { useWallet } from './WalletProvider';
import { shortAddress } from '@/lib/wallet';

export function WalletButton({ expectedChainIds }: { expectedChainIds: number[] }) {
  const { address, chainId, connecting, error, source, xHandle, privyEnabled, connectWallet, loginWithX, disconnect, clearError } = useWallet();
  // A page may be usable from more than one network: the name page edits the card
  // on the L2 and sets the primary name on mainnet. Only warn when the wallet is
  // on neither. An embedded wallet only signs, so it is never "wrong".
  const wrongChain =
    source === 'injected' && Boolean(address) && chainId !== null && !expectedChainIds.includes(chainId);

  if (address) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        {wrongChain ? (
          <span className="status-warn" style={{ fontSize: 13 }}>
            Wrong network
          </span>
        ) : null}
        <button
          type="button"
          className="btn btn-sm"
          onClick={disconnect}
          title={source === 'privy' ? 'Sign out (your on-chain names are unaffected)' : 'Disconnect (your on-chain names are unaffected)'}
        >
          <span className="mono">{xHandle && source === 'privy' ? `@${xHandle}` : shortAddress(address)}</span>
        </button>
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {privyEnabled ? (
        <button
          type="button"
          className="btn"
          disabled={connecting}
          onClick={() => {
            clearError();
            void loginWithX();
          }}
          title={error ?? 'Sign in with X — a wallet is created for you'}
        >
          {connecting ? 'Signing in…' : 'Continue with X'}
        </button>
      ) : null}
      <button
        type="button"
        className="btn"
        disabled={connecting}
        onClick={async () => {
          clearError();
          try {
            await connectWallet();
          } catch {
            // The provider already stored a readable message.
          }
        }}
        title={error ?? 'Connect a browser wallet'}
      >
        {connecting ? 'Connecting…' : 'Connect wallet'}
      </button>
    </span>
  );
}
