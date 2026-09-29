/**
 * The off-chain verifier: given what a registry says about one preregistration
 * plus the three published documents, decide whether the recorded verdict is
 * refuted, and by which rule.
 *
 * This is a faithful port of the reference verifier shipped with the draft
 * (assets/erc-8412/verifier/verify.py at the pinned commit), and it is tested
 * against that same project's conformance vectors. What it cannot check, it
 * says so: salted commitments stay closed, media is not opened, and a
 * namespaced decision rule is reported as unchecked rather than refuted.
 *
 * The reason this exists at all: a registry can check that a bundle digest was
 * attested by the named verifier, and nothing else. Every refuted package in
 * the draft's own vector set would be accepted by the registry alone, which is
 * exactly the gap somebody verifying a track record has to close.
 */
import type { Address, Hex } from 'viem';

import {
  type AttestationDocument,
  type BundleItem,
  type ChainState,
  type CriteriaDocument,
  type EvidenceBundle,
  type Obligation,
  type Outcome,
  REQUIRED_CONSTRAINTS,
  applyDecisionRule,
  flagsFromObligations,
  isNamespaced,
  isKnownDecisionRule,
  outcomeNames,
} from './criteria.js';
import { documentDigest } from './jcs.js';
import { waiverSigner } from './waiver.js';

export interface Violation {
  rule: string;
  detail: string;
}

export interface VerificationResult {
  valid: boolean;
  violations: Violation[];
  /** Rules the verifier deliberately did not mechanise for this package. */
  unchecked: string[];
}

export interface VerificationInput {
  chain: ChainState;
  criteria: CriteriaDocument;
  bundle: EvidenceBundle;
  attestation: AttestationDocument;
}

const lower = (value: unknown): string => String(value ?? '').toLowerCase();

