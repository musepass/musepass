/**
 * The ledger and the batches have to agree, or the anchors page is theatre.
 *
 * This recomputes every root from the records it claims to cover. It is the same
 * check the page runs in the browser, done here so a bad ledger cannot be
 * deployed in the first place.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { batchRoot, leafOf, merkleProof, verifyMerkleProof } from '@musename/verify';

import { ANCHOR_LEDGER } from '../lib/anchorLedger';

describe('the anchor ledger', () => {
  it('has at least the genesis batch', () => {
    expect(ANCHOR_LEDGER.length).toBeGreaterThanOrEqual(1);
  });

  it.each(ANCHOR_LEDGER.map((anchor) => [anchor.tx, anchor] as const))(
    '%s recomputes to the root it claims',
    (_tx, anchor) => {
      const root = batchRoot(anchor.records);
      expect(root).toBe(anchor.root);
      expect(anchor.count).toBe(anchor.records.length);
    },
  );

  it.each(ANCHOR_LEDGER.map((anchor) => [anchor.tx, anchor] as const))(
    '%s proves every record it covers',
    (_tx, anchor) => {
      const records = anchor.records;
      const leaves = records.map((record) => leafOf(record));
      const root = batchRoot(records);
      leaves.forEach((_, index) => {
        const proof = merkleProof(leaves, index);
        expect(verifyMerkleProof({ root, leaf: proof.leaf, proof: proof.proof })).toBe(true);
      });
    },
  );

  it('matches the committed ledger file and the records it points at', () => {
    const ledger = JSON.parse(
      readFileSync(resolve(__dirname, '../../../deployments/receipt-anchors.json'), 'utf8'),
    ) as Array<{ tx: string; root: string; count: number; records: string }>;
    expect(ANCHOR_LEDGER.length).toBe(ledger.length);
    ANCHOR_LEDGER.forEach((anchor, index) => {
      expect(anchor.tx).toBe(ledger[index]!.tx);
      expect(anchor.root).toBe(ledger[index]!.root);
      const records = JSON.parse(readFileSync(resolve(__dirname, '../../../', ledger[index]!.records), 'utf8'));
      expect(anchor.records).toEqual(records);
    });
  });
});
