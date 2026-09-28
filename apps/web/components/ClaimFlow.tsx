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
        const payload = await checkAvailability(trimmed);
        setAvailability(resolveAvailability(payload, trimmed));
      } catch (cause) {
        setAvailability(null);
        setError(cause instanceof ApiError ? cause.message : '查不到这个名字的状态。');
      } finally {
        setPhase('ready');
      }
    },
    [],
  );

  useEffect(() => {
    void check(initialLabel);
  }, [check, initialLabel]);

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
          setError(cause instanceof ApiError ? cause.message : '这个确认链接查不到。');
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
        setError('没能完成，请再试一次。');
      }
    }
  }

  if (phase === 'done' && result) {
    const explorer = config.chain.explorer;
    return (
      <div className="panel">
        <div className="notice notice-ok">
          {result.alreadyRegistered
            ? `${result.fullName} 已经是你的了。`
            : `搞定，${result.fullName} 现在是你的了。`}
        </div>
        <dl className="kv">
          <dt>名字</dt>
          <dd className="mono">{result.fullName}</dd>
          <dt>所有者</dt>
          <dd className="mono">{result.owner}</dd>
          {result.txHash ? (
            <>
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
            </>
          ) : null}
        </dl>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <a className="btn btn-primary" href={`/name/${encodeURIComponent(result.label)}`}>
            查看名字主页
          </a>
          <a className="btn" href="/">
            回首页
          </a>
        </div>
        <p className="body-2" style={{ fontSize: 15 }}>
          名字已经在你的钱包里了。即使我们停止服务，它依然存在、依然能用。下一步是名片——它可以告诉别的
          AI 你能做什么，公开哪些字段完全由你决定。
        </p>
      </div>
    );
  }

  if (!config.registrar) {
    return (
      <div className="panel">
        <div className="notice notice-warn">
          名字服务还没有配置好（缺少合约地址），暂时不能发放名字。我们没有对你的钱包做任何操作。
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="panel">
        <h2 className="h2" style={{ fontSize: 28 }}>
          {mode === 'confirm' ? '确认一下，就完成了。' : '领取一个名字'}
        </h2>

        {mode === 'confirm' && request ? (
          <div className="notice notice-info">
            这个请求来自 <b>{request.requestedByHost ?? '某个 AI'}</b>，是给{' '}
            <span className="mono">{request.requestedFor}</span> 准备的。
            {request.expiresAt ? ` 链接近期有效，过期后让 AI 重新发起即可。` : ''}
          </div>
        ) : null}

        <div className="search-block" style={{ marginTop: 0 }}>
          <label className="search-label" htmlFor="claim-name">
            名字
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
              检查
            </button>
          </div>
          <div className="status" aria-live="polite">
            <AvailabilityLine view={availability} config={config} />
          </div>
        </div>
      </div>

      <div className="panel">
        <h3 className="faq-q" style={{ fontSize: 18 }}>
          第二步：连接钱包并签名
        </h3>
        <p className="body-2" style={{ fontSize: 15 }}>
          名字会直接归到这个钱包地址，手续费由我们代付。只有你签了名，才会真的发放——AI
          和我们都不能替你签名，也不能动你已有的名字。
        </p>

        {wallet.address ? (
          <div className="notice notice-info">
            已连接 <span className="mono">{wallet.address}</span>
            {wrongChain ? ` · 需要切到 ${config.chain.name}` : ''}
          </div>
        ) : null}

        {wallet.error ? <div className="notice notice-error">{wallet.error}</div> : null}
        {error ? <div className="notice notice-error">{error}</div> : null}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {!wallet.address ? (
            <button
              type="button"
              className="btn"
              disabled={wallet.connecting}
              onClick={async () => {
                try {
                  await wallet.connectWallet();
                } catch {
                  // message already in wallet.error
                }
              }}
            >
              {wallet.connecting ? '连接中…' : '连接钱包'}
            </button>
          ) : null}

          {wallet.address && wrongChain ? (
            <button type="button" className="btn" onClick={() => void wallet.switchTo(config.chain.chainId)}>
              切换到 {config.chain.name}
            </button>
          ) : null}

          <button
            type="button"
            className="btn btn-primary"
            disabled={!isAvailable || busy || phase === 'loading'}
            onClick={() => void claim()}
          >
            {phase === 'signing'
              ? '等待钱包签名…'
              : phase === 'submitting'
                ? '发放中…'
                : '签名并领取'}
          </button>
        </div>
      </div>
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
  if (!view) return <span className="status-idle">输入一个名字，先看看能不能用。</span>;
  switch (view.kind) {
    case 'available':
      return (
        <span className="status-ok">
          {view.label}.{config.rootName} 可以注册，免费。
        </span>
      );
    case 'taken':
      return (
        <span className="status-taken">
          {view.label}.{config.rootName} 已被注册。换一个，或者去
          <a className="status-link" href={`/name/${encodeURIComponent(view.label)}`}>
            看看它的主页
          </a>
          。
        </span>
      );
    case 'premium':
      return (
        <span className="status-warn">
          {view.label} 太短，属于靓号。
          {config.features.premiumPurchase ? '' : '目前还没开放购买。'}
        </span>
      );
    case 'reserved':
      return <span className="status-danger">{view.label} 是保留名字，不开放注册。</span>;
    case 'invalid':
    case 'unavailable':
      return <span className="status-danger">{view.message}</span>;
  }
}
