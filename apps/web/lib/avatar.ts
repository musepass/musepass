/**
 * A default avatar, so "image is required" never blocks a card.
 *
 * ERC-8004 marks `image` as a required field. That is the spec's call, and this
 * project follows it — but requiring a person to go and find an image URL before
 * they can describe their own AI is friction we introduced, not the spec.
 *
 * So the editor can offer this: a deterministic SVG, generated from the name,
 * inlined as a data URI. Deterministic means the same name always gets the same
 * avatar, and a data URI means the card does not depend on a host that might
 * disappear — which is the same reason cards themselves are stored inline.
 */

/** FNV-1a, 32 bit: small, stable across runs, and enough for picking a colour. */
function hash(input: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

export function defaultAvatarDataUri(label: string): string {
  const seed = hash(label.toLowerCase());
  const hue = seed % 360;
  const second = (hue + 40) % 360;
  const initials = label.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'MN';

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="hsl(${hue} 62% 42%)"/>` +
    `<stop offset="100%" stop-color="hsl(${second} 58% 26%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="256" height="256" fill="url(#g)"/>` +
    `<text x="128" y="166" font-family="IBM Plex Mono, monospace" font-size="104" font-weight="600" ` +
    `fill="#ffffff" text-anchor="middle">${initials}</text>` +
    `</svg>`;

  // base64 keeps the URI free of characters that would need escaping inside a
  // JSON card, and Buffer exists on the server and in the browser build alike.
  const encoded = Buffer.from(svg, 'utf8').toString('base64');
  return `data:image/svg+xml;base64,${encoded}`;
}

/** True for the shapes the card validator accepts as an image. */
export function looksLikeImage(value: string): boolean {
  return /^(https?:\/\/|ipfs:\/\/|data:image\/)/.test(value.trim());
}
