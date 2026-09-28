import type { PricingConfig } from './config.js';
import { MuseNameError } from './errors.js';

export interface PriceQuote {
  tier: 'free' | 'premium';
  tierId: string;
  priceUsd: number;
  currency: string;
  /** False while a tier is still a placeholder or belongs to a later phase. */
  active: boolean;
}

/**
 * Price is a function of the label's measured length only, so the same label
 * always costs the same no matter who asks. `length` comes from
 * `measureLength(label, config.limits.lengthMetric)`.
 */
export function quoteLabel(length: number, pricing: PricingConfig): PriceQuote {
  if (length >= pricing.freeTier.minUnits) {
    return {
      tier: 'free',
      tierId: 'free',
      priceUsd: 0,
      currency: pricing.currency,
      active: true,
    };
  }

  const tier = pricing.premiumTiers.find(
    (candidate) => length >= candidate.minCodePoints && length <= candidate.maxCodePoints,
  );

  if (!tier) {
    throw new MuseNameError('NOT_FREE_TIER', 'no pricing tier is configured for this name length', {
      length,
    });
  }

  return {
    tier: 'premium',
    tierId: tier.id,
    priceUsd: tier.priceUsd,
    currency: pricing.currency,
    active: tier.status !== 'placeholder',
  };
}
