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
        message: error instanceof ApiError ? error.message : '查询失败，请稍后再试。',
      });
    }
  }

  return (
    <section className="hero" id="top">
      <div className="hero-copy">
        <h1 className="h1">
          给你的 AI
          <br />
          一个名字。
        </h1>
        <p className="lede">
          名字在所有支持 ENS 的钱包里都能用。名片告诉别人它能做什么，履历证明它真的做到过。
        </p>

        <div className="search-block">
          <label className="search-label" htmlFor="name-search">
            查一个名字
          </label>
          <div className="search">
            <input
              id="name-search"
              className="search-input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="输入名字，例如 xiaoming"
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
              {status.kind === 'loading' ? '查询中' : '查询'}
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
    return <span className="status-idle">或者直接对你的 AI 说：“帮你自己注册个名字。”</span>;
  }
  if (status.kind === 'loading') {
    return <span className="status-idle">正在查…</span>;
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
            {view.label}.{config.rootName} 可以注册，免费。
          </span>
          <Link className="status-link" href={`/claim?label=${encodeURIComponent(view.label)}`}>
            连接钱包领取
          </Link>
          <span className="status-note">
            手续费我们代付。也可以直接对你的 AI 说：“帮你自己注册个名字。”
          </span>
        </>
      );

    case 'taken':
      return (
        <>
          <span className="status-taken">
            {view.label}.{config.rootName} 已被注册。
          </span>
          <Link className="status-link" href={`/name/${encodeURIComponent(view.label)}`}>
            查看它的主页
          </Link>
          {view.suggestions.length > 0 ? (
            <span className="suggestions">
              试试：
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
          {view.label} 太短，属于靓号。
          {config.features.premiumPurchase ? '可以购买。' : '目前还没开放购买。'}
        </span>
      );

    case 'reserved':
      return (
        <>
          <span className="status-danger">{view.label} 是保留名字，不开放注册。</span>
          {view.appealable ? (
            <a className="status-link" href={`mailto:${config.supportEmail}`}>
              如果这是你的品牌，可以提交申请
            </a>
          ) : null}
        </>
      );

    case 'invalid':
    case 'unavailable':
      return <span className="status-danger">{view.message}</span>;
  }
}
