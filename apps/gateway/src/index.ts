import { serve } from '@hono/node-server';
import { loadConfig } from '@musename/core';

import { createGatewayApp, signerFromEnv } from './app.js';
import { createL2Reader } from './l2.js';

const config = loadConfig();

const signerKey = process.env.MUSENAME_GATEWAY_SIGNER_KEY;
if (!signerKey) {
  console.error(
    'MUSENAME_GATEWAY_SIGNER_KEY is required. It must match the `signer` set on the L1 resolver,',
    'otherwise every resolution fails with InvalidSignature.',
  );
  process.exit(1);
}

/**
 * Production must set this to the L1 resolver address. Leaving it unset makes
 * the gateway sign for any sender, which is only acceptable on a dev machine.
 */
const allowedSenders = (process.env.MUSENAME_GATEWAY_ALLOWED_SENDERS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

if (allowedSenders.length === 0) {
  console.warn(
    'MUSENAME_GATEWAY_ALLOWED_SENDERS is empty: this instance will sign for any L1 resolver.',
  );
}

const rpcUrls: Record<number, string> = {};
if (process.env.MUSENAME_RPC_URL) rpcUrls[config.chains.l2.chainId] = process.env.MUSENAME_RPC_URL;
if (process.env.BASE_RPC_URL) rpcUrls[8453] = process.env.BASE_RPC_URL;
if (process.env.BASE_SEPOLIA_RPC_URL) rpcUrls[84532] = process.env.BASE_SEPOLIA_RPC_URL;
if (process.env.ROBINHOOD_RPC_URL) rpcUrls[4663] = process.env.ROBINHOOD_RPC_URL;
if (process.env.ROBINHOOD_TESTNET_RPC_URL) rpcUrls[46630] = process.env.ROBINHOOD_TESTNET_RPC_URL;
if (process.env.MUSENAME_LOCAL_RPC_URL) rpcUrls[31337] = process.env.MUSENAME_LOCAL_RPC_URL;

const signer = signerFromEnv(signerKey);
const { app } = createGatewayApp({
  l2: createL2Reader({ rpcUrls }),
  signer,
  allowedSenders: allowedSenders as `0x${string}`[],
  ttlSeconds: Number(process.env.MUSENAME_GATEWAY_TTL_SECONDS ?? 300),
});

const port = Number(process.env.GATEWAY_PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'gateway listening',
      url: `http://localhost:${info.port}`,
      signer: signer.address,
      allowedSenders,
    }),
  );
});
