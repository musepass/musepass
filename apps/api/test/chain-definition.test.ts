/**
 * A regression test for a bug that only existed in production.
 *
 * The API picked its chain by matching the configured id against viem's Base,
 * Base Sepolia and Anvil, and fell back to Base Sepolia otherwise. Every test
 * passed, because the tests inject a fake chain reader — and on the live service
 * reads worked while writes failed with "Missing or invalid parameters", since
 * the client was stamping Base Sepolia's chain id onto transactions going to
 * Robinhood Chain.
 *
 * So this test asserts the property that was missing: whatever chain the config
 * names is the chain the client claims, whether or not viem ships it.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { loadConfig, type MusenameConfig } from '@musename/core';

import { resolveChainDefinition } from '../src/chain/registry.js';

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(here, '../../../config');

describe('the chain the API writes to', () => {
  const config = loadConfig({ configDir: CONFIG_DIR });

  it('uses the configured chain id, not a neighbour it happens to know', () => {
    const chain = resolveChainDefinition(config);
    expect(chain.id).toBe(config.chains.l2.chainId);
    expect(chain.id).not.toBe(84532); // the old, wrong fallback
  });

  it('carries the configured RPC, so the transport and the chain id agree', () => {
    const chain = resolveChainDefinition(config, 'https://example.invalid/rpc');
    expect(chain.rpcUrls.default.http[0]).toBe('https://example.invalid/rpc');
  });

  it('still uses the definition viem ships when the chain is one of its own', () => {
    // Anvil, so a local run keeps its multicall settings and the like.
    const local: MusenameConfig = {
      ...config,
      chains: { ...config.chains, l2: { ...config.chains.l2, chainId: 31337 } },
    };
    expect(resolveChainDefinition(local).id).toBe(31337); // viem calls 31337 Foundry
  });

  it('names the chain something, even when config has no name for it', () => {
    const unnamed: MusenameConfig = {
      ...config,
      chains: { ...config.chains, l2: { ...config.chains.l2, chainId: 999, name: '' } },
    };
    expect(resolveChainDefinition(unnamed).name).toBe('chain-999');
  });
});
