/**
 * Anchoring a batch of records on chain, without adding a contract.
 *
 * One transaction, zero value, to ourselves, with the root in the calldata:
 *
 *   tag ‖ root ‖ count ‖ anchoredAt
 *
 * Four words, 128 bytes. The tag says what this is, so nobody has to trust a
 * memo; the root is the merkle root of the batch; count and timestamp are there
 * because they are impossible to recover from a root and useful to a human
 * reading the chain years later.
 *
 * Why not a contract: an anchor holds no funds and needs no state, and the
 * project rule is not to write core contracts. A transaction's input data is
 * already immutable and already indexed, which is all this needs. The cost is
 * about 23,000 gas per batch.
 */
import { concat, keccak256, toHex, type Hex } from 'viem';

import { documentDigest } from './jcs.js';
import { merkleRoot } from './merkle.js';

export const ANCHOR_TAG: Hex = keccak256(toHex('musename.receipts.v1'));

export interface AnchorPayload {
  tag: Hex;
  root: Hex;
  count: number;
  anchoredAt: number;
}

const word = (value: bigint): Hex => `0x${value.toString(16).padStart(64, '0')}` as Hex;

export function encodeAnchorPayload(input: { root: Hex; count: number; anchoredAt: number }): Hex {
  return concat([ANCHOR_TAG, input.root, word(BigInt(input.count)), word(BigInt(input.anchoredAt))]);
}

export function decodeAnchorPayload(data: Hex): AnchorPayload | null {
  if (data.length !== 2 + 128 * 2) return null;
  const tag = `0x${data.slice(2, 66)}` as Hex;
  if (tag !== ANCHOR_TAG) return null;
  return {
    tag,
    root: `0x${data.slice(66, 130)}` as Hex,
    count: Number(BigInt(`0x${data.slice(130, 194)}`)),
    anchoredAt: Number(BigInt(`0x${data.slice(194, 258)}`)),
  };
}

/** A record is either a 32-byte digest or a document that hashes to one. */
export interface AnchorRecord {
  digest?: Hex;
  [key: string]: unknown;
}

export function leafOf(record: AnchorRecord): Hex {
  return record.digest ?? (documentDigest(record) as Hex);
}

export function batchRoot(records: AnchorRecord[]): Hex {
  return merkleRoot(records.map(leafOf));
}

/** Check a published anchor against the records somebody claims it covers. */
export function verifyAnchor(input: { data: Hex; records: AnchorRecord[] }): {
  ok: boolean;
  reason: string;
  root: Hex | null;
  count: number | null;
  anchoredAt: number | null;
} {
  const payload = decodeAnchorPayload(input.data);
  if (!payload) {
    return { ok: false, reason: 'not a MuseName receipt anchor', root: null, count: null, anchoredAt: null };
  }
  if (payload.count !== input.records.length) {
    return {
      ok: false,
      reason: `anchor covers ${payload.count} records, ${input.records.length} were presented`,
      root: payload.root,
      count: payload.count,
      anchoredAt: payload.anchoredAt,
    };
  }
  const root = batchRoot(input.records);
  return {
    ok: root === payload.root,
    reason: root === payload.root ? 'the batch hashes to the anchored root' : 'the batch does not hash to the anchored root',
    root: payload.root,
    count: payload.count,
    anchoredAt: payload.anchoredAt,
  };
}
