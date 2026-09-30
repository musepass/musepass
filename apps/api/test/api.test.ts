import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
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

// The canonical domain is config, not a constant to retype: the 2026-09-30 move
// to musepass.xyz broke these two assertions, and the API was right both times.
const SITE_URL = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../config/brand.json'), 'utf8'),
).siteUrl as string;
import type { ChainReader, MusenameDeps } from '../src/deps.js';
import { createMemoryRepos } from '../src/repositories/memory.js';

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(here, '../../../config');

const REGISTRAR = '0x9999999999999999999999999999999999999999' as Address;
const L2_REGISTRY = '0x8888888888888888888888888888888888888888' as Address;
// Public anvil keys. Test only.
const SPONSOR_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const OWNER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

const ownerAccount = privateKeyToAccount(OWNER_KEY);
const sponsorAccount = privateKeyToAccount(SPONSOR_KEY);

function testConfig(): MusenameConfig {
  return loadConfig({
    configDir: CONFIG_DIR,
    env: { MUSENAME_REGISTRAR: REGISTRAR, MUSENAME_L2_REGISTRY: L2_REGISTRY },
  });
}

interface FakeChain extends ChainReader {
  taken: Set<string>;
  registrations: Array<{ label: string; owner: Address }>;
  failNext: boolean;
}

function fakeChain(): FakeChain {
  const taken = new Set<string>();
  const registrations: Array<{ label: string; owner: Address }> = [];
  const chain: FakeChain = {
    taken,
    registrations,
    failNext: false,
    async listNames() {
      return [];
    },
    async isLabelAvailable(label) {
      return !taken.has(label);
    },
    async getOwner(label) {
      return taken.has(label) ? ownerAccount.address : null;
    },
    async register({ label, owner }) {
      if (chain.failNext) throw new Error('rpc exploded');
      if (taken.has(label)) throw new Error('taken');
      taken.add(label);
      registrations.push({ label, owner });
      return { txHash: `0x${'ab'.repeat(32)}` as Hex, node: `0x${'cd'.repeat(32)}` as Hex };
    },
  };
  return chain;
}

const FIXED_NOW = new Date('2026-09-29T00:00:00.000Z');

function buildApp(overrides: Partial<MusenameDeps> = {}, config = testConfig()) {
  const repos = createMemoryRepos();
  const deps: MusenameDeps = {
    config,
    reservedIndex: buildReservedIndex(config.reserved),
    chain: fakeChain(),
    names: repos.names,
    requests: repos.requests,
    cards: repos.cards,
    sponsorship: repos.sponsorship,
    invitationClaims: repos.invitationClaims,
    indexKind: 'memory',
    clock: () => FIXED_NOW,
    ...overrides,
  };
  return { app: createApp(deps), deps };
}

async function signClaim(label: string, config: MusenameConfig, deadlineSeconds: number) {
  const domain = buildEip712Domain({
    productName: config.brand.productName,
    chainId: config.chains.l2.chainId,
    verifyingContract: REGISTRAR,
  });
  const message = registerMessage({
    label,
    owner: ownerAccount.address,
    deadline: BigInt(deadlineSeconds),
  });
  const signature = await ownerAccount.signTypedData({
    domain,
    types: REGISTER_TYPES,
    primaryType: 'Register',
    message,
  });
  return { signature, message };
}


/** The service is "unconfigured" when the addresses are blank, not when the
 *  config file is missing them — the real config now carries them. */
function withoutAddresses(config: MusenameConfig): MusenameConfig {
  return {
    ...config,
    chains: {
      ...config.chains,
      l2: { ...config.chains.l2, l2Registry: '', registrar: '' },
    },
  };
}

const futureSeconds = Math.floor(FIXED_NOW.getTime() / 1000) + 600;
const pastSeconds = Math.floor(FIXED_NOW.getTime() / 1000) - 600;

describe('GET /healthz', () => {
  it('reports readiness', async () => {
    const { app } = buildApp();
    const response = await app.request('/healthz');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.registrarConfigured).toBe(true);
  });
});

