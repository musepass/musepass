import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { Address, Hex } from 'viem';

import { createPostgresRepos } from '../src/repositories/postgres.js';
import { migrate, type Sql } from '../src/repositories/sql.js';

/**
 * These run against PGlite, which is real Postgres compiled to WebAssembly, so
 * the repository code is exercised by the actual schema from
 * sql/001_init.sql instead of by a mock that agrees with itself.
 */
let db: PGlite;
let repos: ReturnType<typeof createPostgresRepos>;

const OWNER = '0x603b8B1f7a0Bc152b7D0Dcd7bFfBF1f2Af115f6d' as Address;
const OTHER = '0x2A9574dE1B1C7FEa588C483d9a692b05A62e0d46' as Address;
const TX = `0x${'ab'.repeat(32)}` as Hex;

// PGlite boots a Postgres instance in WebAssembly and then applies the schema;
// that is a few seconds on its own and more when the other suites run beside
// it, so the default hook timeout is too tight.
beforeAll(async () => {
  db = new PGlite();
  const sql: Sql = {
    async query<R>(text: string, params?: unknown[]) {
      const result = await db.query<R>(text, params);
      return { rows: result.rows };
    },
  };
  await migrate(sql);
  repos = createPostgresRepos(sql);
}, 120_000);

afterAll(async () => {
  await db.close();
}, 30_000);

function newName(normalized: string, owner: Address = OWNER) {
  return {
    label: normalized,
    fullName: `${normalized}.musepass.eth`,
    normalized,
    ownerAddress: owner,
    tier: 'free' as const,
    status: 'active' as const,
    registeredVia: 'web' as const,
    agentHost: null,
    txHash: TX,
  };
}

describe('migrations', () => {
  it('creates every table the data model describes', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' order by table_name`,
    );
    const tables = rows.map((row) => row.table_name);
    for (const expected of [
      'abuse_reports',
      'anchor_batches',
      'api_usage',
      'cards',
      'criteria',
      'names',
      'records',
      'registration_requests',
      'reserved_names',
      'sponsorship_ledger',
      'subscriptions',
    ]) {
      expect(tables).toContain(expected);
    }
  });

  it('is idempotent, so booting twice is harmless', async () => {
    const sql: Sql = {
      async query<R>(text: string, params?: unknown[]) {
        const result = await db.query<R>(text, params);
        return { rows: result.rows };
      },
    };
    await expect(migrate(sql)).resolves.toBeUndefined();
  });
});

describe('names', () => {
  it('round-trips a name', async () => {
    const inserted = await repos.names.insert(newName('aguang'));
    expect(inserted.id).toBeGreaterThan(0);
    expect(inserted.registeredAt).toBeInstanceOf(Date);

    const found = await repos.names.findByNormalized('aguang');
    expect(found?.ownerAddress).toBe(OWNER);
    expect(found?.fullName).toBe('aguang.musepass.eth');
  });

  it('refuses a duplicate, because the schema says so', async () => {
    await repos.names.insert(newName('taken'));
    await expect(repos.names.insert(newName('taken'))).rejects.toThrow();
  });

  it('lists by owner regardless of address case', async () => {
    await repos.names.insert(newName('xiaoming'));
    const byChecksum = await repos.names.listByOwner(OWNER);
    const byLower = await repos.names.listByOwner(OWNER.toLowerCase() as Address);
    expect(byLower.map((row) => row.normalized).sort()).toEqual(
      byChecksum.map((row) => row.normalized).sort(),
    );
  });

  it('returns null rather than throwing for an unknown name', async () => {
    expect(await repos.names.findByNormalized('nobody')).toBeNull();
  });
});

describe('sponsorship ledger', () => {
  it('counts per wallet, per day and platform wide', async () => {
    const dayStart = new Date('2026-09-29T00:00:00.000Z');
    const before = await repos.sponsorship.countPlatformSince(dayStart);

    await repos.sponsorship.record({
      wallet: OWNER,
      txHash: TX,
      sponsoredAt: new Date('2026-09-29T10:00:00.000Z'),
    });
    await repos.sponsorship.record({
      wallet: OTHER,
      txHash: TX,
      sponsoredAt: new Date('2026-09-29T11:00:00.000Z'),
    });
    await repos.sponsorship.record({
      wallet: OWNER,
      txHash: TX,
      sponsoredAt: new Date('2026-09-28T11:00:00.000Z'),
    });

    expect(await repos.sponsorship.countForWalletSince(OWNER, dayStart)).toBe(1);
    expect(await repos.sponsorship.countForWalletLifetime(OWNER)).toBe(2);
    expect(await repos.sponsorship.countPlatformSince(dayStart)).toBe(before + 2);
  });
});

describe('registration requests', () => {
  const base = {
    label: 'photographer',
    requestedByHost: 'claude',
    requestedFor: 'owner@example.com',
    confirmTokenHash: 'f'.repeat(64),
    expiresAt: new Date('2026-09-29T00:15:00.000Z'),
    status: 'pending' as const,
    confirmedAt: null,
  };

  it('stores only the hashed token and can find it again', async () => {
    const id = crypto.randomUUID();
    const inserted = await repos.requests.insert({ ...base, id });
    expect(inserted.confirmTokenHash).toBe('f'.repeat(64));

    const found = await repos.requests.findById(id);
    expect(found?.requestedByHost).toBe('claude');
    expect(found?.createdAt).toBeInstanceOf(Date);
  });

  it('counts open requests per host and per subject', async () => {
    expect(await repos.requests.countOpenByHost('claude')).toBeGreaterThan(0);
    expect(await repos.requests.countOpenBySubject('OWNER@example.com')).toBeGreaterThan(0);
    expect(await repos.requests.countOpenByHost('nobody')).toBe(0);
  });

  it('marks a request confirmed and stamps the time', async () => {
    const id = crypto.randomUUID();
    await repos.requests.insert({ ...base, id, requestedFor: 'second@example.com' });
    await repos.requests.markStatus(id, 'confirmed', new Date('2026-09-29T00:05:00.000Z'));

    const found = await repos.requests.findById(id);
    expect(found?.status).toBe('confirmed');
    expect(found?.confirmedAt?.toISOString()).toBe('2026-09-29T00:05:00.000Z');
  });

  it('stops counting a request once it is no longer pending', async () => {
    const before = await repos.requests.countOpenByHost('hostx');
    const id = crypto.randomUUID();
    await repos.requests.insert({
      ...base,
      id,
      requestedByHost: 'hostx',
      requestedFor: 'x@example.com',
    });
    expect(await repos.requests.countOpenByHost('hostx')).toBe(before + 1);

    await repos.requests.markStatus(id, 'expired', new Date());
    expect(await repos.requests.countOpenByHost('hostx')).toBe(before);
  });
});
