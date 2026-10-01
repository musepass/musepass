import { describe, expect, it } from 'vitest';
import {
  applyVisibility,
  canonicalJson,
  cardContentHash,
  cardDataUri,
  defaultVisibility,
  envelopeContentHash,
  ERC8004_CARD_TYPE,
  parseCardDataUri,
  validateCard,
  type AgentCard,
} from '../src/card.js';

const validCard: AgentCard = {
  type: ERC8004_CARD_TYPE,
  name: '阿光摄影',
  description: '婚礼与风光摄影，接受档期咨询',
  image: 'ipfs://bafyimage',
  services: [
    { name: 'web', endpoint: 'https://aguang.musename.xyz' },
    { name: 'MCP', endpoint: 'https://mcp.aguang.example/', version: '2025-06-18' },
  ],
  x402Support: false,
  active: true,
  registrations: [],
  supportedTrust: ['reputation'],
  musename: {
    owner: '阿光本人',
    host: 'claude',
    contact: 'aguang@example.com',
    payoutAddress: '0x1111111111111111111111111111111111111111',
    ensName: 'aguang.musepass.eth',
  },
};

describe('validateCard', () => {
  it('accepts a well formed ERC-8004 registration file', () => {
    const result = validateCard(validCard);
    expect(result.ok).toBe(true);
  });

  it('warns when the card has no services or registrations yet', () => {
    const result = validateCard({ ...validCard, services: [], registrations: [] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toHaveLength(2);
  });

  it('requires every mandatory ERC-8004 field', () => {
    const result = validateCard({ type: ERC8004_CARD_TYPE });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('name is required');
      expect(result.errors).toContain('description is required');
      expect(result.errors).toContain('image is required');
      expect(result.errors).toContain('services must be an array');
      expect(result.errors).toContain('registrations must be an array');
    }
  });

  it('rejects a wrong type string', () => {
    const result = validateCard({ ...validCard, type: 'https://example.com/other' });
    expect(result.ok).toBe(false);
  });

  it('rejects a service without an endpoint', () => {
    const result = validateCard({ ...validCard, services: [{ name: 'web' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('services[0].endpoint is required');
  });

  it('rejects non boolean flags', () => {
    const result = validateCard({ ...validCard, active: 'yes' });
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed registration entry', () => {
    const result = validateCard({
      ...validCard,
      registrations: [{ agentId: '1', agentRegistry: 'eip155:8453:0xabc' }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a non object', () => {
    expect(validateCard('nope').ok).toBe(false);
    expect(validateCard(null).ok).toBe(false);
  });
});

describe('visibility', () => {
  it('publishes only the name and the address by default', () => {
    const visibility = defaultVisibility();
    expect(visibility.name).toBe('public');
    expect(visibility.address).toBe('public');
    for (const [field, setting] of Object.entries(visibility)) {
      if (field === 'name' || field === 'address') continue;
      expect(setting).toBe('private');
    }
  });

  it('strips everything the owner has not published', () => {
    const redacted = applyVisibility(
      { card: validCard, ensName: 'aguang.musepass.eth', ownerAddress: '0xabc' },
      defaultVisibility(),
      'public',
    );
    expect(redacted).toEqual({ name: 'aguang.musepass.eth', address: '0xabc' });
    expect(redacted.description).toBeUndefined();
    expect(redacted.contact).toBeUndefined();
  });

  it('unlocks fields the owner marked public', () => {
    const visibility = { ...defaultVisibility(), description: 'public' as const, host: 'public' as const };
    const redacted = applyVisibility(
      { card: validCard, ensName: 'aguang.musepass.eth', ownerAddress: '0xabc' },
      visibility,
      'public',
    );
    expect(redacted.description).toBe(validCard.description);
    expect(redacted.host).toBe('claude');
    expect(redacted.contact).toBeUndefined();
  });

  it('gives certified counterparts access to certified-only fields', () => {
    const visibility = { ...defaultVisibility(), contact: 'certified-only' as const };
    const publicView = applyVisibility(
      { card: validCard, ensName: 'aguang.musepass.eth', ownerAddress: '0xabc' },
      visibility,
      'public',
    );
    const certifiedView = applyVisibility(
      { card: validCard, ensName: 'aguang.musepass.eth', ownerAddress: '0xabc' },
      visibility,
      'certified',
    );
    expect(publicView.contact).toBeUndefined();
    expect(certifiedView.contact).toBe('aguang@example.com');
  });

  it('still returns the identity when there is no card yet', () => {
    const redacted = applyVisibility(
      { card: null, ensName: 'aguang.musepass.eth', ownerAddress: '0xabc' },
      defaultVisibility(),
    );
    expect(redacted).toEqual({ name: 'aguang.musepass.eth', address: '0xabc' });
  });
});

describe('canonicalJson and cardContentHash', () => {
  it('is independent of key order', () => {
    const a = { b: 1, a: [1, { d: 2, c: 3 }] };
    const b = { a: [1, { c: 3, d: 2 }], b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('drops undefined so serializers agree', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('produces the same hash for the same card regardless of key order', () => {
    const reordered = JSON.parse(JSON.stringify({ musename: validCard.musename, ...validCard }));
    expect(cardContentHash(reordered as AgentCard)).toBe(cardContentHash(validCard));
  });

  it('changes the hash when a field changes', () => {
    const changed = { ...validCard, description: 'something else' };
    expect(cardContentHash(changed)).not.toBe(cardContentHash(validCard));
  });

  it('returns a bytes32 hex string', () => {
    expect(cardContentHash(validCard)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('cardDataUri — the on-chain record is the public view, never the card', () => {
  it('writes no private field into the record', () => {
    const record = JSON.parse(
      Buffer.from(cardDataUri(validCard).split(',')[1] ?? '', 'base64').toString('utf8'),
    ) as Record<string, unknown>;
    // Everything except name (and type) is private by default.
    expect(record.name).toBe(validCard.name);
    expect(record.type).toBe(ERC8004_CARD_TYPE);
    expect(record.description).toBeUndefined();
    expect(record.image).toBeUndefined();
    expect(record.contact).toBeUndefined();
    expect(record.payoutAddress).toBeUndefined();
    expect(JSON.stringify(record)).not.toContain(validCard.description);
    expect(JSON.stringify(record)).not.toContain(validCard.musename?.contact ?? '');
    expect(JSON.stringify(record)).not.toContain(validCard.musename?.payoutAddress ?? '');
  });

  it('carries the public fields the owner opted into', () => {
    const card: AgentCard = {
      ...validCard,
      musename: { ...validCard.musename, visibility: { ...defaultVisibility(), description: 'public' } },
    };
    const record = JSON.parse(
      Buffer.from(cardDataUri(card).split(',')[1] ?? '', 'base64').toString('utf8'),
    ) as Record<string, unknown>;
    expect(record.description).toBe(validCard.description);
    // Still no private ones.
    expect(record.image).toBeUndefined();
  });

  it('carries the hash of the whole card and round-trips', () => {
    const parsed = parseCardDataUri(cardDataUri(validCard));
    expect(parsed).not.toBeNull();
    expect(envelopeContentHash(parsed)).toBe(cardContentHash(validCard));
  });

  it('reports null for a legacy record with no envelope marker', () => {
    const legacy = `data:application/json;base64,${Buffer.from(
      canonicalJson(validCard),
    ).toString('base64')}`;
    const parsed = parseCardDataUri(legacy);
    expect(parsed).not.toBeNull();
    expect(envelopeContentHash(parsed)).toBeNull();
  });
});
