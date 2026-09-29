'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPublicClient, createWalletClient, custom, http, type Address } from 'viem';

import { KNOWN_CHAINS, WalletError, getProvider } from '@/lib/wallet';
import {
  ENS_REGISTRY,
  ENS_REGISTRY_ABI_FOR_REVERSE,
  REVERSE_REGISTRAR,
  REVERSE_RESOLVER_ABI,
  describePrimaryName,
  reverseNodeFor,
  setNameCalldata,
} from '@/lib/primaryName';
import { useWallet } from './WalletProvider';

const MAINNET = {
  id: 1,
  name: 'Ethereum',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [KNOWN_CHAINS[1].rpcUrls[0]] } },
} as const;

/**
 * "Make this my name."
 *
 * Forward resolution is already live; this is the reverse record, the thing that
 * decides whether a wallet prints `xiaoming.musename.eth` or `0x603b…`. ENS only
 * lets the address itself set it, so the platform cannot do this on anyone's
 * behalf — hence a card with one button rather than a background job.
 */
export function PrimaryNameCard({ fullName, ownerAddress }: { fullName: string; ownerAddress: string }) {
  const wallet = useWallet();
  const [currentPrimary, setCurrentPrimary] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const client = useMemo(
    () => createPublicClient({ chain: MAINNET, transport: http(MAINNET.rpcUrls.default.http[0]) }),
    [],
  );

  const load = useCallback(async () => {
    if (!ownerAddress) return;
    setChecking(true);
    try {
      const node = reverseNodeFor(ownerAddress as Address);
      const resolver = await client.readContract({
        address: ENS_REGISTRY,
        abi: ENS_REGISTRY_ABI_FOR_REVERSE,
        functionName: 'resolver',
        args: [node],
      });
      if (resolver === '0x0000000000000000000000000000000000000000') {
        setCurrentPrimary(null);
      } else {
        const name = await client.readContract({
          address: resolver,
          abi: REVERSE_RESOLVER_ABI,
          functionName: 'name',
          args: [node],
        });
        setCurrentPrimary(name || null);
      }
    } catch {
      // A missing name record is not an error worth shouting about.
      setCurrentPrimary(null);
    } finally {
      setChecking(false);
    }
  }, [client, ownerAddress]);

  useEffect(() => {
    void load();
  }, [load]);

  const prompt = describePrimaryName({
    connected: wallet.address,
    owner: ownerAddress,
    fullName,
    currentPrimary,
  });

  async function setName() {
    setError(null);
    setNote(null);
    setBusy(true);
    try {
      const account = (wallet.address ?? (await wallet.connectWallet())) as Address;
      // The reverse namespace lives on mainnet, wherever the name itself lives.
      await wallet.switchTo(1);
      const signer = createWalletClient({ account, transport: custom(getProvider() as never) });
      const hash = await signer.sendTransaction({
        to: REVERSE_REGISTRAR,
        data: setNameCalldata(fullName),
        chain: null,
      });
      await client.waitForTransactionReceipt({ hash });
      setNote(`主名字已提交：${hash}`);
      await load();
    } catch (cause) {
      const code = (cause as { code?: number }).code;
      setError(
        cause instanceof WalletError
          ? cause.message
          : code === 4001
            ? '你取消了这笔交易。'
            : `没有成功：${(cause as { shortMessage?: string }).shortMessage ?? '请再试一次。'}`,
      );
    } finally {
      setBusy(false);
    }
  }

  if (!prompt.offer) {
    return (
      <div className="panel">
        <h2 className="faq-q" style={{ fontSize: 18 }}>
          主名字
        </h2>
        <div className="notice notice-ok">{prompt.message}</div>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2 className="faq-q" style={{ fontSize: 18 }}>
        主名字
      </h2>
      <p className="body-2">{checking ? '正在读链上的反向记录…' : prompt.message}</p>
      {prompt.actionable ? (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void setName()}>
          {busy ? '等待钱包确认…' : '把这个名字设为主名字'}
        </button>
      ) : null}
      {error ? <div className="notice notice-error" style={{ marginTop: 8 }}>{error}</div> : null}
      {note ? <div className="notice notice-ok" style={{ marginTop: 8 }}>{note}</div> : null}
      <p className="body-2" style={{ fontSize: 13, marginTop: 8 }}>
        反向记录在以太坊主网的 <span className="mono">addr.reverse</span> 命名空间里，
        只有这个地址本人能写。设好之后，钱包和区块浏览器显示的就是名字，而不是一串 0x 地址。
      </p>
    </div>
  );
}
