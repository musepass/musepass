import {
  encodeFunctionData,
  decodeFunctionData,
  encodeAbiParameters,
  encodePacked,
  keccak256,
  type Address,
  type Hex,
} from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';

/**
 * CCIP-Read gateway for Durin's L1Resolver (ERC-3668 / ENSIP-10).
 *
 * The protocol, read off the resolver source rather than guessed:
 *
 *   L1Resolver.resolve(name, data)
 *     -> computes the 2LD, looks up l2Registry[2LD]
 *     -> reverts OffchainLookup(sender, [url], callData, resolveWithProof.selector, callData)
 *        where callData = abi.encodeCall(stuffedResolveCall, (name, data, chainId, registry))
 *
 *   The client then GETs url/{sender}/{callData} and expects
 *     { "data": abi.encode(bytes result, uint64 expires, bytes sig) }
 *
 *   The resolver's callback verifies
 *     signer == ecrecover(keccak256(0x1900 || sender || expires || keccak(request) || keccak(result)))
 *   with request = extraData = callData, and requires expires >= block.timestamp.
 *
 * Note `expires` is a "valid until" timestamp, not a duration, despite the name.
 */

export const STUFFED_RESOLVE_CALL_ABI = [
  {
    type: 'function',
    name: 'stuffedResolveCall',
    stateMutability: 'view',
    inputs: [
      { name: 'name', type: 'bytes' },
      { name: 'data', type: 'bytes' },
      { name: 'targetChainId', type: 'uint64' },
      { name: 'targetRegistryAddress', type: 'address' },
    ],
    outputs: [
      { name: 'result', type: 'bytes' },
      { name: 'expires', type: 'uint64' },
      { name: 'sig', type: 'bytes' },
    ],
  },
] as const;

export interface StuffedCall {
  /** DNS-encoded name the client asked about. */
  name: Hex;
  /** The inner resolver call, e.g. addr(bytes32) or text(bytes32,string). */
  resolveCall: Hex;
  targetChainId: bigint;
  targetRegistryAddress: Address;
}

export function decodeStuffedCall(data: Hex): StuffedCall {
  const decoded = decodeFunctionData({ abi: STUFFED_RESOLVE_CALL_ABI, data });
  const [name, resolveCall, targetChainId, targetRegistryAddress] = decoded.args as [
    Hex,
    Hex,
    bigint,
    Address,
  ];
  return { name, resolveCall, targetChainId, targetRegistryAddress };
}

export function encodeStuffedCall(call: StuffedCall): Hex {
  // Must include the selector: the resolver builds this with
  // abi.encodeWithSelector, and the gateway decodes it with decodeFunctionData.
  return encodeFunctionData({
    abi: STUFFED_RESOLVE_CALL_ABI,
    functionName: 'stuffedResolveCall',
    args: [call.name, call.resolveCall, call.targetChainId, call.targetRegistryAddress],
  });
}

export interface GatewayResponseInput {
  result: Hex;
  expires: bigint;
  signature: Hex;
}

export function encodeGatewayResponse(input: GatewayResponseInput): Hex {
  return encodeAbiParameters(
    [
      { name: 'result', type: 'bytes' },
      { name: 'expires', type: 'uint64' },
      { name: 'sig', type: 'bytes' },
    ],
    [input.result, input.expires, input.signature],
  );
}

/**
 * Mirrors `SignatureVerifier.makeSignatureHash` in Durin's L1Resolver.
 * A test asserts this equals the hash the Solidity library produces for the
 * same inputs, because a mismatch would make every resolution fail with
 * InvalidSignature and look like a gateway outage.
 */
export function makeSignatureHash(input: {
  sender: Address;
  expires: bigint;
  request: Hex;
  result: Hex;
}): Hex {
  return keccak256(
    encodePacked(
      ['bytes', 'address', 'uint64', 'bytes32', 'bytes32'],
      [
        '0x1900',
        input.sender,
        input.expires,
        keccak256(input.request),
        keccak256(input.result),
      ],
    ),
  );
}

/**
 * The account signs a raw hash and hands back the 65 byte (r,s,v) signature the
 * resolver expects. It is deterministic (RFC 6979), which is why the Solidity
 * suite can pin the same bytes.
 */
export async function signGatewayResponse(input: {
  account: PrivateKeyAccount;
  sender: Address;
  expires: bigint;
  request: Hex;
  result: Hex;
}): Promise<Hex> {
  const hash = makeSignatureHash({
    sender: input.sender,
    expires: input.expires,
    request: input.request,
    result: input.result,
  });
  return input.account.sign({ hash });
}
