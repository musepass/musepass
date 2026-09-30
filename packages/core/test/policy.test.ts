import { describe, expect, it } from 'vitest';
import { checkClaimQuota, checkLabel, suggestLabels } from '../src/policy.js';
import { testConfig, testReservedIndex } from './helpers.js';

const config = testConfig();
const reservedIndex = testReservedIndex(config);

const check = (label: string, extra: Partial<Parameters<typeof checkLabel>[1]> = {}) =>
  checkLabel(label, { config, reservedIndex, ...extra });

describe('checkLabel — happy path', () => {
  it('accepts an ordinary free name', () => {
    const result = check('aguang');
    expect(result.policyOk).toBe(true);
    expect(result.label).toBe('aguang');
    expect(result.fullName).toBe('aguang.musepass.eth');
    expect(result.price?.tier).toBe('free');
    expect(result.summary.zh).toContain('可以用');
  });

  it('accepts a chinese name', () => {
    const result = check('阿光摄影');
    expect(result.policyOk).toBe(true);
    expect(result.fullName).toBe('阿光摄影.musepass.eth');
  });

  it('reports availability only when the chain was consulted', () => {
    expect(check('aguang').available).toBeNull();
    expect(check('aguang', { onChainFree: true }).available).toBe(true);
    const taken = check('aguang', { onChainFree: false });
    expect(taken.available).toBe(false);
    expect(taken.summary.zh).toContain('已经被注册');
    // Taken is an availability fact, not a rule violation: it must appear as a
    // machine readable reason while policyOk stays true.
    expect(taken.issues.map((issue) => issue.code)).toContain('NAME_TAKEN');
    expect(taken.policyOk).toBe(true);
  });
});

describe('checkLabel — rejections', () => {
  it('rejects an empty name', () => {
    const result = check('');
    expect(result.policyOk).toBe(false);
    expect(result.issues[0]?.code).toBe('EMPTY_LABEL');
  });

  it('rejects disallowed characters', () => {
    const result = check('hello world');
    expect(result.policyOk).toBe(false);
    expect(result.issues[0]?.code).toBe('INVALID_CHARACTER');
  });

  it('rejects names that are too short for the free tier', () => {
    const result = check('abc');
    expect(result.policyOk).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('NOT_FREE_TIER');
    expect(result.price?.tier).toBe('premium');
  });

  it('accepts the same short name once premium sales are enabled', () => {
    // Without allowPremium (phase 1) a short name is refused.
    expect(check('abc', {}).policyOk).toBe(false);
    // With it (phase 6) the same name is acceptable, at the tier price.
    const result = check('abc', { allowPremium: true });
    expect(result.policyOk).toBe(true);
    expect(result.price?.tier).toBe('premium');
    expect(result.price?.priceUsd).toBe(600);
  });

  it('keeps a tier closed while its price is still a placeholder', () => {
    const priced = checkLabel('abc', {
      config: {
        ...config,
        pricing: {
          ...config.pricing,
          premiumTiers: config.pricing.premiumTiers.map((tier) => ({
            ...tier,
            status: 'placeholder',
          })),
        },
      },
      reservedIndex,
      allowPremium: true,
    });
    expect(priced.policyOk).toBe(false);
    expect(priced.issues.map((issue) => issue.code)).toContain('NOT_FREE_TIER');
    expect(priced.price?.tier).toBe('premium');
  });

  it('rejects reserved names', () => {
    const result = check('admin');
    expect(result.issues.map((issue) => issue.code)).toContain('RESERVED_NAME');
    expect(result.reserved?.category).toBe('system');
  });

  it('rejects fullwidth brand spoofs after normalization', () => {
    const result = check('ＧＯＯＧＬＥ');
    expect(result.label).toBe('google');
    expect(result.issues.map((issue) => issue.code)).toContain('RESERVED_NAME');
  });

  it('rejects digit-substituted brands through the folded pass', () => {
    const result = check('g00gle');
    expect(result.issues.map((issue) => issue.code)).toContain('RESERVED_NAME');
  });

  it('rejects emoji while the policy forbids them', () => {
    const result = check('🔵🔵🔵🔵🔵');
    expect(result.issues.map((issue) => issue.code)).toContain('EMOJI_NOT_ALLOWED');
  });

  it('rejects labels with an edge hyphen', () => {
    expect(check('-aguang').issues.map((issue) => issue.code)).toContain('INVALID_NAME');
    expect(check('aguang-').issues.map((issue) => issue.code)).toContain('INVALID_NAME');
  });

  it('rejects labels over the registry byte limit', () => {
    const result = check('a'.repeat(256));
    expect(result.issues.map((issue) => issue.code)).toContain('LABEL_TOO_MANY_BYTES');
  });
});

