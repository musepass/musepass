'use client';

import { useWallet } from './WalletProvider';
import { shortAddress } from '@/lib/wallet';

export function WalletButton({ expectedChainId }: { expectedChainId: number }) {
  const { address, chainId, connecting, error, connectWallet, disconnect, clearError } = useWallet();
  const wrongChain = Boolean(address) && chainId !== expectedChainId;

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
          title="Disconnect (your on-chain names are unaffected)"
        >
          <span className="mono">{shortAddress(address)}</span>
        </button>
      </span>
    );
  }

  return (
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
  );
}
