import { serve } from '@hono/node-server';
import { buildReservedIndex, loadConfig, normalizeLabel } from '@musename/core';

import { createApp } from './app.js';
import { createChainReader } from './chain/registry.js';
import type {
  CardsRepo,
  InvitationClaimsRepo,
  NamesRepo,
  PurchaseRepo,
  RegistrationRequestRepo,
  SponsorshipRepo,
} from './deps.js';
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
let invitationClaims: InvitationClaimsRepo;
let purchases: PurchaseRepo;
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
  ({ names, requests, cards, sponsorship, invitationClaims, purchases } = createPostgresRepos(sql));
  indexKind = 'postgres';
  logger.log('info', 'using postgres for the index');
} else {
  ({ names, requests, cards, sponsorship, invitationClaims, purchases } = createMemoryRepos());
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
  invitationClaims,
  purchases,
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
  // The chain is the source of truth and the index is a cache, so boot is the
  // moment to repair the cache: any name the chain knows but the index does
  // not — registered before this database was attached, or while the index
  // lived in memory — is backfilled from the registrar's own events. A
  // failure logs and leaves serving untouched; the next boot tries again.
  void backfillIndexFromChain();
});

async function backfillIndexFromChain(): Promise<void> {
  try {
    const onChain = await chain.listNames();
    let added = 0;
    for (const entry of onChain) {
      const { normalized } = normalizeLabel(entry.label);
      const existing = await names.findByNormalized(normalized);
      if (existing) {
        // The reconciliation rule the index already follows: when the chain
        // disagrees about ownership, the chain wins.
        if (existing.ownerAddress.toLowerCase() !== entry.owner.toLowerCase()) {
          await names.updateOwner(normalized, entry.owner);
          logger.log('info', 'backfill updated owner from chain', { label: entry.label });
        }
        continue;
      }
      await names.insert({
        label: entry.label,
        fullName: `${entry.label}.${config.brand.rootName}`,
        normalized,
        ownerAddress: entry.owner,
        // The chain event cannot say which channel asked or what tier was
        // granted, and today every issued name is free, so free/web is what
        // the index can honestly record for a backfilled row.
        tier: 'free',
        status: 'active',
        registeredVia: 'web',
        agentHost: null,
        txHash: entry.txHash,
      });
      added += 1;
    }
    if (added > 0 || onChain.length > 0) {
      logger.log('info', 'index backfilled from chain', {
        onChain: onChain.length,
        added,
        indexKind,
      });
    }
  } catch (error) {
    logger.log('warn', 'chain backfill failed; the index serves what it has', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

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
