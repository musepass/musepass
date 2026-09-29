import { serve } from '@hono/node-server';
import { buildReservedIndex, loadConfig } from '@musename/core';

import { createApp } from './app.js';
import { createChainReader } from './chain/registry.js';
import type { CardsRepo, NamesRepo, RegistrationRequestRepo, SponsorshipRepo } from './deps.js';
import { createLogger } from './observability.js';
import { createMemoryRepos } from './repositories/memory.js';
import { createPostgresRepos } from './repositories/postgres.js';
import { migrate, type Sql } from './repositories/sql.js';

const config = loadConfig();

const issuerPrivateKey = process.env.MUSENAME_ISSUER_KEY as `0x${string}` | undefined;
const chain = createChainReader({ config, issuerPrivateKey: issuerPrivateKey ?? null });
const logger = createLogger(undefined, { service: 'musename-api' });

// The chain owns the names; this database is only an index. Without
// DATABASE_URL we keep it in memory, which is fine for development and honest
// about its cost: a restart loses the index and it is rebuilt by re-reading.
let names: NamesRepo;
let requests: RegistrationRequestRepo;
let cards: CardsRepo;
let sponsorship: SponsorshipRepo;
let indexKind: 'memory' | 'postgres' = 'memory';
if (process.env.DATABASE_URL) {
  // Imported only when it is actually used, so a deployment that runs without
  // Postgres does not need the driver installed at all.
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const sql: Sql = {
    async query<R>(text: string, params?: unknown[]) {
      const result = await pool.query(text, params as never);
      return { rows: result.rows as R[] };
    },
  };
  await migrate(sql);
  ({ names, requests, cards, sponsorship } = createPostgresRepos(sql));
  indexKind = 'postgres';
  logger.log('info', 'using postgres for the index');
} else {
  ({ names, requests, cards, sponsorship } = createMemoryRepos());
  logger.log('warn', 'DATABASE_URL is not set: the index is in memory and is lost on restart', {
    effect: 'chain data is unaffected; the index is rebuilt by re-reading',
  });
}

const app = createApp({
  config,
  reservedIndex: buildReservedIndex(config.reserved),
  chain,
  names,
  requests,
  cards,
  sponsorship,
  indexKind,
  clock: () => new Date(),
  logger,
});

const port = Number(process.env.PORT ?? 3001);
const server = serve({ fetch: app.fetch, port }, (info) => {
  logger.log('info', 'listening', {
    url: `http://localhost:${info.port}`,
    chain: config.chains.l2.name,
    chainId: config.chains.l2.chainId,
    brand: config.brand.productName,
  });
  if (!issuerPrivateKey) {
    logger.log('warn', 'MUSENAME_ISSUER_KEY is not set: claims are disabled', {
      hint: 'read endpoints still work',
    });
  }
});

/**
 * Stop accepting new work and let in-flight requests finish. Without this a
 * rolling deploy drops requests that were already being served, and a claim in
 * flight would be reported as failed to a user whose name still gets minted.
 */
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logger.log('info', 'shutting down', { signal });
    server.close(() => process.exit(0));
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
