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
  /** Labels with a published card, for the genesis cover numbering. */
  cards: Set<string>;
  failNext: boolean;
  /**
   * D19: seeded ERC-20 transfers, standing in for eth_getTransactionReceipt.
   * The keys are tx hashes; a `null` entry means "the node has never seen it".
   */
  payments: Map<Hex, null | {
    status: 'success' | 'reverted';
    token: Address;
    from: Address;
    to: Address;
    amount: bigint;
  }>;
}

function fakeChain(): FakeChain {
  const taken = new Set<string>();
  const registrations: Array<{ label: string; owner: Address }> = [];
  const cards = new Set<string>();
  const payments: FakeChain['payments'] = new Map();
  const chain: FakeChain = {
    taken,
    registrations,
    cards,
    failNext: false,
    payments,
    async listNames() {
      return registrations.map((entry, index) => ({
        ...entry,
        blockNumber: index + 1,
        txHash: `0x${'ab'.repeat(32)}` as Hex,
      }));
    },
    async isLabelAvailable(label) {
      return !taken.has(label);
    },
    async getOwner(label) {
      return taken.has(label) ? ownerAccount.address : null;
    },
    async readText(label, key) {
      return key === 'musename.card' && cards.has(label) ? 'data:application/json,{}' : null;
    },
    async writeText() {
      throw new Error('not used in these tests');
    },
    async register({ label, owner }) {
      if (chain.failNext) throw new Error('rpc exploded');
      if (taken.has(label)) throw new Error('taken');
      taken.add(label);
      registrations.push({ label, owner });
      return { txHash: `0x${'ab'.repeat(32)}` as Hex, node: `0x${'cd'.repeat(32)}` as Hex };
    },
    async verifyPayment(input) {
      const payment = payments.get(input.txHash) ?? null;
      if (!payment) return { ok: false, reason: 'NOT_FOUND' as const };
      if (payment.status !== 'success') return { ok: false, reason: 'REVERTED' as const };
      if (payment.token.toLowerCase() !== input.token.toLowerCase()) {
        return { ok: false, reason: 'WRONG_TOKEN' as const };
      }
      if (payment.from.toLowerCase() !== input.from.toLowerCase()) {
        return { ok: false, reason: 'WRONG_FROM' as const };
      }
      if (payment.to.toLowerCase() !== input.to.toLowerCase()) {
        return { ok: false, reason: 'WRONG_TO' as const };
      }
      if (payment.amount < input.minAmount) return { ok: false, reason: 'INSUFFICIENT' as const };
      return { ok: true, amount: payment.amount, blockNumber: 1 };
    },
  };
  return chain;
}

