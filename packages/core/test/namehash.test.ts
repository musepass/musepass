import { describe, expect, it } from 'vitest';
import { dnsEncode, ensip11CoinType, labelhash, makeNode, namehash } from '../src/namehash.js';

// Canonical ENS test vectors.
const ZERO_NODE = '0x0000000000000000000000000000000000000000000000000000000000000000';
const ETH_NODE = '0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae';
const FOO_ETH_NODE = '0xde9b09fd7c5f901e23a3f19fecc54828e9c848539801e86591bd9801b019f84f';
const ETH_LABELHASH = '0x4f5b812789fc606be1b3b16908db13fc7a9adf7ca72641f84d75b47069d3d7f0';

describe('namehash', () => {
  it('hashes the empty name to zero', () => {
    expect(namehash('')).toBe(ZERO_NODE);
  });

  it('matches the canonical eth node', () => {
    expect(namehash('eth')).toBe(ETH_NODE);
  });

  it('matches the canonical foo.eth node', () => {
    expect(namehash('foo.eth')).toBe(FOO_ETH_NODE);
  });

  it('labelhashes the utf-8 bytes of the label', () => {
    expect(labelhash('eth')).toBe(ETH_LABELHASH);
  });
});

describe('makeNode (Durin L2 construction)', () => {
  it('reproduces namehash for a one-level subname', () => {
    // Durin's registry computes keccak256(baseNode || labelhash(label)); it must
    // agree with the ENS namehash wallets use, or resolution silently breaks.
    expect(makeNode(ETH_NODE, 'foo')).toBe(FOO_ETH_NODE);
  });

  it('is stable for a unicode label', () => {
    const node = makeNode(ETH_NODE, '阿光');
    expect(node).toMatch(/^0x[0-9a-f]{64}$/);
    expect(makeNode(ETH_NODE, '阿光')).toBe(node);
  });
});

describe('ensip11CoinType', () => {
  it('sets the high bit for mainnet', () => {
    expect(ensip11CoinType(1)).toBe(2147483649n);
  });

  it('matches base', () => {
    expect(ensip11CoinType(8453)).toBe(2147492101n);
  });

  it('rejects nonsense input', () => {
    expect(() => ensip11CoinType(-1)).toThrow();
    expect(() => ensip11CoinType(1.5)).toThrow();
  });
});

describe('dnsEncode', () => {
  it('encodes a single label', () => {
    expect(dnsEncode('eth')).toBe('0x0365746800');
  });

  it('encodes a two label name', () => {
    expect(dnsEncode('foo.eth')).toBe('0x03666f6f0365746800');
  });

  it('encodes length in bytes for non-ascii labels', () => {
    // 阿光 is 6 utf-8 bytes
    expect(dnsEncode('阿光')).toBe('0x06e998bfe5858900');
  });
});
