/**
 * What this wallet will sign, and what it refuses to.
 *
 * The point of a signer is that an agent never holds a key. The risk of a signer
 * is that it becomes a signing oracle: anything that can reach it can ask for a
 * signature, and a prompt-injected agent will ask for the wrong one. So the policy
 * is narrow on purpose, and it is a pure function so it can be tested without a
 * key, a network or an agent.
 *
 * Two things it will sign: a MusePass registration for the registrar this
 * deployment is configured with, and a 32-byte card hash. Everything else is
 * refused. The honest limit: a 32-byte hash carries no provenance, so this cannot
 * tell a real card hash from one an attacker built. The blast radius is bounded
 * by the key holding almost nothing — registration gas is paid by the platform.
 */
import { isAddress, isHex, type Address, type Hex } from 'viem';

export interface SignerConfig {
  chainId: number;
  registrar: Address;
  rootName: string;
}

export interface RegistrationRequest {
  domain: { name?: string; version?: string; chainId?: number; verifyingContract?: string };
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: { label?: string; owner?: string; deadline?: string | number | bigint };
}

export type PolicyResult<T> = { ok: true; value: T } | { ok: false; code: string; reason: string };

const LABEL = /^[a-z0-9-]{1,63}$/;

/** A registration payload, checked against what this deployment may sign. */
export function checkRegistrationPayload(
  payload: unknown,
  config: SignerConfig,
): PolicyResult<{ label: string; owner: Address; deadline: bigint }> {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'BAD_PAYLOAD', reason: 'the payload must be an object' };
  }
  const request = payload as RegistrationRequest;
  const domain = request.domain;
  if (!domain || typeof domain !== 'object') {
    return { ok: false, code: 'BAD_PAYLOAD', reason: 'the payload has no EIP-712 domain' };
  }
  if (Number(domain.chainId) !== config.chainId) {
    return {
      ok: false,
      code: 'WRONG_CHAIN',
      reason: `this wallet signs for chain ${config.chainId}, the payload says ${String(domain.chainId)}`,
    };
  }
  if ((domain.verifyingContract ?? '').toLowerCase() !== config.registrar.toLowerCase()) {
    return {
      ok: false,
      code: 'WRONG_CONTRACT',
      reason: `this wallet signs for the registrar ${config.registrar}, not ${String(domain.verifyingContract)}`,
    };
  }
  if (request.primaryType !== 'Register') {
    return {
      ok: false,
      code: 'WRONG_TYPE',
      reason: `primaryType must be Register, not ${String(request.primaryType)}`,
    };
  }

  const message = request.message ?? {};
  const label = String(message.label ?? '').toLowerCase();
  if (!LABEL.test(label)) {
    return { ok: false, code: 'BAD_LABEL', reason: `"${label}" is not a label this wallet will sign for` };
  }
  const owner = String(message.owner ?? '');
  if (!isAddress(owner)) {
    return { ok: false, code: 'BAD_OWNER', reason: 'message.owner must be an address' };
  }
  const deadline = BigInt(message.deadline ?? 0);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (deadline <= now) {
    return { ok: false, code: 'EXPIRED', reason: 'that deadline has already passed' };
  }
  // A signature that lasts forever is one somebody can use later.
  if (deadline > now + 3600n) {
    return { ok: false, code: 'DEADLINE_TOO_FAR', reason: 'deadlines more than an hour away are refused' };
  }

  return { ok: true, value: { label, owner: owner as Address, deadline } };
}

/** The card payload is a 32-byte hash signed with personal_sign. */
export function checkCardPayload(payload: unknown): PolicyResult<Hex> {
  if (typeof payload !== 'string' || !isHex(payload) || payload.length !== 66) {
    return {
      ok: false,
      code: 'BAD_PAYLOAD',
      reason: 'a card payload is exactly 32 bytes of hex, as prepare_card returns it',
    };
  }
  return { ok: true, value: payload as Hex };
}
