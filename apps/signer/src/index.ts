/**
 * MuseName signer: a wallet for an agent, without giving the agent a key.
 *
 * An agent cannot hold a private key. Pasting one into a chat is publishing it,
 * and a cloud agent has nowhere safe to keep it anyway. What an agent can do is
 * ask a signer it is allowed to reach — this one. Two signing tools and an
 * address, behind a bearer token and a narrow policy, and the key never leaves.
 *
 *   MUSENAME_SIGNER_TOKEN        required, at least 16 characters
 *   MUSENAME_SIGNER_KEY          the private key, from the environment
 *   MUSENAME_SIGNER_PORT         default 8804
 *   MUSENAME_SIGNER_MAX_PER_HOUR default 60
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { loadConfig } from '@musename/core';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

import { checkCardPayload, checkRegistrationPayload, type SignerConfig } from './policy.js';

const config = loadConfig();
const token = process.env.MUSENAME_SIGNER_TOKEN;
const key = process.env.MUSENAME_SIGNER_KEY;

if (!token || token.length < 16) {
  console.error('MUSENAME_SIGNER_TOKEN is required (at least 16 characters). Refusing to start.');
  process.exit(1);
}
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error('MUSENAME_SIGNER_KEY is required and must be a 32 byte hex key. Refusing to start.');
  process.exit(1);
}

const account = privateKeyToAccount(key as Hex);
const signerConfig: SignerConfig = {
  chainId: config.chains.l2.chainId,
  registrar: config.chains.l2.registrar as `0x${string}`,
  rootName: config.brand.rootName,
};

const maxPerHour = Number(process.env.MUSENAME_SIGNER_MAX_PER_HOUR ?? 60);
let windowStarted = Date.now();
let signedInWindow = 0;

/** A ceiling on damage rather than a business rule: a loop hits it, a person does not. */
function underLimit(): boolean {
  if (Date.now() - windowStarted > 60 * 60 * 1000) {
    windowStarted = Date.now();
    signedInWindow = 0;
  }
  signedInWindow += 1;
  return signedInWindow <= maxPerHour;
}

function buildServer(): McpServer {
  const server = new McpServer({
    name: `${config.brand.productName.toLowerCase()}-signer`,
    version: '0.1.0',
  });
  const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });
  const json = (value: unknown) => text(JSON.stringify(value, null, 2));

  server.registerTool(
    'wallet_address',
    {
      title: 'Which wallet this signer uses',
      description:
        'The address this signer signs for. Use it as ownerAddress in prepare_registration, or as the owner of the name whose card you publish. The key stays here and is never returned.',
      inputSchema: {},
    },
    async () =>
      json({ address: account.address, chainId: signerConfig.chainId, signsFor: signerConfig.registrar }),
  );

  server.registerTool(
    'sign_registration',
    {
      title: 'Sign a prepared registration',
      description:
        'Takes the typedData object from prepare_registration and returns the signature for submit_registration. Refuses a payload that is not for this registry and chain, or whose deadline has passed or is more than an hour away.',
      inputSchema: {
        typedData: z
          .record(z.string(), z.unknown())
          .describe('The typedData field from prepare_registration, unchanged.'),
      },
    },
    async ({ typedData }) => {
      const checked = checkRegistrationPayload(typedData, signerConfig);
      if (!checked.ok) {
        return json({ signed: false, code: checked.code, reason: checked.reason });
      }
      if (!underLimit()) {
        return json({
          signed: false,
          code: 'RATE_LIMITED',
          reason: `more than ${maxPerHour} signatures this hour`,
        });
      }
      const typed = typedData as {
        domain: { name: string; version: string };
        types: Record<string, Array<{ name: string; type: string }>>;
      };
      const signature = await account.signTypedData({
        domain: {
          name: typed.domain.name,
          version: typed.domain.version,
          chainId: signerConfig.chainId,
          verifyingContract: signerConfig.registrar,
        },
        types: typed.types,
        primaryType: 'Register',
        message: {
          label: checked.value.label,
          owner: checked.value.owner,
          deadline: checked.value.deadline,
        },
      });
      return json({ signed: true, signer: account.address, label: checked.value.label, signature });
    },
  );

  server.registerTool(
    'sign_card',
    {
      title: 'Sign a prepared card',
      description:
        'Signs the 32-byte payloadToSign from prepare_card with personal_sign and returns the signature for submit_card. Only 32-byte hashes are accepted.',
      inputSchema: {
        payloadToSign: z.string().describe('The payloadToSign field from prepare_card, unchanged.'),
      },
    },
    async ({ payloadToSign }) => {
      const checked = checkCardPayload(payloadToSign);
      if (!checked.ok) {
        return json({ signed: false, code: checked.code, reason: checked.reason });
      }
      if (!underLimit()) {
        return json({
          signed: false,
          code: 'RATE_LIMITED',
          reason: `more than ${maxPerHour} signatures this hour`,
        });
      }
      const signature = await account.signMessage({ message: { raw: checked.value } });
      return json({ signed: true, signer: account.address, signature });
    },
  );

  return server;
}

const app = new Hono();

app.get('/healthz', (c) =>
  c.json({
    status: 'ok',
    address: account.address,
    chainId: signerConfig.chainId,
    limitPerHour: maxPerHour,
  }),
);

app.all('/mcp', async (c) => {
  const presented = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (presented !== token) {
    return c.json({ error: 'unauthorized', hint: 'send Authorization: Bearer <token>' }, 401);
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = buildServer();
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

const port = Number(process.env.MUSENAME_SIGNER_PORT ?? 8804);
serve({ fetch: app.fetch, port }, (info) => {
  // The address is public. The key is not, and never appears in a log line.
  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'signer listening',
      url: `http://localhost:${info.port}`,
      address: account.address,
    }),
  );
});
