import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FALLBACK_CONFIG } from '../lib/api.js';
import { AGENT_PROMPT, ASK_TXT, MCP_URL, SITE_URL } from '../lib/agentPrompt.js';

/**
 * The front end cannot import config/brand.json: the paste block and /ask.txt
 * are read by a client component, and pulling a filesystem loader into the
 * browser bundle is how a page breaks at runtime instead of build time. So the
 * brand values are written out here — and pinned to the config file in a test,
 * because "written out here" is exactly how the 2026-09-30 rename left /ask.txt
 * naming a registry address the product no longer used.
 *
 * When the product moves to a new domain: change config/brand.json, these
 * constants, and let this test tell you if you missed one.
 */
const brand = JSON.parse(
  readFileSync(resolve(__dirname, '../../../config/brand.json'), 'utf8'),
) as {
  productName: string;
  siteUrl: string;
  supportEmail: string;
  rootName: string;
};
const pricing = JSON.parse(
  readFileSync(resolve(__dirname, '../../../config/pricing.json'), 'utf8'),
) as {
  freeTier: { minUnits: number };
  premiumTiers: Array<{ id: string; minCodePoints: number; maxCodePoints: number; priceUsd: number }>;
};

describe('brand surfaces', () => {
  it('agrees with config/brand.json about the name of the product', () => {
    expect(FALLBACK_CONFIG.productName).toBe(brand.productName);
    expect(FALLBACK_CONFIG.rootName).toBe(brand.rootName);
  });

  it('agrees with config/brand.json about where the product lives', () => {
    expect(FALLBACK_CONFIG.siteUrl).toBe(brand.siteUrl);
    expect(SITE_URL).toBe(brand.siteUrl);
  });

  it('agrees with config/brand.json about how to reach a human', () => {
    expect(FALLBACK_CONFIG.supportEmail).toBe(brand.supportEmail);
    expect(ASK_TXT).toContain(`QUESTIONS: ${brand.supportEmail}`);
  });

  it('keeps one host for the site and the MCP endpoint', () => {
    expect(MCP_URL).toBe(`${SITE_URL}/mcp`);
    expect(AGENT_PROMPT).toContain(`${SITE_URL}/ask.txt`);
    expect(new URL(MCP_URL).host).toBe(new URL(SITE_URL).host);
  });

  it('carries the same price ladder the API serves', () => {
    // The offline fallback is what a prerendered page shows when it could not
    // reach the API, so an empty ladder there is a page that renders a blank
    // price — which is exactly what shipped once.
    expect(FALLBACK_CONFIG.pricing.freeMinUnits).toBe(pricing.freeTier.minUnits);
    expect(
      FALLBACK_CONFIG.pricing.premiumTiers.map((tier) => [
        tier.id,
        tier.minUnits,
        tier.maxUnits,
        tier.priceUsd,
      ]),
    ).toEqual(
      pricing.premiumTiers.map((tier) => [
        tier.id,
        tier.minCodePoints,
        tier.maxCodePoints,
        tier.priceUsd,
      ]),
    );
    // Nothing short is on sale until the payment flow exists (D15).
    expect(FALLBACK_CONFIG.pricing.premiumTiers.every((tier) => tier.sellable === false)).toBe(true);
  });
});
