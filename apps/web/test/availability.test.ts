import { describe, expect, it } from 'vitest';
import type { ApiEnvelope, AvailabilityData } from '../lib/api';
import { resolveAvailability } from '../lib/availability';

function envelope(
  data: Partial<AvailabilityData>,
  errors: Array<{ code: string; message?: string }> = [],
  options: { summaryEn?: string; verified?: boolean } = {},
): ApiEnvelope<AvailabilityData> {
  return {
    summary: { zh: '(unused)', en: options.summaryEn ?? 'summary' },
    data: {
      label: 'aguang',
      fullName: 'aguang.musepass.eth',
      available: null,
      policyOk: true,
      onChainFree: null,
      price: null,
      units: 6,
      reserved: null,
      invited: null,
      purchase: null,
      suggestions: [],
      ...data,
    },
    errors: errors.map((error) => ({ code: error.code, message: error.message ?? error.code })),
    meta: {
      asOf: '2026-09-29T00:00:00.000Z',
      chain: 'base',
      chainId: 8453,
      verified: options.verified ?? true,
      root: 'musepass.eth',
    },
  };
}

describe('resolveAvailability', () => {
  it('reports an available name', () => {
    const view = resolveAvailability(envelope({ available: true, onChainFree: true }));
    expect(view.kind).toBe('available');
  });

  it('reports a taken name with its suggestions', () => {
    const view = resolveAvailability(
      envelope({ available: false, onChainFree: false, suggestions: ['aguang1', 'aguang2'] }, [
        { code: 'NAME_TAKEN' },
      ]),
    );
    expect(view).toMatchObject({ kind: 'taken', label: 'aguang' });
    if (view.kind === 'taken') expect(view.suggestions).toHaveLength(2);
  });

  it('reports a premium name', () => {
    const view = resolveAvailability(
      envelope({ price: { tier: 'premium', tierId: 'tier-4', priceUsd: 150, currency: 'USDC', active: true } }, [
        { code: 'NOT_FREE_TIER' },
      ]),
    );
    expect(view).toMatchObject({ kind: 'premium', priceUsd: 150 });
  });

  it('reports a reserved name and whether it can be appealed', () => {
    const view = resolveAvailability(
      envelope({ reserved: { category: 'system', appealable: true } }, [{ code: 'RESERVED_NAME' }]),
    );
    expect(view).toMatchObject({ kind: 'reserved', appealable: true });
  });

  it('reports invalid input with the sentence from the backend', () => {
    const view = resolveAvailability(
      envelope({ label: null }, [{ code: 'INVALID_CHARACTER' }], {
        summaryEn: 'That name has characters ENS does not support.',
      }),
    );
    expect(view).toEqual({ kind: 'invalid', message: 'That name has characters ENS does not support.' });
  });

  it('never says a name is free when the chain was not read', () => {
    const view = resolveAvailability(
      envelope({ available: null, onChainFree: null }, [], {
        summaryEn: 'The chain could not be reached just now.',
      }),
      'aguang',
    );
    expect(view.kind).toBe('unavailable');
  });

  it('treats meta.verified false as not checked', () => {
    const view = resolveAvailability(
      envelope({ available: null, onChainFree: null }, [], {
        verified: false,
        summaryEn: 'The chain could not be reached just now. Try again shortly.',
      }),
    );
    expect(view).toEqual({ kind: 'unavailable', message: 'The chain could not be reached just now. Try again shortly.' });
  });
});

describe('state priority', () => {
  it('puts invalid above everything else', () => {
    const view = resolveAvailability(
      envelope({ available: false, onChainFree: false }, [
        { code: 'INVALID_CHARACTER' },
        { code: 'NAME_TAKEN' },
      ]),
    );
    expect(view.kind).toBe('invalid');
  });

  it('puts reserved above taken', () => {
    const view = resolveAvailability(
      envelope({ available: false, onChainFree: false, reserved: { category: 'brand', appealable: false } }, [
        { code: 'RESERVED_NAME' },
        { code: 'NAME_TAKEN' },
      ]),
    );
    expect(view.kind).toBe('reserved');
  });

  it('puts taken above premium, because being taken is a fact', () => {
    const view = resolveAvailability(
      envelope({ available: false, onChainFree: false }, [{ code: 'NOT_FREE_TIER' }, { code: 'NAME_TAKEN' }]),
    );
    expect(view.kind).toBe('taken');
  });

  it('reports premium when nothing else is wrong', () => {
    const view = resolveAvailability(envelope({ available: false, onChainFree: true }, [{ code: 'NOT_FREE_TIER' }]));
    expect(view.kind).toBe('premium');
  });

  it('falls back to unavailable instead of guessing', () => {
    const view = resolveAvailability(envelope({ available: false, onChainFree: null }, [], {
      summaryEn: 'This name cannot be judged right now.',
    }));
    expect(view.kind).toBe('unavailable');
  });
});
