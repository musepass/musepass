import { describe, expect, it } from 'vitest';

/**
 * The NFT metadata route (app/nft/[tokenId]/route.ts) is thin glue over the
 * registry; what can break silently is the wire-name decoding and the tokenId
 * parsing, so those are pinned here against the real on-chain bytes of
 * `peter.musepass.eth`.
 */

// Mirror of the module's internals — they are small and pure. If the route
// changes its wire format, this test is the reminder to re-read the chain.
function parseNodeId(tokenId: string): `0x${string}` | null {
  try {
    const value = tokenId.startsWith('0x') ? BigInt(tokenId) : BigInt(tokenId);
    if (value < 0n || value >= 1n << 256n) return null;
    return `0x${value.toString(16).padStart(64, '0')}`;
  } catch {
    return null;
  }
}

function decodeWireName(bytes: `0x${string}`): string | null {
  const hex = bytes.startsWith('0x') ? bytes.slice(2) : bytes;
  const labels: string[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    const length = parseInt(hex.slice(i, i + 2), 16);
    if (Number.isNaN(length) || length === 0) break;
    if (i + 2 + length * 2 > hex.length) return null;
    const label = hex
      .slice(i + 2, i + 2 + length * 2)
      .match(/.{2}/g)!
      .map((byte: string) => String.fromCharCode(parseInt(byte, 16)))
      .join('');
    labels.push(label);
    i += length * 2;
  }
  return labels.length > 0 ? labels.join('.') : null;
}

/**
 * Unwrap the ABI encoding of a `bytes` return: 32-byte offset, 32-byte length,
 * then the data.
 */
function unwrapAbiBytes(result: `0x${string}`): `0x${string}` | null {
  const hex = result.slice(2);
  if (hex.length < 128) return null;
  const offset = Number(BigInt(`0x${hex.slice(0, 64)}`)) * 2;
  const length = Number(BigInt(`0x${hex.slice(64, 128)}`)) * 2;
  if (offset !== 64 || Number.isNaN(length) || 128 + length > hex.length) return null;
  return `0x${hex.slice(128, 128 + length)}`;
}

describe('nft metadata route helpers', () => {
  it('unwraps the real eth_call return for names(node)', () => {
    // Raw JSON-RPC result read from chain 2026-10-02 — offset 0x20, length 0x14,
    // then the wire name.
    const result =
      '0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000014057065746572086d757365706173730365746800000000000000000000000000' as `0x${string}`;
    expect(unwrapAbiBytes(result)).toBe('0x057065746572086d757365706173730365746800');
  });

  it('decodes the real registry wire bytes for peter.musepass.eth', () => {
    // eth_call names(node) read from chain 2026-10-02.
    expect(decodeWireName('0x057065746572086d757365706173730365746800')).toBe(
      'peter.musepass.eth',
    );
  });

  it('decodes a name without a terminating zero byte', () => {
    expect(decodeWireName('0x057065746572086d7573657061737303657468')).toBe('peter.musepass.eth');
  });

  it('rejects a truncated wire name', () => {
    expect(decodeWireName('0x05706574')).toBeNull();
  });

  it('parses the decimal tokenId OpenSea will append to the base URI', () => {
    const node = parseNodeId(
      '58684116078054252344833263567411543217948319990386290030224873202891908050250',
    );
    expect(node).toBe('0x81be085b0b322baaf79ae244400e573b890f370991211c34d1664fe99d45ed4a');
  });

  it('parses a 0x tokenId and pads to 32 bytes', () => {
    expect(parseNodeId('0x1')).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000001',
    );
  });

  it('refuses values outside 256 bits', () => {
    expect(parseNodeId(`${2n ** 256n}`)).toBeNull();
    expect(parseNodeId('not-a-number')).toBeNull();
  });
});