export async function verifyPackage(input: VerificationInput): Promise<VerificationResult> {
  const { chain, criteria, bundle, attestation } = input;
  const violations: Violation[] = [];
  const unchecked: string[] = [];
  const bad = (rule: string, detail: string) => violations.push({ rule, detail });

  const pid = chain.preregistrationId;
  const attestationState = chain.attestation;
  const obligations: Obligation[] = criteria.obligations ?? [];
  const count = chain.obligationCount;

  // ---- W: the criteria document is well formed (§2, §3)
  const indices = obligations.map((obligation) => obligation.index);
  if (indices.join(',') !== obligations.map((_, index) => index).join(',')) {
    bad('W', 'obligations must be dense and ordered by index from 0');
  }
  if (obligations.some((obligation) => obligation.waivable) && !criteria.waiverAuthority) {
    bad('W', 'waiverAuthority must be non-null when any obligation is waivable');
  }
  for (const obligation of obligations) {
    const type = obligation.type ?? '';
    const required = REQUIRED_CONSTRAINTS[type];
    if (required) {
      const missing = required.filter((key) => !(key in (obligation.constraints ?? {})));
      if (missing.length > 0) {
        bad('W', `obligation ${obligation.index} (${type}) missing required constraints ${missing.join(', ')}`);
      }
    } else if (!isNamespaced(type)) {
      bad('W', `obligation ${obligation.index}: unknown unnamespaced type '${type}'`);
    }
  }
  const rule = criteria.decisionRule ?? '';
  if (!isKnownDecisionRule(rule)) {
    bad('W', `decisionRule '${rule}' is neither a standard rule nor namespaced`);
  }

  // ---- O5: the published documents are the ones the chain signed off on
  if (documentDigest(criteria) !== lower(chain.criteriaDigest)) {
    bad('O5', 'criteria document does not hash to the registered criteriaDigest');
  }
  if (documentDigest(bundle) !== lower(attestationState.bundleDigest)) {
    bad('O5', 'bundle does not hash to the attested bundleDigest');
  }
  if (documentDigest(attestation) !== lower(attestationState.attestationDigest)) {
    bad('O5', 'attestation document does not hash to the attested attestationDigest');
  }
  for (const field of ['taskRef', 'expiry', 'verifier'] as const) {
    if (lower(criteria[field]) !== lower(chain[field])) {
      bad('O5', `criteria.${field} != on-chain ${field}`);
    }
  }
  const documentSupersedes = criteria.supersedes;
  const chainSupersedes = chain.supersedes;
  const chainSupersedesIsZero = BigInt(chainSupersedes) === 0n;
  if ((documentSupersedes === null) !== chainSupersedesIsZero) {
    bad('O5', 'criteria.supersedes does not match on-chain supersedes');
  } else if (documentSupersedes && lower(documentSupersedes) !== lower(chainSupersedes)) {
    bad('O5', 'criteria.supersedes does not match on-chain supersedes');
  }
  if (obligations.length !== count) {
    bad('O5', 'number of obligations != on-chain obligationCount');
  } else if (flagsFromObligations(obligations) !== lower(chain.obligationFlags)) {
    bad('O5', 'on-chain obligationFlags do not match required/waivable in the document');
  }
  const allowed = criteria.verifierConstraint?.allowed;
  if (allowed && !allowed.map(lower).includes(lower(chain.verifier))) {
    bad('O5', 'on-chain verifier is not in verifierConstraint.allowed');
  }
  if (lower(attestation.preregistrationId) !== lower(pid)) {
    bad('O5', 'attestation document names a different preregistrationId');
  }
  if (attestation.verdict !== attestationState.verdict) {
    bad('O5', 'attestation document verdict != on-chain verdict');
  }
  if (lower(attestation.obligationOutcomes) !== lower(attestationState.obligationOutcomes)) {
    bad('O5', 'attestation document outcomes != on-chain obligationOutcomes');
  }
  if (lower(attestation.bundleDigest) !== lower(attestationState.bundleDigest)) {
    bad('O5', 'attestation document bundleDigest != on-chain bundleDigest');
  }

  const outcomes: Outcome[] = outcomeNames(attestationState.obligationOutcomes as Hex, count);

  // ---- O1: evidence does not predate the criteria, and each item binds the id
  if (lower(bundle.preregistrationId) !== lower(pid)) {
    bad('O1', 'bundle does not bind this preregistrationId');
  }
  (bundle.items ?? []).forEach((item: BundleItem, position: number) => {
    if (lower(item.preregistrationId) !== lower(pid)) {
      bad('O1', `bundle item ${position} does not bind this preregistrationId`);
    }
    const timestamp = item.captureMetadata?.timestamp;
    if (!Number.isInteger(timestamp) || (timestamp as number) < chain.registeredAt) {
      bad('O1', `bundle item ${position} captured at ${String(timestamp)}, before registeredAt ${chain.registeredAt}`);
    }
  });

  // ---- O2: every MET obligation is covered, and its checkable constraints hold
  const byIndex = new Map<number, BundleItem[]>();
  for (const item of bundle.items ?? []) {
    const list = byIndex.get(item.obligationIndex) ?? [];
    list.push(item);
    byIndex.set(item.obligationIndex, list);
  }
  for (const obligation of obligations) {
    const index = obligation.index;
    if (outcomes[index] !== 'MET') continue;
    const constraints = obligation.constraints ?? {};
    const satisfies = (item: BundleItem): boolean => {
      const metadata = item.captureMetadata ?? ({} as BundleItem['captureMetadata']);
      const wanted = (constraints.captureMetadata as string[] | undefined) ?? [];
      if (wanted.some((key) => !(key in metadata))) return false;
      if ('notBefore' in constraints && (metadata.timestamp ?? -1) < (constraints.notBefore as number)) {
        return false;
      }
      if ('mediaType' in constraints && item.mediaType !== constraints.mediaType) return false;
      return true;
    };
    const items = byIndex.get(index) ?? [];
    if (items.length === 0) {
      bad('O2', `obligation ${index} is MET but no bundle item covers it`);
    } else if (!items.some(satisfies)) {
      bad('O2', `obligation ${index} is MET but no covering item satisfies its constraints`);
    }
  }

  // ---- O3: every WAIVED outcome carries exactly one waiver from the authority
  const waivers = new Map<number, { obligationIndex: number; reasonDigest: string; signature: string }[]>();
  for (const waiver of attestation.waivers ?? []) {
    const list = waivers.get(waiver.obligationIndex) ?? [];
    list.push(waiver);
    waivers.set(waiver.obligationIndex, list);
  }
  for (let index = 0; index < count; index += 1) {
    const forObligation = waivers.get(index) ?? [];
    if (outcomes[index] === 'WAIVED') {
      if (forObligation.length !== 1) {
        bad('O3', `obligation ${index} is WAIVED but has ${forObligation.length} waiver records`);
        continue;
      }
      const waiver = forObligation[0]!;
      const signer = await waiverSigner({
        chainId: chain.chainId,
        registry: chain.registry as Address,
        preregistrationId: pid as Hex,
        obligationIndex: index,
        reasonDigest: waiver.reasonDigest as Hex,
        signature: waiver.signature as Hex,
      });
      if (!criteria.waiverAuthority || !signer || lower(signer) !== lower(criteria.waiverAuthority)) {
        bad('O3', `waiver for obligation ${index} is not signed by waiverAuthority`);
      }
    } else if (forObligation.length > 0) {
      bad('O3', `waiver record present for obligation ${index}, which is ${outcomes[index]}, not WAIVED`);
    }
  }

  // ---- O4: the verdict follows from the decision rule
  const verdict = attestationState.verdict;
  const undecided = attestation.undecided ?? [];
  const decided = obligations.length > 0 ? applyDecisionRule(rule, obligations, outcomes) : null;
  if (decided === null) {
    unchecked.push('O4: custom decisionRule not implemented by this verifier');
  } else if (verdict === 'Satisfied' || verdict === 'NotSatisfied') {
    if (verdict !== decided) {
      bad('O4', `decisionRule yields ${decided}, verdict is ${verdict}`);
    }
    if (undecided.length > 0) {
      bad('O4', 'undecided must be empty unless the verdict is Indeterminate');
    }
  } else if (verdict === 'Indeterminate') {
    if (decided === 'Satisfied') {
      bad('O4', 'Indeterminate recorded although the decision rule is already Satisfied');
    }
    if (undecided.length === 0) {
      bad('O4', 'Indeterminate requires a non-empty undecided list');
    }
    for (const index of undecided) {
      if (outcomes[index] !== 'UNMET') {
        bad('O4', `undecided obligation ${index} must be encoded UNMET, is ${outcomes[index]}`);
      }
    }
  }

  return { valid: violations.length === 0, violations, unchecked };
}
