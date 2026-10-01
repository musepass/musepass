'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Address } from 'viem';

import { fetchOwnedNames, type OwnedNamesData } from '@/lib/api';
import { shortAddress } from '@/lib/wallet';
import { ExportWalletPanel } from './ExportWalletPanel';
import { useWallet } from './WalletProvider';

/**
 * "Where are my names?"
 *
 * Until this page existed the only way back to a name you had claimed was to
 * remember its label — the chain knew, but nobody could ask it. The list comes
 * from the registrar's own events, so it is the same record anyone else can
 * read, not a dashboard we maintain separately.
 */
export function MyNames({ explorer }: { explorer: string | null }) {
  const wallet = useWallet();
  const [data, setData] = useState<OwnedNamesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (owner: Address) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchOwnedNames(owner);
      setData(payload.data);
    } catch {
      setError('Could not read your names just now. Refresh and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (wallet.address) void load(wallet.address);
    else setData(null);
  }, [wallet.address, load]);

  const names = useMemo(() => data?.names ?? [], [data]);

  if (!wallet.address) {
    return (
      <div className="panel">
        <p className="body-2">
          Connect the wallet you claimed a name with, and this page lists everything it holds — read from
          the chain, not from an account we keep.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={wallet.connecting}
          onClick={() => void wallet.connectWallet().catch(() => undefined)}
        >
          {wallet.connecting ? 'Connecting…' : 'Connect wallet'}
        </button>
        {wallet.error ? <div className="notice notice-error">{wallet.error}</div> : null}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <p className="body-2">
        Showing names held by <span className="mono">{shortAddress(wallet.address)}</span>. Signing in
        proves nothing here: the list is the same one anybody could read for this address.
      </p>

      {loading ? <div className="notice notice-info">Reading the chain…</div> : null}
      {error ? <div className="notice notice-error">{error}</div> : null}

      {/* X sign-in users hold their names in the Privy embedded wallet; this is
          the only way out, so it belongs right next to the list. */}
      {wallet.source === 'privy' ? (
        <ExportWalletPanel address={wallet.address} explorer={explorer} />
      ) : null}

      {!loading && names.length === 0 ? (
        <div className="panel">
          <p className="body-2" style={{ marginTop: 0 }}>
            This wallet does not hold a name yet.
          </p>
          <Link className="btn btn-primary" href="/claim">
            Claim one
          </Link>
        </div>
      ) : null}

      {names.map((entry) => (
        <div key={entry.label} className="card" style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong className="mono">{entry.fullName}</strong>
          </div>
          <div className="kv">
            <span>Owner</span>
            <span className="mono mono-break">{entry.owner}</span>
            {entry.txHash ? (
              <>
                <span>Registered in</span>
                <span className="mono mono-break" style={{ fontSize: 12 }}>
                  {explorer ? (
                    <a href={`${explorer}/tx/${entry.txHash}`} target="_blank" rel="noreferrer">
                      {entry.txHash}
                    </a>
                  ) : (
                    entry.txHash
                  )}
                </span>
              </>
            ) : null}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link className="btn btn-sm" href={`/name/${encodeURIComponent(entry.label)}`}>
              Open its page
            </Link>
            <Link className="btn btn-sm" href={`/name/${encodeURIComponent(entry.label)}`}>
              Add or edit its card
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
