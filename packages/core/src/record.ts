/**
 * The off-chain half of the record format.
 *
 * `contracts/src/lib/RecordDigest.sol` is the on-chain definition; this is the
 * same formula in TypeScript so an exporter, a verifier or a batch builder can
 * reproduce a record's digest without reading every log. Both sides pin the same
 * expected bytes in their tests (`contracts/test/RecordDigest.t.sol` and
 * `packages/core/test/record.test.ts`), so a change to either one fails the other.
 *
 * The digest includes the chain id and the registry address. That is not
 * decoration: without them a verdict recorded on one deployment could be
 * replayed into another, which is exactly the kind of thing a "portable record"
 * claim makes easy to get wrong.
 */
import { encodeAbiParameters, keccak256, parseAbiParameters, stringToHex, type Address, type Hex } from 'viem';

/** Keccak of the ASCII tag. Must equal `RecordDigest.TAG` in Solidity. */
/**
 * Frozen on purpose: the tag names the format, not the brand, and it is compared
 * byte-for-byte against `RecordDigest.TAG` in Solidity. Renaming it with the
 * product would invalidate every record already issued.
 */
export const RECORD_DIGEST_TAG: Hex = keccak256(stringToHex('MuseNameRecord/1'));

export enum RecordVerdict {
  Pass = 0,
  Fail = 1,
  /**
   * A verdict that exists so that "we could not establish this" is visible.
   * It must never be rendered like a pass — see `verdictCopy`.
   */
  Unproven = 2,
}

export enum RecordKind {
  Verdict = 0,
  Dispute = 1,
}

export interface RecordFields {
  chainId: number | bigint;
  registry: Address;
  node: Hex;
  ownerAtIssue: Address;
  actor: Address;
  kind: RecordKind;
  verdict: RecordVerdict;
  issuedAt: number | bigint;
  standardHash: Hex;
  evidenceHash: Hex;
  refRecordId: number | bigint;
}

const FIELD_TYPES = parseAbiParameters(
  'bytes32, uint256, address, bytes32, address, address, uint8, uint8, uint64, bytes32, bytes32, uint256',
);

export function recordDigest(fields: RecordFields): Hex {
  assertRecordFields(fields);
  return keccak256(
    encodeAbiParameters(FIELD_TYPES, [
      RECORD_DIGEST_TAG,
      BigInt(fields.chainId),
      fields.registry,
      fields.node,
      fields.ownerAtIssue,
      fields.actor,
      fields.kind,
      fields.verdict,
      BigInt(fields.issuedAt),
      fields.standardHash,
      fields.evidenceHash,
      BigInt(fields.refRecordId),
    ]),
  );
}

/**
 * Mirrors `RecordDigest.dedupeKey`: the same claim about the same owner twice is
 * the same claim, while the same claim about a new owner is a new record.
 */
export function recordDedupeKey(fields: RecordFields): Hex {
  assertRecordFields(fields);
  return keccak256(
    encodeAbiParameters(parseAbiParameters('bytes32, address, address, uint8, uint8, bytes32, bytes32'), [
      fields.node,
      fields.ownerAtIssue,
      fields.actor,
      fields.kind,
      fields.verdict,
      fields.standardHash,
      fields.evidenceHash,
    ]),
  );
}

export class RecordFieldError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(`${field}: ${message}`);
    this.name = 'RecordFieldError';
  }
}

/**
 * Cheap shape checks, in the same spirit as the contract: a digest built from a
 * malformed record is worse than an error, because it looks verifiable.
 */
export function assertRecordFields(fields: RecordFields): void {
  const isBytes32 = (value: unknown): boolean => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
  const isAddress = (value: unknown): boolean => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
  const isCode = (value: unknown, max: number): boolean =>
    typeof value === 'number' || typeof value === 'bigint'
      ? Number(value) >= 0 && Number(value) <= max
      : false;

  for (const field of ['node', 'standardHash', 'evidenceHash'] as const) {
    if (!isBytes32(fields[field])) throw new RecordFieldError(field, 'expected 32 bytes of hex');
  }
  for (const field of ['registry', 'ownerAtIssue', 'actor'] as const) {
    if (!isAddress(fields[field])) throw new RecordFieldError(field, 'expected a 20-byte address');
  }
  if (!isCode(fields.kind, 1)) throw new RecordFieldError('kind', 'expected 0 (verdict) or 1 (dispute)');
  if (!isCode(fields.verdict, 2)) {
    throw new RecordFieldError('verdict', 'expected 0 (pass), 1 (fail) or 2 (unproven)');
  }
  if (!isCode(fields.issuedAt, Number.MAX_SAFE_INTEGER)) {
    throw new RecordFieldError('issuedAt', 'expected a non-negative timestamp');
  }
  if (!isCode(fields.chainId, Number.MAX_SAFE_INTEGER)) {
    throw new RecordFieldError('chainId', 'expected a non-negative chain id');
  }
  if (!isCode(fields.refRecordId, Number.MAX_SAFE_INTEGER)) {
    throw new RecordFieldError('refRecordId', 'expected a non-negative record id');
  }
  if (fields.kind === RecordKind.Dispute && fields.verdict !== RecordVerdict.Unproven) {
    throw new RecordFieldError('verdict', 'a dispute carries the Unproven verdict, never a pass or a fail');
  }
}

/**
 * How each outcome must be worded. The third one exists so that a UI cannot
 * quietly present "we could not tell" as "it passed": the copy and the tone are
 * different, and this function is the single place that decides.
 */
export function verdictCopy(verdict: RecordVerdict): {
  zh: string;
  en: string;
  tone: 'positive' | 'negative' | 'unknown';
} {
  switch (verdict) {
    case RecordVerdict.Pass:
      return { zh: '通过', en: 'passed', tone: 'positive' };
    case RecordVerdict.Fail:
      return { zh: '失败', en: 'failed', tone: 'negative' };
    default:
      return { zh: '无法证明', en: 'could not be established', tone: 'unknown' };
  }
}