describe('GET /v1/config', () => {
  it('publishes the brand, chain and prices the front end needs', async () => {
    const { app } = buildApp();
    const body = await (await app.request('/v1/config')).json();

    expect(body.data.productName).toBe('MusePass');
    expect(body.data.rootName).toBe('musepass.eth');
    expect(body.data.siteUrl).toBe(SITE_URL);
    expect(body.data.chain.chainId).toBe(4663);
    expect(body.data.registrar).toBe(REGISTRAR);
    expect(body.data.legalDisclaimer.zh).toContain('Meta');
  });

  it('gives the front end everything the EIP-712 domain needs', async () => {
    const { app } = buildApp();
    const body = await (await app.request('/v1/config')).json();
    expect(body.data.productName).toBeTruthy();
    expect(body.data.chain.chainId).toBeTruthy();
    expect(body.data.registrar).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('does not let the front end promise unbuilt features', async () => {
    const { app } = buildApp();
    const body = await (await app.request('/v1/config')).json();
    expect(body.data.features).toEqual({
      cards: false,
      trackRecord: false,
      premiumPurchase: false,
      aiRegistration: true,
    });
  });

  it('reports the decided certification price and the free tier threshold', async () => {
    const { app } = buildApp();
    const body = await (await app.request('/v1/config')).json();
    expect(body.data.pricing.certificationMonthlyUsd).toBe(5);
    expect(body.data.pricing.freeMinUnits).toBe(5);
    expect(body.data.pricing.lengthMetric).toBe('display-width');
  });
});

describe('browser access', () => {
  it('answers a preflight from an allowed origin', async () => {
    const { app } = buildApp();
    const response = await app.request('/v1/names/aguang/available', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'GET',
      },
    });
    expect(response.status).toBeLessThan(300);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });

  it('does not hand an unknown origin a CORS grant', async () => {
    const { app } = buildApp();
    const response = await app.request('/v1/names/aguang/available', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'GET',
      },
    });
    expect(response.headers.get('access-control-allow-origin')).not.toBe('https://evil.example');
  });

  it('allows the configured site origin', async () => {
    const { app } = buildApp();
    const response = await app.request('/v1/names/aguang/available', {
      method: 'OPTIONS',
      headers: {
        origin: SITE_URL,
        'access-control-request-method': 'GET',
      },
    });
    expect(response.headers.get('access-control-allow-origin')).toBe(SITE_URL);
  });
});

describe('GET /v1/names/{name}/available', () => {
  it('accepts a free name and leads with a plain language summary', async () => {
    const { app } = buildApp();
    const response = await app.request('/v1/names/aguang/available');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary.zh).toContain('可以用');
    expect(body.data.available).toBe(true);
    expect(body.data.price.tier).toBe('free');
    expect(body.meta.verified).toBe(true);
  });

  it('accepts the fully qualified name as well as the label', async () => {
    const { app } = buildApp();
    const response = await app.request('/v1/names/aguang.musepass.eth/available');
    const body = await response.json();
    expect(body.data.label).toBe('aguang');
    expect(body.data.fullName).toBe('aguang.musepass.eth');
  });

  it('reports a reserved name with a reason instead of a bare failure', async () => {
    const { app } = buildApp();
    const response = await app.request('/v1/names/admin/available');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.available).toBe(false);
    expect(body.errors.map((error: { code: string }) => error.code)).toContain('RESERVED_NAME');
    expect(body.data.reserved.category).toBe('system');
    expect(body.data.reserved.appealable).toBe(true);
  });

  it('offers suggestions that themselves pass policy', async () => {
    const { app } = buildApp();
    const response = await app.request('/v1/names/aguang/available');
    const chain = fakeChain();
    chain.taken.add('aguang');
    const takenApp = createApp({
      ...buildApp().deps,
      chain,
    });
    const takenBody = await (await takenApp.request('/v1/names/aguang/available')).json();

    expect((await response.json()).data.available).toBe(true);
    expect(takenBody.data.available).toBe(false);
    expect(takenBody.data.suggestions.length).toBe(3);
    for (const suggestion of takenBody.data.suggestions) {
      expect(suggestion).not.toBe('aguang');
      expect(suggestion).not.toContain('admin');
    }
  });

  it('explains why a short name cannot be claimed for free', async () => {
    const { app } = buildApp();
    const body = await (await app.request('/v1/names/abc/available')).json();
    expect(body.errors.map((error: { code: string }) => error.code)).toContain('NOT_FREE_TIER');
  });

  it('says an invited wallet may take a 4 character name, with ?owner=', async () => {
    const config = testConfig();
    config.invitations.invitations.push({
      wallet: ownerAccount.address,
      issuedBy: 'test',
      issuedAt: '2026-09-30',
      claimedAt: null,
      claimedLabel: null,
      txHash: null,
    });
    const { app } = buildApp({ config });

    const body = await (
      await app.request(`/v1/names/gold/available?owner=${ownerAccount.address}`)
    ).json();

    expect(body.data.available).toBe(true);
    expect(body.data.invited).toBe(true);
    expect(body.data.price.tier).toBe('free');
    expect(body.data.price.priceUsd).toBe(0);
  });

  it('says a wallet without an invitation may not, with ?owner=', async () => {
    const { app } = buildApp();

    const body = await (
      await app.request(`/v1/names/gold/available?owner=${ownerAccount.address}`)
    ).json();

    expect(body.data.invited).toBe(false);
    expect(body.errors.map((error: { code: string }) => error.code)).toContain('NOT_FREE_TIER');
  });

  it('rejects a malformed owner query instead of guessing', async () => {
    const { app } = buildApp();
    const response = await app.request('/v1/names/gold/available?owner=0x1234');
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors[0].code).toBe('BAD_OWNER');
  });

  it('rejects names with disallowed characters', async () => {
    const { app } = buildApp();
    const body = await (await app.request('/v1/names/hello%20world/available')).json();
    expect(body.data.policyOk).toBe(false);
    expect(body.errors.map((error: { code: string }) => error.code)).toContain('INVALID_CHARACTER');
  });
});

