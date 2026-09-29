/**
 * The pieces of ERC-8412 that are pure arithmetic: the packed 2-bit fields, the
 * obligation types and their required constraints, and the standard decision
 * rules.
 *
 * Section numbers in the comments refer to the draft pinned in
 * docs/reference/erc-8412-ff9fbc7.md.
 */
import type { Hex } from 'viem';

export const OUTCOME_NAMES = ['UNMET', 'MET', 'WAIVED', 'NOT_APPLICABLE'] as const;
export type Outcome = (typeof OUTCOME_NAMES)[number];

export const VERDICT_NAMES = ['None', 'Satisfied', 'NotSatisfied', 'Indeterminate', 'ExpiredUnresolved'] as const;
export type Verdict = (typeof VERDICT_NAMES)[number];

/** §3: the type identifiers this ERC defines, and the constraints they require. */
export const REQUIRED_CONSTRAINTS: Record<string, string[]> = {
  PHOTO: ['captureMetadata'],
  VIDEO: ['captureMetadata'],
  GPS_TRACE: ['captureMetadata', 'sampleIntervalSeconds'],
  HUMAN_SIGNATURE: ['signerBinding'],
  DOCUMENT: ['mediaType'],
  WITNESS_STATEMENT: ['signerBinding'],
  DEVICE_READING: ['deviceBinding', 'captureMetadata'],
  AGENT_LOG: ['agentBinding'],
  GENERATED_ARTIFACT: ['modelBinding', 'mediaType'],
};

/** Unnamespaced identifiers are reserved for the ERC; profiles use reverse DNS. */
const NAMESPACED = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const RULE_AT_LEAST = /^ALL_REQUIRED_AND_AT_LEAST\((\d+)\)$/;

export function isNamespaced(token: string): boolean {
  return NAMESPACED.test(token);
}

export interface Obligation {
  index: number;
  type: string;
  required: boolean;
  waivable: boolean;
  constraints: Record<string, unknown>;
}

export interface CriteriaDocument {
  version: string;
  taskRef: string;
  supersedes: string | null;
  decisionRule: string;
  obligations: Obligation[];
  waiverAuthority: string | null;
  verifier: string;
  verifierConstraint?: { allowed?: string[]; maxRiskScore?: number };
  expiry: number;
  terminalOnExpiry: string;
  [key: string]: unknown;
}

export interface BundleItem {
  obligationIndex: number;
  preregistrationId: string;
  digest: string;
  mediaType: string;
  locator: string;
  captureMetadata: { timestamp: number; [key: string]: unknown };
  [key: string]: unknown;
}

export interface EvidenceBundle {
  version: string;
  preregistrationId: string;
  items: BundleItem[];
  [key: string]: unknown;
}

export interface WaiverRecord {
  obligationIndex: number;
  reasonDigest: string;
  signature: string;
}

export interface AttestationDocument {
  version: string;
  preregistrationId: string;
  bundleDigest: string;
  verdict: Verdict;
  obligationOutcomes: string;
  waivers: WaiverRecord[];
  undecided: number[];
  [key: string]: unknown;
}

/** §6: the on-chain view of one preregistration plus its attestation. */
export interface ChainState {
  chainId: number;
  registry: string;
  preregistrationId: string;
  author: string;
  criteriaDigest: string;
  taskRef: string;
  obligationCount: number;
  obligationFlags: string;
  expiry: number;
  registeredAt: number;
  verifier: string;
  supersedes: string;
  attestation: {
    verifier: string;
    bundleDigest: string;
    attestationDigest: string;
    verdict: Verdict;
    obligationOutcomes: string;
    attestedAt: number;
  };
}

/** §5: two bits per obligation, most-significant bits first, zero padding. */
export function pack2Bit(values: number[]): Hex {
  const bytes = new Uint8Array(Math.ceil(values.length / 4));
  values.forEach((value, index) => {
    const shift = 6 - 2 * (index % 4);
    bytes[Math.floor(index / 4)] |= (value & 0b11) << shift;
  });
  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function unpack2Bit(packed: Hex, index: number): number {
  const bytes = packed.slice(2);
  const byte = Number.parseInt(bytes.slice(Math.floor(index / 4) * 2, Math.floor(index / 4) * 2 + 2), 16);
  return (byte >> (6 - 2 * (index % 4))) & 0b11;
}

/** §5 table: 00 optional, 01 required, 10 optional+waivable, 11 required+waivable. */
export function flagsFromObligations(obligations: Obligation[]): Hex {
  return pack2Bit(obligations.map((o) => (o.required ? 1 : 0) | (o.waivable ? 2 : 0)));
}

export function outcomesFromNames(names: Outcome[]): Hex {
  return pack2Bit(names.map((name) => OUTCOME_NAMES.indexOf(name)));
}

export function outcomeNames(packed: Hex, count: number): Outcome[] {
  return Array.from({ length: count }, (_, index) => OUTCOME_NAMES[unpack2Bit(packed, index)]!);
}

/**
 * §2: the standard decision rules. Returns null for a namespaced rule this
 * verifier does not implement — reported as unchecked, never as a violation.
 */
export function applyDecisionRule(
  rule: string,
  obligations: Obligation[],
  outcomes: Outcome[],
): 'Satisfied' | 'NotSatisfied' | null {
  const byIndex = (obligation: Obligation) => outcomes[obligation.index] ?? 'UNMET';
  const requiredOk = obligations
    .filter((obligation) => obligation.required)
    .every((obligation) => ['MET', 'WAIVED'].includes(byIndex(obligation)));

  if (rule === 'ALL_REQUIRED') return requiredOk ? 'Satisfied' : 'NotSatisfied';

  const atLeast = RULE_AT_LEAST.exec(rule);
  if (atLeast) {
    const k = Number.parseInt(atLeast[1]!, 10);
    const optionalMet = obligations.filter(
      (obligation) => !obligation.required && byIndex(obligation) === 'MET',
    ).length;
    return requiredOk && optionalMet >= k ? 'Satisfied' : 'NotSatisfied';
  }

  return null;
}

/** True when a decision rule is one this ERC defines (or a namespaced one). */
export function isKnownDecisionRule(rule: string): boolean {
  return rule === 'ALL_REQUIRED' || RULE_AT_LEAST.test(rule) || isNamespaced(rule);
}
