import {
  encodePacked,
  hashMessage,
  keccak256,
  toBytes,
  verifyMessage,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';

export const ERC8004_CARD_TYPE = 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1';

export interface AgentService {
  name: string;
  endpoint: string;
  version?: string;
  skills?: string[];
  domains?: string[];
}

export interface AgentRegistration {
  agentId: number;
  agentRegistry: string;
}

/**
 * MuseName's additions to the ERC-8004 registration file. They live under one
 * namespaced key so that other clients can ignore them without breaking.
 */
export interface MusenameCardExtension {
  owner?: string;
  host?: string;
  contact?: string;
  payoutAddress?: string;
  cardVersion?: number;
  updatedAt?: string;
  trackRecordEndpoint?: string;
  ensName?: string;
  /**
   * Who may see what. It lives inside the card on purpose: the owner signs the
   * card, so anything stored outside it would not be covered by the signature.
   */
  visibility?: VisibilityMap;
}

export interface AgentCard {
  type: string;
  name: string;
  description: string;
  image: string;
  services: AgentService[];
  x402Support: boolean;
  active: boolean;
  registrations: AgentRegistration[];
  supportedTrust?: string[];
  musename?: MusenameCardExtension;
}

export interface CardValidationSuccess {
  ok: true;
  card: AgentCard;
  warnings: string[];
}

export interface CardValidationFailure {
  ok: false;
  errors: string[];
}

export type CardValidationResult = CardValidationSuccess | CardValidationFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validates an ERC-8004 agent registration file.
 *
 * ERC-8004 states that every field except `supportedTrust` is mandatory, so we
 * require the keys to be present and well typed. We do not require a non-empty
 * `registrations` array here: the spec says agents SHOULD have one, and a card
 * is created before the optional ERC-8004 identity registration in our flow.
 */
export function validateCard(value: unknown): CardValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ['card must be a JSON object'] };
  }

  if (!isNonEmptyString(value.type)) errors.push('type is required');
  else if (value.type !== ERC8004_CARD_TYPE) {
    errors.push(`type must be ${ERC8004_CARD_TYPE}`);
  }
  if (!isNonEmptyString(value.name)) errors.push('name is required');
  if (!isNonEmptyString(value.description)) errors.push('description is required');
  if (!isNonEmptyString(value.image)) errors.push('image is required');
  if (typeof value.x402Support !== 'boolean') errors.push('x402Support must be a boolean');
  if (typeof value.active !== 'boolean') errors.push('active must be a boolean');

  if (!Array.isArray(value.services)) {
    errors.push('services must be an array');
  } else {
    value.services.forEach((service, index) => {
      if (!isRecord(service)) {
        errors.push(`services[${index}] must be an object`);
        return;
      }
      if (!isNonEmptyString(service.name)) errors.push(`services[${index}].name is required`);
      if (!isNonEmptyString(service.endpoint)) errors.push(`services[${index}].endpoint is required`);
      if (service.version !== undefined && !isNonEmptyString(service.version)) {
        errors.push(`services[${index}].version must be a non-empty string when present`);
      }
    });
    if (value.services.length === 0) warnings.push('services is empty: other agents cannot reach this AI');
  }

  if (!Array.isArray(value.registrations)) {
    errors.push('registrations must be an array');
  } else {
    value.registrations.forEach((registration, index) => {
      if (!isRecord(registration)) {
        errors.push(`registrations[${index}] must be an object`);
        return;
      }
      if (typeof registration.agentId !== 'number' || !Number.isInteger(registration.agentId)) {
        errors.push(`registrations[${index}].agentId must be an integer`);
      }
      if (!isNonEmptyString(registration.agentRegistry)) {
        errors.push(`registrations[${index}].agentRegistry is required`);
      }
    });
    if (value.registrations.length === 0) {
      warnings.push('registrations is empty: the card is not linked to an ERC-8004 identity yet');
    }
  }

  if (value.supportedTrust !== undefined) {
    if (!Array.isArray(value.supportedTrust) || value.supportedTrust.some((item) => !isNonEmptyString(item))) {
      errors.push('supportedTrust must be an array of strings when present');
    }
  }

  if (value.musename !== undefined) {
    if (!isRecord(value.musename)) {
      errors.push('musename must be an object when present');
    } else {
      const extension = value.musename;
      for (const key of ['owner', 'host', 'contact', 'payoutAddress', 'updatedAt', 'trackRecordEndpoint', 'ensName']) {
        if (extension[key] !== undefined && !isNonEmptyString(extension[key])) {
          errors.push(`musename.${key} must be a non-empty string when present`);
        }
      }
      if (extension.cardVersion !== undefined && typeof extension.cardVersion !== 'number') {
        errors.push('musename.cardVersion must be a number when present');
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, card: value as unknown as AgentCard, warnings };
}

export const CARD_FIELDS = [
  'name',
  'address',
  'description',
  'image',
  'services',
  'x402Support',
  'active',
  'registrations',
  'supportedTrust',
  'owner',
  'host',
  'contact',
  'payoutAddress',
  'trackRecordEndpoint',
] as const;

export type CardField = (typeof CARD_FIELDS)[number];
export type FieldVisibility = 'public' | 'certified-only' | 'private';
export type VisibilityMap = Record<CardField, FieldVisibility>;

/**
 * Rule 4 (minimum disclosure): everything is private unless the owner opts in.
 * The ENS name and the owner address are visible by construction — they are
 * public on chain — so they are the only two fields that start as public.
 */
export function defaultVisibility(): VisibilityMap {
  const map = {} as VisibilityMap;
  for (const field of CARD_FIELDS) map[field] = 'private';
  map.name = 'public';
  map.address = 'public';
  return map;
}

export interface RedactedCard {
  name?: string;
  address?: string;
  description?: string;
  image?: string;
  services?: AgentService[];
  x402Support?: boolean;
  active?: boolean;
  registrations?: AgentRegistration[];
  supportedTrust?: string[];
  owner?: string;
  host?: string;
  contact?: string;
  payoutAddress?: string;
  trackRecordEndpoint?: string;
}

export interface RedactInput {
  card?: AgentCard | null;
  ensName: string;
  ownerAddress: string;
}

/**
 * Strips every field the owner has not published. `mode: 'certified'` is the
 * view a certified counterparty sees, which additionally unlocks fields marked
 * `certified-only`.
 */
export function applyVisibility(
  input: RedactInput,
  visibility: VisibilityMap,
  mode: 'public' | 'certified' = 'public',
): RedactedCard {
  const allowed = (field: CardField): boolean => {
    const setting = visibility[field] ?? 'private';
    if (setting === 'public') return true;
    return mode === 'certified' && setting === 'certified-only';
  };

  const output: RedactedCard = {};
  if (allowed('name')) output.name = input.ensName;
  if (allowed('address')) output.address = input.ownerAddress;

  const card = input.card;
  if (!card) return output;

  const extension = card.musename ?? {};
  if (allowed('description')) output.description = card.description;
  if (allowed('image')) output.image = card.image;
  if (allowed('services')) output.services = card.services;
  if (allowed('x402Support')) output.x402Support = card.x402Support;
  if (allowed('active')) output.active = card.active;
  if (allowed('registrations')) output.registrations = card.registrations;
  if (allowed('supportedTrust') && card.supportedTrust) output.supportedTrust = card.supportedTrust;
  if (allowed('owner') && extension.owner) output.owner = extension.owner;
  if (allowed('host') && extension.host) output.host = extension.host;
  if (allowed('contact') && extension.contact) output.contact = extension.contact;
  if (allowed('payoutAddress') && extension.payoutAddress) output.payoutAddress = extension.payoutAddress;
  if (allowed('trackRecordEndpoint') && extension.trackRecordEndpoint) {
    output.trackRecordEndpoint = extension.trackRecordEndpoint;
  }
  return output;
}

/** Deterministic JSON: object keys sorted at every level, no extra whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

/**
 * Content hash of a card. This is what the owner signs when publishing, so it
 * must be stable across serializers — hence the canonical form.
 */
export function cardContentHash(card: AgentCard): Hex {
  return keccak256(toBytes(canonicalJson(card)));
}

/* ------------------------------------------------------------------ */
/* On-chain text record                                                */
/* ------------------------------------------------------------------ */

/** The ENS text record key the card lives under. Namespaced so it cannot clash. */
export const CARD_TEXT_KEY = 'musename.card';

/**
 * A card is stored as a self-contained data URI rather than only as an IPFS
 * pointer. ERC-8004 explicitly allows this, and it means the record cannot rot
 * when a pinning service disappears — which matters because the whole pitch is
 * that a name outlives the platform that issued it.
 */
export function cardDataUri(card: AgentCard): string {
  const json = canonicalJson(card);
  return `data:application/json;base64,${encodeBase64(json)}`;
}

export function parseCardDataUri(value: string): AgentCard | null {
  const prefix = 'data:application/json;base64,';
  if (!value.startsWith(prefix)) return null;
  try {
    const json = decodeBase64(value.slice(prefix.length));
    return JSON.parse(json) as AgentCard;
  } catch {
    return null;
  }
}

/** Works in Node and in a browser, so the front end can reuse this later. */
function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(value, 'base64').toString('utf8');
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export interface CardTextSignatureInput {
  /** The L2 registry, which is also the resolver holding the text record. */
  registry: Address;
  node: Hex;
  key: string;
  value: string;
  /** Unix timestamp after which the signature is void. */
  expiration: bigint | number;
}

/**
 * The value a wallet should sign — a plain 32 byte hash, passed to
 * `personal_sign` (viem: `signMessage({ message: { raw } })`).
 *
 * The contract compares against the EIP-191 wrapped form of this hash (see
 * {@link cardTextSignatureHash}), and `personal_sign` wraps it exactly the same
 * way. Signing the wrapped hash instead would wrap it twice and every publish
 * would revert with Unauthorized — which is what happened the first time.
 */
export function cardTextSignaturePayload(input: CardTextSignatureInput): Hex {
  return keccak256(
    encodePacked(
      ['address', 'bytes32', 'string', 'string', 'uint256'],
      [input.registry, input.node, input.key, input.value, BigInt(input.expiration)],
    ),
  );
}

/**
 * Mirrors the final hash `L2Resolver.setTextWithSignature` compares against:
 *
 *   keccak256(abi.encodePacked(address(this), node, key, value, expiration))
 *     .toEthSignedMessageHash()
 *
 * Note this is a personal-sign hash, not EIP-712, so a wallet shows raw bytes
 * rather than readable fields. That is the contract's choice, not ours.
 */
export function cardTextSignatureHash(input: CardTextSignatureInput): Hex {
  return hashMessage({ raw: cardTextSignaturePayload(input) });
}

export interface VerifyCardTextSignatureInput {
  address: Address;
  /** The value returned by {@link cardTextSignaturePayload}. */
  payload: Hex;
  signature: Hex;
  /** Pass a client to also accept ERC-1271 smart wallets. */
  client?: PublicClient;
}

export async function verifyCardTextSignature(
  input: VerifyCardTextSignatureInput,
): Promise<boolean> {
  const parameters = {
    address: input.address,
    message: { raw: input.payload },
    signature: input.signature,
  };
  if (input.client) return input.client.verifyMessage(parameters);
  return verifyMessage(parameters);
}