/** Seeds an on-chain payment and returns its tx hash. Test convenience only. */
function seedPayment(
  chain: FakeChain,
  overrides: Partial<{
    txHash: Hex;
    status: 'success' | 'reverted';
    token: Address;
    from: Address;
    to: Address;
    amount: bigint;
  }> = {},
): Hex {
  const txHash = overrides.txHash ?? (`0x${'ef'.repeat(32)}` as Hex);
  chain.payments.set(txHash, {
    status: 'success',
    token: (testConfig().pricing.purchase?.token ?? '0x5fc5360d0400a0fd4f2af552add042d716f1d168') as Address,
    from: ownerAccount.address,
    to: (testConfig().pricing.purchase?.treasury ?? '0x6bd854c3bdcd0f37dc1c8370d8b0627b8c6fe335') as Address,
    amount: 5_000_000n,
    ...overrides,
  });
  return txHash;
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
    purchases: repos.purchases,
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
  // The live config grows as real invitations go out, so these tests read the
  // count from the same file instead of hardcoding it.
  function issuedIn(config: MusenameConfig): number {
    return config.invitations.invitations.filter((row) => !row.$example).length;
  }

  it('publishes counts, never the list', async () => {
    const { app } = buildApp();
    const body = await (await app.request('/v1/invitations')).json();

    const issued = issuedIn(testConfig());
    expect(body.data.issued).toBe(issued);
    expect(body.data.claimed).toBe(0);
    expect(body.data.remaining).toBe(issued);
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
    expect(body.data.issued).toBe(issuedIn(config));
    expect(body.data.claimed).toBe(1);
    expect(body.data.remaining).toBe(issuedIn(config) - 1);

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

describe('genesis cover', () => {
  it('numbers card-publishing names in registration order, skipping the rest', async () => {
    const chain = fakeChain();
    chain.taken.add('first');
    chain.registrations.push({ label: 'first', owner: ownerAccount.address });
    chain.taken.add('nocard');
    chain.registrations.push({ label: 'nocard', owner: ownerAccount.address });
    chain.taken.add('second');
    chain.registrations.push({ label: 'second', owner: ownerAccount.address });
    chain.cards.add('first');
    chain.cards.add('second');
    const { app } = buildApp({ chain });

    const list = await (await app.request('/v1/genesis')).json();
    expect(list.data.numbered).toEqual([
      { label: 'first', number: 1 },
      { label: 'second', number: 2 },
    ]);

    const first = await (await app.request('/v1/names/first')).json();
    expect(first.data.genesis).toEqual({ number: 1 });

    const skipped = await (await app.request('/v1/names/nocard')).json();
    expect(skipped.data.genesis).toBeNull();
  });

  it('shows no number on a chain error rather than a wrong number', async () => {
    const chain = fakeChain();
    chain.taken.add('first');
    chain.registrations.push({ label: 'first', owner: ownerAccount.address });
    chain.failNext = false;
    const originalList = chain.listNames;
    chain.listNames = async () => {
      throw new Error('rpc exploded');
    };
    const { app } = buildApp({ chain });

    const body = await (await app.request('/v1/names/first')).json();
    expect(body.data.genesis).toBeNull();
    expect(body.data.owner).toBeTruthy();

    chain.listNames = originalList;
  });
});

describe('POST /v1/names/claim', () => {
  it('refuses an uninvited wallet at any label length', async () => {
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

    expect(response.status).toBe(403);
    expect(body.errors[0].code).toBe('NOT_INVITED');
    expect((deps.chain as FakeChain).registrations).toHaveLength(0);
  });

  it('issues the name to an invited wallet and records the sponsorship', async () => {
    const config = invitedConfig();
    const { app, deps } = buildApp({ config });
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
    const config = invitedConfig();
    const { app, deps } = buildApp({ config });
    const { signature } = await signClaim('aguang', config, futureSeconds);
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
    const config = invitedConfig();
    const { app, deps } = buildApp({ config });
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
    const { signature } = await signClaim('aguang2', config, futureSeconds);

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
    const config = invitedConfig();
    const { app, deps } = buildApp({ chain, config });
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
    const config = invitedConfig();
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

/* ------------------------------------------------------------------ */
/* D19: the paid purchase rail                                         */
/* ------------------------------------------------------------------ */

/** The live config ships with purchase.enabled=false; tests switch it on. */
function purchaseConfig(): MusenameConfig {
  const config = testConfig();
  const purchase = config.pricing.purchase!;
  return { ...config, pricing: { ...config.pricing, purchase: { ...purchase, enabled: true } } };
}

describe('POST /v1/names/purchase/quote (D19)', () => {
  it('locks a $5 price for a 4 character name, with no invitation consulted', async () => {
    const { app } = buildApp({}, purchaseConfig());
    const response = await app.request('/v1/names/purchase/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'gold', owner: ownerAccount.address }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.kind).toBe('tier-4');
    expect(body.data.priceUsd).toBe(5);
    // USDG has 6 decimals on Robinhood Chain: $5 = 5,000,000 base units.
    expect(body.data.amountBaseUnits).toBe('5000000');
    expect(body.data.currency).toBe('USDG');
    expect(body.data.quoteId).toBeTruthy();
    expect(body.data.expiresAt).toBeTruthy();
  });

  it('quotes $1 for a second long name on a wallet that already holds one', async () => {
    const config = purchaseConfig();
    const { app, deps } = buildApp({ config });
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

    const response = await app.request('/v1/names/purchase/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'secondname', owner: ownerAccount.address }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.kind).toBe('additional-name');
    expect(body.data.priceUsd).toBe(1);
    expect(body.data.amountBaseUnits).toBe('1000000');
  });

  it('points a first long name back at the free claim flow instead of quoting', async () => {
    const { app } = buildApp({}, purchaseConfig());
    const response = await app.request('/v1/names/purchase/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'aguang', owner: ownerAccount.address }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.errors[0].code).toBe('FREE_NAME_USE_CLAIM');
  });

  it('keeps 1–3 character names off the paid rail too', async () => {
    const { app } = buildApp({}, purchaseConfig());
    for (const label of ['a', 'ab', 'abc']) {
      const response = await app.request('/v1/names/purchase/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label, owner: ownerAccount.address }),
      });
      const body = await response.json();
      expect(response.status).toBe(403);
      expect(body.errors[0].code).toBe('NOT_PURCHASABLE');
    }
  });

  it('answers 503 while purchase is disabled in config', async () => {
    const { app } = buildApp(); // live config: enabled=false
    const quote = await app.request('/v1/names/purchase/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'gold', owner: ownerAccount.address }),
    });
    expect(quote.status).toBe(503);
    expect((await quote.json()).errors[0].code).toBe('PURCHASE_NOT_ENABLED');

    const submit = await app.request('/v1/names/purchase', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'gold',
        owner: ownerAccount.address,
        deadline: futureSeconds,
        signature: '0x' + '00'.repeat(65),
        quoteId: 'irrelevant',
        paymentTxHash: `0x${'ef'.repeat(32)}`,
      }),
    });
    expect(submit.status).toBe(503);
    expect((await submit.json()).errors[0].code).toBe('PURCHASE_NOT_ENABLED');
  });

  it('caps the open quotes one wallet may hold', async () => {
    const { app } = buildApp({}, purchaseConfig());
    // Four-character labels, so each quote is priced instead of 409-ing into
    // the free-first path a 5+ character name would take.
    let lastStatus = 201;
    for (let index = 0; index < 8 && lastStatus === 201; index += 1) {
      const response = await app.request('/v1/names/purchase/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: `g${index}bu`, owner: ownerAccount.address }),
      });
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe('POST /v1/names/purchase (D19)', () => {
  async function buyLabel(
    app: ReturnType<typeof createApp>,
    chain: FakeChain,
    label: string,
    config: MusenameConfig,
    options: {
      paymentOverrides?: Parameters<typeof seedPayment>[2];
      submitLabel?: string;
      paymentTxHash?: Hex;
    } = {},
  ) {
    const quote = await (
      await app.request('/v1/names/purchase/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label, owner: ownerAccount.address }),
      })
    ).json();
    // Sign what will be submitted; the mismatch is between the payload and
    // the quote, not inside the payload itself.
    const { signature } = await signClaim(options.submitLabel ?? label, config, futureSeconds);
    const paymentTxHash =
      options.paymentTxHash ?? seedPayment(chain, options.paymentOverrides ?? {});
    return app.request('/v1/names/purchase', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: options.submitLabel ?? label,
        owner: ownerAccount.address,
        deadline: futureSeconds,
        signature,
        quoteId: quote.data.quoteId,
        paymentTxHash,
      }),
    });
  }

  it('settles an uninvited wallet buying a 4 character name, end to end', async () => {
    const config = purchaseConfig();
    const chain = fakeChain();
    const { app, deps } = buildApp({ chain, config });

    const response = await buyLabel(app, chain, 'gold', config);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.fullName).toBe('gold.musepass.eth');
    expect(body.data.tier).toBe('premium');
    expect(body.data.paid).toBe(true);
    expect(chain.registrations).toEqual([{ label: 'gold', owner: ownerAccount.address }]);
    // Paid purchases never consume sponsorship budget.
    expect(await deps.sponsorship.countForWalletLifetime(ownerAccount.address)).toBe(0);
  });

  it('sells a second long name to a wallet already at its free quota', async () => {
    const config = purchaseConfig();
    const chain = fakeChain();
    const { app, deps } = buildApp({ chain, config });
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

    const response = await buyLabel(app, chain, 'secondname', config, {
      paymentOverrides: { amount: 1_000_000n },
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.label).toBe('secondname');
  });

  it.each([
    ['WRONG_TOKEN', { token: '0x1111111111111111111111111111111111111111' as Address }],
    ['WRONG_FROM', { from: sponsorAccount.address }],
    ['WRONG_TO', { to: sponsorAccount.address }],
    ['INSUFFICIENT', { amount: 4_999_999n }],
    ['REVERTED', { status: 'reverted' as const }],
  ])('refuses a payment that fails verification: %s', async (reason, overrides) => {
    const config = purchaseConfig();
    const chain = fakeChain();
    const { app } = buildApp({ chain, config });

    const response = await buyLabel(app, chain, 'gold', config, { paymentOverrides: overrides });
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.errors[0].code).toBe(`PAYMENT_${reason}`);
    expect(chain.registrations).toHaveLength(0);
  });

  it('treats a payment the node has not seen as retryable, not failed', async () => {
    const config = purchaseConfig();
    const chain = fakeChain();
    const { app } = buildApp({ chain, config });
    const unseen = `0x${'ee'.repeat(32)}` as Hex;

    const response = await buyLabel(app, chain, 'gold', config, { paymentTxHash: unseen });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.errors[0].code).toBe('PAYMENT_NOT_FOUND');
    expect(chain.registrations).toHaveLength(0);
  });

  it('lets one payment buy exactly one name', async () => {
    const config = purchaseConfig();
    const chain = fakeChain();
    const { app } = buildApp({ chain, config });
    const txHash = seedPayment(chain, { amount: 10_000_000n }); // enough for two

    const first = await buyLabel(app, chain, 'gold', config, { paymentTxHash: txHash });
    expect(first.status).toBe(201);

    const second = await buyLabel(app, chain, 'iron', config, { paymentTxHash: txHash });
    const body = await second.json();

    expect(second.status).toBe(409);
    expect(body.errors[0].code).toBe('PAYMENT_ALREADY_USED');
    expect(chain.registrations).toHaveLength(1);
  });

  it('refuses a submit after the quote expired', async () => {
    const config = purchaseConfig();
    const chain = fakeChain();
    let now = FIXED_NOW;
    const { app } = buildApp({ chain, config, clock: () => now });

    const quote = await (
      await app.request('/v1/names/purchase/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'gold', owner: ownerAccount.address }),
      })
    ).json();
    now = new Date(FIXED_NOW.getTime() + 31 * 60 * 1000);
    // The register signature must outlive the 31-minute clock jump below, or
    // the submit dies as EXPIRED (401) before the quote is ever consulted.
    const lateDeadline = futureSeconds + 31 * 60 + 60;
    const { signature } = await signClaim('gold', config, lateDeadline);
    const paymentTxHash = seedPayment(chain);

    const response = await app.request('/v1/names/purchase', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'gold',
        owner: ownerAccount.address,
        deadline: lateDeadline,
        signature,
        quoteId: quote.data.quoteId,
        paymentTxHash,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body.errors[0].code).toBe('EXPIRED');
  });

  it('says the money is at the treasury when the label is taken after payment', async () => {
    const config = purchaseConfig();
    const chain = fakeChain();
    const { app } = buildApp({ chain, config });

    const quote = await (
      await app.request('/v1/names/purchase/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'gold', owner: ownerAccount.address }),
      })
    ).json();
    chain.taken.add('gold'); // someone else registers it before the submit
    const { signature } = await signClaim('gold', config, futureSeconds);

    const response = await app.request('/v1/names/purchase', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'gold',
        owner: ownerAccount.address,
        deadline: futureSeconds,
        signature,
        quoteId: quote.data.quoteId,
        paymentTxHash: seedPayment(chain),
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.errors[0].code).toBe('NAME_TAKEN');
    expect(body.summary.en).toContain('refund');
  });

  it('refuses a submit that does not match its quote', async () => {
    const config = purchaseConfig();
    const chain = fakeChain();
    const { app } = buildApp({ chain, config });

    const response = await buyLabel(app, chain, 'gold', config, { submitLabel: 'iron' });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.errors[0].code).toBe('QUOTE_MISMATCH');
    expect(chain.registrations).toHaveLength(0);
  });

  it('reopens the quote when registration fails, so the same payment can retry', async () => {
    const config = purchaseConfig();
    const chain = fakeChain();
    const { app } = buildApp({ chain, config });

    // First attempt: quote and pay, then the chain breaks on register.
    const quote = await (
      await app.request('/v1/names/purchase/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'gold', owner: ownerAccount.address }),
      })
    ).json();
    const { signature } = await signClaim('gold', config, futureSeconds);
    const paymentTxHash = seedPayment(chain);
    const payload = JSON.stringify({
      label: 'gold',
      owner: ownerAccount.address,
      deadline: futureSeconds,
      signature,
      quoteId: quote.data.quoteId,
      paymentTxHash,
    });
    const headers = { 'content-type': 'application/json' };

    chain.failNext = true;
    const failed = await app.request('/v1/names/purchase', { method: 'POST', headers, body: payload });
    expect(failed.status).toBe(502);

    // Second attempt with the same payment: the quote was reopened.
    chain.failNext = false;
    const retried = await app.request('/v1/names/purchase', { method: 'POST', headers, body: payload });
    expect(retried.status).toBe(201);
    expect(chain.registrations).toHaveLength(1);
  });

  it('is idempotent for an already settled purchase', async () => {
    const config = purchaseConfig();
    const chain = fakeChain();
    const { app } = buildApp({ chain, config });

    const quote = await (
      await app.request('/v1/names/purchase/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'gold', owner: ownerAccount.address }),
      })
    ).json();
    const { signature } = await signClaim('gold', config, futureSeconds);
    const payload = JSON.stringify({
      label: 'gold',
      owner: ownerAccount.address,
      deadline: futureSeconds,
      signature,
      quoteId: quote.data.quoteId,
      paymentTxHash: seedPayment(chain),
    });
    const headers = { 'content-type': 'application/json' };

    const first = await app.request('/v1/names/purchase', { method: 'POST', headers, body: payload });
    const second = await app.request('/v1/names/purchase', { method: 'POST', headers, body: payload });
    const body = await second.json();

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(body.data.alreadyRegistered).toBe(true);
    expect(chain.registrations).toHaveLength(1);
  });
});

describe('GET /v1/config with purchase (D19)', () => {
  it('derives the feature flag and payment block from config', async () => {
    const { app } = buildApp({}, purchaseConfig());
    const body = await (await app.request('/v1/config')).json();

    expect(body.data.features.premiumPurchase).toBe(true);
    expect(body.data.payment).toMatchObject({ currency: 'USDG', tokenDecimals: 6 });
    expect(body.data.pricing.premiumTiers.find((tier: { id: string }) => tier.id === 'tier-4').sellable).toBe(true);
    expect(body.data.pricing.premiumTiers.find((tier: { id: string }) => tier.id === 'tier-3').sellable).toBe(false);
  });

  it('hides the payment block while purchase is disabled', async () => {
    const { app } = buildApp();
    const body = await (await app.request('/v1/config')).json();
    expect(body.data.features.premiumPurchase).toBe(false);
    expect(body.data.payment).toBeNull();
  });
});
