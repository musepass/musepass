import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig, type MusenameConfig } from '@musename/core';

import { createServer } from '../src/server.js';
import type { MusenameApi, ToolResult } from '../src/tools.js';

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(here, '../../../config');

const ok = (summary: ToolResult['summary'], data: Record<string, unknown>): ToolResult => ({
  summary,
  data,
  errors: [],
});

const api: MusenameApi = {
  async checkName(name) {
    return ok({ zh: `${name} 可以用。`, en: `${name} is available.` }, { label: name, available: true });
  },
  async createRequest({ label, requestedFor }) {
    return ok({ zh: `${label} 准备好了。`, en: `${label} is prepared.` }, {
      requestId: 'req-1',
      label,
      confirmUrl: 'https://musename.xyz/confirm/req-1?token=abc',
      requestedFor,
    });
  },
  async getRequest(id) {
    return ok({ zh: '还在等主人确认。', en: 'Waiting.' }, { requestId: id, status: 'pending' });
  },
  async getProfile(name) {
    return ok({ zh: `${name} 属于某人。`, en: `${name} belongs to someone.` }, {
      name,
      owner: '0xabc',
      card: null,
      trackRecord: null,
    });
  },
};

let client: Client;
let config: MusenameConfig;

beforeEach(async () => {
  config = loadConfig({ configDir: CONFIG_DIR, env: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'musename-test-client', version: '0.0.1' });
  await createServer(api, config).connect(serverTransport);
  await client.connect(clientTransport);
});

afterEach(async () => {
  await client.close();
});

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((item) => item.text ?? '').join('\n');
}

describe('tool registration over the MCP protocol', () => {
  it('exposes the five tools from the task document, plus the self-signing pair', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'check_name',
      'draft_card',
      'get_profile',
      'get_status',
      'prepare_registration',
      'request_name',
      'submit_registration',
    ]);
  });

  it('keeps the two paths apart in what the model is told', async () => {
    const { tools } = await client.listTools();
    const owner = tools.find((tool) => tool.name === 'request_name');
    const self = tools.find((tool) => tool.name === 'prepare_registration');
    // An agent with no wallet must not think it can register on its own, and an
    // agent with a wallet should not have to involve its owner at all.
    expect(owner?.description).toContain('no wallet');
    expect(self?.description).toContain('OWN wallet');
    expect(self?.description).toContain('submit_registration');
  });

  it('tells the model in the tool description that the owner must confirm', async () => {
    const { tools } = await client.listTools();
    const requestName = tools.find((tool) => tool.name === 'request_name');
    expect(requestName?.description).toContain('owner to confirm');
    expect(requestName?.description).toContain('NOT issued');
  });

  it('describes the card draft as unpublished', async () => {
    const { tools } = await client.listTools();
    const draftCard = tools.find((tool) => tool.name === 'draft_card');
    expect(draftCard?.description).toContain('NOT published');
  });

  it('answers check_name with a readable sentence first', async () => {
    const result = await client.callTool({ name: 'check_name', arguments: { name: 'aguang' } });
    const text = textOf(result);
    expect(text).toContain('可以用');
    expect(text.indexOf('可以用')).toBeLessThan(text.indexOf('```json'));
  });

  it('returns a confirmation link that the model can hand over', async () => {
    const result = await client.callTool({
      name: 'request_name',
      arguments: { name: 'aguang', ownerAddress: '0xabc', host: 'grok' },
    });
    const text = textOf(result);
    expect(text).toContain('https://musename.xyz/confirm/req-1?token=abc');
    expect(text).toContain('requiresOwnerConfirmation');
  });

  it('drafts a card through the protocol without publishing it', async () => {
    const result = await client.callTool({
      name: 'draft_card',
      arguments: {
        name: 'aguang',
        description: '婚礼摄影',
        image: 'ipfs://bafy',
        services: [{ name: 'web', endpoint: 'https://aguang.musename.xyz' }],
      },
    });
    const text = textOf(result);
    expect(text).toContain('"draft": true');
    expect(text).toContain('"published": false');
  });

  it('accepts the arguments an AI would naturally send', async () => {
    await expect(
      client.callTool({
        name: 'get_status',
        arguments: { requestId: 'req-1' },
      }),
    ).resolves.toBeTruthy();
  });
});
