/**
 * The pieces the conformance vectors do not pin down by themselves: canonical
 * JSON, the 2-bit packing, the merkle anchor, and what happens when someone
 * edits a document after the fact.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { keccak256, toHex } from 'viem';

import { OUTCOME_NAMES, pack2Bit, outcomesFromNames, unpack2Bit } from '../src/criteria.js';
import { JcsError, canonicalJson, documentDigest } from '../src/jcs.js';
import { merkleProof, merkleRoot, verifyMerkleProof } from '../src/merkle.js';
import { verifyPackage, type VerificationInput } from '../src/verify.js';

const FIXTURES = resolve(__dirname, 'fixtures/erc8412');
const valid = JSON.parse(
  readFileSync(join(FIXTURES, 'valid-satisfied.json'), 'utf8'),
) as VerificationInput;

describe('canonical JSON', () => {
  it('sorts keys, drops whitespace, and keeps non-ASCII literal', () => {
    expect(canonicalJson({ b: 1, a: [true, null], 'ü': 'x' })).toBe('{"a":[true,null],"b":1,"ü":"x"}');
  });

  it('refuses the numbers the ERC forbids', () => {
    expect(() => canonicalJson({ amount: 1.5 })).toThrow(JcsError);
    expect(canonicalJson({ amount: 2 })).toBe('{"amount":2}');
  });

  it('hashes the way the vectors were built', () => {
    expect(documentDigest({ version: '1' })).toBe(keccak256(toHex('{"version":"1"}')));
  });
});

describe('packed 2-bit fields', () => {
  it('round trips', () => {
    const names = ['MET', 'UNMET', 'WAIVED', 'NOT_APPLICABLE', 'MET'] as const;
    const packed = outcomesFromNames([...names]);
    expect(names.map((_, index) => OUTCOME_NAMES[unpack2Bit(packed, index)])).toEqual([...names]);
  });

  it('is most-significant bits first, like the draft', () => {
    // required+waivable (11) then optional (00) then required (01) is 0b11000100.
    expect(pack2Bit([3, 0, 1])).toBe('0xc4');
  });
});

describe('merkle anchor', () => {
  const leaves = ['0x01', '0x02', '0x03', '0x04', '0x05'].map((value) =>
    keccak256(toHex(value)),
  ) as `0x${string}`[];

  it('proves every leaf it built', () => {
    const root = merkleRoot(leaves);
    leaves.forEach((leaf, index) => {
      const proof = merkleProof(leaves, index);
      expect(proof.root).toBe(root);
      expect(verifyMerkleProof({ root, leaf, proof: proof.proof })).toBe(true);
    });
  });

  it('rejects a leaf that was not in the batch', () => {
    const root = merkleRoot(leaves);
    const proof = merkleProof(leaves, 0);
    const impostor = keccak256(toHex('not in the batch'));
    expect(verifyMerkleProof({ root, leaf: impostor, proof: proof.proof })).toBe(false);
  });

  it('rejects a proof with a tampered step', () => {
    const root = merkleRoot(leaves);
    const proof = merkleProof(leaves, 2);
    const broken = [...proof.proof];
    broken[0] = keccak256(toHex('swapped'));
    expect(verifyMerkleProof({ root, leaf: proof.leaf, proof: broken })).toBe(false);
  });
});

describe('editing a document after the fact', () => {
  it('accepts the package as published', async () => {
    expect((await verifyPackage(valid)).valid).toBe(true);
  });

  it('refutes an edited criteria document', async () => {
    const edited = structuredClone(valid);
    edited.criteria.decisionRule = 'ALL_REQUIRED_AND_AT_LEAST(9)';
    const result = await verifyPackage(edited);
    expect(result.valid).toBe(false);
    expect(result.violations.map((violation) => violation.rule)).toContain('O5');
  });

  it('refutes evidence added to the bundle afterwards', async () => {
    const edited = structuredClone(valid);
    edited.attestation.bundleDigest = keccak256(toHex('a different bundle'));
    expect((await verifyPackage(edited)).valid).toBe(false);
  });

  it('refutes a waiver signed by somebody who is not the authority', async () => {
    const edited = structuredClone(valid);
    edited.criteria.waiverAuthority = '0x1111111111111111111111111111111111111111';
    const result = await verifyPackage(edited);
    expect(result.valid).toBe(false);
    expect(result.violations.map((violation) => violation.rule)).toContain('O5');
  });
});
