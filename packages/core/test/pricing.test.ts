import { describe, expect, it } from 'vitest';
import { isMusePassError } from '../src/errors.js';
import { quoteLabel } from '../src/pricing.js';
import { testConfig } from './helpers.js';

const config = testConfig();

describe('quoteLabel', () => {
  it('prices names at or above the free threshold as free', () => {
    expect(quoteLabel(5, config.pricing)).toMatchObject({ tier: 'free', priceUsd: 0 });
    expect(quoteLabel(12, config.pricing)).toMatchObject({ tier: 'free', priceUsd: 0 });
  });

  it('prices four character names in the four character tier', () => {
    const quote = quoteLabel(4, config.pricing);
    expect(quote.tier).toBe('premium');
    expect(quote.tierId).toBe('tier-4');
    expect(quote.priceUsd).toBe(5);
  });

  it('prices three character names in the three character tier', () => {
    expect(quoteLabel(3, config.pricing).tierId).toBe('tier-3');
    expect(quoteLabel(3, config.pricing).priceUsd).toBe(20);
  });

  it('prices one and two character names in their own tiers', () => {
    // The ladder is per length now (D15): a one character name is scarcer than
    // two, and a shared "short" tier could not say so.
    expect(quoteLabel(1, config.pricing).tierId).toBe('tier-1');
    expect(quoteLabel(1, config.pricing).priceUsd).toBe(500);
    expect(quoteLabel(2, config.pricing).tierId).toBe('tier-2');
    expect(quoteLabel(2, config.pricing).priceUsd).toBe(100);
  });

  it('marks decided tiers as active', () => {
    expect(quoteLabel(4, config.pricing).active).toBe(true);
  });

  it('still reports a placeholder tier as inactive', () => {
    const withPlaceholder = {
      ...config.pricing,
      premiumTiers: config.pricing.premiumTiers.map((tier) => ({ ...tier, status: 'placeholder' })),
    };
    expect(quoteLabel(4, withPlaceholder).active).toBe(false);
  });

  it('reads the currency from config instead of hardcoding it', () => {
    expect(quoteLabel(4, { ...config.pricing, currency: 'DAI' }).currency).toBe('DAI');
  });

  it('fails loudly when a length has no tier', () => {
    const brokenPricing = {
      ...config.pricing,
      premiumTiers: config.pricing.premiumTiers.filter((tier) => tier.id !== 'tier-4'),
    };
    try {
      quoteLabel(4, brokenPricing);
      throw new Error('expected quoteLabel to throw');
    } catch (error) {
      expect(isMusePassError(error)).toBe(true);
      if (isMusePassError(error)) expect(error.code).toBe('NOT_FREE_TIER');
    }
  });
});
