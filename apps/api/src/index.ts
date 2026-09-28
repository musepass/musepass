import { serve } from '@hono/node-server';
import { buildReservedIndex, loadConfig } from '@musename/core';

import { createApp } from './app.js';
import { createChainReader } from './chain/registry.js';
import { createMemoryRepos } from './repositories/memory.js';

const config = loadConfig();

const { names, sponsorship, requests } = createMemoryRepos();
const issuerPrivateKey = process.env.MUSENAME_ISSUER_KEY as `0x${string}` | undefined;
const chain = createChainReader({ config, issuerPrivateKey: issuerPrivateKey ?? null });

const app = createApp({
  config,
  reservedIndex: buildReservedIndex(config.reserved),
  chain,
  names,
  requests,
  sponsorship,
  clock: () => new Date(),
});

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `${config.brand.productName} api listening on http://localhost:${info.port} (${config.chains.l2.name})`,
  );
  if (!issuerPrivateKey) {
    console.warn('MUSENAME_ISSUER_KEY is not set: read endpoints work, claims are disabled.');
  }
});
