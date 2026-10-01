'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ApiError, checkAvailability, type PublicConfig } from '@/lib/api';
import { resolveAvailability, type AvailabilityView } from '@/lib/availability';
import { CardMock } from './CardMock';
import { useWallet } from './WalletProvider';

type SearchStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'result'; view: AvailabilityView }
  | { kind: 'error'; message: string };

/**
 * The hero is one client component because the card mockup follows whatever the
 * visitor is searching for — the design drives both from the same `display`
 * value. Everything it renders is still server-rendered on first paint.
 */
export function HeroSection({ config }: { config: PublicConfig }) {
  // The lookup carries the visitor's identity when they have one, so an
  // invited X user sees "available, free" for a 3–4 character name here too,
  // not just on the claim page.
  const wallet = useWallet();
  const [query, setQuery] = useState('');
  const [display, setDisplay] = useState(config.exampleLabel);
  const [status, setStatus] = useState<SearchStatus>({ kind: 'idle' });
  // What the last run answered for, so typing does not re-ask the same question.
  const answeredFor = useRef<string | null>(null);

  async function run(raw: string) {
    const value = raw.trim();
    if (!value) {
      setStatus({ kind: 'idle' });
      return;
    }
    setStatus({ kind: 'loading' });
    answeredFor.current = value;
    try {
      const payload = await checkAvailability(
        value,
        wallet.address ?? undefined,
        undefined,
        wallet.xHandle ?? undefined,
      );
      setDisplay(payload.data?.label ?? value);
      setStatus({ kind: 'result', view: resolveAvailability(payload, value) });
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof ApiError ? error.message : 'The lookup failed. Try again in a moment.',
      });
    }
  }

  // Identity can arrive after the first lookup (Privy loads async), and it
  // changes the answer for short names — let the query re-run for it.
  useEffect(() => {
    answeredFor.current = null;
  }, [wallet.address, wallet.xHandle]);

  /**
   * Check while the visitor types.
   *
   * Waiting for Enter is one decision too many for the first thing anyone does
   * here, and the answer is cheap: a lookup that is already rate limited and
   * cached. The pause is long enough that a fast typist makes one request rather
   * than eight.
   */
  useEffect(() => {
    const value = query.trim();
    if (value.length < 2 || answeredFor.current === value) return;
    const timer = setTimeout(() => {
      void run(value);
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, wallet.address, wallet.xHandle]);

  return (
    <section className="hero" id="top">
      <div className="hero-copy">
        <h1 className="h1">
          Give your AI
          <br />
          a passport.
        </h1>
        <p className="lede">
          A name any wallet can read, and a track record anyone can check. Next: an account that
          holds payments until the work is verified.
        </p>

        <div className="hero-actions">
          <Link className="btn btn-primary" href="/claim">
            Claim your free MusePass
          </Link>
          <Link className="btn" href="/docs/start/developers">
            Paste into your AI
          </Link>
        </div>

        <div className="search-block">
          <label className="search-label" htmlFor="name-search">
            Check a name
          </label>
          <div className="search">
            <input
              id="name-search"
              className="search-input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="Type a name, for example atlas"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void run(query);
              }}
            />
            <span className="search-suffix">.{config.rootName}</span>
            <button
              type="button"
              className="search-button"
              disabled={status.kind === 'loading'}
              onClick={() => void run(query)}
            >
              {status.kind === 'loading' ? 'Checking' : 'Check'}
            </button>
          </div>

          <div className="status" aria-live="polite">
            <StatusLine
              status={status}
              config={config}
              signedIn={Boolean(wallet.address)}
              onPick={(next) => {
                setQuery(next);
                void run(next);
              }}
            />
          </div>
        </div>
      </div>

      <CardMock label={display} rootName={config.rootName} />
    </section>
  );
}

function StatusLine({
  status,
  config,
  onPick,
  signedIn,
}: {
  status: SearchStatus;
  config: PublicConfig;
  onPick: (next: string) => void;
  signedIn: boolean;
}) {
  if (status.kind === 'idle') {
    return <span className="status-idle">Or just tell your AI: “register a name for yourself”.</span>;
  }
  if (status.kind === 'loading') {
    return <span className="status-idle">Checking…</span>;
  }
  if (status.kind === 'error') {
    return <span className="status-danger">{status.message}</span>;
  }

  const view = status.view;
  switch (view.kind) {
    case 'available':
      return (
        <>
          <span className="status-ok">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path
                d="M3.5 9.5l3.5 3.5 7.5-8"
                stroke="var(--success)"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {view.label}.{config.rootName} is available, free.
          </span>
          <Link className="status-link" href={`/claim?label=${encodeURIComponent(view.label)}`}>
            {signedIn ? 'Claim it' : 'Connect a wallet to claim it'}
          </Link>
          <span className="status-note">
            We pay the gas. Or tell your AI: “register a name for yourself”.
          </span>
        </>
      );

    case 'taken':
      return (
        <>
          <span className="status-taken">
            {view.label}.{config.rootName} is taken.
          </span>
          <Link className="status-link" href={`/name/${encodeURIComponent(view.label)}`}>
            See its page
          </Link>
          {view.suggestions.length > 0 ? (
            <span className="suggestions">
              Try:
              {view.suggestions.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  className="chip"
                  onClick={() => onPick(candidate)}
                >
                  {candidate}
                </button>
              ))}
            </span>
          ) : null}
        </>
      );

    case 'premium':
      return (
        <span className="status-warn">
          {view.label} is short enough to be a premium name.{' '}
          {config.features.premiumPurchase ? 'It can be bought.' : 'Premium names are not on sale yet.'}
        </span>
      );

    case 'reserved':
      return (
        <>
          <span className="status-danger">{view.label} is reserved and cannot be registered.</span>
          {view.appealable ? (
            <a className="status-link" href={`mailto:${config.supportEmail}`}>
              If this is your brand, you can apply for it
            </a>
          ) : null}
        </>
      );

    case 'invalid':
    case 'unavailable':
      return <span className="status-danger">{view.message}</span>;
  }
}
