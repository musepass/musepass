'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPublicClient, createWalletClient, custom, http, type Address } from 'viem';

import { KNOWN_CHAINS, WalletError, getProvider } from '@/lib/wallet';
import {
  ENS_REGISTRY,
  ENS_REGISTRY_ABI_FOR_REVERSE,
  REVERSE_REGISTRAR,
  REVERSE_RESOLVER_ABI,
  describePrimaryName,
  reverseNodeFor,
  setNameCalldata,
} from '@/lib/primaryName';
import { useWallet } from './WalletProvider';

const MAINNET = {
  id: 1,
  name: 'Ethereum',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [KNOWN_CHAINS[1].rpcUrls[0]] } },
} as const;

/**
 * "Make this my name."
 *
 * Forward resolution is already live; this is the reverse record, the thing that
 * decides whether a wallet prints `xiaoming.musepass.eth` or `0x603b…`. ENS only
 * lets the address itself set it, so the platform cannot do this on anyone's
 * behalf — hence a card with one button rather than a background job.
 */
export function PrimaryNameCard({ fullName, ownerAddress }: { fullName: string; ownerAddress: string }) {
  const wallet = useWallet();
  const [currentPrimary, setCurrentPrimary] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Gas warning (P2): this one transaction is on mainnet and the user pays it.
  // Reading the balance lets the page warn before the wallet throws, instead of
  // after. Unknown balance (RPC unreadable) is not treated as zero.
  const [noEth, setNoEth] = useState(false);

  const client = useMemo(
    () => createPublicClient({ chain: MAINNET, transport: http(MAINNET.rpcUrls.default.http[0]) }),
    [],
  );

  const load = useCallback(async () => {
    if (!ownerAddress) return;
    setChecking(true);
    try {
      const node = reverseNodeFor(ownerAddress as Address);
      const resolver = await client.readContract({
        address: ENS_REGISTRY,
        abi: ENS_REGISTRY_ABI_FOR_REVERSE,
        functionName: 'resolver',
        args: [node],
      });
      if (resolver === '0x0000000000000000000000000000000000000000') {
        setCurrentPrimary(null);
      } else {
        const name = await client.readContract({
          address: resolver,
          abi: REVERSE_RESOLVER_ABI,
          functionName: 'name',
          args: [node],
        });
        setCurrentPrimary(name || null);
      }
    } catch {
      // A missing name record is not an error worth shouting about.
      setCurrentPrimary(null);
    } finally {
      setChecking(false);
    }
  }, [client, ownerAddress]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setNoEth(false);
    if (!wallet.address) return;
    void client
      .getBalance({ address: wallet.address as Address })
      .then((balance) => setNoEth(balance === 0n))
      .catch(() => setNoEth(false));
  }, [client, wallet.address]);

  const prompt = describePrimaryName({
    connected: wallet.address,
    owner: ownerAddress,
    fullName,
    currentPrimary,
  });

  async function setName() {
    setError(null);
    setNote(null);
    setBusy(true);
    try {
      const account = (wallet.address ?? (await wallet.connectWallet())) as Address;
      // The reverse namespace lives on mainnet, wherever the name itself lives.
      await wallet.switchTo(1);
      const signer = createWalletClient({ account, transport: custom(getProvider() as never) });
      const hash = await signer.sendTransaction({
        to: REVERSE_REGISTRAR,
        data: setNameCalldata(fullName),
        chain: null,
      });
      await client.waitForTransactionReceipt({ hash });
      setNote(`Primary name submitted: ${hash}`);
      await load();
    } catch (cause) {
      const code = (cause as { code?: number }).code;
      setError(
        cause instanceof WalletError
          ? cause.message
          : code === 4001
            ? 'You cancelled the transaction.'
            : `Did not go through: ${(cause as { shortMessage?: string }).shortMessage ?? 'try again.'}`,
      );
    } finally {
      setBusy(false);
    }
  }

  if (!prompt.offer) {
    return (
      <div className="panel">
        <h2 className="faq-q" style={{ fontSize: 18 }}>
          Primary name
        </h2>
        <div className="notice notice-ok">{prompt.message}</div>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2 className="faq-q" style={{ fontSize: 18 }}>
        Primary name
      </h2>
      <p className="body-2">{checking ? 'Reading the reverse record from the chain…' : prompt.message}</p>
      {prompt.actionable ? (
        <>
          {noEth ? (
            <div className="notice notice-warn" style={{ marginTop: 8 }}>
              This wallet holds no ETH on Ethereum mainnet. The transaction needs a small amount for
              gas — send it roughly 0.001 ETH, or skip this step: the name already resolves, this
              only changes what wallets display.
            </div>
          ) : null}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void setName()}>
            {busy ? 'Waiting for your wallet…' : 'Make this my primary name'}
          </button>
        </>
      ) : null}
      {error ? <div className="notice notice-error" style={{ marginTop: 8 }}>{error}</div> : null}
      {note ? <div className="notice notice-ok" style={{ marginTop: 8 }}>{note}</div> : null}
      <p className="body-2" style={{ fontSize: 13, marginTop: 8 }}>
        A mainnet transaction: it needs a small amount of ETH for gas, and unlike registering the
        name, this one is yours to pay. The reverse record lives in the{' '}
        <span className="mono">addr.reverse</span> namespace on Ethereum
        mainnet, and only the address itself can write it. Once it is set, wallets and block explorers
        show the name instead of a hex address.
      </p>
    </div>
  );
}
