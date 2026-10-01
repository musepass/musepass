'use client';

import { useState } from 'react';
import type { Address } from 'viem';
import { useExportWallet } from '@privy-io/react-auth';

/**
 * The exit for X sign-in users. Their names live in the Privy embedded wallet,
 * which never sends a transaction on this site, so moving a name out starts
 * with exporting the key. Privy shows the key inside its own iframe — this
 * page never touches the plaintext.
 *
 * Rendered only for `source === 'privy'` (see MyNames): the hook requires a
 * signed-in user with an embedded wallet, which that condition guarantees.
 */
export function ExportWalletPanel({
  address,
  explorer,
}: {
  address: Address;
  explorer: string | null;
}) {
  const { exportWallet } = useExportWallet();
  const [open, setOpen] = useState(false);

  const onExport = () => {
    // A closed or dismissed modal is not an error worth showing.
    exportWallet({ address }).catch(() => undefined);
  };

  return (
    <div className="panel" style={{ display: 'grid', gap: 8 }}>
      <strong>Your wallet key</strong>
      <p className="body-2" style={{ margin: 0 }}>
        The wallet behind your X sign-in is a standard Ethereum wallet. You can export its private
        key and import it into any wallet app. Your names belong to this address, so they follow
        the key wherever you hold it.
      </p>
      {open ? (
        <div className="kv">
          <span>Moving a name</span>
          <span>
            Import the key, then add the Robinhood Chain network (chain ID 4663,{' '}
            <span className="mono">https://rpc.mainnet.chain.robinhood.com</span>)
            {explorer ? (
              <>
                {' '}
                —{' '}
                <a href={explorer} target="_blank" rel="noreferrer">
                  block explorer
                </a>
              </>
            ) : null}
            .
          </span>
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-sm" onClick={onExport}>
          Export your wallet key
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setOpen((prev) => !prev)}>
          {open ? 'Hide moving instructions' : 'How do I move a name?'}
        </button>
      </div>
    </div>
  );
}
