/**
 * The default avatar is what keeps an ERC-8004 required field from becoming a
 * dead end for a person or an agent. Three things must hold: it is a
 * self-contained image, it is stable for a given name, and it survives the
 * browser (where Buffer does not exist) as well as Node.
 */
import { describe, expect, it } from 'vitest';

import { defaultAvatarDataUri, looksLikeImage } from '../src/avatar.js';

/** Decode just enough base64 to prove the payload is the SVG we meant. */
function decodeBase64(value: string): string {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of value) {
    if (char === '=') break;
    buffer = (buffer << 6) | table.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

describe('defaultAvatarDataUri', () => {
  it('is an inline image, not a link somebody else hosts', () => {
    const uri = defaultAvatarDataUri('peter');
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(looksLikeImage(uri)).toBe(true);
  });

  it('decodes to a real SVG carrying the initials', () => {
    const svg = decodeBase64(defaultAvatarDataUri('peter').split(',')[1]!);
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg).toContain('>PE<');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('is stable per name, and different across names', () => {
    expect(defaultAvatarDataUri('peter')).toBe(defaultAvatarDataUri('peter'));
    expect(defaultAvatarDataUri('PETER')).toBe(defaultAvatarDataUri('peter'));
    expect(defaultAvatarDataUri('peter')).not.toBe(defaultAvatarDataUri('sarah'));
  });

  it('survives a name with no latin letters', () => {
    expect(defaultAvatarDataUri('张三').startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(decodeBase64(defaultAvatarDataUri('张三').split(',')[1]!)).toContain('>MN<');
  });
});
