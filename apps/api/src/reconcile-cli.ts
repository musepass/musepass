import { Pool } from 'pg';
import { buildReservedIndex, loadConfig } from '@musename/core';

import { createChainReader } from './chain/registry.js';
import { createLogger } from './observability.js';
import { reconcile } from './reconcile.js';
import { createPostgresRepos } from './repositories/postgres.js';
import { migrate, type Sql } from './repositories/sql.js';

/**
 * One reconciliation pass. Run it from cron, or before trusting a report that
 * came out of the index.
 *
 *   DATABASE_URL=postgres://... MUSENAME_ISSUER_KEY=... node dist/reconcile-cli.js
 *
 * Read-only with respect to the chain: it only ever corrects our own rows.
 */
const config = loadConfig();
const logger = createLogger(undefined, { service: 'musename-reconcile' });

if (!process.env.DATABASE_URL) {
  logger.log('error', 'DATABASE_URL is required; there is nothing to reconcile in memory');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sql: Sql = {
  async query<R>(text: string, params?: unknown[]) {
    const result = await pool.query(text, params as never);
    return { rows: result.rows as R[] };
  },
};
await migrate(sql);

void buildReservedIndex(config.reserved);

const result = await reconcile({
  names: createPostgresRepos(sql).names,
  chain: createChainReader({ config, issuerPrivateKey: null }),
  logger,
  limit: Number(process.env.MUSENAME_RECONCILE_LIMIT ?? 500),
});

await pool.end();

// A non-zero exit makes a failed pass visible to whatever scheduled it.
process.exit(result.issues.length > 0 ? 1 : 0);

