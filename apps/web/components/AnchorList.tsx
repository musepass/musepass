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
        <div className="notice notice-info">No batches have been anchored yet.</div>
      ) : null}

      {ANCHOR_LEDGER.map((anchor) => {
        const check = checks[anchor.tx];
        return (
          <div key={anchor.tx} className="card" style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="chip">{anchor.count} records</span>
              <span className="body-2">{new Date(anchor.anchoredAt * 1000).toISOString().slice(0, 10)}</span>
              <span className="body-2">
                {anchor.chainName} · block {anchor.block}
              </span>
            </div>

            <div className="kv">
              <span>Merkle root</span>
              <span className="mono mono-break" style={{ fontSize: 12 }}>
                {anchor.root}
              </span>
              <span>Transaction</span>
              <span className="mono mono-break" style={{ fontSize: 12 }}>
                <a href={`${anchor.explorer}/tx/${anchor.tx}`} target="_blank" rel="noreferrer noopener">
                  {anchor.tx}
                </a>
              </span>
              <span>Records from</span>
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
                Recompute this root on your machine
              </button>
            </div>

            {check ? (
              <div className={check.ok ? 'notice notice-ok' : 'notice notice-error'}>
                {check.ok
                  ? `These records hash to exactly that root (${check.root}), and every one of them can be proven on its own with a merkle proof.`
                  : `They do not match: recomputed ${check.root}. That means a file on this page was edited.`}
              </div>
            ) : null}
          </div>
        );
      })}

      <p className="body-2">
        How it works: a batch of record digests is folded into a merkle tree and only the root goes on
        chain. Anyone holding one record and its proof can show that it was in that batch — without us
        being online and without trusting us. The verification code is in
        <span className="mono"> packages/verify</span>; the command line and the browser run the same copy.
      </p>
    </div>
  );
}
