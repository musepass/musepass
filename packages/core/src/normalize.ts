import { ens_normalize } from '@adraffy/ens-normalize';
import { MuseNameError } from './errors.js';

export interface NormalizedLabel {
  /** Exactly what the caller passed in. Never displayed to a user. */
  input: string;
  /** ENSIP-15 normalized form. This is the form that goes on chain and in the DB. */
  normalized: string;
  /** Unicode code points in the normalized form. Length rules use this. */
  codePoints: number;
  /** Display width: East Asian wide characters count as two columns. */
  width: number;
  /** UTF-8 byte length. The L2 registry caps labels at 255 bytes. */
  bytes: number;
}

export function countCodePoints(value: string): number {
  return Array.from(value).length;
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Ranges of East Asian Wide / Fullwidth code points. Approximated from the
 * Unicode EastAsianWidth property, which is the same convention terminals,
 * font metrics and ENS pricing use.
 */
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
];

function isWide(codePoint: number): boolean {
  for (const [start, end] of WIDE_RANGES) {
    if (codePoint >= start && codePoint <= end) return true;
  }
  return false;
}

/**
 * Length as a human reads it: `abc` is 3, `阿光摄影` is 8 (four wide glyphs).
 *
 * This matters because a four character Chinese name is an ordinary name while
 * a four character Latin name is a collector's name. Counting UTF-16 units or
 * raw code points would price the two identically and lock normal Chinese
 * names out of the free tier.
 */
export function displayWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    width += isWide(char.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return width;
}

export type LengthMetric = 'display-width' | 'code-points';

/** The single place the free/premium length rule gets its number from. */
export function measureLength(value: string, metric: LengthMetric = 'display-width'): number {
  return metric === 'code-points' ? countCodePoints(value) : displayWidth(value);
}

/** True when `input` is already in ENSIP-15 normalized form. */
export function isNormalized(input: string): boolean {
  try {
    return ens_normalize(input) === input;
  } catch {
    return false;
  }
}

/**
 * ENSIP-15 normalization for a single label (no dots).
 *
 * Deliberately strict: it does not trim, lowercase-away or repair input. The
 * spec requires that a name which cannot be normalized is rejected *before*
 * registration rather than registered and then failing to resolve in wallets.
 */
export function normalizeLabel(input: string, opcode = 'NORMALIZE'): NormalizedLabel {
  if (typeof input !== 'string') {
    throw new MuseNameError('INVALID_NAME', 'name must be a string', { input: typeof input });
  }
  if (input.length === 0) {
    throw new MuseNameError('EMPTY_LABEL', 'name is empty');
  }
  if (input.includes('.')) {
    throw new MuseNameError('INVALID_NAME', 'a single label must not contain a dot', { input, opcode });
  }

  let normalized: string;
  try {
    normalized = ens_normalize(input);
  } catch (error) {
    throw new MuseNameError('INVALID_CHARACTER', 'name contains characters that ENS does not allow', {
      input,
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  if (normalized.length === 0) {
    throw new MuseNameError('EMPTY_LABEL', 'name is empty after normalization', { input });
  }

  return {
    input,
    normalized,
    codePoints: countCodePoints(normalized),
    width: displayWidth(normalized),
    bytes: utf8ByteLength(normalized),
  };
}

export interface NormalizedName {
  input: string;
  normalized: string;
  labels: NormalizedLabel[];
}

/** Normalizes a dotted name (e.g. `aguang.musename.eth`) label by label. */
export function normalizeName(input: string): NormalizedName {
  if (typeof input !== 'string' || input.length === 0) {
    throw new MuseNameError('EMPTY_LABEL', 'name is empty');
  }
  const parts = input.split('.');
  if (parts.some((part) => part.length === 0)) {
    throw new MuseNameError('INVALID_NAME', 'name contains an empty label', { input });
  }
  const labels = parts.map((part) => normalizeLabel(part));
  return {
    input,
    normalized: labels.map((label) => label.normalized).join('.'),
    labels,
  };
}

/** `aguang.musename.eth` -> `aguang`, validated against the configured root. */
export function labelFromFullName(fullName: string, rootName: string): NormalizedLabel {
  const name = normalizeName(fullName);
  const root = normalizeName(rootName);
  if (!name.normalized.endsWith(`.${root.normalized}`)) {
    throw new MuseNameError('INVALID_NAME', 'name is not under the configured root name', {
      fullName,
      rootName,
    });
  }
  const label = name.normalized.slice(0, name.normalized.length - root.normalized.length - 1);
  if (label.includes('.')) {
    throw new MuseNameError('INVALID_NAME', 'nested subnames are not supported in phase 1', {
      fullName,
      rootName,
    });
  }
  return normalizeLabel(label);
}

export function fullNameFromLabel(label: string, rootName: string): string {
  return `${label}.${rootName}`;
}
