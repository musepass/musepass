/**
 * A default avatar for a name card.
 *
 * ERC-8004 marks `image` as required, so a card without one is invalid — and
 * asking somebody to go and find an image URL before they can describe their own
 * AI is friction we introduced, not the spec. This generates one instead: a
 * deterministic SVG (same name, same avatar) inlined as a data URI, so the card
 * never depends on a host that might disappear.
 *
 * It lives in core because three places need the same answer: the web editor's
 * button, the draft a fresh name starts with, and the MCP tool an AI calls. Two
 * implementations would eventually disagree, and a card is meant to be verifiable.
 */

/** FNV-1a, 32 bit: stable across runs and platforms. */
function hash(input: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Base64 of a UTF-8 string, without Buffer or btoa.
 *
 * Buffer does not exist in the browser and btoa mangles anything above U+007F,
 * and this runs in client components — so the encoder is here, thirty lines, no
 * runtime assumptions.
 */
function base64Utf8(text: string): string {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }

  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    out += BASE64[a >> 2];
    out += BASE64[((a & 0x03) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : BASE64[((b & 0x0f) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : BASE64[c & 0x3f];
  }
  return out;
}

export function defaultAvatarDataUri(label: string): string {
  const seed = hash(label.toLowerCase());
  const hue = seed % 360;
  const second = (hue + 40) % 360;
  const initials = label.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'MN';

  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    `<stop offset="0%" stop-color="hsl(${hue} 62% 42%)"/>` +
    `<stop offset="100%" stop-color="hsl(${second} 58% 26%)"/>` +
    '</linearGradient></defs>' +
    '<rect width="256" height="256" fill="url(#g)"/>' +
    '<text x="128" y="166" font-family="monospace" font-size="104" font-weight="600" ' +
    `fill="#ffffff" text-anchor="middle">${initials}</text>` +
    '</svg>';

  return `data:image/svg+xml;base64,${base64Utf8(svg)}`;
}

/** True for the image shapes the card validator accepts. */
export function looksLikeImage(value: string): boolean {
  return /^(https?:\/\/|ipfs:\/\/|data:image\/)/.test(value.trim());
}
