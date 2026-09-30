import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { MusenameConfig } from '@musename/core';
import {
  checkName,
  prepareRegistration,
  submitRegistration,
  draftCard,
  getProfile,
  getStatus,
  render,
  requestName,
  type MusenameApi,
} from './tools.js';

// The five tools from the task document. Their descriptions are part of the
// safety design, not documentation: an AI reads them before deciding what it is
// allowed to do, so `request_name` spells out that the owner has to confirm.
export function createServer(api: MusenameApi, config: MusenameConfig): McpServer {
  const server = new McpServer({
    name: config.brand.productName.toLowerCase() + '-names',
    version: '0.1.0',
  });

  const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });

  server.registerTool(
    'check_name',
    {
      title: 'Check whether a name is available',
      description:
        'Check whether a name can be registered, whether it breaks any rule, and get up to three alternatives if it cannot. Read only: this never registers anything.',
      inputSchema: {
        name: z.string().describe('The name to check, with or without the root suffix.'),
      },
    },
    async ({ name }) => text(render(await checkName(api, { name }))),
  );

  server.registerTool(
    'request_name',
    {
      title: 'Request a name for the owner to confirm',
      description:
        'Start a registration and get a confirmation link. IMPORTANT: registering needs the owner to confirm. Hand the returned link to the owner; the name is NOT issued until they open it and sign. The link expires. Use this when you have no wallet of your own — if you do have one, prepare_registration lets you sign for yourself instead.',
      inputSchema: {
        name: z.string().describe('The name the owner wants.'),
        ownerEmail: z.string().optional().describe('Owner email, when the owner has no wallet.'),
        ownerAddress: z.string().optional().describe('Owner wallet address, when they have one.'),
        host: z.string().optional().describe('Which AI host is asking, e.g. claude.'),
      },
    },
    async (args) => text(render(await requestName(api, args, config))),
  );

  server.registerTool(
    'get_status',
    {
      title: 'Check a registration request',
      description:
        'Look up whether a registration request is still waiting, has been confirmed, or has expired. Read only.',
      inputSchema: {
        requestId: z.string().describe('The requestId returned by request_name.'),
      },
    },
    async ({ requestId }) => text(render(await getStatus(api, { requestId }, config))),
  );

  server.registerTool(
    'draft_card',
    {
      title: 'Draft an ERC-8004 card',
      description:
        'Turn what you learned in the conversation into an ERC-8004 agent card draft. Returns a validated draft with a content hash. It is NOT published: the owner signs on the name page before any of it becomes public, and everything except the name and address is private by default.',
      inputSchema: {
        name: z.string().describe('The name the card belongs to.'),
        description: z.string().describe('What this AI does, in the owner voice.'),
        image: z.string().optional().describe('Avatar URL or ipfs:// CID.'),
        contact: z.string().optional().describe('Contact email, optional.'),
        host: z.string().optional().describe('Which AI platform runs it.'),
        payoutAddress: z.string().optional().describe('Where it receives payment.'),
        owner: z.string().optional().describe('The human behind it.'),
        services: z
          .array(
            z.object({
              name: z.string(),
              endpoint: z.string(),
              version: z.string().optional(),
              skills: z.array(z.string()).optional(),
              domains: z.array(z.string()).optional(),
            }),
          )
          .optional()
          .describe('Where other agents can reach it: MCP, A2A, web, email, ENS, DID.'),
        supportedTrust: z.array(z.string()).optional(),
      },
    },
    async (args) => text(render(await draftCard(args, config))),
  );

  server.registerTool(
    'prepare_registration',
    {
      title: 'Prepare a registration for an agent that signs for itself',
      description:
        'Use this when you have your OWN wallet and will sign for yourself. Returns the exact EIP-712 payload to sign for a name; hand the signature to submit_registration and the name is issued to that address, with the project paying the gas. Use request_name instead if you have no wallet of your own: it returns a confirmation link for your owner to sign.',
      inputSchema: {
        name: z.string().describe('The name to register, with or without the root suffix.'),
        ownerAddress: z.string().describe('Your own wallet address, the one that will sign and own the name.'),
      },
    },
    async ({ name, ownerAddress }) => text(render(prepareRegistration({ name, ownerAddress }, config))),
  );

  server.registerTool(
    'submit_registration',
    {
      title: 'Submit a signature and receive the name',
      description:
        'Second half of the self-signing path. Takes the signature you produced over the prepare_registration payload and issues the name to that address. The signature is verified against the registrar before anything is spent, so a wrong payload simply fails.',
      inputSchema: {
        label: z.string().describe('The label that was signed.'),
        owner: z.string().describe('The wallet address that signed.'),
        deadline: z.number().describe('The deadline from the prepared payload, in Unix seconds.'),
        signature: z.string().describe('The EIP-712 signature over the prepared payload.'),
      },
    },
    async ({ label, owner, deadline, signature }) =>
      text(render(await submitRegistration(api, { label, owner, deadline, signature }))),
  );

  server.registerTool(
    'get_profile',
    {
      title: 'Read a name and its public card',
      description:
        'Look up any name: who owns it and what the owner has chosen to publish. Fields the owner kept private are absent, and a missing card is reported as missing rather than guessed. Read only.',
      inputSchema: {
        name: z.string().describe('The name to look up.'),
      },
    },
    async ({ name }) => text(render(await getProfile(api, { name }))),
  );

  return server;
}
