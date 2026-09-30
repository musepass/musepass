import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address } from 'viem';
import {
  assertNotExpired,
  buildEip712Domain,
  cardUpdateDigest,
  cardUpdateMessage,
  isExpired,
  REGISTER_TYPES,
  registerDigest,
  registerMessage,
  verifyCardUpdateSignature,
  verifyRegisterSignature,
} from '../src/signature.js';

// A public test key (anvil account #1). Never funded, never used in production.
const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const VERIFYING_CONTRACT = '0x2222222222222222222222222222222222222222' as Address;

const domain = buildEip712Domain({
  productName: 'MusePass',
  chainId: 8453,
  verifyingContract: VERIFYING_CONTRACT,
});

const future = () => BigInt(Math.floor(Date.now() / 1000) + 900);
const past = () => BigInt(Math.floor(Date.now() / 1000) - 900);

describe('buildEip712Domain', () => {
  it('carries the brand name so a rename invalidates old signatures', () => {
    expect(domain.name).toBe('MusePass');
    expect(domain.version).toBe('1');
    expect(domain.chainId).toBe(8453);
    expect(domain.verifyingContract).toBe(VERIFYING_CONTRACT);
  });

  it('rejects an address that is not a contract address', () => {
    expect(() =>
      buildEip712Domain({ productName: 'MusePass', chainId: 8453, verifyingContract: 'nope' as Address }),
    ).toThrow();
  });

  it('honours a config supplied product name', () => {
    const renamed = buildEip712Domain({
      productName: 'BackupName',
      chainId: 8453,
      verifyingContract: VERIFYING_CONTRACT,
    });
    expect(renamed.name).toBe('BackupName');
  });
});

describe('register signature', () => {
  it('verifies a signature from the beneficiary', async () => {
    const message = registerMessage({ label: 'aguang', owner: account.address, deadline: future() });
    const signature = await account.signTypedData({
      domain,
      types: REGISTER_TYPES,
      primaryType: 'Register',
      message,
    });

    await expect(
      verifyRegisterSignature({ address: account.address, signature, domain, message }),
    ).resolves.toBe(true);
  });

  it('rejects a signature replayed for a different label', async () => {
    const message = registerMessage({ label: 'aguang', owner: account.address, deadline: future() });
    const signature = await account.signTypedData({
      domain,
      types: REGISTER_TYPES,
      primaryType: 'Register',
      message,
    });
    const tampered = registerMessage({ label: 'admin', owner: account.address, deadline: future() });

    await expect(
      verifyRegisterSignature({ address: account.address, signature, domain, message: tampered }),
    ).resolves.toBe(false);
  });

  it('rejects a signature that mints to somebody else', async () => {
    const message = registerMessage({ label: 'aguang', owner: account.address, deadline: future() });
    const signature = await account.signTypedData({
      domain,
      types: REGISTER_TYPES,
      primaryType: 'Register',
      message,
    });
    const other = '0x3333333333333333333333333333333333333333' as Address;
    const tampered = registerMessage({ label: 'aguang', owner: other, deadline: future() });

    await expect(
      verifyRegisterSignature({ address: account.address, signature, domain, message: tampered }),
    ).resolves.toBe(false);
  });

  it('rejects an expired signature before checking the math', async () => {
    const message = registerMessage({ label: 'aguang', owner: account.address, deadline: past() });
    const signature = await account.signTypedData({
      domain,
      types: REGISTER_TYPES,
      primaryType: 'Register',
      message,
    });
    await expect(
      verifyRegisterSignature({ address: account.address, signature, domain, message }),
    ).rejects.toThrow(/deadline/);
  });

  it('produces a stable digest', () => {
    const message = registerMessage({ label: 'aguang', owner: account.address, deadline: 1893456000n });
    expect(registerDigest(domain, message)).toBe(registerDigest(domain, message));
    expect(registerDigest(domain, message)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('card update signature', () => {
  const contentHash = `0x${'ab'.repeat(32)}` as const;

  it('verifies a card publish signature', async () => {
    const message = cardUpdateMessage({
      name: 'aguang.musepass.eth',
      contentHash,
      version: 1,
      deadline: future(),
    });
    const signature = await account.signTypedData({
      domain,
      types: {
        CardUpdate: [
          { name: 'name', type: 'string' },
          { name: 'contentHash', type: 'bytes32' },
          { name: 'version', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'CardUpdate',
      message,
    });

    await expect(
      verifyCardUpdateSignature({ address: account.address, signature, domain, message }),
    ).resolves.toBe(true);
  });

  it('changes the digest when the card content changes', () => {
    const base = cardUpdateMessage({ name: 'a.musepass.eth', contentHash, version: 1, deadline: 1n });
    const changed = cardUpdateMessage({
      name: 'a.musepass.eth',
      contentHash: `0x${'cd'.repeat(32)}`,
      version: 1,
      deadline: 1n,
    });
    expect(cardUpdateDigest(domain, base)).not.toBe(cardUpdateDigest(domain, changed));
  });
});

describe('deadline helpers', () => {
  it('compares against a supplied clock', () => {
    expect(isExpired(1000n, 1001n)).toBe(true);
    expect(isExpired(1000n, 999n)).toBe(false);
  });

  it('throws a typed error when expired', () => {
    expect(() => assertNotExpired(past())).toThrow();
    expect(() => assertNotExpired(future())).not.toThrow();
  });
});
