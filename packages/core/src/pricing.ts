import type { PricingConfig } from './config.js';
import { MusePassError } from './errors.js';

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
    throw new MusePassError('NOT_FREE_TIER', 'no pricing tier is configured for this name length', {
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

export type PurchaseKind = 'tier-4' | 'additional-name';

export type PurchaseQuote =
  | { kind: PurchaseKind; tierId: string; priceUsd: number }
  | { kind: 'free-first'; tierId: 'free'; priceUsd: 0 };

/**
 * D19: what a wallet would pay for a label right now.
 *
 * - units 1–3  → null (project-reserved; the purchase rail must not unblock them)
 * - units 4    → tier-4 ($5) when purchases are enabled
 * - units ≥5   → the first name per wallet stays free (`free-first`, use the
 *   invitation claim); a second+ name costs `additionalName.priceUsd`
 *
 * `units` comes from `measureLength(label, config.limits.lengthMetric)`.
 */
export function quotePurchase(
  units: number,
  ownerHasName: boolean,
  pricing: PricingConfig,
): PurchaseQuote | null {
  const purchase = pricing.purchase;
  if (!purchase?.enabled) return null;

  if (units < 4) return null;

  if (units === 4) {
    const tier = pricing.premiumTiers.find(
      (candidate) => units >= candidate.minCodePoints && units <= candidate.maxCodePoints,
    );
    if (!tier || tier.status === 'placeholder') return null;
    return { kind: 'tier-4', tierId: tier.id, priceUsd: tier.priceUsd };
  }

  if (!ownerHasName) return { kind: 'free-first', tierId: 'free', priceUsd: 0 };
  if (!purchase.additionalNameEnabled) return null;
  const priceUsd = pricing.additionalName?.priceUsd ?? 1;
  return { kind: 'additional-name', tierId: 'additional-name', priceUsd };
}

/**
 * Converts a USD amount (at most two decimal places) to the integer amount in
 * the token's base units as a decimal string (USDG has 6 decimals, so 5 →
 * "5000000"). Exact BigInt math — no float drift.
 */
export function toBaseUnits(priceUsd: number, decimals: number): string {
  if (!Number.isFinite(priceUsd) || priceUsd < 0) {
    throw new MusePassError('INVALID_PRICE', 'priceUsd must be a non-negative number', { priceUsd });
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new MusePassError('INVALID_PRICE', 'decimals must be an integer in 0..18', { decimals });
  }
  const cents = BigInt(Math.round(priceUsd * 100));
  return (cents * 10n ** BigInt(decimals) / 100n).toString();
}
