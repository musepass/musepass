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
        cause instanceof Error ? `读链失败：${cause.message}` : '读链失败，请刷新重试。',
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
      setNote(`${step.title} 已完成，交易 ${hash}`);
      await refresh();
    } catch (cause) {
      const code = (cause as { code?: number }).code;
      setError(
        cause instanceof WalletError
          ? cause.message
          : code === 4001
            ? '你取消了这笔交易。'
            : `交易没有成功：${(cause as { shortMessage?: string }).shortMessage ?? '请再试一次。'}`,
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
      setResolved(address ? `${name} → ${address}` : `${name} 目前没有解析结果。`);
    } catch (cause) {
      setError(`解析查询失败：${(cause as { shortMessage?: string }).shortMessage ?? '未知错误'}`);
    }
  }

  const done = steps.filter((step) => step.done).length;

  return (
    <div className="panel" style={{ display: 'grid', gap: 16 }}>
      <div>
        <h1 className="h2">启动名字解析</h1>
        <p className="body-2">
          这一步只做一次。名字 <span className="mono">{config.rootName}</span>{' '}
          已经在链上，缺的只是把它指向我们的解析器，这样别人（和别的 AI）才能在钱包里查到{' '}
          <span className="mono">
            {config.exampleLabel}.{config.rootName}
          </span>
          。每一步都会先说清楚要签什么，再让你签。
        </p>
      </div>
      <div className="kv">
        <span>钱包</span>
        <span className="mono">
          {wallet.address ? shortAddress(wallet.address) : '未连接'}
          {wallet.chainId && wallet.chainId !== 1 ? '（这笔要切到 Ethereum 主网）' : ''}
        </span>
        <span>名字主人</span>
        <span className="mono">
          {loading && !observation ? '读取中…' : (observation?.rootOwner ?? '未知')}
        </span>
        <span>进度</span>
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
            {step.done ? <span className="pill-pass">已完成</span> : null}
          </div>
          <p className="body-2">{step.detail}</p>
          <div className="kv">
            <span>发往</span>
            <span className="mono mono-break">{step.to}</span>
          </div>
          {step.done ? null : step.sendable ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending !== null}
              onClick={() => void send(step)}
            >
              {pending === step.id ? '等待钱包确认…' : '用钱包完成这一步'}
            </button>
          ) : (
            <p className="body-2">{step.blocker}</p>
          )}
          <details>
            <summary className="body-2">手动执行（复制到钱包或 Etherscan）</summary>
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
          {loading ? '读取链上状态…' : '刷新状态'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void checkResolution()}
          disabled={done === 0}
        >
          查一次真实解析
        </button>
      </div>
      {resolved ? <div className="notice notice-info mono mono-break">{resolved}</div> : null}
      <p className="body-2">
        解析器地址是预先算好的：同一段字节码用确定性的 CREATE2 部署，谁付款、什么时候付，
        地址都不变，所以可以先把地址写在配置里，再决定谁去部署。
      </p>
    </div>
  );
}
