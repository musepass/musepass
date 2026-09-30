/**
 * The reverse record is the difference between a wallet showing a name and
 * showing hex, and it is written by a transaction only the owner can send. So
 * the calldata and the "should we even offer this" rules are worth pinning.
 */
import { decodeFunctionData, keccak256, namehash, toHex } from 'viem';
import { describe, expect, it } from 'vitest';

import {
  REVERSE_REGISTRAR,
  REVERSE_REGISTRAR_ABI,
  describePrimaryName,
  reverseNodeFor,
  setNameCalldata,
} from '../lib/primaryName';

const OWNER = '0x603b8B1f7a0Bc152b7D0Dcd7bFfBF1f2Af115f6d' as const;
const OTHER = '0x1111111111111111111111111111111111111111' as const;
const FULL_NAME = 'xiaoming.musename.eth';

describe('setName calldata', () => {
  it('uses the reverse registrar and the plain setName(string)', () => {
    expect(REVERSE_REGISTRAR).toBe('0xa58E81fe9b61B5c3fE2AFD33CF304c454AbFc7Cb');
    const data = setNameCalldata(FULL_NAME);
    expect(data.startsWith('0xc47f0027')).toBe(true); // setName(string)
    expect(keccak256(toHex('setName(string)')).slice(0, 10)).toBe('0xc47f0027');
    const decoded = decodeFunctionData({ abi: REVERSE_REGISTRAR_ABI, data });
    expect(decoded.args).toEqual([FULL_NAME]);
  });

  it('targets <address>.addr.reverse', () => {
    expect(reverseNodeFor(OWNER)).toBe(namehash('603b8b1f7a0bc152b7d0dcd7bffbf1f2af115f6d.addr.reverse'));
  });
});

describe('whether to offer the button', () => {
  it('offers it, with a reason, when the owner is connected and nothing is set', () => {
    const prompt = describePrimaryName({
      connected: OWNER,
      owner: OWNER,
      fullName: FULL_NAME,
      currentPrimary: null,
    });
    expect(prompt.offer).toBe(true);
    expect(prompt.actionable).toBe(true);
    expect(prompt.message).toContain('hex address');
  });

  it('will not pretend a different wallet can set it', () => {
    const prompt = describePrimaryName({
      connected: OTHER,
      owner: OWNER,
      fullName: FULL_NAME,
      currentPrimary: null,
    });
    expect(prompt.offer).toBe(true);
    expect(prompt.actionable).toBe(false);
    expect(prompt.message).toContain(OWNER);
  });

  it('says so when the visitor has not connected anything', () => {
    const prompt = describePrimaryName({
      connected: null,
      owner: OWNER,
      fullName: FULL_NAME,
      currentPrimary: null,
    });
    expect(prompt.actionable).toBe(false);
    expect(prompt.message).toContain(OWNER);
  });

  it('is done when the reverse record already points here', () => {
    const prompt = describePrimaryName({
      connected: OWNER,
      owner: OWNER,
      fullName: FULL_NAME,
      currentPrimary: FULL_NAME,
    });
    expect(prompt.done).toBe(true);
    expect(prompt.offer).toBe(false);
  });

  it('offers to replace a different primary name', () => {
    const prompt = describePrimaryName({
      connected: OWNER,
      owner: OWNER,
      fullName: FULL_NAME,
      currentPrimary: 'something-else.eth',
    });
    expect(prompt.actionable).toBe(true);
    expect(prompt.message).toContain('something-else.eth');
  });
});
