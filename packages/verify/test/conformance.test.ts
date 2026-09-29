/**
 * Conformance against the draft's own vectors.
 *
 * These 23 files come from ethereum/ERCs#2002 at a pinned commit, vendored by
 * scripts/fetch-erc8412-vectors.mjs. They are not our test data: each one is a
 * complete document package with real keccak digests and real EIP-712 waiver
 * signatures, plus the verdict a conforming checker has to reach. If our
 * canonicalisation, packing, waiver recovery or rule evaluation drifts, these
 * fail — which is the only honest way to claim we implemented the draft rather
 * than something inspired by it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { type VerificationInput, verifyPackage } from '../src/verify.js';

const FIXTURES = resolve(__dirname, 'fixtures/erc8412');
const manifest = JSON.parse(readFileSync(join(FIXTURES, 'manifest.json'), 'utf8')) as {
  commit: string;
  count: number;
  files: Record<string, string>;
};

const files = readdirSync(FIXTURES)
  .filter((name) => name.endsWith('.json') && name !== 'manifest.json')
  .sort();

interface Vector extends VerificationInput {
  name: string;
  rule: string;
  description: string;
  expect: { valid: boolean; violations?: string[] };
  chainAccepts?: boolean;
}

const load = (file: string): Vector => JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as Vector;

describe(`ERC-8412 conformance (${manifest.commit.slice(0, 7)})`, () => {
  it('vendored every vector the manifest claims', () => {
    expect(files.length).toBe(manifest.count);
    expect(files.length).toBe(23);
  });

  it.each(files)('%s', async (file) => {
    const vector = load(file);
    const result = await verifyPackage(vector);

    expect(result.valid, `expected valid=${vector.expect.valid}: ${vector.description}`).toBe(
      vector.expect.valid,
    );

    // Every rule the vector says must be reported: reporting extra rules is
    // allowed (an implementation may find more), missing one is not.
    for (const rule of vector.expect.violations ?? []) {
      expect(
        result.violations.some((violation) => violation.rule === rule),
        `${file} should report ${rule}, reported ${JSON.stringify(result.violations)}`,
      ).toBe(true);
    }
  });

  it('says what it could not check instead of guessing', async () => {
    const custom = load('valid-custom-rule.json');
    const result = await verifyPackage(custom);
    expect(result.valid).toBe(true);
    expect(result.unchecked.join(' ')).toContain('custom decisionRule');
  });

  it('refutes packages the registry alone would accept', async () => {
    const refuted = files
      .map(load)
      .filter((vector) => vector.expect.valid === false && vector.chainAccepts === true);
    // The draft's point is that on-chain checks are not enough. If this number
    // ever drops to zero, the vectors stopped covering that gap.
    expect(refuted.length).toBeGreaterThanOrEqual(15);
    for (const vector of refuted) {
      expect((await verifyPackage(vector)).valid).toBe(false);
    }
  });
});
