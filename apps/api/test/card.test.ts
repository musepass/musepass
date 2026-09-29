import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';
import {
  CARD_TEXT_KEY,
  ERC8004_CARD_TYPE,
  cardContentHash,
  cardDataUri,
  cardTextSignaturePayload,
  buildReservedIndex,
  loadConfig,
  namehash,
  type MusenameConfig,
} from '@musename/core';

import { createApp } from '../src/app.js';
import type { ChainReader, MusenameDeps } from '../src/deps.js';
import { createMemoryRepos } from '../src/repositories/memory.js';

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(here, '../../../config');
const REGISTRAR = '0x9999999999999999999999999999999999999999' as Address;
const L2_REGISTRY = '0x8888888888888888888888888888888888888888' as Address;

// Public anvil keys. Test only.
const OWNER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const STRANGER_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
const owner = privateKeyToAccount(OWNER_KEY);
const stranger = privateKeyToAccount(STRANGER_KEY);

const FIXED_NOW = new Date('2026-09-29T00:00:00.000Z');
const EXPIRATION = BigInt(Math.floor(FIXED_NOW.getTime() / 1000) + 3600);

function testConfig(): MusenameConfig {
  return loadConfig({
    configDir: CONFIG_DIR,
    env: { MUSENAME_REGISTRAR: REGISTRAR, MUSENAME_L2_REGISTRY: L2_REGISTRY },
  });
}

function validCard(
  label = 'aguang',
  config = testConfig(),
  visibility?: Record<string, string>,
) {
  return {
    type: ERC8004_CARD_TYPE,
    name: `${label}.${config.brand.rootName}`,
    description: '婚礼与风光摄影，接受档期咨询',
    image: 'ipfs://bafyimage',
    services: [{ name: 'web', endpoint: `https://${label}.musename.xyz` }],
    x402Support: false,
    active: true,
    registrations: [],
    ...(visibility ? { musename: { ensName: `${label}.${config.brand.rootName}`, visibility } } : {}),
  };
}

interface FakeChain extends ChainReader {
  taken: Set<string>;
  texts: Map<string, string>;
  writes: Array<{ key: string; value: string; signer: string }>;
}

function fakeChain(): FakeChain {
  const taken = new Set<string>(['aguang']);
  const texts = new Map<string, string>();
  const writes: FakeChain['writes'] = [];
  return {
    taken,
    texts,
    writes,
    async listNames() {
      return [];
    },
    async isLabelAvailable(label) {
      return !taken.has(label);
    },
    async getOwner(label) {
      return taken.has(label) ? owner.address : null;
    },
    async readText(label, key) {
      return texts.get(`${label}:${key}`) ?? null;
    },
    async writeText(input) {
      writes.push({ key: input.key, value: input.value, signer: input.signer });
      // Mirror the contract: the record only lands if the signer is authorised.
      if (input.signer.toLowerCase() !== owner.address.toLowerCase()) {
        throw new Error('execution reverted: Unauthorized');
      }
      texts.set(`${input.label}:${input.key}`, input.value);
      return { txHash: `0x${'ab'.repeat(32)}` as Hex };
    },
    async register({ label }) {
      taken.add(label);
      return { txHash: `0x${'cd'.repeat(32)}` as Hex, node: `0x${'ef'.repeat(32)}` as Hex };
    },
  };
}

function buildApp(chain: FakeChain = fakeChain(), config = testConfig()) {
  const repos = createMemoryRepos();
  const deps: MusenameDeps = {
    config,
    reservedIndex: buildReservedIndex(config.reserved),
    chain,
    names: repos.names,
    requests: repos.requests,
      cards: repos.cards,
    sponsorship: repos.sponsorship,
    indexKind: 'memory',
    clock: () => FIXED_NOW,
  };
  return { app: createApp(deps), deps, chain };
}

async function signCard(
  card: ReturnType<typeof validCard>,
  account = owner,
  config = testConfig(),
) {
  const value = cardDataUri(card as never);
  const payload = cardTextSignaturePayload({
    registry: L2_REGISTRY,
    node: namehash(card.name),
    key: CARD_TEXT_KEY,
    value,
    expiration: EXPIRATION,
  });
  const signature = await account.signMessage({ message: { raw: payload } });
  return { value, payload, signature };
}

