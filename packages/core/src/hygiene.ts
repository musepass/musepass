/**
 * What must not leave this machine inside a repository or a review package.
 *
 * An outside review (2026-09-29) found runtime droppings in the working tree:
 * a server log carrying the build machine's internal address, plus its model.
 * The launch zip happened to be clean; the review package was not. The
 * fix in `scripts/package-review.mjs` is the exclusion. This file is the
 * assertion behind it, and it also covers the other half — a private key that
 * someone pasted into a file that git tracks.
 */

export type LeakKind = 'private-ipv4' | 'local-hostname' | 'home-path' | 'secret';

export interface Leak {
  kind: LeakKind;
  file: string;
  line: number;
  column: number;
  /** What was found, already truncated for a report. */
  value: string;
  text: string;
  /** Always true for network leaks inside test fixtures, which need fake values. */
  benign: boolean;
}

/** RFC1918 addresses, plus the CGNAT range, without the loopback we all use on purpose. */
const PRIVATE_IPV4 =
  /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})\b/g;

const HOSTNAME = /\b[a-z0-9][a-z0-9-]{0,62}\.(?:local|lan|internal|home\.arpa)\b/gi;

/** A personal directory name leaks the operator's identity and machine. */
const HOME_PATH = /\/(?:Users|home)\/([A-Za-z][A-Za-z0-9._-]{2,})/g;

function octetsAreSane(value: string): boolean {
  return value
    .split('.')
    .every((part) => Number(part) >= 0 && Number(part) <= 255);
}

/** Test fixtures need fake addresses; report them, do not fail on them. */
export function isTestPath(file: string): boolean {
  return /(^|\/)(test|tests|__tests__|fixtures)\//.test(file) || /\.test\.[cm]?[jt]sx?$/.test(file);
}

export function findNetworkLeaks(file: string, source: string): Leak[] {
  const leaks: Leak[] = [];
  const benignByPath = isTestPath(file);
  for (const [index, line] of source.split('\n').entries()) {
    for (const match of line.matchAll(PRIVATE_IPV4)) {
      if (!octetsAreSane(match[0])) continue;
      leaks.push({
        kind: 'private-ipv4',
        file,
        line: index + 1,
        column: match.index + 1,
        value: match[0],
        text: line.trim(),
        benign: benignByPath,
      });
    }
    for (const match of line.matchAll(HOSTNAME)) {
      // `.env.local` is a file name, not a machine.
      const before = match.index === 0 ? '' : line[match.index - 1];
      if (before === '.' || before === '/') continue;
      leaks.push({
        kind: 'local-hostname',
        file,
        line: index + 1,
        column: match.index + 1,
        value: match[0],
        text: line.trim(),
        benign: benignByPath,
      });
    }
    // `~/…` and `/Users/x/…` in a shipped document tells a stranger who we are.
    if (!benignByPath && !/\.env\.example$/.test(file)) {
      for (const match of line.matchAll(HOME_PATH)) {
        leaks.push({
          kind: 'home-path',
          file,
          line: index + 1,
          column: match.index + 1,
          value: match[0],
          text: line.trim(),
          benign: false,
        });
      }
    }
  }
  return leaks;
}

/**
 * Candidates are read from the files we keep secrets in (`.secrets/`, a key
 * file, an env file). A candidate that then appears inside a tracked file is a
 * leak by definition: git already published it.
 */
export function extractSecretCandidates(sources: Iterable<string>): string[] {
  const found = new Set<string>();
  for (const source of sources) {
    // Split on anything that is not a credential character. `=` is a separator
    // rather than a character, so `KEY=value` yields the value on its own.
    for (const token of source.split(/[^0-9A-Za-z+/_-]+/)) {
      // A 0x-prefixed 32-byte hex string is a private key.
      if (/^0x[0-9a-fA-F]{64}$/.test(token)) {
        found.add(token);
        continue;
      }
      // Everything else long enough to be a credential, but not a bare hash:
      // a 64-hex value with no 0x is an ordinary transaction hash, and those
      // are published in our own documentation on purpose.
      const bare = token.startsWith('0x') ? token.slice(2) : token;
      if (
        token.length >= 32 &&
        /[g-zG-Z+/=_]/.test(bare) &&
        !/^[0-9a-fA-F]{40,}$/.test(bare)
      ) {
        found.add(token);
      }
    }
  }
  // Longest first, so the truncation in the report shows the most of it.
  return [...found].sort((a, b) => b.length - a.length);
}

export function findSecretLeaks(file: string, source: string, secrets: Iterable<string>): Leak[] {
  const leaks: Leak[] = [];
  const candidates = [...secrets];
  if (candidates.length === 0) return leaks;
  const lines = source.split('\n');
  for (const [index, line] of lines.entries()) {
    for (const secret of candidates) {
      const at = line.indexOf(secret);
      if (at === -1) continue;
      leaks.push({
        kind: 'secret',
        file,
        line: index + 1,
        column: at + 1,
        value: `${secret.slice(0, 6)}… (${secret.length} chars)`,
        text: line.replace(secret, '<redacted>').trim(),
        benign: false,
      });
    }
  }
  return leaks;
}

export function scanForLeaks(
  file: string,
  source: string,
  secrets: Iterable<string> = [],
): Leak[] {
  return [...findNetworkLeaks(file, source), ...findSecretLeaks(file, source, secrets)];
}

/** A finding is a violation unless it lives in a test fixture. */
export function violationsOnly(leaks: Iterable<Leak>): Leak[] {
  return [...leaks].filter((leak) => !leak.benign);
}