describe('GET /v1/invitations', () => {
  it('publishes counts, never the list', async () => {
    const { app } = buildApp();
    const body = await (await app.request('/v1/invitations')).json();

    expect(body.data.issued).toBe(3);
    expect(body.data.claimed).toBe(0);
    expect(body.data.remaining).toBe(3);
    expect(body.data.claimsSource).toBe('memory');
    // The one thing this endpoint must not do: name a wallet or a handle.
    expect(JSON.stringify(body)).not.toContain('d2b294');
  });

  it('counts a spent invitation after a successful invited claim', async () => {
    const config = testConfig();
    config.invitations.invitations.push({
      wallet: ownerAccount.address,
      issuedBy: 'test',
      issuedAt: '2026-09-30',
      claimedAt: null,
      claimedLabel: null,
      txHash: null,
    });
    const { app, deps } = buildApp({ config });
    const { signature } = await signClaim('gold', config, futureSeconds);
    await app.request('/v1/names/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'gold',
        owner: ownerAccount.address,
        deadline: futureSeconds,
        signature,
      }),
    });

    const body = await (await app.request('/v1/invitations')).json();
    expect(body.data.issued).toBe(4);
    expect(body.data.claimed).toBe(1);
    expect(body.data.remaining).toBe(3);

    // And a claim recorded outside the config file still counts.
    await deps.invitationClaims.markClaimed({
      wallet: '0xd2b294fbe4b6710cf00c4d15a3e8857de12be344',
      claimedLabel: 'tst1',
      txHash: null,
      claimedAt: new Date(),
    });
    const after = await (await app.request('/v1/invitations')).json();
    expect(after.data.claimed).toBe(2);
  });
});