describe('PUT /v1/names/{name}/card', () => {
  it('publishes the card with the owner signature and our gas', async () => {
    const { app, chain } = buildApp();
    const card = validCard();
    const { signature } = await signCard(card);

    const response = await app.request('/v1/names/aguang/card', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        card,
        expiration: Number(EXPIRATION),
        signer: owner.address,
        signature,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.txHash).toBe(`0x${'ab'.repeat(32)}`);
    expect(chain.writes).toHaveLength(1);
    expect(chain.writes[0].key).toBe(CARD_TEXT_KEY);
    // The stored value is a self-contained data URI, not a pointer.
    expect(chain.writes[0].value.startsWith('data:application/json;base64,')).toBe(true);
    expect(body.data.contentHash).toBe(cardContentHash(card as never));
  });

  it('refuses a signature from somebody who does not own the name', async () => {
    const { app, chain } = buildApp();
    const card = validCard();
    const { signature } = await signCard(card, stranger);

    const response = await app.request('/v1/names/aguang/card', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        card,
        expiration: Number(EXPIRATION),
        signer: stranger.address,
        signature,
      }),
    });

    expect(response.status).toBe(403);
    expect(chain.writes).toHaveLength(0);
  });

  it('refuses a signature made for different content', async () => {
    const { app, chain } = buildApp();
    const card = validCard();
    const { signature } = await signCard(card);
    const tampered = { ...card, description: '改了描述' };

    const response = await app.request('/v1/names/aguang/card', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        card: tampered,
        expiration: Number(EXPIRATION),
        signer: owner.address,
        signature,
      }),
    });

    expect(response.status).toBe(401);
    expect(chain.writes).toHaveLength(0);
  });

  it('refuses a card that does not satisfy ERC-8004', async () => {
    const { app } = buildApp();
    const card = { ...validCard(), description: '' };
    const { signature } = await signCard(card as never);

    const response = await app.request('/v1/names/aguang/card', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        card,
        expiration: Number(EXPIRATION),
        signer: owner.address,
        signature,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.data.invalid).toContain('description is required');
  });

  it('lists published versions, newest first', async () => {
    const { app, deps } = buildApp();
    const indexedName = await deps.names.insert({
      label: 'aguang',
      fullName: 'aguang.musename.eth',
      normalized: 'aguang',
      ownerAddress: owner.address,
      tier: 'free',
      status: 'active',
      registeredVia: 'web',
      agentHost: null,
      txHash: null,
    });

    const first = validCard('aguang', deps.config, { description: 'public' });
    const firstSignature = await signCard(first as never, owner, deps.config);
    await app.request('/v1/names/aguang/card', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        card: first,
        expiration: Number(EXPIRATION),
        signer: owner.address,
        signature: firstSignature.signature,
      }),
    });

    const second = validCard('aguang', deps.config, { description: 'public' });
    second.description = '改过的简介';
    const secondSignature = await signCard(second as never, owner, deps.config);
    await app.request('/v1/names/aguang/card', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        card: second,
        expiration: Number(EXPIRATION),
        signer: owner.address,
        signature: secondSignature.signature,
      }),
    });

    const response = await app.request('/v1/names/aguang/card/versions');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.versions).toHaveLength(2);
    expect(body.data.versions[0].version).toBe(2);
    expect(body.data.versions[1].version).toBe(1);
    expect(body.data.versions[0].contentHash).toBe(cardContentHash(second as never));
    expect(body.data.versions[0].contentHash).not.toBe(body.data.versions[1].contentHash);
    expect(body.data.versions[0].visibility.description).toBe('public');
    void indexedName;
  });

  it('says so when the name is not in our index', async () => {
    const { app } = buildApp();
    const response = await app.request('/v1/names/unindexed/card/versions');
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.indexed).toBe(false);
    expect(body.summary.zh).toContain('不在我们的索引里');
  });

  it('reports a clear 503 when no registry is configured', async () => {
    const base = testConfig();
    const config = { ...base, chains: { ...base.chains, l2: { ...base.chains.l2, l2Registry: '' } } };
    const { app } = buildApp(fakeChain(), config);
    const response = await app.request('/v1/names/aguang/card', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(503);
  });
});

describe('GET /v1/names/{name} with a card', () => {
  it('serves only the fields the owner made public', async () => {
    const { app, chain } = buildApp();
    const card = validCard();
    const { value } = await signCard(card);
    chain.texts.set(`aguang:${CARD_TEXT_KEY}`, value);

    const body = await (await app.request('/v1/names/aguang')).json();

    expect(body.data.owner).toBe(owner.address);
    // Default visibility: name and address only.
    expect(body.data.card.name).toBe('aguang.musename.eth');
    expect(body.data.card.address).toBe(owner.address);
    expect(body.data.card.description).toBeUndefined();
    expect(body.data.card.contact).toBeUndefined();
    expect(body.data.card.contentHash).toBe(cardContentHash(card as never));
  });

  it('unlocks the fields the owner marked public', async () => {
    const { app, chain } = buildApp();
    // Visibility lives inside the card, because the owner signs the card.
    const card = validCard('aguang', testConfig(), {
      description: 'public',
      services: 'public',
    });
    const { signature } = await signCard(card);

    const publish = await app.request('/v1/names/aguang/card', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        card,
        expiration: Number(EXPIRATION),
        signer: owner.address,
        signature,
      }),
    });
    expect(publish.status).toBe(201);

    const body = await (await app.request('/v1/names/aguang')).json();
    expect(body.data.card.description).toBe(card.description);
    expect(body.data.card.services).toHaveLength(1);
    // Still private, because the owner did not open it.
    expect(body.data.card.image).toBeUndefined();
    expect(chain.writes).toHaveLength(1);
  });

  it('reports no card when the record is missing', async () => {
    const { app } = buildApp();
    const body = await (await app.request('/v1/names/aguang')).json();
    expect(body.data.card).toBeNull();
  });
});
