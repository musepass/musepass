'use client';

import { useState } from 'react';

import { ANCHOR_LEDGER } from '@/lib/anchorLedger';
import { batchRoot, leafOf, merkleProof, verifyMerkleProof, type AnchorRecord } from '@musename/verify';

interface Check {
  ok: boolean;
  root: string;
  proofSize: number;
}

/**
 * What we have anchored, and the one thing a reader can do about it: recompute
 * the root from the records and see whether it matches. The root itself is not
 * taken on faith — the transaction link goes to the chain, where it is in the
 * input data and cannot be edited afterwards.
 */
export function AnchorList() {
  const [checks, setChecks] = useState<Record<string, Check>>({});

  function recompute(tx: string, records: Array<Record<string, unknown>>, expected: string) {
    const entries: AnchorRecord[] = records;
    const root = batchRoot(entries);
    const leaves = entries.map(leafOf);
    const proofs = entries.map((_, index) => merkleProof(leaves, index));
    const everyLeafProves = proofs.every((proof) =>
      verifyMerkleProof({ root, leaf: proof.leaf, proof: proof.proof }),
    );
    const proofSize: number = proofs[0]?.proof.length ?? 0;
    setChecks((previous) => ({
      ...previous,
      [tx]: { ok: root === expected && everyLeafProves, root, proofSize },
    }));
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {ANCHOR_LEDGER.length === 0 ? (
        <div className="notice notice-info">还没有锚定过任何批次。</div>
      ) : null}

      {ANCHOR_LEDGER.map((anchor) => {
        const check = checks[anchor.tx];
        return (
          <div key={anchor.tx} className="card" style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="chip">{anchor.count} 条记录</span>
              <span className="body-2">{new Date(anchor.anchoredAt * 1000).toISOString().slice(0, 10)}</span>
              <span className="body-2">
                {anchor.chainName} · 区块 {anchor.block}
              </span>
            </div>

            <div className="kv">
              <span>默克尔根</span>
              <span className="mono mono-break" style={{ fontSize: 12 }}>
                {anchor.root}
              </span>
              <span>交易</span>
              <span className="mono mono-break" style={{ fontSize: 12 }}>
                <a href={`${anchor.explorer}/tx/${anchor.tx}`} target="_blank" rel="noreferrer noopener">
                  {anchor.tx}
                </a>
              </span>
              <span>记录来源</span>
              <span className="mono" style={{ fontSize: 12 }}>
                {anchor.recordsPath}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => recompute(anchor.tx, anchor.records, anchor.root)}
              >
                在这台机器上重算这个根
              </button>
            </div>

            {check ? (
              <div className={check.ok ? 'notice notice-ok' : 'notice notice-error'}>
                {check.ok
                  ? `这些记录算出来就是那个根（${check.root}），每条都能用默克尔证明单独证明。`
                  : `对不上：重算得到 ${check.root}。这说明这一页的文件被改过。`}
              </div>
            ) : null}
          </div>
        );
      })}

      <p className="body-2">
        原理：把一天/一批记录的摘要做成默克尔树，只把根写进链上。任何人拿着其中一条记录和它的证明，
        就能独立证明「这条在那一批里」，不需要我们在线，也不需要信任我们。验证代码在
        <span className="mono"> packages/verify</span>，命令行和浏览器里跑的是同一份。
      </p>
    </div>
  );
}
