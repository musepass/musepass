import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  REGISTER_TYPES,
  buildEip712Domain,
  buildReservedIndex,
  loadConfig,
  registerMessage,
  type MusenameConfig,
} from '@musename/core';

import { createApp } from '../src/app.js';
import type { ChainReader, MusenameDeps } from '../src/deps.js';
import { createMemoryRepos } from '../src/repositories/memory.js';

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(here, '../../../config');
const REGISTRAR = '0x9999999999999999999999999999999999999999' as Address;
const L2_REGISTRY = '0x8888888888888888888888888888888888888888' as Address;
// Public anvil key. Test only.
const OWNER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const ownerAccount = privateKeyToAccount(OWNER_KEY);

const FIXED_NOW = new Date('2026-09-29T00:00:00.000Z');
/** Mutable clock shared by every request in a test. */
let now = FIXED_NOW;

/** Absolute unix timestamp `seconds` after the current (possibly advanced) clock. */
function deadlineIn(seconds: number): number {
  return Math.floor(now.getTime() / 1000) + seconds;
}

function testConfig(): MusenameConfig {
  return loadConfig({
    configDir: CONFIG_DIR,
    env: { MUSENAME_REGISTRAR: REGISTRAR, MUSENAME_L2_REGISTRY: L2_REGISTRY },
  });
}

function fakeChain(taken = new Set<string>()): ChainReader {
  return {
    async isLabelAvailable(label) {
      return !taken.has(label);
    },
    async getOwner(label) {
      return taken.has(label) ? ownerAccount.address : null;
    },
    async register({ label }) {
      taken.add(label);
      return { txHash: `0x${'ab'.repeat(32)}` as Hex, node: `0x${'cd'.repeat(32)}` as Hex };
    },
  };
}

function buildApp(overrides: Partial<MusenameDeps> = {}) {
  const config = testConfig();
  const repos = createMemoryRepos();
  now = FIXED_NOW;
  const deps: MusenameDeps = {
    config,
    reservedIndex: buildReservedIndex(config.reserved),
    chain: fakeChain(),
    names: repos.names,
    requests: repos.requests,
      cards: repos.cards,
    sponsorship: repos.sponsorship,
    clock: () => now,
    ...overrides,
  };
  return { app: createApp(deps), deps };
}

/** Signs for an absolute deadline, which is exactly what the API will verify. */
async function signClaim(label: string, config: MusenameConfig, deadline: number) {
  const domain = buildEip712Domain({
    productName: config.brand.productName,
    chainId: config.chains.l2.chainId,
    verifyingContract: REGISTRAR,
  });
  const message = registerMessage({
    label,
    owner: ownerAccount.address,
    deadline: BigInt(deadline),
  });
  return ownerAccount.signTypedData({
    domain,
    types: REGISTER_TYPES,
    primaryType: 'Register',
    message,
  });
}

async function createRequest(
  app: ReturnType<typeof createApp>,
  label: string,
  host = 'claude',
  requestedFor = 'owner@example.com',
) {
  const response = await app.request('/v1/requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label, requestedFor, host }),
  });
  return { response, body: await response.json() };
}

async function claim(
  app: ReturnType<typeof createApp>,
  config: MusenameConfig,
  label: string,
  extra: Record<string, unknown> = {},
) {
  const deadline = deadlineIn(1800);
  const signature = await signClaim(label, config, deadline);
  const response = await app.request('/v1/names/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      label,
      owner: ownerAccount.address,
      deadline,
      signature,
      ...extra,
    }),
  });
  return { response, body: await response.json(), deadline, signature };
}

describe('POST /v1/requests', () => {
  it('prepares a name and returns a confirm link, without registering anything', async () => {
    const { app, deps } = buildApp();
    const { response, body } = await createRequest(app, 'aguang');

    expect(response.status).toBe(201);
    expect(body.data.label).toBe('aguang');
    expect(body.data.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.data.confirmUrl).toContain(`/confirm/${body.data.requestId}?token=`);
    expect(body.summary.zh).toContain('交给主人确认');
    // The whole point: an AI asking for a name creates nothing.
    expect(await deps.names.findByNormalized('aguang')).toBeNull();
    expect(await deps.chain.getOwner('aguang')).toBeNull();
  });

  it('gives the AI a sentence it can read out to its owner', async () => {
    const { app } = buildApp();
    const { body } = await createRequest(app, 'aguang');
    expect(body.summary.en).toContain('expires in 15 minutes');
    expect(body.data.expiresAt).toBe(
      new Date(FIXED_NOW.getTime() + 15 * 60 * 1000).toISOString(),
    );
  });

  it('stores only the hash of the token', async () => {
    const { app, deps } = buildApp();
    const { body } = await createRequest(app, 'aguang');
    const token = new URL(body.data.confirmUrl).searchParams.get('token');
    const stored = await deps.requests.findById(body.data.requestId);

    expect(stored?.confirmTokenHash).toBeTruthy();
    expect(stored?.confirmTokenHash).not.toBe(token);
    expect(stored?.confirmTokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a name that policy or the chain rejects', async () => {
    const { app } = buildApp();
    const reserved = await createRequest(app, 'admin');
    expect(reserved.response.status).toBe(409);
    expect(reserved.body.errors.map((error: { code: string }) => error.code)).toContain(
      'RESERVED_NAME',
    );

    const short = await createRequest(app, 'abc');
    expect(short.response.status).toBe(409);
  });

  it('requires somebody to hand the link to', async () => {
    const { app } = buildApp();
    const response = await app.request('/v1/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'aguang' }),
    });
    expect(response.status).toBe(400);
  });

  it('caps how many requests one AI can leave open', async () => {
    const { app } = buildApp();
    for (let index = 0; index < 10; index += 1) {
      const { response } = await createRequest(app, `name${index}a`, 'claude', `o${index}@x.com`);
      expect(response.status).toBe(201);
    }
    const { response, body } = await createRequest(app, 'name9z', 'claude', 'other@x.com');
    expect(response.status).toBe(429);
    expect(body.errors[0].code).toBe('RATE_LIMITED');
  });

  it('caps how many requests one owner can have open', async () => {
    const { app } = buildApp();
    for (let index = 0; index < 5; index += 1) {
      const { response } = await createRequest(app, `owner${index}a`, `host${index}`, 'same@x.com');
      expect(response.status).toBe(201);
    }
    const { response } = await createRequest(app, 'owner9z', 'anotherhost', 'same@x.com');
    expect(response.status).toBe(429);
  });
});

