import { concat, keccak256, namehash as viemNamehash, toBytes, toHex, type Hex } from 'viem';

export function labelhash(label: string): Hex {
  return keccak256(toBytes(label));
}

/** ENS namehash. Callers must pass an already ENSIP-15 normalized name. */
export function namehash(name: string): Hex {
  return viemNamehash(name);
}

/**
 * Durin's `makeNode(parentNode, label)`: keccak256(parentNode || labelhash(label)).
 * Same construction the L2 registry uses on chain.
 */
export function makeNode(parentNode: Hex, label: string): Hex {
  return keccak256(concat([parentNode, labelhash(label)]));
}

/** ENSIP-11 coin type for an EVM chain: 0x80000000 | chainId. */
export function ensip11CoinType(chainId: number): bigint {
  if (!Number.isInteger(chainId) || chainId < 0) {
    throw new RangeError(`chainId must be a non-negative integer, received ${chainId}`);
  }
  // Bitwise operators in JS are 32-bit signed, so `0x80000000 | chainId` comes
  // back negative. Do the OR in BigInt.
  return BigInt(0x80000000) | BigInt(chainId);
}

/**
 * DNS wire encoding used by ENS resolvers and CCIP-Read queries.
 * `eth` -> `0x0365746800`
 */
export function dnsEncode(name: string): Hex {
  const labels = name.split('.');
  const parts: Hex[] = [];
  for (const label of labels) {
    if (label.length === 0) throw new RangeError('empty label in name');
    const raw = toBytes(label);
    const bytes = toHex(raw);
    if (raw.length > 255) throw new RangeError(`label too long: ${label}`);
    parts.push(toHex(raw.length, { size: 1 }));
    parts.push(bytes);
  }
  parts.push('0x00');
  return concat(parts);
}