describe('POST /v1/names/claim', () => {
  it('issues the name to the signer and records the sponsorship', async () => {
    const { app, deps } = buildApp();
    const { signature } = await signClaim('aguang', deps.config, futureSeconds);

    const response = await app.request('/v1/names/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'aguang',
        owner: ownerAccount.address,
        deadline: futureSeconds,
        signature,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.owner).toBe(ownerAccount.address);
    expect(body.data.txHash).toBe(`0x${'ab'.repeat(32)}`);
    expect(body.summary.zh).toContain('现在是你的了');
    expect((deps.chain as FakeChain).registrations).toEqual([
      { label: 'aguang', owner: ownerAccount.address },
    ]);
  });

  it('rejects a signature from a different wallet', async () => {
    const { app, deps } = buildApp();
    const { signature } = await signClaim('aguang', deps.config, futureSeconds);

    const response = await app.request('/v1/names/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'aguang',
        owner: sponsorAccount.address,
        deadline: futureSeconds,
        signature,
      }),
    });

    expect(response.status).toBe(401);
  });

  it('rejects a replayed signature after the deadline', async () => {
    const { app, deps } = buildApp();
    const { signature } = await signClaim('aguang', deps.config, pastSeconds);

    const response = await app.request('/v1/names/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'aguang',
        owner: ownerAccount.address,
        deadline: pastSeconds,
        signature,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.errors[0].code).toBe('EXPIRED');
  });

  it('rejects a signature given for another label', async () => {
    const { app, deps } = buildApp();
    const { signature } = await signClaim('aguang', deps.config, futureSeconds);

    const response = await app.request('/v1/names/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'different',
        owner: ownerAccount.address,
        deadline: futureSeconds,
        signature,
      }),
    });

    expect(response.status).toBe(401);
  });

  it('refuses reserved names', async () => {
    const { app, deps } = buildApp();
    const { signature } = await signClaim('admin', deps.config, futureSeconds);

    const response = await app.request('/v1/names/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'admin',
        owner: ownerAccount.address,
        deadline: futureSeconds,
        signature,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.errors.map((error: { code: string }) => error.code)).toContain('RESERVED_NAME');
  });

  it('refuses a name that is already taken', async () => {
    const config = testConfig();
    const chain = fakeChain();
    chain.taken.add('aguang');
    const { app } = buildApp({ chain, config });
    const { signature } = await signClaim('aguang', config, futureSeconds);

    const response = await app.request('/v1/names/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'aguang',
        owner: ownerAccount.address,
        deadline: futureSeconds,
        signature,
      }),
    });

    expect(response.status).toBe(409);
  });

  // D17: three and four character names exist only through an invitation, and
  // one invitation is ever worth one name.
  function invitedConfig(): MusenameConfig {
    const config = testConfig();
    return {
      ...config,
      invitations: {
        ...config.invitations,
        invitations: [
          ...config.invitations.invitations,
          {
            wallet: ownerAccount.address,
            issuedBy: 'test',
            issuedAt: '2026-09-30',
            claimedAt: null,
            claimedLabel: null,
            txHash: null,
          },
        ],
      },
    };
  }

  it('refuses a 4 character name to a wallet without an invitation', async () => {
    const { app, deps } = buildApp();
    const { signature } = await signClaim('abcd', deps.config, futureSeconds);

    const response = await app.request('/v1/names/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'abcd',
        owner: ownerAccount.address,
        deadline: futureSeconds,
        signature,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.errors[0].code).toBe('NOT_INVITED');
    expect((deps.chain as FakeChain).registrations).toHaveLength(0);
  });

  it('issues a 4 character name to an invited wallet and spends the invitation', async () => {
    const config = invitedConfig();
    const { app, deps } = buildApp({ config });
    const first = await signClaim('gold', config, futureSeconds);

    const response = await app.request('/v1/names/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'gold',
        owner: ownerAccount.address,
        deadline: futureSeconds,
        signature: first.signature,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.label).toBe('gold');
    expect(body.data.tier).toBe('free');
    expect((deps.chain as FakeChain).registrations).toEqual([
      { label: 'gold', owner: ownerAccount.address },
    ]);

    // Same wallet, another short name: the invitation is gone.
    const second = await signClaim('iron', config, futureSeconds);
    const again = await app.request('/v1/names/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'iron',
        owner: ownerAccount.address,
        deadline: futureSeconds,
        signature: second.signature,
      }),
    });
    const againBody = await again.json();

    expect(again.status).toBe(409);
    expect(againBody.errors[0].code).toBe('ALREADY_CLAIMED');
    expect((deps.chain as FakeChain).registrations).toHaveLength(1);

    const claim = await deps.invitationClaims.findByWallet(ownerAccount.address);
    expect(claim?.claimedLabel).toBe('gold');
    expect(claim?.txHash).toBe(`0x${'ab'.repeat(32)}`);
  });

  it('refuses a 2 character name even to an invited wallet', async () => {
    const config = invitedConfig();
    const { app } = buildApp({ config });
    const { signature } = await signClaim('ab', config, futureSeconds);

    const response = await app.request('/v1/names/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'ab',
        owner: ownerAccount.address,
        deadline: futureSeconds,
        signature,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.errors[0].code).toBe('PROJECT_RESERVED');
  });

  it('is idempotent for the same owner', async () => {
    const { app, deps } = buildApp();
    const { signature } = await signClaim('aguang', deps.config, futureSeconds);
    const payload = JSON.stringify({
      label: 'aguang',
      owner: ownerAccount.address,
      deadline: futureSeconds,
      signature,
    });
    const headers = { 'content-type': 'application/json' };

    const first = await app.request('/v1/names/claim', { method: 'POST', headers, body: payload });
    const second = await app.request('/v1/names/claim', { method: 'POST', headers, body: payload });
    const body = await second.json();

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(body.data.alreadyRegistered).toBe(true);
    expect((deps.chain as FakeChain).registrations).toHaveLength(1);
  });

  it('enforces the per wallet free name limit', async () => {
    const { app, deps } = buildApp();
    await deps.names.insert({
      label: 'existing',
      fullName: 'existing.musepass.eth',
      normalized: 'existing',
      ownerAddress: ownerAccount.address,
      tier: 'free',
      status: 'active',
      registeredVia: 'web',
      agentHost: null,
      txHash: null,
    });
    const { signature } = await signClaim('aguang2', deps.config, futureSeconds);

    const response = await app.request('/v1/names/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'aguang2',
        owner: ownerAccount.address,
        deadline: futureSeconds,
        signature,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.errors.map((error: { code: string }) => error.code)).toContain('QUOTA_EXCEEDED');
  });

  it('returns a clear error when the chain call fails, and mints nothing', async () => {
    const chain = fakeChain();
    chain.failNext = true;
    const { app, deps } = buildApp({ chain });
    const { signature } = await signClaim('aguang', deps.config, futureSeconds);

    const response = await app.request('/v1/names/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'aguang',
        owner: ownerAccount.address,
        deadline: futureSeconds,
        signature,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.errors[0].code).toBe('CHAIN_ERROR');
    expect(chain.registrations).toHaveLength(0);
  });

  it('rejects a malformed body', async () => {
    const { app } = buildApp();
    const response = await app.request('/v1/names/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'aguang' }),
    });
    expect(response.status).toBe(400);
  });

  it('reports a clear 503 while the registrar is unconfigured', async () => {
    const { app } = buildApp({ config: withoutAddresses(testConfig()) });
    const response = await app.request('/v1/names/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'aguang' }),
    });
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.errors[0].code).toBe('NOT_CONFIGURED');
  });

  it('rate limits repeated claims from one wallet', async () => {
    const config = testConfig();
    const chain = fakeChain();
    const { app } = buildApp({ chain, config });

    let lastStatus = 0;
    for (let index = 0; index < 7; index += 1) {
      const label = `user${index}`;
      const { signature } = await signClaim(label, config, futureSeconds);
      const response = await app.request('/v1/names/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label,
          owner: ownerAccount.address,
          deadline: futureSeconds,
          signature,
        }),
      });
      lastStatus = response.status;
      if (lastStatus === 429) break;
    }
    expect(lastStatus).toBe(429);
  });
});

