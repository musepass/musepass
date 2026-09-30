import { describe, expect, it } from 'vitest';
import type { Address, Hex } from 'viem';
import { buildReservedIndex, loadConfig } from '@musename/core';

import type { ChainReader } from '../src/deps.js';
import { createLogger } from '../src/observability.js';
import { reconcile } from '../src/reconcile.js';
import { createMemoryRepos } from '../src/repositories/memory.js';

const ALICE = '0x603b8B1f7a0Bc152b7D0Dcd7bFfBF1f2Af115f6d' as Address;
const BOB = '0x2A9574dE1B1C7FEa588C483d9a692b05A62e0d46' as Address;
const TX = `0x${'ab'.repeat(32)}` as Hex;

const config = loadConfig({
  configDir: new URL('../../../config', import.meta.url).pathname,
  env: {},
});
void buildReservedIndex(config.reserved);
void createLogger;

async function seed(repos: ReturnType<typeof createMemoryRepos>, name: string, owner: Address) {
  return repos.names.insert({
    label: name,
    fullName: `${name}.musepass.eth`,
    normalized: name,
    ownerAddress: owner,
    tier: 'free',
    status: 'active',
    registeredVia: 'web',
    agentHost: null,
    txHash: TX,
  });
}

function chainWith(owners: Record<string, Address | null>, broken: string[] = []): ChainReader {
  return {
    async isLabelAvailable() {
      return true;
    },
    async getOwner(label) {
      if (broken.includes(label)) throw new Error(`rpc refused for ${label}`);
      return owners[label] ?? null;
    },
    async readText() {
      return null;
    },
    async writeText() {
      return { txHash: TX };
    },
    async register() {
      return { txHash: TX, node: `0x${'cd'.repeat(32)}` as Hex };
    },
  };
}

describe('reconcile', () => {
  it('leaves a consistent index alone', async () => {
    const repos = createMemoryRepos();
    await seed(repos, 'aguang', ALICE);

    const result = await reconcile({
      names: repos.names,
      chain: chainWith({ aguang: ALICE }),
    });

    expect(result).toMatchObject({ checked: 1, repaired: 0, issues: [] });
  });

  it('repairs an owner mismatch, because the chain wins', async () => {
    const repos = createMemoryRepos();
    await seed(repos, 'aguang', ALICE);

    const result = await reconcile({
      names: repos.names,
      chain: chainWith({ aguang: BOB }),
    });

    expect(result.repaired).toBe(1);
    expect(result.issues[0]).toMatchObject({ kind: 'owner-changed', normalized: 'aguang' });
    expect((await repos.names.findByNormalized('aguang'))?.ownerAddress).toBe(BOB);
    // And the repaired row is now found under the new owner.
    expect((await repos.names.listByOwner(BOB)).map((row) => row.normalized)).toEqual(['aguang']);
  });

  it('matches owners ignoring address case', async () => {
    const repos = createMemoryRepos();
    await seed(repos, 'aguang', ALICE);

    const result = await reconcile({
      names: repos.names,
      chain: chainWith({ aguang: ALICE.toLowerCase() as Address }),
    });

    expect(result.repaired).toBe(0);
  });

  it('reports a name the chain says nobody owns, and does not delete it', async () => {
    const repos = createMemoryRepos();
    await seed(repos, 'aguang', ALICE);

    const result = await reconcile({
      names: repos.names,
      chain: chainWith({}),
    });

    expect(result.repaired).toBe(0);
    expect(result.issues[0].kind).toBe('missing-on-chain');
    // The registry has no burn, so this means the index is wrong, not the name.
    expect(await repos.names.findByNormalized('aguang')).not.toBeNull();
  });

  it('records an unreadable name instead of guessing', async () => {
    const repos = createMemoryRepos();
    await seed(repos, 'aguang', ALICE);

    const result = await reconcile({
      names: repos.names,
      chain: chainWith({ aguang: ALICE }, ['aguang']),
    });

    expect(result.checked).toBe(1);
    expect(result.repaired).toBe(0);
    expect(result.issues[0]).toMatchObject({ kind: 'unreadable', normalized: 'aguang' });
  });

  it('handles many names without losing any', async () => {
    const repos = createMemoryRepos();
    const owners: Record<string, Address> = {};
    for (let index = 0; index < 25; index += 1) {
      const name = `name${index}`;
      await seed(repos, name, ALICE);
      owners[name] = index % 5 === 0 ? BOB : ALICE;
    }

    const lines: string[] = [];
    const result = await reconcile({
      names: repos.names,
      chain: chainWith(owners),
      concurrency: 8,
      logger: createLogger((line) => lines.push(line)),
    });

    expect(result.checked).toBe(25);
    expect(result.repaired).toBe(5);
    expect(lines.some((line) => line.includes('reconcile finished'))).toBe(true);
  });
});
