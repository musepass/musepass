import { describe, expect, it } from 'vitest';
import {
  decodeAbiParameters,
  parseAbiParameters,
  recoverAddress,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import {
  decodeStuffedCall,
  encodeGatewayResponse,
  encodeStuffedCall,
  makeSignatureHash,
  signGatewayResponse,
} from '../src/ccipRead.js';

// Public anvil key #1. Test only.
const SIGNER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const signer = privateKeyToAccount(SIGNER_KEY);

// The L1 resolver Durin deploys deterministically to mainnet and Sepolia.
const SENDER = '0x8A968aB9eb8C084FBC44c531058Fc9ef945c3D61' as const;
const EXPIRES = 1790619628n;
const REQUEST: Hex = '0x1234';
const RESULT: Hex = '0xabcd';

/**
 * The same three constants are asserted by contracts/test/SignatureVerifier.t.sol.
 * If the two sides ever drift, every resolution fails with InvalidSignature and
 * looks like a gateway outage, so both suites pin the same bytes.
 */
const EXPECTED_HASH: Hex = '0x986952d68a4090deccd73dc19e90d38484fe5839bbeb390643c6c9aca6a2876c';
const EXPECTED_SIGNATURE: Hex =
  '0x63e6e6b02ea7359800e6c98b12b9ae7af2941176a550028a3272993eb4dcaa1e1b357ca0a7e1f73fc631b08f25a361b45570374051691d7b231092abd42d20651b';

const STUFFED_CALL = {
  name: '0x077869616f6d696e67066d7573656e616d650365746800' as Hex,
  resolveCall: '0x3b3b57de' as Hex,
  targetChainId: 84532n,
  // CHECKSUM_ADDRESS: viem checksums addresses on decode, so the fixture uses
  // the checksummed form to keep the round-trip comparison meaningful.
  targetRegistryAddress: '0xdB0e02b4E3509D72C660241f4069b3a477815Eb9' as const,
};

describe('stuffed call encoding', () => {
  it('round-trips a stuffed resolve call', () => {
    expect(decodeStuffedCall(encodeStuffedCall(STUFFED_CALL))).toEqual(STUFFED_CALL);
  });

  it('starts with the selector the resolver uses', () => {
    // stuffedResolveCall(bytes,bytes,uint64,address)
    expect(encodeStuffedCall(STUFFED_CALL).slice(0, 10)).toBe('0x21759430');
  });
});

describe('signature hash', () => {
  it('matches the vector the Solidity test pins', () => {
    expect(
      makeSignatureHash({ sender: SENDER, expires: EXPIRES, request: REQUEST, result: RESULT }),
    ).toBe(EXPECTED_HASH);
  });

  it('changes when any field changes', () => {
    const base = { sender: SENDER, expires: EXPIRES, request: REQUEST, result: RESULT };
    expect(makeSignatureHash({ ...base, expires: EXPIRES + 1n })).not.toBe(EXPECTED_HASH);
    expect(makeSignatureHash({ ...base, result: '0xabce' as Hex })).not.toBe(EXPECTED_HASH);
    expect(makeSignatureHash({ ...base, request: '0x1235' as Hex })).not.toBe(EXPECTED_HASH);
  });
});

describe('response', () => {
  it('signs deterministically and recovers to the signer', async () => {
    const signature = await signGatewayResponse({
      account: signer,
      sender: SENDER,
      expires: EXPIRES,
      request: REQUEST,
      result: RESULT,
    });
    expect(signature).toBe(EXPECTED_SIGNATURE);
    expect(await recoverAddress({ hash: EXPECTED_HASH, signature })).toBe(signer.address);
  });

  it('encodes as the (result, expires, sig) tuple the resolver decodes', async () => {
    const signature = await signGatewayResponse({
      account: signer,
      sender: SENDER,
      expires: EXPIRES,
      request: REQUEST,
      result: RESULT,
    });
    const decoded = decodeAbiParameters(
      parseAbiParameters('bytes result, uint64 expires, bytes sig'),
      encodeGatewayResponse({ result: RESULT, expires: EXPIRES, signature }),
    ) as [Hex, bigint, Hex];

    expect(decoded[0]).toBe(RESULT);
    expect(decoded[1]).toBe(EXPIRES);
    expect(decoded[2]).toBe(signature);
  });
});
