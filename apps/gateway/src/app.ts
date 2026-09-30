import { Hono } from 'hono';
import { isAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';

import {
  decodeStuffedCall,
  encodeGatewayResponse,
  signGatewayResponse,
} from './ccipRead.js';
import { GatewayError, type L2Reader } from './l2.js';
import { createMetrics, type Metrics } from './metrics.js';

export interface GatewayOptions {
  l2: L2Reader;
  signer: PrivateKeyAccount;
  /**
   * Only sign for these L1 resolvers. The signature is bound to the sender, so
   * a stranger cannot turn our gateway into a signing oracle for their own
   * resolver — but an allow list also stops us wasting work on them.
   */
  allowedSenders?: Address[];
  /** Seconds the signed response stays valid. */
  ttlSeconds?: number;
  metrics?: Metrics;
  now?: () => number;
  logger?: (entry: Record<string, unknown>) => void;
}

export function createGatewayApp(options: GatewayOptions) {
  const { l2, signer } = options;
  const allowed = new Set((options.allowedSenders ?? []).map((a) => a.toLowerCase()));
  const ttl = options.ttlSeconds ?? 300;
  const metrics = options.metrics ?? createMetrics();
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const log = options.logger ?? ((entry) => console.log(JSON.stringify(entry)));

  const app = new Hono();

  app.get('/healthz', async (c) => {
    // Liveness plus a cheap statement of what this instance will serve.
    return c.json({
      status: 'ok',
      signer: signer.address,
      chains: l2.chains(),
      allowedSenders: [...allowed],
      ttlSeconds: ttl,
    });
  });

  app.get('/metrics', (c) => c.text(metrics.render(), 200, { 'content-type': 'text/plain' }));

  /**
   * ERC-3668 endpoint. Clients substitute {sender} and {data} from the
   * OffchainLookup revert; some append a `.json` suffix, so accept both.
   */
  app.get('/:sender/:data', async (c) => {
    const startedAt = Date.now();
    const rawSender = c.req.param('sender');
    const rawData = c.req.param('data').replace(/\.json$/i, '');
    const labels = { chain: 'unknown' };

    const fail = (error: GatewayError) => {
      metrics.observe('ccip-read', labels, Date.now() - startedAt, false);
      log({ level: 'warn', code: error.code, sender: rawSender, status: error.status });
      return c.json({ message: error.message, code: error.code }, error.status as 400);
    };

    try {
      if (!isAddress(rawSender)) {
        throw new GatewayError('BAD_SENDER', 'sender is not an address', 400);
      }
      const sender = rawSender as Address;
      if (allowed.size > 0 && !allowed.has(sender.toLowerCase())) {
        throw new GatewayError('SENDER_NOT_ALLOWED', 'this gateway does not serve that resolver', 403);
      }
      if (!/^0x[0-9a-fA-F]*$/.test(rawData)) {
        throw new GatewayError('BAD_DATA', 'data is not hex', 400);
      }

      let call;
      try {
        call = decodeStuffedCall(rawData as Hex);
      } catch {
        // Anything that is not the resolver's own call shape is a client
        // mistake, not our failure. Say so without echoing viem's internals
        // back to whoever asked.
        throw new GatewayError(
          'BAD_CALLDATA',
          'data is not a MusePass resolver call (expected stuffedResolveCall)',
          400,
        );
      }
      labels.chain = call.targetChainId.toString();

      const result = await l2.read({
        chainId: call.targetChainId,
        registryAddress: call.targetRegistryAddress,
        callData: call.resolveCall,
      });

      const expires = BigInt(now() + ttl);
      const signature = await signGatewayResponse({
        account: signer,
        sender,
        expires,
        request: rawData as Hex,
        result,
      });

      metrics.observe('ccip-read', labels, Date.now() - startedAt, true);
      log({
        level: 'info',
        sender,
        chain: labels.chain,
        bytes: (result.length - 2) / 2,
        ms: Date.now() - startedAt,
      });

      return c.json({ data: encodeGatewayResponse({ result, expires, signature }) });
    } catch (error) {
      if (error instanceof GatewayError) return fail(error);
      // Keep the detail in the log, not in the response: a stack trace or an
      // RPC URL in a public body is a gift to whoever is probing us.
      log({
        level: 'error',
        code: 'INTERNAL',
        sender: rawSender,
        detail: error instanceof Error ? error.message : String(error),
      });
      return fail(new GatewayError('INTERNAL', 'internal error', 500));
    }
  });

  app.notFound((c) => c.json({ message: 'not found', code: 'NOT_FOUND' }, 404));

  return { app, metrics };
}

export function signerFromEnv(privateKey: string): PrivateKeyAccount {
  return privateKeyToAccount(privateKey as Hex);
}
