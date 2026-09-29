import { serve } from '@hono/node-server';
import { buildReservedIndex, loadConfig } from '@musename/core';

import { createApp } from './app.js';
import { createChainReader } from './chain/registry.js';
import { createLogger } from './observability.js';
import { createMemoryRepos } from './repositories/memory.js';

const config = loadConfig();

const { names, sponsorship, requests } = createMemoryRepos();
const issuerPrivateKey = process.env.MUSENAME_ISSUER_KEY as `0x${string}` | undefined;
const chain = createChainReader({ config, issuerPrivateKey: issuerPrivateKey ?? null });
const logger = createLogger(undefined, { service: 'musename-api' });

const app = createApp({
  config,
  reservedIndex: buildReservedIndex(config.reserved),
  chain,
  names,
  requests,
  sponsorship,
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
