import { describe, expect, it } from 'vitest';
import { ERC8004_CARD_TYPE, defaultVisibility } from '@musename/core/browser';
import {
  EDITABLE_FIELDS,
  buildCard,
  draftFromPublished,
  publicFieldCount,
  type CardDraft,
} from '../lib/cardDraft';

const FULL_NAME = 'xiaoming.musename.eth';

function draft(overrides: Partial<CardDraft> = {}): CardDraft {
  return {
    description: '婚礼与风光摄影',
    image: 'ipfs://bafyimage',
    host: 'Claude',
    contact: 'xiaoming@musename.xyz',
    payoutAddress: '',
    services: [{ name: 'web', endpoint: 'https://xiaoming.musename.xyz' }],
    visibility: defaultVisibility(),
    ...overrides,
  };
}

describe('draftFromPublished', () => {
  it('starts empty when nothing is published', () => {
    const result = draftFromPublished(null);
    expect(result.description).toBe('');
    expect(result.services).toEqual([]);
    expect(result.visibility.name).toBe('public');
    expect(result.visibility.description).toBe('private');
  });

  it('seeds only the fields the API could serve', () => {
    const result = draftFromPublished({
      name: FULL_NAME,
      address: '0xabc',
      description: '公开的简介',
      contentHash: '0xdead',
    });
    expect(result.description).toBe('公开的简介');
    // Private fields are absent by design, so they must start blank rather than
    // being invented or carried over from somewhere else.
    expect(result.contact).toBe('');
    expect(result.image).toBe('');
  });
});

describe('buildCard', () => {
  it('produces a valid ERC-8004 document and carries visibility inside it', () => {
    const built = buildCard(draft(), { fullName: FULL_NAME });
    expect(built.ok).toBe(true);
    expect(built.card?.type).toBe(ERC8004_CARD_TYPE);
    expect(built.card?.name).toBe(FULL_NAME);
    expect(built.card?.musename?.visibility).toEqual(draft().visibility);
    expect(built.card?.services).toHaveLength(1);
  });

  it('drops half-filled service rows instead of publishing broken entries', () => {
    const built = buildCard(
      draft({
        services: [
          { name: 'web', endpoint: 'https://ok.example' },
          { name: 'MCP', endpoint: '' },
          { name: '', endpoint: 'https://nameless.example' },
        ],
      }),
      { fullName: FULL_NAME },
    );
    expect(built.card?.services).toEqual([{ name: 'web', endpoint: 'https://ok.example' }]);
  });

  it('refuses a card missing required content, with the reason', () => {
    const built = buildCard(draft({ description: '', image: '' }), { fullName: FULL_NAME });
    expect(built.ok).toBe(false);
    expect(built.errors).toContain('description is required');
    expect(built.errors).toContain('image is required');
    expect(built.card).toBeUndefined();
  });

  it('keeps optional fields out of the document when they are blank', () => {
    const built = buildCard(draft({ host: '', contact: '' }), { fullName: FULL_NAME });
    expect(built.card?.musename?.host).toBeUndefined();
    expect(built.card?.musename?.contact).toBeUndefined();
  });

  it('is deterministic, so the signature always matches the stored bytes', () => {
    const first = buildCard(draft(), { fullName: FULL_NAME });
    const second = buildCard(draft(), { fullName: FULL_NAME });
    expect(JSON.stringify(first.card)).toBe(JSON.stringify(second.card));
  });
});

describe('publicFieldCount', () => {
  it('counts only what a stranger can see', () => {
    // name and address are public by default, everything else is not.
    expect(publicFieldCount(defaultVisibility())).toBe(2);
    expect(
      publicFieldCount({ ...defaultVisibility(), description: 'public', services: 'public' }),
    ).toBe(4);
  });

  it('does not count certified-only fields as public', () => {
    expect(publicFieldCount({ ...defaultVisibility(), contact: 'certified-only' })).toBe(2);
  });
});

describe('EDITABLE_FIELDS', () => {
  it('never includes the fields the owner cannot hide', () => {
    expect(EDITABLE_FIELDS).not.toContain('name');
    expect(EDITABLE_FIELDS).not.toContain('address');
  });
});
