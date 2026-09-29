/**
 * Waiver signatures (§4).
 *
 * A waiver is an EIP-712 signature by the criteria document's `waiverAuthority`
 * over `Waiver(bytes32 preregistrationId, uint16 obligationIndex, bytes32
 * reasonDigest)`, against a domain that names the registry it belongs to. That
 * binding is the whole point: a waiver cannot be replayed onto another task or
 * another registry, because both are inside the signed digest.
 */
import { hashTypedData, recoverAddress, type Address, type Hex } from 'viem';

export const WAIVER_TYPES = {
  Waiver: [
    { name: 'preregistrationId', type: 'bytes32' },
    { name: 'obligationIndex', type: 'uint16' },
    { name: 'reasonDigest', type: 'bytes32' },
  ],
} as const;

export function waiverDomain(chainId: number, registry: Address) {
  return { name: 'ERC-8412', version: '1', chainId, verifyingContract: registry } as const;
}

export function waiverDigest(input: {
  chainId: number;
  registry: Address;
  preregistrationId: Hex;
  obligationIndex: number;
  reasonDigest: Hex;
}): Hex {
  return hashTypedData({
    domain: waiverDomain(input.chainId, input.registry),
    types: WAIVER_TYPES,
    primaryType: 'Waiver',
    message: {
      preregistrationId: input.preregistrationId,
      obligationIndex: input.obligationIndex,
      reasonDigest: input.reasonDigest,
    },
  });
}

/**
 * Who signed this waiver, or null if the signature is malformed or high-s.
 *
 * Async because viem recovers signatures asynchronously (it uses the noble
 * secp256k1 implementation rather than a synchronous wrapper).
 */
export async function waiverSigner(input: {
  chainId: number;
  registry: Address;
  preregistrationId: Hex;
  obligationIndex: number;
  reasonDigest: Hex;
  signature: Hex;
}): Promise<Address | null> {
  try {
    return await recoverAddress({
      hash: waiverDigest(input),
      signature: input.signature,
    });
  } catch {
    return null;
  }
}
