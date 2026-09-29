/**
 * The anchoring layer: what gets written, and what a reader can prove from it.
 */
import { describe, expect, it } from 'vitest';
import { keccak256, toHex } from 'viem';

import {
  ANCHOR_TAG,
  batchRoot,
  decodeAnchorPayload,
  encodeAnchorPayload,
  leafOf,
  verifyAnchor,
  type AnchorRecord,
} from '../src/anchor.js';
import { merkleProof, verifyMerkleProof } from '../src/merkle.js';

const records: AnchorRecord[] = [
  { kind: 'name-claim', name: 'xiaoming.musename.eth', tx: `0x${'11'.repeat(32)}` },
  { kind: 'card-publish', name: 'xiaoming.musename.eth', tx: `0x${'22'.repeat(32)}` },
  { digest: keccak256(toHex('already hashed')) },
];

describe('the anchor payload', () => {
  it('round trips', () => {
    const root = batchRoot(records);
    const data = encodeAnchorPayload({ root, count: 3, anchoredAt: 1790700000 });
    const decoded = decodeAnchorPayload(data);
    expect(decoded).not.toBeNull();
    expect(decoded!.tag).toBe(ANCHOR_TAG);
    expect(decoded!.root).toBe(root);
    expect(decoded!.count).toBe(3);
    expect(decoded!.anchoredAt).toBe(1790700000);
  });

  it('refuses calldata that is not one of ours', () => {
    expect(decodeAnchorPayload('0x1234')).toBeNull();
    const foreign = keccak256(toHex('some other project')) as `0x${string}`;
    const data = `${foreign}${toHex(1n, { size: 32 }).slice(2)}${toHex(1n, { size: 32 }).slice(2)}${toHex(1n, { size: 32 }).slice(2)}` as `0x${string}`;
    expect(decodeAnchorPayload(data)).toBeNull();
  });
});

describe('verifying a batch against an anchor', () => {
  const data = encodeAnchorPayload({ root: batchRoot(records), count: records.length, anchoredAt: 1790700000 });

  it('accepts the batch it was built from', () => {
    const result = verifyAnchor({ data, records });
    expect(result.ok).toBe(true);
    expect(result.count).toBe(3);
  });

  it('refutes an edited record', () => {
    const edited = structuredClone(records);
    edited[1]!.tx = `0x${'33'.repeat(32)}`;
    const result = verifyAnchor({ data, records: edited });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('does not hash');
  });

  it('refutes a different number of records', () => {
    const result = verifyAnchor({ data, records: records.slice(0, 2) });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('covers 3 records');
  });

  it('lets one record be proven without the other two', () => {
    const leaves = records.map(leafOf);
    const proof = merkleProof(leaves, 1);
    const root = batchRoot(records);
    expect(verifyMerkleProof({ root, leaf: proof.leaf, proof: proof.proof })).toBe(true);
    // The proof is what a holder of a single record keeps. Nothing about the
    // other records is needed, which is the point of anchoring a root.
    expect(proof.proof.length).toBe(2);
  });
});
