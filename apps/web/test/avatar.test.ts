/**
 * The default avatar exists so that "image is required" — which is the
 * ERC-8004 standard's rule, not ours — cannot stop somebody from publishing a
 * card. Three properties matter: it is accepted by the card validator, it is the
 * same every time for a given name, and it does not point at a host.
 */
import { describe, expect, it } from 'vitest';
import { validateCard, ERC8004_CARD_TYPE } from '@musename/core';

import { defaultAvatarDataUri, looksLikeImage } from '../lib/avatar';

describe('the default avatar', () => {
  it('is a self-contained image, not a link to a host', () => {
    const uri = defaultAvatarDataUri('peter');
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(looksLikeImage(uri)).toBe(true);
  });

  it('is the same every time for the same name', () => {
    expect(defaultAvatarDataUri('peter')).toBe(defaultAvatarDataUri('peter'));
    expect(defaultAvatarDataUri('PETER')).toBe(defaultAvatarDataUri('peter'));
    expect(defaultAvatarDataUri('peter')).not.toBe(defaultAvatarDataUri('sarah'));
  });

  it('produces a card the validator accepts, which is the whole point', () => {
    const result = validateCard({
      type: ERC8004_CARD_TYPE,
      name: 'peter.musepass.eth',
      description: 'An AI that answers the phone.',
      image: defaultAvatarDataUri('peter'),
      x402Support: false,
      active: true,
      services: [],
      registrations: [],
    });
    expect(result.ok).toBe(true);
  });

  it('still tells the truth about what the card requires', () => {
    const result = validateCard({
      type: ERC8004_CARD_TYPE,
      name: 'peter.musepass.eth',
      description: 'An AI that answers the phone.',
      x402Support: false,
      active: true,
      services: [],
      registrations: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('image is required');
  });
});
