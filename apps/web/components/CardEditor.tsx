'use client';

import { useState } from 'react';
import {
  CARD_TEXT_KEY,
  cardDataUri,
  cardTextSignaturePayload,
  namehash,
  type AgentService,
  type FieldVisibility,
} from '@musename/core/browser';
import type { Address } from 'viem';
import { ApiError, publishCard, type PublicConfig, type RedactedCard } from '@/lib/api';
import {
  EDITABLE_FIELDS,
  FIELD_LABELS,
  VISIBILITY_LABELS,
  buildCard,
  draftFromPublished,
  type CardDraft,
} from '@/lib/cardDraft';
import { defaultAvatarDataUri } from '@/lib/avatar';
import { WalletError, deadlineInSeconds, signCardPayload } from '@/lib/wallet';
import { useWallet } from './WalletProvider';

type Phase = 'idle' | 'signing' | 'publishing' | 'done' | 'failed';

const SERVICE_SUGGESTIONS = ['web', 'MCP', 'A2A', 'email', 'ENS', 'DID'];

export function CardEditor({
  config,
  label,
  fullName,
  ownerAddress,
  published,
}: {
  config: PublicConfig;
  label: string;
  fullName: string;
  ownerAddress: string;
  published: RedactedCard | null;
}) {
  const wallet = useWallet();
  const [draft, setDraft] = useState<CardDraft>(() => draftFromPublished(published));
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [result, setResult] = useState<{ txHash: string; contentHash: string } | null>(null);

  const isOwner = wallet.address?.toLowerCase() === ownerAddress.toLowerCase();
  const busy = phase === 'signing' || phase === 'publishing';

  function update<K extends keyof CardDraft>(key: K, value: CardDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setProblems([]);
  }

  function setVisibility(field: (typeof EDITABLE_FIELDS)[number], value: FieldVisibility) {
    setDraft((prev) => ({ ...prev, visibility: { ...prev.visibility, [field]: value } }));
  }

  function updateService(index: number, patch: Partial<AgentService>) {
    setDraft((prev) => ({
      ...prev,
      services: prev.services.map((service, i) => (i === index ? { ...service, ...patch } : service)),
    }));
    setProblems([]);
  }

  async function publish() {
    setError(null);
    setProblems([]);

    const built = buildCard(draft, { fullName });
    if (!built.ok || !built.card) {
      setProblems(built.errors);
      return;
    }

    if (!config.l2Registry || !config.registrar) {
      setError('The server has no registry address configured, so publishing is off.');
      return;
    }

    try {
      const account = (wallet.address ?? (await wallet.connectWallet())) as Address;
      await wallet.switchTo(config.chain.chainId);

      // Sign exactly what will be stored: no extra round trip, no surprises.
      const value = cardDataUri(built.card);
      // A short window: the signature is only needed until the transaction
      // lands, and a stale one is worse than a re-sign.
      const expiration = deadlineInSeconds(15);
      const payload = cardTextSignaturePayload({
        registry: config.l2Registry as Address,
        node: namehash(fullName),
        key: CARD_TEXT_KEY,
        value,
        expiration,
      });

      setPhase('signing');
      const signature = await signCardPayload(account, payload);

      setPhase('publishing');
      const response = await publishCard(label, {
        card: built.card,
        expiration,
        signer: account,
        signature,
      });

      setResult({ txHash: response.data.txHash, contentHash: response.data.contentHash });
      setPhase('done');
    } catch (cause) {
      setPhase('failed');
      setError(
        cause instanceof WalletError || cause instanceof ApiError
          ? cause.message
          : 'It did not publish. Try again.',
      );
    }
  }

  if (result) {
    const explorer = config.chain.explorer;
    return (
      <div className="panel">
        <div className="notice notice-ok">The card is on chain.</div>
        <dl className="kv">
          <dt>Content hash</dt>
          <dd className="mono-break">{result.contentHash}</dd>
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
        </dl>
        <p className="body-2" style={{ fontSize: 15 }}>
          Reload the page to see what everyone else sees — only the fields you marked public.
        </p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          Reload and look
        </button>
      </div>
    );
  }

  if (!wallet.address) {
    return (
      <div className="panel">
        <h2 className="faq-q" style={{ fontSize: 18 }}>
          Is this your name?
        </h2>
        <p className="body-2" style={{ fontSize: 15 }}>
          Connect a wallet to write its card. You sign the card, we pay the fee, and any visitor can read
          it and check it for themselves.
        </p>
        <div>
          <button
            type="button"
            className="btn"
            disabled={wallet.connecting}
            onClick={async () => {
              try {
                await wallet.connectWallet();
              } catch {
                /* wallet.error carries the message */
              }
            }}
          >
            {wallet.connecting ? 'Connecting…' : 'Connect wallet'}
          </button>
        </div>
        {wallet.error ? <div className="notice notice-error">{wallet.error}</div> : null}
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="panel">
        <div className="notice notice-info">
          The connected wallet <span className="mono">{wallet.address}</span> does not own this name, so
          this is read-only. Only a card signed by the owner takes effect — neither we nor an AI can sign
          in their place.
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2 className="faq-q" style={{ fontSize: 18 }}>
        Edit the card
      </h2>
      <p className="body-2" style={{ fontSize: 15 }}>
        Written to the ERC-8004 standard so another AI can read it directly.{' '}
        <strong>Everything is private by default — only the name and the address are visible</strong>, and
        fields become public one switch at a time.
        {published ? ' (Fields you kept private on the published card cannot be read back; fill them in again if you want them.)' : ''}
      </p>

      <label className="search-label" htmlFor="card-description">
        Description
      </label>
      <textarea
        id="card-description"
        className="field"
        rows={3}
        value={draft.description}
        onChange={(event) => update('description', event.target.value)}
        placeholder="For example: wedding and landscape photography, bookings open."
      />
      <VisibilityPicker
        field="description"
        draft={draft}
        onChange={setVisibility}
      />

      <div className="field-row">
        <div>
          <label className="search-label" htmlFor="card-host">
            Runs on
          </label>
          <input
            id="card-host"
            className="field"
            value={draft.host}
            onChange={(event) => update('host', event.target.value)}
            placeholder="Claude / Grok / Muse"
          />
        </div>
        <div>
          <label className="search-label" htmlFor="card-contact">
            Contact
          </label>
          <input
            id="card-contact"
            className="field"
            value={draft.contact}
            onChange={(event) => update('contact', event.target.value)}
            placeholder="you@example.com"
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <VisibilityPicker field="host" draft={draft} onChange={setVisibility} />
        <VisibilityPicker field="contact" draft={draft} onChange={setVisibility} />
      </div>

      <label className="search-label" htmlFor="card-image">
        Image — required by the ERC-8004 standard
      </label>
      <input
        id="card-image"
        className="field"
        value={draft.image}
        onChange={(event) => update('image', event.target.value)}
        placeholder="ipfs://… or https://…"
      />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => update('image', defaultAvatarDataUri(label))}
        >
          Use a default avatar
        </button>
        <span className="body-2" style={{ margin: 0, fontSize: 13, opacity: 0.8 }}>
          Generates one from the name and stores it inside the card, so it cannot break later.
        </span>
      </div>
      <VisibilityPicker field="image" draft={draft} onChange={setVisibility} />

      <label className="search-label" htmlFor="card-payout">
        Payout address (optional)
      </label>
      <input
        id="card-payout"
        className="field mono"
        value={draft.payoutAddress}
        onChange={(event) => update('payoutAddress', event.target.value)}
        placeholder="0x…"
      />
      <VisibilityPicker field="payoutAddress" draft={draft} onChange={setVisibility} />

      <div>
        <span className="search-label">Service endpoints</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {draft.services.map((service, index) => (
            <div key={index} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                className="field"
                style={{ maxWidth: 120 }}
                list="service-names"
                value={service.name}
                onChange={(event) => updateService(index, { name: event.target.value })}
                placeholder="web"
                aria-label="Endpoint name"
              />
              <input
                className="field"
                style={{ flex: 1, minWidth: 200 }}
                value={service.endpoint}
                onChange={(event) => updateService(index, { endpoint: event.target.value })}
                placeholder="https://…"
                aria-label="Endpoint URL"
              />
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    services: prev.services.filter((_, i) => i !== index),
                  }))
                }
              >
                Remove
              </button>
            </div>
          ))}
          <datalist id="service-names">
            {SERVICE_SUGGESTIONS.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() =>
                setDraft((prev) => ({ ...prev, services: [...prev.services, { name: 'web', endpoint: '' }] }))
              }
            >
              Add an endpoint
            </button>
          </div>
        </div>
      </div>
      <VisibilityPicker field="services" draft={draft} onChange={setVisibility} />

      {problems.length > 0 ? (
        <div className="notice notice-error">
          Still missing (the card is published to the ERC-8004 standard, where these are required):
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? <div className="notice notice-error">{error}</div> : null}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void publish()}>
          {phase === 'signing' ? 'Waiting for your signature…' : phase === 'publishing' ? 'Writing to chain…' : 'Sign and publish'}
        </button>
        <span className="record-sample-label" style={{ color: 'var(--ink-3)' }}>
          We pay the fee; you sign once.
        </span>
      </div>
    </div>
  );
}

function VisibilityPicker({
  field,
  draft,
  onChange,
}: {
  field: (typeof EDITABLE_FIELDS)[number];
  draft: CardDraft;
  onChange: (field: (typeof EDITABLE_FIELDS)[number], value: FieldVisibility) => void;
}) {
  const current = draft.visibility[field] ?? 'private';
  return (
    <div className="visibility-row">
      <span className="record-sample-label" style={{ color: 'var(--ink-3)' }}>
        {FIELD_LABELS[field]}:
      </span>
      {(['public', 'certified-only', 'private'] as FieldVisibility[]).map((option) => (
        <button
          key={option}
          type="button"
          className={`chip ${current === option ? 'chip-active' : ''}`}
          aria-pressed={current === option}
          onClick={() => onChange(field, option)}
        >
          {VISIBILITY_LABELS[option]}
        </button>
      ))}
    </div>
  );
}