describe('GET /v1/requests/{id}', () => {
  it('reports a pending request', async () => {
    const { app } = buildApp();
    const { body } = await createRequest(app, 'aguang');
    const status = await app.request(`/v1/requests/${body.data.requestId}`);
    const statusBody = await status.json();

    expect(status.status).toBe(200);
    expect(statusBody.data.status).toBe('pending');
    expect(statusBody.summary.zh).toContain('等主人确认');
  });

  it('reports expiry without mutating the row', async () => {
    const { app, deps } = buildApp();
    const { body } = await createRequest(app, 'aguang');
    now = new Date(FIXED_NOW.getTime() + 16 * 60 * 1000);

    const status = await app.request(`/v1/requests/${body.data.requestId}`);
    const statusBody = await status.json();

    expect(statusBody.data.status).toBe('expired');
    expect((await deps.requests.findById(body.data.requestId))?.status).toBe('pending');
  });

  it('404s for an unknown id', async () => {
    const { app } = buildApp();
    const response = await app.request('/v1/requests/00000000-0000-0000-0000-000000000000');
    expect(response.status).toBe(404);
  });
});

describe('claiming through a request', () => {
  it('registers the name when the owner signs with a valid token', async () => {
    const { app, deps } = buildApp();
    const { body } = await createRequest(app, 'aguang');
    const token = new URL(body.data.confirmUrl).searchParams.get('token')!;

    const { response, body: claimBody } = await claim(app, deps.config, 'aguang', {
      requestId: body.data.requestId,
      confirmToken: token,
    });

    expect(response.status).toBe(201);
    expect(claimBody.data.fullName).toBe('aguang.musename.eth');

    const request = await deps.requests.findById(body.data.requestId);
    expect(request?.status).toBe('confirmed');
    expect(request?.confirmedAt).not.toBeNull();
  });

  it('refuses a valid signature with the wrong token', async () => {
    const { app, deps } = buildApp();
    const { body } = await createRequest(app, 'aguang');

    const { response } = await claim(app, deps.config, 'aguang', {
      requestId: body.data.requestId,
      confirmToken: 'not-the-token',
    });

    expect(response.status).toBe(403);
    expect(await deps.names.findByNormalized('aguang')).toBeNull();
  });

  it('refuses a token belonging to another name', async () => {
    const { app, deps } = buildApp();
    const { body } = await createRequest(app, 'aguang');
    const token = new URL(body.data.confirmUrl).searchParams.get('token')!;

    const { response } = await claim(app, deps.config, 'othername', {
      requestId: body.data.requestId,
      confirmToken: token,
    });

    expect(response.status).toBe(409);
  });

  it('refuses an expired request and marks it expired without minting', async () => {
    const { app, deps } = buildApp();
    const { body } = await createRequest(app, 'aguang');
    const token = new URL(body.data.confirmUrl).searchParams.get('token')!;
    now = new Date(FIXED_NOW.getTime() + 16 * 60 * 1000);

    const { response } = await claim(app, deps.config, 'aguang', {
      requestId: body.data.requestId,
      confirmToken: token,
    });

    expect(response.status).toBe(410);
    expect((await deps.requests.findById(body.data.requestId))?.status).toBe('expired');
    expect(await deps.names.findByNormalized('aguang')).toBeNull();
  });

  it('a confirmed request cannot be reused for a different name', async () => {
    const { app, deps } = buildApp();
    const { body } = await createRequest(app, 'aguang');
    const token = new URL(body.data.confirmUrl).searchParams.get('token')!;

    const first = await claim(app, deps.config, 'aguang', {
      requestId: body.data.requestId,
      confirmToken: token,
    });
    expect(first.response.status).toBe(201);

    const second = await claim(app, deps.config, 'othername', {
      requestId: body.data.requestId,
      confirmToken: token,
    });
    expect(second.response.status).toBe(409);
    expect(await deps.names.findByNormalized('othername')).toBeNull();
  });

  it('still works without a request, for the web flow', async () => {
    const { app, deps } = buildApp();
    const { response } = await claim(app, deps.config, 'aguang');
    expect(response.status).toBe(201);
  });
});
