'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ApiError, checkAvailability, type PublicConfig } from '@/lib/api';
import { resolveAvailability, type AvailabilityView } from '@/lib/availability';
import { CardMock } from './CardMock';

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
  const [query, setQuery] = useState('');
  const [display, setDisplay] = useState(config.exampleLabel);
  const [status, setStatus] = useState<SearchStatus>({ kind: 'idle' });

  async function run(raw: string) {
    const value = raw.trim();
    if (!value) {
      setStatus({ kind: 'idle' });
      return;
    }
    setStatus({ kind: 'loading' });
    try {
      const payload = await checkAvailability(value);
      setDisplay(payload.data?.label ?? value);
      setStatus({ kind: 'result', view: resolveAvailability(payload, value) });
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof ApiError ? error.message : 'The lookup failed. Try again in a moment.',
      });
    }
  }

  return (
    <section className="hero" id="top">
      <div className="hero-copy">
        <h1 className="h1">
          A name for
          <br />
          your AI.
        </h1>
        <p className="lede">
          The name works in every wallet that speaks ENS. The card says what it does, and the track record
          proves it actually did.
        </p>

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
              placeholder="Type a name, for example bruce"
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
}: {
  status: SearchStatus;
  config: PublicConfig;
  onPick: (next: string) => void;
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
            Connect a wallet to claim it
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
