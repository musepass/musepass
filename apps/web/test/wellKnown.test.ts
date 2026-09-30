import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FALLBACK_CONFIG } from '../lib/api.js';
import { GATEWAY_URL, buildWellKnown } from '../lib/wellKnown.js';

const deployments = JSON.parse(
  readFileSync(resolve(__dirname, '../../../deployments/robinhood.json'), 'utf8'),
);
const chains = JSON.parse(readFileSync(resolve(__dirname, '../../../config/chains.json'), 'utf8'));

const config = {
  ...FALLBACK_CONFIG,
  chain: { name: 'robinhood', chainId: 4663, explorer: 'https://robinhoodchain.blockscout.com' },
  registrar: deployments.registrar,
  l2Registry: deployments.l2Registry.address,
};

describe('well-known discovery document', () => {
  it('keeps the offline fallback pointing at the live chain', () => {
    expect(FALLBACK_CONFIG.chain.chainId).toBe(chains.l2.chainId);
    expect(FALLBACK_CONFIG.chain.name).toBe(chains.l2.name);
    expect(FALLBACK_CONFIG.chain.explorer).toBe(chains.l2.explorer);
    expect(FALLBACK_CONFIG.l2Registry).toBe(chains.l2.l2Registry);
    expect(FALLBACK_CONFIG.registrar).toBe(chains.l2.registrar);
  });

  it('says which chain and registry the domain is bound to', () => {
    const document = buildWellKnown(config);
    expect(document.chain.chainId).toBe(4663);
    expect(document.chain.registry).toBe(deployments.l2Registry.address);
    expect(document.chain.registrar).toBe(deployments.registrar);
    expect(document.rootEnsName).toBe(config.rootName);
  });

  it('keeps the gateway host in step with the deployment record', () => {
    expect(GATEWAY_URL).toBe('https://gw.musename.xyz');
    const allowList: string[] = deployments.l1Resolver.gatewayAllowList;
    const signer = deployments.l1Resolver.deployVerifiedOnChain.signer;
    expect(allowList.length).toBeGreaterThan(0);
    expect(signer).toMatch(/^0x[0-9a-fA-F]{40}$/);
    // The URL is baked into the resolver's constructor arguments, so a change
    // here without a redeploy would point integrators at nothing.
    expect(deployments.l1Resolver.deployVerifiedOnChain.url.startsWith(GATEWAY_URL)).toBe(true);
  });

  it('carries the caveats, not just the capabilities', () => {
    const document = buildWellKnown(config);
    expect(document.notVerified.map((entry) => entry.claim)).toEqual([
      'the operator behind a name',
      'an independent verdict',
      'an on-chain record contract',
    ]);
    for (const entry of document.notVerified) expect(entry.why.length).toBeGreaterThan(30);
  });

  it('tells a caller how to check a name without trusting us', () => {
    const document = buildWellKnown(config);
    expect(document.verification.steps).toHaveLength(3);
    expect(document.verification.steps[0].how).toContain('owner(bytes32)');
    expect(document.verification.steps[0].how).toContain(deployments.l2Registry.address);
    expect(document.api.nameLookup).toBe(`${config.siteUrl}/v1/names/{name}`);
  });

  it('carries the legal disclaimer so a copy of the file travels with it', () => {
    const document = buildWellKnown(config);
    // English only: the discovery document is fetched by machines and read by
    // people, and the site does not publish Chinese anywhere.
    expect(document.legalDisclaimer.en).toContain('Meta');
    expect(JSON.stringify(document)).not.toMatch(/[\u4e00-\u9fff]/);
    expect(document.contact).toContain('@');
  });
});
