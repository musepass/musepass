/**
 * The web verifier has to reach the same verdict the CLI does, because it runs
 * the same code: if these two ever disagree, one of them is lying to somebody.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runVerification } from '../lib/verifyCase';
import { VERIFY_EXAMPLES } from '../lib/verifyExamples';

const FIXTURES = resolve(__dirname, '../../../packages/verify/test/fixtures/erc8412');
const fixture = (name: string) => JSON.parse(readFileSync(resolve(FIXTURES, `${name}.json`), 'utf8'));

describe('the examples the page ships', () => {
  it('are byte-identical to the conformance vectors they come from', () => {
    expect(VERIFY_EXAMPLES['valid-satisfied']).toEqual(fixture('valid-satisfied'));
    expect(VERIFY_EXAMPLES['o2-met-without-evidence']).toEqual(fixture('o2-met-without-evidence'));
  });
});

describe('running a verification in the browser', () => {
  it('accepts a package that stands up', async () => {
    const outcome = await runVerification(JSON.stringify(VERIFY_EXAMPLES['valid-satisfied']));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result.valid).toBe(true);
  });

  it('refutes a package with a MET obligation and no evidence', async () => {
    const outcome = await runVerification(JSON.stringify(VERIFY_EXAMPLES['o2-met-without-evidence']));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.valid).toBe(false);
      expect(outcome.result.violations.map((violation) => violation.rule)).toContain('O2');
    }
  });

  it('says what is wrong when the input is not JSON', async () => {
    const outcome = await runVerification('not json');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('JSON');
  });

  it('names the missing part when one of the four is absent', async () => {
    const { attestation, ...rest } = VERIFY_EXAMPLES['valid-satisfied'] as Record<string, unknown>;
    const outcome = await runVerification(JSON.stringify(rest));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('attestation');
  });
});