describe('checkLabel — length is measured in display width', () => {
  it('counts one latin letter as one column', () => {
    expect(check('abcde').units).toBe(5);
    expect(check('abcde').price?.tier).toBe('free');
  });

  it('counts one CJK character as two columns', () => {
    // 4 CJK characters = 8 columns, an ordinary name — not a 4 character
    // collector name. Counting raw code points would wrongly price it.
    const result = check('阿光摄影');
    expect(result.codePoints).toBe(4);
    expect(result.units).toBe(8);
    expect(result.price?.tier).toBe('free');
    expect(result.policyOk).toBe(true);
  });

  it('still treats a two character CJK name as premium', () => {
    const result = check('中文');
    expect(result.units).toBe(4);
    expect(result.issues.map((issue) => issue.code)).toContain('NOT_FREE_TIER');
  });

  it('honours a code point metric when config asks for it', () => {
    const result = checkLabel('阿光摄影', {
      config: { ...config, limits: { ...config.limits, lengthMetric: 'code-points' } },
      reservedIndex,
    });
    expect(result.units).toBe(4);
    expect(result.issues.map((issue) => issue.code)).toContain('NOT_FREE_TIER');
  });
});

describe('checkClaimQuota', () => {
  const empty = {
    walletFreeNames: 0,
    walletSponsoredToday: 0,
    walletSponsoredLifetime: 0,
    platformSponsoredToday: 0,
  };

  it('passes a fresh wallet', () => {
    expect(checkClaimQuota(empty, config)).toEqual([]);
  });

  it('enforces the per wallet free name limit', () => {
    const issues = checkClaimQuota({ ...empty, walletFreeNames: 1 }, config);
    expect(issues[0]?.code).toBe('QUOTA_EXCEEDED');
  });

  it('enforces the per wallet daily sponsorship limit', () => {
    const issues = checkClaimQuota({ ...empty, walletSponsoredToday: 3 }, config);
    expect(issues.map((issue) => issue.code)).toContain('SPONSORSHIP_EXCEEDED');
  });

  it('enforces the platform daily budget', () => {
    const issues = checkClaimQuota({ ...empty, platformSponsoredToday: 500 }, config);
    expect(issues.map((issue) => issue.code)).toContain('SPONSORSHIP_EXCEEDED');
  });
});

describe('suggestLabels', () => {
  it('returns the requested number of free suggestions', () => {
    const suggestions = suggestLabels('aguang', () => true, 3);
    expect(suggestions).toHaveLength(3);
    expect(suggestions[0]).toBe('aguang1');
  });

  it('skips candidates that are already taken', () => {
    const taken = new Set(['aguang1', 'aguang2']);
    const suggestions = suggestLabels('aguang', (candidate) => !taken.has(candidate), 2);
    expect(suggestions).toEqual(['aguang3', 'aguang4']);
  });

  it('never suggests something the policy would reject', () => {
    const isUsable = (candidate: string) =>
      checkLabel(candidate, { config, reservedIndex, onChainFree: true }).available === true;
    const suggestions = suggestLabels('admin', isUsable, 3);
    expect(suggestions.every((candidate) => !candidate.startsWith('admin'))).toBe(true);
  });
});
