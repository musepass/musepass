import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot, loadConfig } from '../src/config.js';
import { ensip11CoinType } from '../src/namehash.js';
import { CONFIG_DIR, testConfig } from './helpers.js';

describe('loadConfig', () => {
  it('loads the real repository config', () => {
    const config = testConfig();
    expect(config.brand.productName).toBe('MuseName');
    expect(config.brand.rootName.endsWith('.eth')).toBe(true);
    expect(config.brand.legalDisclaimer.zh).toContain('Meta');
  });

  it('keeps brand and prices out of the code (rule 6)', () => {
    const renamed = loadConfig({ configDir: CONFIG_DIR, env: { MUSENAME_BRAND: 'BackupName' } });
    expect(renamed.brand.productName).toBe('BackupName');
    expect(renamed.brand.rootName).toBe(testConfig().brand.rootName);
  });

  it('lets the environment supply deployed addresses', () => {
    const registry = '0x1111111111111111111111111111111111111111';
    const config = loadConfig({
      configDir: CONFIG_DIR,
      env: { MUSENAME_L2_REGISTRY: registry, BASE_RPC_URL: 'https://example.invalid' },
    });
    expect(config.chains.l2.l2Registry).toBe(registry);
    expect(config.chains.l2.rpcUrl).toBe('https://example.invalid');
  });

  it('derives the ENSIP-11 coin type from the configured chain id', () => {
    const config = testConfig();
    expect(ensip11CoinType(config.chains.l2.chainId)).toBe(2147492101n);
    expect(ensip11CoinType(config.chains.l2Testnet.chainId)).toBe(2147568180n);
  });

  it('fails loudly on a missing config directory', () => {
    expect(() => loadConfig({ configDir: '/definitely/not/here', env: {} })).toThrow();
  });
});

describe('findRepoRoot', () => {
  it('walks up to the directory holding config/brand.json', () => {
    const root = findRepoRoot(join(CONFIG_DIR, '..', 'packages', 'core', 'src'));
    expect(join(root, 'config', 'brand.json')).toBe(join(CONFIG_DIR, 'brand.json'));
  });

  it('throws when it cannot find the config', () => {
    expect(() => findRepoRoot('/')).toThrow();
  });
});
