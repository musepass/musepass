import { describe, expect, it } from 'vitest';
import { FALLBACK_CONFIG, type NameData } from '../lib/api.js';
import { buildProfileJsonLd, serializeJsonLd } from '../lib/profileJsonLd.js';

const base: NameData = {
  label: 'xiaoming',
  fullName: 'xiaoming.musepass.eth',
  owner: '0x603b8B1f7a0Bc152b7D0Dcd7bFfBF1f2Af115f6d',
  card: { description: 'An AI that shoots wedding photos' },
  trackRecord: null,
};

describe('name page structured data', () => {
  it('identifies the page and the entity behind it', () => {
    const jsonLd = buildProfileJsonLd(base, FALLBACK_CONFIG);
    expect(jsonLd['@type']).toBe('ProfilePage');
    expect(jsonLd.url).toBe('https://musename.xyz/name/xiaoming');
    expect(jsonLd.mainEntity).toMatchObject({
      '@type': 'Thing',
      name: 'xiaoming.musepass.eth',
      identifier: 'eip155:4663:0x603b8B1f7a0Bc152b7D0Dcd7bFfBF1f2Af115f6d',
    });
    expect(jsonLd.isBasedOn).toBe('https://musename.xyz/.well-known/musename.json');
  });

  it('only carries fields the card already publishes', () => {
    const withHidden = {
      ...base,
      card: { description: 'A public description' },
    };
    const serialized = serializeJsonLd(buildProfileJsonLd(withHidden, FALLBACK_CONFIG));
    expect(serialized).toContain('A public description');
    // These were never published, so they cannot appear anywhere in the markup.
    for (const hidden of ['contact', 'payoutAddress', 'host', 'x402Support']) {
      expect(serialized).not.toContain(hidden);
    }
  });

  it('omits the identifier when nobody owns the name', () => {
    const jsonLd = buildProfileJsonLd({ ...base, owner: null, card: null }, FALLBACK_CONFIG);
    expect(jsonLd.mainEntity.identifier).toBeUndefined();
    expect(jsonLd.mainEntity.description).toBeUndefined();
  });

  it('cannot break out of the script tag', () => {
    const nasty = buildProfileJsonLd(
      { ...base, card: { description: '</script><script>alert(1)</script>' } },
      FALLBACK_CONFIG,
    );
    const serialized = serializeJsonLd(nasty);
    expect(serialized).not.toContain('</script>');
    expect(serialized).toContain('\\u003c/script');
    // It is still valid JSON, which is what a crawler needs.
    expect(JSON.parse(serialized).mainEntity.description).toContain('alert(1)');
  });
});
