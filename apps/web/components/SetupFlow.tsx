'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPublicClient, createWalletClient, custom, http, type Address, type Hex } from 'viem';
import { getEnsAddress } from 'viem/ens';

import type { PublicConfig } from '@/lib/api';
import { L1_RESOLVER_BYTECODE } from '@/lib/l1ResolverBytecode';
import {
  L1_RESOLVER,
  buildSetupSteps,
  observeSetup,
  type SetupObservation,
  type SetupStep,
} from '@/lib/setup';
import { KNOWN_CHAINS, WalletError, getProvider, shortAddress } from '@/lib/wallet';
import { useWallet } from './WalletProvider';

const MAINNET = {
  id: 1,
  name: 'Ethereum',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [KNOWN_CHAINS[1].rpcUrls[0]] } },
} as const;

/**
 * The one-time setup, as buttons.
 *
 * Deliberately not clever: it reads the chain, says what each transaction does,
 * and sends exactly the calldata it shows. Nothing here can move a name.
 */
export function SetupFlow({ config }: { config: PublicConfig }) {
  const wallet = useWallet();
  const [observation, setObservation] = useState<SetupObservation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [resolved, setResolved] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const client = useMemo(
    () => createPublicClient({ chain: MAINNET, transport: http(MAINNET.rpcUrls.default.http[0]) }),
    [],
  );
  const chains = useMemo(
    () => ({
      rootName: config.rootName,
      l2ChainId: config.chain.chainId,
      l2Registry: (config.l2Registry ?? '0x0000000000000000000000000000000000000000') as Address,
    }),
    [config.rootName, config.chain.chainId, config.l2Registry],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await observeSetup(
        {
          getCode: (args) => client.getCode(args),
          readContract: (args) => client.readContract(args as never),
        },
        {
          rootName: chains.rootName,
          connected: wallet.address,
          bytecode: L1_RESOLVER_BYTECODE as Hex,
          plannedOwner: (wallet.address ?? L1_RESOLVER.operator) as Address,
          l2ChainId: chains.l2ChainId,
          l2Registry: chains.l2Registry,
        },
      );
      setObservation(next);
    } catch (cause) {
      setError(
        cause instanceof Error ? `Could not read the chain: ${cause.message}` : 'Could not read the chain. Refresh and try again.',
      );
    } finally {
      setLoading(false);
    }
  }, [client, chains, wallet.address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const steps: SetupStep[] = useMemo(
    () => (observation ? buildSetupSteps(observation, L1_RESOLVER_BYTECODE as Hex, chains) : []),
    [observation, chains],
  );

  async function send(step: SetupStep) {
    setError(null);
    setNote(null);
    setPending(step.id);
    try {
      const account = (wallet.address ?? (await wallet.connectWallet())) as Address;
      await wallet.switchTo(1);
      const signer = createWalletClient({ account, transport: custom(getProvider() as never) });
      // `chain: null` means "whatever the wallet is on" — the wallet has already
      // been switched to mainnet above, and this avoids viem second-guessing it.
      const hash = await signer.sendTransaction({
        to: step.to,
        data: step.data,
        value: step.value,
        chain: null,
      });
      await client.waitForTransactionReceipt({ hash });
      setNote(`${step.title} done — transaction ${hash}`);
      await refresh();
    } catch (cause) {
      const code = (cause as { code?: number }).code;
      setError(
        cause instanceof WalletError
          ? cause.message
          : code === 4001
            ? 'You cancelled the transaction.'
            : `The transaction did not go through: ${(cause as { shortMessage?: string }).shortMessage ?? 'try again.'}`,
      );
    } finally {
      setPending(null);
    }
  }

  async function checkResolution() {
    setError(null);
    setResolved(null);
    try {
      const name = `${config.exampleLabel}.${config.rootName}`;
      const address = await getEnsAddress(client, { name });
      setResolved(address ? `${name} → ${address}` : `${name} does not resolve to anything right now.`);
    } catch (cause) {
      setError(`The resolution lookup failed: ${(cause as { shortMessage?: string }).shortMessage ?? 'unknown error'}`);
    }
  }

  const done = steps.filter((step) => step.done).length;

  return (
    <div className="panel" style={{ display: 'grid', gap: 16 }}>
      <div>
        <h1 className="h2">Turn on name resolution</h1>
        <p className="body-2">
          This is a one-time step. The name <span className="mono">{config.rootName}</span> is already on
          chain; what is missing is pointing it at our resolver, so that other people — and other AIs —
          can find{' '}
          <span className="mono">
            {config.exampleLabel}.{config.rootName}
          </span>{' '}
          in their wallet. Each step says what you are about to sign before you sign it.
        </p>
      </div>
      <div className="kv">
        <span>Wallet</span>
        <span className="mono">
          {wallet.address ? shortAddress(wallet.address) : 'not connected'}
          {wallet.chainId && wallet.chainId !== 1 ? ' (this one needs Ethereum mainnet)' : ''}
        </span>
        <span>Name owner</span>
        <span className="mono">
          {loading && !observation ? 'reading…' : (observation?.rootOwner ?? 'unknown')}
        </span>
        <span>Progress</span>
        <span>
          {done}/{steps.length}
        </span>
      </div>
      {error ? <div className="notice notice-error">{error}</div> : null}
      {note ? <div className="notice notice-ok">{note}</div> : null}
      {steps.map((step, index) => (
        <div key={step.id} className="card" style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="chip">{index + 1}</span>
            <strong>{step.title}</strong>
            {step.done ? <span className="pill-pass">Done</span> : null}
          </div>
          <p className="body-2">{step.detail}</p>
          <div className="kv">
            <span>Sends to</span>
            <span className="mono mono-break">{step.to}</span>
          </div>
          {step.done ? null : step.sendable ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending !== null}
              onClick={() => void send(step)}
            >
              {pending === step.id ? 'Waiting for your wallet…' : 'Do this step with my wallet'}
            </button>
          ) : (
            <p className="body-2">{step.blocker}</p>
          )}
          <details>
            <summary className="body-2">Do it by hand (copy into a wallet or Etherscan)</summary>
            <p className="mono mono-break" style={{ fontSize: 12 }}>
              to {step.to}
            </p>
            <p className="mono mono-break" style={{ fontSize: 12 }}>
              data {step.data}
            </p>
          </details>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn" onClick={() => void refresh()} disabled={loading}>
          {loading ? 'Reading chain state…' : 'Refresh' }
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void checkResolution()}
          disabled={done === 0}
        >
          Check a real resolution
        </button>
      </div>
      {resolved ? <div className="notice notice-info mono mono-break">{resolved}</div> : null}
      <p className="body-2">
        The resolver address is worked out in advance: the same bytecode deployed with deterministic
        CREATE2 lands on the same address no matter who pays or when, so the address can be written into
        config before anyone decides who will deploy it.
      </p>
    </div>
  );
}
