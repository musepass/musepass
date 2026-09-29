import { describe, expect, it } from 'vitest';
import {
  RECORD_DIGEST_TAG,
  RecordFieldError,
  RecordKind,
  RecordVerdict,
  assertRecordFields,
  recordDedupeKey,
  recordDigest,
  verdictCopy,
  type RecordFields,
} from '../src/record.js';

/** The same fixture as contracts/test/RecordDigest.t.sol. */
const fixture: RecordFields = {
  chainId: 4663,
  registry: '0x1111111111111111111111111111111111111111',
  node: '0x2222222222222222222222222222222222222222222222222222222222222222',
  ownerAtIssue: '0x3333333333333333333333333333333333333333',
  actor: '0x4444444444444444444444444444444444444444',
  kind: RecordKind.Verdict,
  verdict: RecordVerdict.Fail,
  issuedAt: 1_790_000_000,
  standardHash: '0x5555555555555555555555555555555555555555555555555555555555555555',
  evidenceHash: '0x6666666666666666666666666666666666666666666666666666666666666666',
  refRecordId: 0,
};

describe('record digest', () => {
  it('matches the Solidity implementation byte for byte', () => {
    expect(RECORD_DIGEST_TAG).toBe('0x4c04084f84da0da2e1cd0806e7ad4328c397c1dc9953c6b4d6b3cf0d9049488f');
    expect(recordDigest(fixture)).toBe(
      '0x1a124827b12ed10cbe8bbde11611aa8b9dcb21fba4d6a114dc27f33a7d1499bc',
    );
    expect(recordDedupeKey(fixture)).toBe(
      '0x75ac43f6b0faf5b47f33a281cbe8d8b4a7a3a189e8a6aab5463d826a5256d9aa',
    );
  });

  it('changes when any field that identifies the claim changes', () => {
    const original = recordDigest(fixture);
    expect(recordDigest({ ...fixture, verdict: RecordVerdict.Pass })).not.toBe(original);
    expect(recordDigest({ ...fixture, chainId: 1 })).not.toBe(original);
    expect(recordDigest({ ...fixture, registry: '0x9999999999999999999999999999999999999999' })).not.toBe(original);
    expect(recordDigest({ ...fixture, evidenceHash: `0x${'9'.repeat(64)}` })).not.toBe(original);
  });

  it('ignores time in the dedupe key but not the owner', () => {
    expect(recordDedupeKey({ ...fixture, issuedAt: 1_800_000_000 })).toBe(recordDedupeKey(fixture));
    expect(recordDedupeKey({ ...fixture, ownerAtIssue: '0x8888888888888888888888888888888888888888' })).not.toBe(
      recordDedupeKey(fixture),
    );
  });

  it('refuses a malformed record instead of hashing it', () => {
    expect(() => recordDigest({ ...fixture, node: '0x22' })).toThrow(RecordFieldError);
    expect(() => recordDigest({ ...fixture, actor: 'not-an-address' })).toThrow(/actor/);
    expect(() => assertRecordFields({ ...fixture, verdict: 3 as RecordVerdict })).toThrow(/verdict/);
    expect(() => assertRecordFields({ ...fixture, kind: 5 as RecordKind })).toThrow(/kind/);
  });

  it('will not let a dispute borrow the weight of a verdict', () => {
    expect(() =>
      assertRecordFields({ ...fixture, kind: RecordKind.Dispute, verdict: RecordVerdict.Pass }),
    ).toThrow(/dispute/);
    expect(() =>
      assertRecordFields({ ...fixture, kind: RecordKind.Dispute, verdict: RecordVerdict.Unproven }),
    ).not.toThrow();
  });
});

describe('verdict wording', () => {
  it('keeps the three outcomes visibly different', () => {
    expect(verdictCopy(RecordVerdict.Pass)).toEqual({ zh: '通过', en: 'passed', tone: 'positive' });
    expect(verdictCopy(RecordVerdict.Fail)).toEqual({ zh: '失败', en: 'failed', tone: 'negative' });
    const unproven = verdictCopy(RecordVerdict.Unproven);
    expect(unproven.tone).toBe('unknown');
    expect(unproven.zh).not.toBe('通过');
    expect(unproven.en).not.toContain('pass');
  });
});
