'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Address } from 'viem';
import {
  ApiError,
  checkAvailability,
  fetchRequest,
  requestPurchaseQuote,
  submitClaim,
  submitPurchase,
  type ClaimData,
  type PublicConfig,
  type PurchasePayload,
  type RequestData,
} from '@/lib/api';
import { resolveAvailability, type AvailabilityView } from '@/lib/availability';
import {
  WalletError,
  deadlineInSeconds,
  hasWallet,
  shortAddress,
} from '@/lib/wallet';
import { PrimaryNameCard } from './PrimaryNameCard';
import { SharePass } from './SharePass';
import { useWallet } from './WalletProvider';

type Phase = 'loading' | 'ready' | 'signing' | 'paying' | 'submitting' | 'done' | 'failed';

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
  // D19: a submit that failed only because the payment was not visible on
  // chain yet. Retrying re-submits the same payment — never a second transfer.
  const [pendingPurchase, setPendingPurchase] = useState<PurchasePayload | null>(null);
  const [funding, setFunding] = useState<{
    wallet: string;
    treasury: string;
    priceUsd: number;
    currency: string;
  } | null>(null);

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
        // (by wallet or by X handle, D17) makes this short name free here.
        const payload = await checkAvailability(
          trimmed,
          wallet.address ?? undefined,
          undefined,
          wallet.xHandle ?? undefined,
        );
        setAvailability(resolveAvailability(payload, trimmed));
      } catch (cause) {
        setAvailability(null);
        setError(cause instanceof ApiError ? cause.message : 'The status of that name could not be read.');
      } finally {
        setPhase('ready');
      }
    },
    [wallet.address, wallet.xHandle],
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
  // Availability is checked with the wallet's identity, so once connected this
  // is authoritative for the claim path. D20: a long name (5+) is free for
  // every wallet; `invited` is only the short-name privilege.
  const invited = availability?.kind === 'available' && availability.invited;
  const purchaseOffer =
    availability && (availability.kind === 'available' || availability.kind === 'premium')
      ? availability.purchase
      : null;
  const purchasable = Boolean(purchaseOffer && config.features.premiumPurchase);
  const secondName = purchaseOffer?.kind === 'additional-name';
  // A wallet that already has its free name, or was never invited, buys.
  const buyPrimary = purchasable && (!invited || secondName);
  // Only an injected wallet can sit on the wrong network; an embedded wallet
  // just signs and never sends a transaction.
  const wrongChain =
    wallet.source === 'injected' &&
    Boolean(wallet.address) &&
    wallet.chainId !== config.chain.chainId;
  const busy = phase === 'signing' || phase === 'paying' || phase === 'submitting';
  // A connected wallet that can neither claim this name for free (long name,
  // or a short one its invitation covers) nor buy it, can never be issued it —
  // the button says so instead of letting the signature happen and the API
  // refuse it afterwards. Anonymous visitors still get the button: connecting
  // is how their invitation (if any) is found.
  const blockUninvited = Boolean(wallet.address) && isAvailable && !invited && !purchasable;

  /**
   * Whatever is still missing, in order: connect a wallet (the browser
   * extension, or an X login that creates one), switch it to the chain, then
   * ask for the signature. Splitting these into separate buttons made the owner
   * work out our state machine.
   */
  async function start() {
    setError(null);
    if (!isAvailable) return;
    try {
      if (!wallet.address) {
        if (hasWallet()) await wallet.connectWallet();
        else await wallet.loginWithX();
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
      const owner =
        wallet.address ??
        (hasWallet() ? await wallet.connectWallet() : await wallet.loginWithX());
      if (!owner) {
        setPhase('failed');
        return;
      }
      await wallet.switchTo(config.chain.chainId);

      const deadline = deadlineInSeconds(config.limits.confirmTokenTtlMinutes);
      const signature = await wallet.signRegister({
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
      // With an X login the API can also match an invitation written against
      // the X handle instead of the wallet address.
      const privyAccessToken = wallet.source === 'privy' ? await wallet.getAccessToken() : null;
      const payload = await submitClaim({
        label,
        owner,
        deadline,
        signature,
        via: 'web',
        requestId: requestId ?? null,
        confirmToken: confirmToken ?? null,
        privyAccessToken,
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

  /**
   * D19: the paid path, open to every wallet once purchase is enabled — a
   * 4-character name ($5 USDG) or a second long name ($1). Order matters and
   * is fixed: quote → check balance → sign → pay on-chain → submit. The
   * submit verifies the transfer on chain, so nothing is registered until the
   * money moved.
   */
  async function buy() {
    setError(null);
    setFunding(null);
    setPendingPurchase(null);
    try {
      const owner =
        wallet.address ??
        (hasWallet() ? await wallet.connectWallet() : await wallet.loginWithX());
      if (!owner) {
        setPhase('failed');
        return;
      }

      setPhase('submitting');
      const quote = await requestPurchaseQuote({ label, owner });
      const q = quote.data;

      // An embedded wallet arrives with no funds as a rule, not an exception;
      // check before signing so the message is an instruction, not a revert.
      const balance = await wallet.readErc20Balance(q.token as Address);
      if (balance !== null && balance < BigInt(q.amountBaseUnits)) {
        setPhase('failed');
        setFunding({ wallet: owner, treasury: q.treasury, priceUsd: q.priceUsd, currency: q.currency });
        return;
      }

      setPhase('signing');
      const deadline = deadlineInSeconds(config.limits.confirmTokenTtlMinutes);
      const signature = await wallet.signRegister({
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

      setPhase('paying');
      const paymentTxHash = await wallet.payErc20({
        chainId: q.chainId,
        token: q.token as Address,
        to: q.treasury as Address,
        amountBaseUnits: BigInt(q.amountBaseUnits),
      });

      setPhase('submitting');
      await settlePurchase({ label, owner, deadline, signature, quoteId: q.quoteId, paymentTxHash });
    } catch (cause) {
      setPhase('failed');
      if (cause instanceof WalletError || cause instanceof ApiError) {
        setError(cause.message);
      } else {
        setError('It did not go through. Nothing was paid.');
      }
    }
  }

  /** Submits (or re-submits after "not visible yet") one settled payment. */
  async function settlePurchase(payload: PurchasePayload) {
    try {
      const purchased = await submitPurchase(payload);
      setResult({
        label: purchased.data.label,
        fullName: purchased.data.fullName,
        owner: purchased.data.owner as Address,
        txHash: (purchased.data.txHash as `0x${string}` | null) ?? null,
        tier: purchased.data.tier,
        alreadyRegistered: purchased.data.alreadyRegistered,
      });
      setPendingPurchase(null);
      setPhase('done');
    } catch (cause) {
      setPhase('failed');
      if (cause instanceof ApiError && cause.code === 'PAYMENT_NOT_FOUND') {
        setPendingPurchase(payload);
        setError(
          'The payment is not visible on chain yet. Wait a minute, then press “Check payment again” — you will not be asked to pay twice.',
        );
      } else if (cause instanceof WalletError || cause instanceof ApiError) {
        setError(cause.message);
      } else {
        setError('The purchase did not go through.');
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
            <AvailabilityLine view={availability} config={config} signedIn={Boolean(wallet.address)} />
          </div>
        </div>
      </div>

      <div className="panel">
        <h3 className="faq-q" style={{ fontSize: 18 }}>
          Step 2: connect a wallet and sign
        </h3>
        <p className="body-2" style={{ fontSize: 15 }}>
          The name goes straight to this wallet address. For invited wallets we pay the gas;
          nothing is issued until this wallet signs — neither we nor your AI can sign instead of
          you. Paid names, when purchase is enabled, settle in{' '}
          {config.payment?.currency ?? 'USDG'} on {config.chain.name}: we verify the payment on
          chain and sponsor the registration. (AIs with no wallet at all can use our custodial
          signer service instead; that path is explained in{' '}
          <a href="/docs/reference/mcp">the MCP docs</a>.)
        </p>

        {wallet.address ? (
          <div className="notice notice-info">
            Connected{' '}
            <span className="mono">
              {wallet.source === 'privy' && wallet.xHandle
                ? `@${wallet.xHandle} (${wallet.address})`
                : wallet.address}
            </span>
            {wrongChain ? ` · switch to ${config.chain.name}` : ''}
          </div>
        ) : null}

        {wallet.address && isAvailable && !invited ? (
          <div className="notice notice-warn">
            {purchasable
              ? 'Short names need an invitation, and this wallet has none — but this one can be bought with the button below.'
              : 'Short names need an invitation, and this wallet or X handle has none yet.'}
          </div>
        ) : null}

        {wallet.error ? <div className="notice notice-error">{wallet.error}</div> : null}
        {error ? <div className="notice notice-error">{error}</div> : null}

        {funding ? (
          <div className="notice notice-info">
            This wallet does not have enough {funding.currency} yet. Send{' '}
            {funding.priceUsd} {funding.currency} (on {config.chain.name}) to{' '}
            <span className="mono">{funding.wallet}</span>, then press Buy again. The payment goes
            to the project treasury (<span className="mono">{shortAddress(funding.treasury)}</span>)
            and buys exactly this name.
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* One button, whatever is left: connect, switch networks, then sign
              (or pay). Two buttons here meant the owner had to guess the right
              order, and the second one only worked if the first had been
              pressed. */}
          {wallet.privyEnabled && !wallet.address ? (
            <button
              type="button"
              className="btn"
              disabled={!isAvailable && !purchasable || busy || wallet.connecting || phase === 'loading'}
              onClick={() => void wallet.loginWithX()}
              title="No wallet needed — one is created for you"
            >
              Continue with X
            </button>
          ) : null}
          {buyPrimary || (purchasable && availability?.kind === 'premium') ? (
            <button
              type="button"
              className="btn btn-primary btn-lg"
              disabled={busy || wallet.connecting || phase === 'loading'}
              onClick={() => void buy()}
            >
              {phase === 'signing'
                ? 'Waiting for your signature…'
                : phase === 'paying'
                  ? 'Waiting for your payment…'
                  : phase === 'submitting'
                    ? 'Verifying the payment…'
                    : secondName
                      ? `Add a second name — $${purchaseOffer?.priceUsd}`
                      : `Buy — $${purchaseOffer?.priceUsd ?? 5} ${config.payment?.currency ?? 'USDG'}`}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-lg"
              disabled={
                !isAvailable || busy || wallet.connecting || phase === 'loading' || blockUninvited
              }
              onClick={() => void start()}
            >
              {blockUninvited
                ? 'Invitation required'
                : wallet.connecting
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
          )}
          {pendingPurchase ? (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void settlePurchase(pendingPurchase)}
            >
              Check payment again
            </button>
          ) : null}
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
  signedIn,
}: {
  view: AvailabilityView | null;
  config: PublicConfig;
  signedIn: boolean;
}) {
  if (!view) return <span className="status-idle">Type a name to see whether it is free.</span>;
  switch (view.kind) {
    case 'available':
      if (view.purchase?.kind === 'additional-name') {
        return (
          <span className="status-ok">
            {view.label}.{config.rootName} is available. This wallet already has its free name, so
            this one is ${view.purchase.priceUsd} {config.payment?.currency ?? 'USDG'}.
          </span>
        );
      }
      if (!view.invited) {
        return (
          <span className="status-ok">
            {view.label}.{config.rootName} is available.{' '}
            {signedIn
              ? view.purchase
                ? `This wallet has no invitation, but this name can be bought: $${view.purchase.priceUsd} ${config.payment?.currency ?? 'USDG'}.`
                : 'Short names need an invitation, and this account has none yet.'
              : 'Short names need an invitation — connect a wallet or sign in with X to check yours.'}
          </span>
        );
      }
      return (
        <span className="status-ok">
          {view.label}.{config.rootName} is available, free — one free name per wallet, and
          invitations are what cover short ones.
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
      if (config.features.premiumPurchase) {
        return (
          <span className="status-warn">
            {view.label} is a 4-character name: $
            {view.purchase?.priceUsd ?? view.priceUsd ?? 5}{' '}
            {config.payment?.currency ?? 'USDG'} to buy.
            {!signedIn ? ' Connect a wallet to continue.' : ''}
          </span>
        );
      }
      return (
        <span className="status-warn">
          {view.label} is short enough to be a premium name. Premium names are not on sale yet.
          Names are issued by invitation — an invited wallet can still take a 3–4 character name
          free, and any wallet can take a longer one free.
        </span>
      );
    case 'reserved':
      return <span className="status-danger">{view.label} is reserved and cannot be registered.</span>;
    case 'invalid':
    case 'unavailable':
      return <span className="status-danger">{view.message}</span>;
  }
}
