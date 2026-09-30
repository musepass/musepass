import {
  hashTypedData,
  verifyTypedData,
  type Address,
  type Hex,
  type PublicClient,
  type TypedDataDomain,
} from 'viem';
import { MusePassError } from './errors.js';

/**
 * Mirrors `MusePassRegistrar.Register` in contracts/src/MusePassRegistrar.sol.
 * The label and the beneficiary are inside the signed payload, so a captured
 * signature can only ever mint the same name to the same owner.
 */
export const REGISTER_TYPES = {
  Register: [
    { name: 'label', type: 'string' },
    { name: 'owner', type: 'address' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export const CARD_UPDATE_TYPES = {
  CardUpdate: [
    { name: 'name', type: 'string' },
    { name: 'contentHash', type: 'bytes32' },
    { name: 'version', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export const SIGNATURE_DOMAIN_VERSION = '1';

export interface BuildDomainInput {
  /** Taken from config so a brand rename invalidates signatures instead of silently working. */
  productName: string;
  chainId: number;
  verifyingContract: Address;
  version?: string;
}

export function buildEip712Domain(input: BuildDomainInput): TypedDataDomain {
  if (!input.verifyingContract || !/^0x[0-9a-fA-F]{40}$/.test(input.verifyingContract)) {
    throw new MusePassError('INVALID_CONFIG', 'verifyingContract must be a contract address', {
      verifyingContract: input.verifyingContract,
    });
  }
  return {
    name: input.productName,
    version: input.version ?? SIGNATURE_DOMAIN_VERSION,
    chainId: input.chainId,
    verifyingContract: input.verifyingContract,
  };
}

export interface RegisterMessage {
  label: string;
  owner: Address;
  deadline: bigint;
  /** Index signature lets viem infer the typed-data generics without casts. */
  [key: string]: unknown;
}

export interface CardUpdateMessage {
  name: string;
  contentHash: Hex;
  version: bigint;
  deadline: bigint;
  [key: string]: unknown;
}

export function registerMessage(input: {
  label: string;
  owner: Address;
  deadline: number | bigint | string;
}): RegisterMessage {
  return { label: input.label, owner: input.owner, deadline: BigInt(input.deadline) };
}

export function cardUpdateMessage(input: {
  name: string;
  contentHash: Hex;
  version: number | bigint;
  deadline: number | bigint;
}): CardUpdateMessage {
  return {
    name: input.name,
    contentHash: input.contentHash,
    version: BigInt(input.version),
    deadline: BigInt(input.deadline),
  };
}

export function registerDigest(domain: TypedDataDomain, message: RegisterMessage): Hex {
  return hashTypedData({
    domain,
    types: REGISTER_TYPES,
    primaryType: 'Register',
    message,
  });
}

export function cardUpdateDigest(domain: TypedDataDomain, message: CardUpdateMessage): Hex {
  return hashTypedData({
    domain,
    types: CARD_UPDATE_TYPES,
    primaryType: 'CardUpdate',
    message,
  });
}

export function nowSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

export function isExpired(deadline: number | bigint, at: bigint = nowSeconds()): boolean {
  return BigInt(deadline) < at;
}

export function assertNotExpired(deadline: number | bigint, at: bigint = nowSeconds()): void {
  if (isExpired(deadline, at)) {
    throw new MusePassError('EXPIRED', 'the signature deadline has passed', { deadline: String(deadline) });
  }
}

export interface VerifyRegisterInput {
  address: Address;
  signature: Hex;
  domain: TypedDataDomain;
  message: RegisterMessage;
  /** Pass a client to also support ERC-1271 smart contract wallets. */
  client?: PublicClient;
  now?: bigint;
}

export async function verifyRegisterSignature(input: VerifyRegisterInput): Promise<boolean> {
  assertNotExpired(input.message.deadline, input.now ?? nowSeconds());

  // Smart contract wallets (ERC-1271) need a client; plain EOAs do not.
  if (input.client) {
    return input.client.verifyTypedData({
      address: input.address,
      domain: input.domain,
      types: REGISTER_TYPES,
      primaryType: 'Register',
      message: input.message,
      signature: input.signature,
    });
  }
  return verifyTypedData({
    address: input.address,
    domain: input.domain,
    types: REGISTER_TYPES,
    primaryType: 'Register',
    message: input.message,
    signature: input.signature,
  });
}

export interface VerifyCardUpdateInput {
  address: Address;
  signature: Hex;
  domain: TypedDataDomain;
  message: CardUpdateMessage;
  client?: PublicClient;
  now?: bigint;
}

export async function verifyCardUpdateSignature(input: VerifyCardUpdateInput): Promise<boolean> {
  assertNotExpired(input.message.deadline, input.now ?? nowSeconds());

  if (input.client) {
    return input.client.verifyTypedData({
      address: input.address,
      domain: input.domain,
      types: CARD_UPDATE_TYPES,
      primaryType: 'CardUpdate',
      message: input.message,
      signature: input.signature,
    });
  }
  return verifyTypedData({
    address: input.address,
    domain: input.domain,
    types: CARD_UPDATE_TYPES,
    primaryType: 'CardUpdate',
    message: input.message,
    signature: input.signature,
  });
}
