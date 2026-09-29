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
      setError('服务端还没配置好注册表地址，暂时不能发布。');
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
          : '没能发布，请再试一次。',
      );
    }
  }

  if (result) {
    const explorer = config.chain.explorer;
    return (
      <div className="panel">
        <div className="notice notice-ok">名片已经写进链上了。</div>
        <dl className="kv">
          <dt>内容指纹</dt>
          <dd className="mono-break">{result.contentHash}</dd>
          <dt>交易</dt>
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
          刷新页面就能看到别人读到的那一面——只包含你勾了「公开」的字段。
        </p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          刷新查看
        </button>
      </div>
    );
  }

  if (!wallet.address) {
    return (
      <div className="panel">
        <h2 className="faq-q" style={{ fontSize: 18 }}>
          这是你的名字吗？
        </h2>
        <p className="body-2" style={{ fontSize: 15 }}>
          连接钱包后可以为它写名片。名片由你签名、我们代付手续费，任何访问者都能读到并自行核实。
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
            {wallet.connecting ? '连接中…' : '连接钱包'}
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
          当前钱包 <span className="mono">{wallet.address}</span> 不是这个名字的主人，只能查看。
          只有主人签名的名片才会生效——我们和 AI 都替不了。
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2 className="faq-q" style={{ fontSize: 18 }}>
        编辑名片
      </h2>
      <p className="body-2" style={{ fontSize: 15 }}>
        按 ERC-8004 标准写成，别的 AI 能直接读懂。
        <strong>默认全部不公开，只有名字和地址可见</strong>，逐项勾选后才会公开。
        {published ? '（已发布的内容里，未公开的字段读不回来，需要重新填写。）' : ''}
      </p>

      <label className="search-label" htmlFor="card-description">
        简介
      </label>
      <textarea
        id="card-description"
        className="field"
        rows={3}
        value={draft.description}
        onChange={(event) => update('description', event.target.value)}
        placeholder="例如：婚礼与风光摄影，接受档期咨询。"
      />
      <VisibilityPicker
        field="description"
        draft={draft}
        onChange={setVisibility}
      />

      <div className="field-row">
        <div>
          <label className="search-label" htmlFor="card-host">
            运行在
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
            联系方式
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
        头像（IPFS 地址或图片 URL）
      </label>
      <input
        id="card-image"
        className="field"
        value={draft.image}
        onChange={(event) => update('image', event.target.value)}
        placeholder="ipfs://… 或 https://…"
      />
      <VisibilityPicker field="image" draft={draft} onChange={setVisibility} />

      <label className="search-label" htmlFor="card-payout">
        收款地址（可选）
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
        <span className="search-label">服务接口</span>
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
                aria-label="接口类型"
              />
              <input
                className="field"
                style={{ flex: 1, minWidth: 200 }}
                value={service.endpoint}
                onChange={(event) => updateService(index, { endpoint: event.target.value })}
                placeholder="https://…"
                aria-label="接口地址"
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
                删除
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
              添加接口
            </button>
          </div>
        </div>
      </div>
      <VisibilityPicker field="services" draft={draft} onChange={setVisibility} />

      {problems.length > 0 ? (
        <div className="notice notice-error">
          还差这些：
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
          {phase === 'signing' ? '等待钱包签名…' : phase === 'publishing' ? '写入链上…' : '签名并发布'}
        </button>
        <span className="record-sample-label" style={{ color: 'var(--ink-3)' }}>
          手续费由我们代付，你只需要签一次名。
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
        {FIELD_LABELS[field]}：
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
