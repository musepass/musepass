'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Address } from 'viem';
import {
  ApiError,
  checkAvailability,
  fetchRequest,
  submitClaim,
  type ClaimData,
  type PublicConfig,
  type RequestData,
} from '@/lib/api';
import { resolveAvailability, type AvailabilityView } from '@/lib/availability';
import {
  WalletError,
  deadlineInSeconds,
  signRegister,
} from '@/lib/wallet';
import { PrimaryNameCard } from './PrimaryNameCard';
import { SharePass } from './SharePass';
import { useWallet } from './WalletProvider';

type Phase = 'loading' | 'ready' | 'signing' | 'submitting' | 'done' | 'failed';

export interface ClaimFlowProps {
  config: PublicConfig;
  mode: 'direct' | 'confirm';
  initialLabel: string;
  requestId?: string | null;
  confirmToken?: string | null;
}

export function ClaimFlow({ config, mode, initialLabel, requestId, confirmToken }: ClaimFlowProps) {
  const wallet = useWallet();
  const disconnect = wallet.disconnect;
  const [label, setLabel] = useState(initialLabel);
  const [availability, setAvailability] = useState<AvailabilityView | null>(null);
  const [request, setRequest] = useState<RequestData | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClaimData | null>(null);

  const check = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) {
        setAvailability(null);
        setPhase('ready');
        return;
      }
      setPhase('loading');
      try {
        // With the wallet connected the answer also says whether an invitation
        // makes this short name free for this wallet (D17).
        const payload = await checkAvailability(trimmed, wallet.address ?? undefined);
        setAvailability(resolveAvailability(payload, trimmed));
      } catch (cause) {
        setAvailability(null);
        setError(cause instanceof ApiError ? cause.message : 'The status of that name could not be read.');
      } finally {
        setPhase('ready');
      }
    },
    [wallet.address],
  );

  useEffect(() => {
    void check(initialLabel);
  }, [check, initialLabel]);

  // Connecting a wallet can change the answer for a 3–4 character name
  // (invited or not), so re-check once the address appears.
  useEffect(() => {
    if (wallet.address) void check(label);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.address]);

  useEffect(() => {
    if (mode !== 'confirm' || !requestId) return;
    let cancelled = false;
    (async () => {
      try {
        const payload = await fetchRequest(requestId);
        if (cancelled) return;
        setRequest(payload.data);
        if (payload.data?.label) {
          setLabel(payload.data.label);
          void check(payload.data.label);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof ApiError ? cause.message : 'That confirmation link could not be found.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, requestId, check]);

  const isAvailable = availability?.kind === 'available';
  const wrongChain = Boolean(wallet.address) && wallet.chainId !== config.chain.chainId;
  const busy = phase === 'signing' || phase === 'submitting';

  /**
   * Whatever is still missing, in order: connect a wallet, switch it to the
   * chain, then ask for the signature. Splitting these into separate buttons
   * made the owner work out our state machine.
   */
  async function start() {
    setError(null);
    if (!isAvailable) return;
    try {
      if (!wallet.address) {
        await wallet.connectWallet();
      }
      if (wallet.chainId !== config.chain.chainId) {
        await wallet.switchTo(config.chain.chainId);
      }
    } catch {
      // The provider already stored a readable message; a second attempt is one
      // click away, which is better than guessing why nothing happened.
      return;
    }
    await claim();
  }

  async function claim() {
    setError(null);
    if (!isAvailable) return;

    try {
      setPhase('signing');
      const owner = wallet.address ?? (await wallet.connectWallet());
      await wallet.switchTo(config.chain.chainId);

      const deadline = deadlineInSeconds(config.limits.confirmTokenTtlMinutes);
      const signature = await signRegister(owner as Address, {
        domain: {
          name: config.productName,
          version: '1',
          chainId: config.chain.chainId,
          verifyingContract: config.registrar as Address,
        },
        types: {
          Register: [
            { name: 'label', type: 'string' },
            { name: 'owner', type: 'address' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'Register',
        message: { label, owner: owner as Address, deadline: BigInt(deadline) },
      });

      setPhase('submitting');
      const payload = await submitClaim({
        label,
        owner,
        deadline,
        signature,
        via: 'web',
        requestId: requestId ?? null,
        confirmToken: confirmToken ?? null,
      });

      setResult(payload.data);
      setPhase('done');
    } catch (cause) {
      setPhase('failed');
      if (cause instanceof WalletError || cause instanceof ApiError) {
        setError(cause.message);
      } else {
        setError('It did not go through. Try again.');
      }
    }
  }

  if (phase === 'done' && result) {
    const explorer = config.chain.explorer;
    return (
      <div className="panel">
        <div className="notice notice-ok">
          {result.alreadyRegistered
            ? `${result.fullName} is already yours.`
            : `Done — ${result.fullName} is yours now.`}
        </div>
        <dl className="kv">
          <dt>Name</dt>
          <dd className="mono">{result.fullName}</dd>
          <dt>Owner</dt>
          <dd className="mono">{result.owner}</dd>
          {result.txHash ? (
            <>
              <dt>Transaction</dt>
              <dd className="mono-break">
                {explorer ? (
                  <a href={`${explorer}/tx/${result.txHash}`} target="_blank" rel="noreferrer">
                    {result.txHash}
                  </a>
                ) : (
                  result.txHash
                )}
              </dd>
            </>
          ) : null}
        </dl>
        <p className="body-2" style={{ fontSize: 15 }}>
          The name is an ERC-721 in this wallet — ownership cannot be taken back. If we shut down, the
          name stays yours; wallet resolution runs through our gateway, and the{' '}
          <a href="/trust">trust model</a> says both halves out loud.
        </p>
        <p className="body-2" style={{ fontSize: 15 }}>
          Next, give it a card. A name on its own is an address; the card is what another person — or
          another AI — actually reads before deciding whether to deal with it.
        </p>
        {mode === 'confirm' ? (
          <CopyForAgent
            text={`${result.fullName} is registered to ${result.owner}${
              result.txHash ? ` (tx ${result.txHash})` : ''
            }.`}
          />
        ) : null}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <a className="btn btn-primary" href={`/name/${encodeURIComponent(result.label)}`}>
            Add its card
          </a>
          <a className="btn" href="/">
            Back to the home page
          </a>
        </div>
        <div className="panel">
          <SharePass label={result.label} fullName={result.fullName} siteUrl={config.siteUrl} />
        </div>
        <PrimaryNameCard fullName={result.fullName} ownerAddress={result.owner} />
      </div>
    );
  }

  if (!config.registrar) {
    return (
      <div className="panel">
        <div className="notice notice-warn">
          The name service is not configured yet (a contract address is missing), so names cannot be
          issued right now. Nothing was done to your wallet.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="panel">
        <h2 className="h2" style={{ fontSize: 28 }}>
          {mode === 'confirm' ? 'Confirm the name your AI asked for' : 'Claim a name'}
        </h2>

        {mode === 'confirm' && request ? (
          <div className="notice notice-info">
            <b>{request.requestedByHost ?? 'Your AI'}</b> started a registration for{' '}
            <span className="mono">{request.requestedFor}</span>. Nothing exists yet — one signature from
            you and it does.
            {request.expiresAt ? (
              <>
                {' '}
                This link works until{' '}
                <span className="mono">{new Date(request.expiresAt).toISOString().slice(0, 16).replace('T', ' ')} UTC</span>
                ; after that, ask your AI to start again.
              </>
            ) : null}
          </div>
        ) : null}

        <div className="search-block" style={{ marginTop: 0 }}>
          <label className="search-label" htmlFor="claim-name">
            Name
          </label>
          <div className="search">
            <input
              id="claim-name"
              className="search-input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={label}
              readOnly={mode === 'confirm'}
              onChange={(event) => {
                setLabel(event.target.value);
                setError(null);
              }}
              onBlur={() => void check(label)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void check(label);
              }}
            />
            <span className="search-suffix">.{config.rootName}</span>
            <button type="button" className="search-button" onClick={() => void check(label)}>
              Check
            </button>
          </div>
          <div className="status" aria-live="polite">
            <AvailabilityLine view={availability} config={config} />
          </div>
        </div>
      </div>

      <div className="panel">
        <h3 className="faq-q" style={{ fontSize: 18 }}>
          Step 2: connect a wallet and sign
        </h3>
        <p className="body-2" style={{ fontSize: 15 }}>
          The name goes straight to this wallet address, and we pay the gas. Nothing is issued until
          this wallet signs — neither we nor your AI can sign instead of you. (AIs with no wallet at
          all can use our custodial signer service instead; that path is explained in{' '}
          <a href="/docs/mcp">the MCP docs</a>.)
        </p>

        {wallet.address ? (
          <div className="notice notice-info">
            Connected <span className="mono">{wallet.address}</span>
            {wrongChain ? ` · switch to ${config.chain.name}` : ''}
          </div>
        ) : null}

        {wallet.error ? <div className="notice notice-error">{wallet.error}</div> : null}
        {error ? <div className="notice notice-error">{error}</div> : null}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* One button, whatever is left: connect, switch networks, then sign.
              Two buttons here meant the owner had to guess the right order, and
              the second one only worked if the first had been pressed. */}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!isAvailable || busy || wallet.connecting || phase === 'loading'}
            onClick={() => void start()}
          >
            {wallet.connecting
              ? 'Connecting…'
              : !wallet.address
                ? 'Connect and claim'
                : wrongChain
                  ? `Switch to ${config.chain.name} and claim`
                  : phase === 'signing'
                    ? 'Waiting for your signature…'
                    : phase === 'submitting'
                      ? 'Issuing…'
                      : 'Sign and claim'}
          </button>
          {wallet.address ? (
            <button type="button" className="btn" onClick={disconnect} disabled={busy}>
              Use a different wallet
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The line an owner pastes back into the chat, so the agent knows it worked. */
function CopyForAgent({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="panel" style={{ background: 'var(--surface, #f7f5f0)' }}>
      <p className="body-2" style={{ margin: 0, fontSize: 14 }}>
        Your AI cannot see this page. Paste this back to it so it can move on:
      </p>
      <pre className="mono mono-break" style={{ margin: '8px 0', fontSize: 13 }}>{text}</pre>
      <button
        type="button"
        className="btn btn-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? 'Copied' : 'Copy for your AI'}
      </button>
    </div>
  );
}

function AvailabilityLine({
  view,
  config,
}: {
  view: AvailabilityView | null;
  config: PublicConfig;
}) {
  if (!view) return <span className="status-idle">Type a name to see whether it is free.</span>;
  switch (view.kind) {
    case 'available':
      return (
        <span className="status-ok">
          {view.label}.{config.rootName} is available, free.
          {view.invited ? ' Your invitation covers this short name.' : ''}
        </span>
      );
    case 'taken':
      return (
        <span className="status-taken">
          {view.label}.{config.rootName} is taken. Pick another, or{' '}
          <a className="status-link" href={`/name/${encodeURIComponent(view.label)}`}>
            see its page
          </a>
          .
        </span>
      );
    case 'premium':
      return (
        <span className="status-warn">
          {view.label} is short enough to be a premium name.{' '}
          {config.features.premiumPurchase ? '' : 'Premium names are not on sale yet.'}
          {!config.features.premiumPurchase ? ' Invited wallets can still take a 3–4 character name — connect your wallet to check.' : ''}
        </span>
      );
    case 'reserved':
      return <span className="status-danger">{view.label} is reserved and cannot be registered.</span>;
    case 'invalid':
    case 'unavailable':
      return <span className="status-danger">{view.message}</span>;
  }
}
