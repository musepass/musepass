import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Address } from 'viem';
import { buildReservedIndex, loadConfig } from '@musename/core';

import { createApp } from '../src/app.js';
import type { MusenameDeps } from '../src/deps.js';
import { createMemoryRepos } from '../src/repositories/memory.js';

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(here, '../../../config');
const SPONSOR = '0x66F499e8F0A92e44A0F9c59a305E73a12b5684e7' as Address;
const OWNER = '0x603b8B1f7a0Bc152b7D0Dcd7bFfBF1f2Af115f6d' as Address;

function build() {
  const config = loadConfig({
    configDir: CONFIG_DIR,
    env: {
      MUSENAME_REGISTRAR: '0x9999999999999999999999999999999999999999',
      MUSENAME_L2_REGISTRY: '0x8888888888888888888888888888888888888888',
    },
  });
  const repos = createMemoryRepos();
  /** What the fake chain reports on the next call. */
  const chainState: {
    names: Array<{ label: string; owner: Address; blockNumber: number; txHash: `0x${string}` }>;
    error: string | null;
  } = { names: [], error: null };
  const deps: MusenameDeps = {
    config,
    reservedIndex: buildReservedIndex(config.reserved),
    chain: {
      async listNames() {
        if (chainState.error) throw new Error(chainState.error);
        return chainState.names;
      },
      async isLabelAvailable() {
        return true;
      },
      async getOwner() {
        return OWNER;
      },
      async readText() {
        return null;
      },
      async writeText() {
        return { txHash: `0x${'ab'.repeat(32)}` };
      },
      async register() {
        return { txHash: `0x${'ab'.repeat(32)}`, node: `0x${'cd'.repeat(32)}` };
      },
    },
    names: repos.names,
    requests: repos.requests,
    cards: repos.cards,
    sponsorship: repos.sponsorship,
    indexKind: 'memory',
    clock: () => new Date('2026-09-29T12:00:00.000Z'),
  };
  return { app: createApp(deps), repos, chainState };
}

async function readMetrics(app: ReturnType<typeof build>['app']) {
  const response = await app.request('http://local/v1/metrics');
  expect(response.status).toBe(200);
  return (await response.json()) as {
    data: {
      names: number;
      namesWithCard: number;
      byTier: Record<string, number>;
      byChannel: Record<string, number>;
      byStatus: Record<string, number>;
      firstRegisteredAt: string | null;
      chain: { names: number | null; firstRegisteredBlock: number | null; owners: number; error: string | null };
      index: { kind: string; names: number; owners: number; warning?: string };
      notMeasured: Array<{ id: string; metric: string; why: string }>;
    };
  };
}

async function insertName(
  repos: ReturnType<typeof build>['repos'],
  label: string,
  overrides: { tier?: 'free' | 'premium'; via?: 'web' | 'mcp'; when?: string } = {},
) {
  const record = await repos.names.insert({
    label,
    fullName: `${label}.musepass.eth`,
    normalized: label,
    ownerAddress: OWNER,
    tier: overrides.tier ?? 'free',
    status: 'active',
    registeredVia: overrides.via ?? 'web',
    agentHost: overrides.via === 'mcp' ? 'Claude' : null,
    txHash: `0x${'ab'.repeat(32)}`,
    registeredAt: new Date(overrides.when ?? '2026-09-29T00:00:00.000Z'),
  });
  return record;
}

describe('GET /v1/metrics', () => {
  it('starts at zero instead of pretending', async () => {
    const { app } = build();
    const { data } = await readMetrics(app);
    expect(data.chain.names).toBe(0);
    expect(data.index.names).toBe(0);
    expect(data.namesWithCard).toBe(0);
    expect(data.firstRegisteredAt).toBeNull();
  });

  it('counts names by tier, channel and status', async () => {
    const { app, repos } = build();
    await insertName(repos, 'xiaoming', { via: 'mcp', when: '2026-09-28T00:00:00.000Z' });
    await insertName(repos, 'aguang', { tier: 'premium', via: 'web' });

    const { data } = await readMetrics(app);
    expect(data.index.names).toBe(2);
    expect(data.index.owners).toBe(1);
    expect(data.byTier).toEqual({ free: 1, premium: 1, enterprise: 0 });
    expect(data.byChannel).toEqual({ web: 1, mcp: 1 });
    expect(data.byStatus).toEqual({ active: 2, expired: 0, reserved: 0 });
    expect(data.firstRegisteredAt).toBe('2026-09-28T00:00:00.000Z');
  });

  it('counts a name as carded only when the index has a card version', async () => {
    const { app, repos } = build();
    const named = await insertName(repos, 'xiaoming');
    await insertName(repos, 'aguang');
    await repos.cards.addVersion({ nameId: named.id, contentHash: `0x${'11'.repeat(32)}`, visibility: {} });

    const { data } = await readMetrics(app);
    expect(data.namesWithCard).toBe(1);
  });

  it('publishes what it cannot measure instead of leaving it out', async () => {
    const { app } = build();
    const { data } = await readMetrics(app);
    const ids = data.notMeasured.map((entry) => entry.id);
    expect(ids).toEqual(['queries_by_others', 'records', 'external_verifier_records', 'unique_users']);
    const metrics = data.notMeasured.map((entry) => entry.metric);
    expect(metrics).toContain('queries by anyone other than us');
    for (const entry of data.notMeasured) expect(entry.why.length).toBeGreaterThan(20);
  });

  it('says when the numbers come from a memory index', async () => {
    const { app } = build();
    const { data } = await readMetrics(app);
    expect(data.index.kind).toBe('memory');
    expect(data.index.warning).toContain('memory');
  });

  it('takes the name count from the chain, not from the index', async () => {
    const { app, repos, chainState } = build();
    await insertName(repos, 'xiaoming');
    chainState.names = [
      { label: 'xiaoming', owner: OWNER, blockNumber: 75_366_746, txHash: `0x${'cd'.repeat(32)}` },
      { label: 'aguang', owner: OWNER, blockNumber: 75_400_000, txHash: `0x${'ef'.repeat(32)}` },
    ];
    const { data } = await readMetrics(app);
    expect(data.chain.names).toBe(2);
    expect(data.chain.firstRegisteredBlock).toBe(75_366_746);
    expect(data.index.names).toBe(1);
  });

  it('refuses to report zero when the chain cannot be read', async () => {
    const { app, chainState } = build();
    chainState.error = 'rpc exploded';
    const { data } = await readMetrics(app);
    expect(data.chain.names).toBeNull();
    expect(data.chain.error).toContain('rpc exploded');
  });

  it('never leaks a name or an owner in the aggregate', async () => {
    const { app, repos } = build();
    await insertName(repos, 'xiaoming');
    const response = await app.request('http://local/v1/metrics');
    const body = await response.text();
    expect(body).not.toContain('xiaoming');
    expect(body).not.toContain(OWNER);
    expect(body).not.toContain(SPONSOR);
  });
});
