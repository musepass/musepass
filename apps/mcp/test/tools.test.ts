import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ERC8004_CARD_TYPE, loadConfig, type MusenameConfig } from '@musename/core';

import {
  checkName,
  draftCard,
  getProfile,
  getStatus,
  render,
  requestName,
  type MusenameApi,
  type ToolResult,
} from '../src/tools.js';

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(here, '../../../config');

function testConfig(): MusenameConfig {
  return loadConfig({ configDir: CONFIG_DIR, env: {} });
}

const ok = (summary: ToolResult['summary'], data: Record<string, unknown>): ToolResult => ({
  summary,
  data,
  errors: [],
});

function fakeApi(overrides: Partial<MusenameApi> = {}): MusenameApi {
  return {
    async checkName(name) {
      return ok({ zh: `${name} 可以用。`, en: `${name} is available.` }, {
        label: name,
        available: true,
      });
    },
    async createRequest({ label, requestedFor }) {
      return ok({ zh: `${label} 准备好了。`, en: `${label} is prepared.` }, {
        requestId: 'req-1',
        label,
        confirmUrl: `https://musename.xyz/confirm/req-1?token=abc`,
        requestedFor,
      });
    },
    async getRequest(id) {
      return ok({ zh: '还在等主人确认。', en: 'Waiting for the owner.' }, {
        requestId: id,
        status: 'pending',
      });
    },
    async getProfile(name) {
      return ok({ zh: `${name} 属于某人。`, en: `${name} belongs to someone.` }, {
        name,
        owner: '0xabc',
        card: null,
        trackRecord: null,
      });
    },
    ...overrides,
  };
}

const config = testConfig();

describe('check_name', () => {
  it('passes the name through and keeps the summary first', async () => {
    const result = await checkName(fakeApi(), { name: 'aguang' });
    expect(result.summary.zh).toContain('可以用');
    expect(result.data.available).toBe(true);
  });

  it('rejects an empty input without calling the API', async () => {
    let called = false;
    const api = fakeApi({
      async checkName(name) {
        called = true;
        return ok({ zh: '', en: '' }, { name });
      },
    });
    const result = await checkName(api, { name: '   ' });
    expect(called).toBe(false);
    expect(result.errors[0].code).toBe('BAD_INPUT');
  });
});

describe('request_name', () => {
  it('always tells the model to hand the link to the owner', async () => {
    const result = await requestName(
      fakeApi(),
      { name: 'aguang', ownerAddress: '0xabc', host: 'claude' },
      config,
    );

    expect(result.data.confirmUrl).toContain('/confirm/');
    expect(result.data.requiresOwnerConfirmation).toBe(true);
    expect(result.data.status).toBe('pending');
    // The instruction belongs in the summary the model reads; the URL belongs in
    // the structured data, so it is quoted from one place instead of two.
    // The instruction belongs in the summary the model reads (including where
    // the link is); the URL itself lives in the structured data, so it is quoted
    // from one place instead of two.
    expect(result.summary.zh).toContain('data.confirmUrl');
    expect(result.summary.zh).not.toContain(String(result.data.confirmUrl));
    expect(result.data.confirmUrl).toContain('/confirm/');
  });

  it('never claims the name was registered', async () => {
    const result = await requestName(
      fakeApi(),
      { name: 'aguang', ownerAddress: '0xabc' },
      config,
    );
    expect(JSON.stringify(result)).not.toMatch(/registered|已经注册好了/);
  });

  it('needs somewhere to send the link', async () => {
    const result = await requestName(fakeApi(), { name: 'aguang' }, config);
    expect(result.errors[0].code).toBe('BAD_INPUT');
    expect(result.summary.zh).toContain('邮箱或钱包地址');
  });

  it('surfaces API refusals instead of inventing a link', async () => {
    const api = fakeApi({
      async createRequest() {
        return {
          summary: { zh: '这个名字被保留。', en: 'This name is reserved.' },
          data: {},
          errors: [{ code: 'RESERVED_NAME', message: 'reserved' }],
        };
      },
    });
    const result = await requestName(api, { name: 'admin', ownerAddress: '0xabc' }, config);
    expect(result.errors[0].code).toBe('RESERVED_NAME');
    expect(result.data.confirmUrl).toBeUndefined();
  });

  it('fails loudly when the API returns a success shape without a link', async () => {
    const api = fakeApi({
      async createRequest({ label }) {
        return ok({ zh: `${label} 准备好了。`, en: `${label} is prepared.` }, { label });
      },
    });
    const result = await requestName(api, { name: 'aguang', ownerAddress: '0xabc' }, config);
    expect(result.errors[0].code).toBe('NO_CONFIRM_URL');
    expect(result.summary.zh).not.toContain('undefined');
  });
});

