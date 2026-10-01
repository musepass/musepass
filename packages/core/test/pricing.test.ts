import { describe, expect, it } from 'vitest';
import { isMusePassError } from '../src/errors.js';
import { quoteLabel, quotePurchase, toBaseUnits } from '../src/pricing.js';
import { testConfig } from './helpers.js';

const config = testConfig();

/** purchase.enabled=true, everything else as configured on disk. */
function purchasablePricing() {
  return { ...config.pricing, purchase: { ...config.pricing.purchase!, enabled: true } };
}

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

describe('quotePurchase (D19)', () => {
  it('quotes nothing while purchase is disabled', () => {
    expect(quotePurchase(4, false, config.pricing)).toBeNull();
    expect(quotePurchase(5, true, config.pricing)).toBeNull();
  });

  it.each([
    [1, false, null, 'one character stays project-reserved'],
    [2, false, null, 'two characters stay project-reserved'],
    [3, true, null, 'three characters stay project-reserved even for a buyer'],
  ])('units=%i ownerHasName=%s → %s', (units, ownerHasName, expected) => {
    expect(quotePurchase(units as number, ownerHasName as boolean, purchasablePricing())).toBe(expected);
  });

  it('quotes tier-4 at $5 for anyone, invitation or not, first name or not', () => {
    const pricing = purchasablePricing();
    expect(quotePurchase(4, false, pricing)).toEqual({
      kind: 'tier-4',
      tierId: 'tier-4',
      priceUsd: 5,
    });
    expect(quotePurchase(4, true, pricing)).toEqual({
      kind: 'tier-4',
      tierId: 'tier-4',
      priceUsd: 5,
    });
  });

  it('keeps the first long name free and points it back at the claim flow', () => {
    expect(quotePurchase(5, false, purchasablePricing())).toEqual({
      kind: 'free-first',
      tierId: 'free',
      priceUsd: 0,
    });
  });

  it('quotes the second long name at the configured additional price', () => {
    expect(quotePurchase(7, true, purchasablePricing())).toEqual({
      kind: 'additional-name',
      tierId: 'additional-name',
      priceUsd: 1,
    });
  });

  it('quotes no second name while additional names are switched off', () => {
    const pricing = purchasablePricing();
    pricing.purchase = { ...pricing.purchase!, additionalNameEnabled: false };
    expect(quotePurchase(7, true, pricing)).toBeNull();
  });

  it('refuses tier-4 while the tier is still a placeholder', () => {
    const pricing = purchasablePricing();
    pricing.premiumTiers = pricing.premiumTiers.map((tier) =>
      tier.id === 'tier-4' ? { ...tier, status: 'placeholder' } : tier,
    );
    expect(quotePurchase(4, false, pricing)).toBeNull();
  });
});

describe('toBaseUnits (D19)', () => {
  it('converts the real prices exactly', () => {
    expect(toBaseUnits(5, 6)).toBe('5000000');
    expect(toBaseUnits(1, 6)).toBe('1000000');
  });

  it('handles cents and zero without float drift', () => {
    expect(toBaseUnits(0.01, 6)).toBe('10000');
    expect(toBaseUnits(0, 18)).toBe('0');
    expect(toBaseUnits(1.1, 18)).toBe('1100000000000000000');
  });

  it('rejects invalid prices and decimals loudly', () => {
    for (const [priceUsd, decimals] of [
      [-1, 6],
      [Number.NaN, 6],
      [5, 2.5],
      [5, -1],
      [5, 19],
    ] as const) {
      expect(() => toBaseUnits(priceUsd, decimals)).toThrow();
      try {
        toBaseUnits(priceUsd, decimals);
      } catch (error) {
        expect(isMusePassError(error)).toBe(true);
        if (isMusePassError(error)) expect(error.code).toBe('INVALID_PRICE');
      }
    }
  });
});