describe('GET /v1/names/{name}', () => {
  it('404s for a name that is not registered', async () => {
    const { app } = buildApp();
    const response = await app.request('/v1/names/aguang');
    const body = await response.json();
    expect(response.status).toBe(404);
    expect(body.data.owner).toBeNull();
  });

  it('returns the owner and never invents a card or track record', async () => {
    const chain = fakeChain();
    chain.taken.add('aguang');
    const { app } = buildApp({ chain });
    const response = await app.request('/v1/names/aguang');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.owner).toBe(ownerAccount.address);
    expect(body.data.card).toBeNull();
    expect(body.data.trackRecord).toBeNull();
  });
});

describe('unknown routes', () => {
  it('returns a friendly 404', async () => {
    const { app } = buildApp();
    const response = await app.request('/nope');
    expect(response.status).toBe(404);
  });
});

beforeEach(() => {
  // Nothing global to reset yet; keeps the shape ready for the Postgres repo.
});

describe('GET /v1/names?owner=', () => {
  it('lists the names a wallet holds, from the chain events', async () => {
    const { app } = buildApp();
    const response = await app.request(`/v1/names?owner=${ownerAccount.address}`);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.owner.toLowerCase()).toBe(ownerAccount.address.toLowerCase());
    expect(Array.isArray(body.data.names)).toBe(true);
  });

  it('refuses a wallet address it cannot read', async () => {
    const { app } = buildApp();
    const response = await app.request('/v1/names?owner=not-an-address');
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.errors[0].code).toBe('BAD_OWNER');
  });

  it('says nothing was found rather than failing, for a wallet with no names', async () => {
    const { app } = buildApp();
    const response = await app.request('/v1/names?owner=0x1111111111111111111111111111111111111111');
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.count).toBe(0);
    expect(body.summary.en).toContain('does not hold a name');
  });
});