describe('get_status', () => {
  it('returns the request state', async () => {
    const result = await getStatus(fakeApi(), { requestId: 'req-1' });
    expect(result.data.status).toBe('pending');
  });

  it('requires an id', async () => {
    const result = await getStatus(fakeApi(), { requestId: '' });
    expect(result.errors[0].code).toBe('BAD_INPUT');
  });
});

describe('draft_card', () => {
  it('produces a validated, unpublished ERC-8004 draft', async () => {
    const result = await draftCard(
      {
        name: 'aguang',
        description: '婚礼与风光摄影',
        image: 'ipfs://bafy',
        services: [{ name: 'web', endpoint: 'https://aguang.musename.xyz' }],
        host: 'claude',
      },
      config,
    );

    expect(result.errors).toEqual([]);
    expect(result.data.draft).toBe(true);
    expect(result.data.published).toBe(false);
    expect(result.data.contentHash).toMatch(/^0x[0-9a-f]{64}$/);
    const card = result.data.card as Record<string, unknown>;
    expect(card.type).toBe(ERC8004_CARD_TYPE);
    expect(card.name).toBe('aguang.musepass.eth');
  });

  it('accepts a fully qualified name without doubling the suffix', async () => {
    const result = await draftCard(
      { name: 'aguang.musepass.eth', description: 'x', image: 'ipfs://a' },
      config,
    );
    expect((result.data.card as Record<string, unknown>).name).toBe('aguang.musepass.eth');
  });

  it('defaults to publishing only the name and address', async () => {
    const result = await draftCard(
      { name: 'aguang', description: 'x', image: 'ipfs://a', contact: 'a@b.com' },
      config,
    );
    const visibility = result.data.visibility as Record<string, string>;
    expect(visibility.name).toBe('public');
    expect(visibility.address).toBe('public');
    expect(visibility.contact).toBe('private');
    expect(visibility.services).toBe('private');
  });

  it('still refuses to guess a description', async () => {
    // The description is the one field only the owner (or their AI, from the
    // conversation) can supply. It is never invented.
    const result = await draftCard({ name: 'aguang', description: '' }, config);
    expect(result.data.draft).toBeUndefined();
    expect(result.errors.map((error) => error.code)).toContain('INVALID_CARD');
    expect(result.data.missingOrInvalid).toContain('description is required');
  });

  it('fills the required image instead of blocking the agent on it', async () => {
    // ERC-8004 requires an image. An agent that has nothing to put there should
    // get a publishable draft, not a chore list.
    const result = await draftCard({ name: 'aguang', description: 'Photographs weddings.' }, config);
    expect(result.data.draft).toBe(true);
    const card = result.data.card as { image: string };
    expect(card.image.startsWith('data:image/svg+xml;base64,')).toBe(true);
  });

  it('never marks a draft as published', async () => {
    const result = await draftCard(
      { name: 'aguang', description: 'x', image: 'ipfs://a' },
      config,
    );
    expect(JSON.stringify(result)).not.toContain('"published":true');
  });
});

describe('get_profile', () => {
  it('returns the owner and does not invent a card', async () => {
    const result = await getProfile(fakeApi(), { name: 'aguang' });
    expect(result.data.owner).toBe('0xabc');
    expect(result.data.card).toBeNull();
  });

  it('requires a name', async () => {
    const result = await getProfile(fakeApi(), { name: '' });
    expect(result.errors[0].code).toBe('BAD_INPUT');
  });
});

describe('render', () => {
  it('puts the plain sentence before the JSON', () => {
    const output = render(
      ok({ zh: '可以用。', en: 'Available.' }, { available: true }),
    );
    expect(output.indexOf('可以用。')).toBeLessThan(output.indexOf('```json'));
    expect(output).toContain('"available": true');
  });

  it('lists errors before the data', () => {
    const output = render({
      summary: { zh: '不行。', en: 'No.' },
      data: {},
      errors: [{ code: 'RESERVED_NAME', message: 'reserved' }],
    });
    expect(output).toContain('RESERVED_NAME');
    expect(output.indexOf('RESERVED_NAME')).toBeLessThan(output.indexOf('```json'));
  });
});
