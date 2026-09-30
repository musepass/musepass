import { ens_tokenize } from '@adraffy/ens-normalize';
import { MusePassError } from './errors.js';

/**
 * Script groups that matter for impersonation. Latin / Cyrillic / Greek share
 * so many identical-looking glyphs that mixing them inside one label is the
 * cheapest way to fake somebody else's name.
 */
export type ScriptGroup =
  | 'latin'
  | 'cyrillic'
  | 'greek'
  | 'han'
  | 'kana'
  | 'hangul'
  | 'arabic'
  | 'hebrew'
  | 'thai'
  | 'devanagari'
  | 'other';

export const CONFUSABLE_SCRIPTS: ReadonlyArray<ScriptGroup> = ['latin', 'cyrillic', 'greek'];

function scriptOfCodePoint(codePoint: number): ScriptGroup {
  const cp = codePoint;
  if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) return 'latin';
  if (cp >= 0x00c0 && cp <= 0x024f) return 'latin';
  if (cp >= 0x1e00 && cp <= 0x1eff) return 'latin';
  if (cp >= 0xab30 && cp <= 0xab6f) return 'latin';
  if (cp >= 0x0370 && cp <= 0x03ff) return 'greek';
  if (cp >= 0x1f00 && cp <= 0x1fff) return 'greek';
  if (cp >= 0x0400 && cp <= 0x04ff) return 'cyrillic';
  if (cp >= 0x0500 && cp <= 0x052f) return 'cyrillic';
  if (cp >= 0x2de0 && cp <= 0x2dff) return 'cyrillic';
  if (cp >= 0xa640 && cp <= 0xa69f) return 'cyrillic';
  if ((cp >= 0x3040 && cp <= 0x309f) || (cp >= 0x30a0 && cp <= 0x30ff) || (cp >= 0xff66 && cp <= 0xff9f)) return 'kana';
  if ((cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xf900 && cp <= 0xfaff)) return 'han';
  if ((cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0xac00 && cp <= 0xd7af)) return 'hangul';
  if (cp >= 0x0600 && cp <= 0x06ff) return 'arabic';
  if (cp >= 0x0590 && cp <= 0x05ff) return 'hebrew';
  if (cp >= 0x0e00 && cp <= 0x0e7f) return 'thai';
  if (cp >= 0x0900 && cp <= 0x097f) return 'devanagari';
  return 'other';
}

export function scriptsOf(label: string): Set<ScriptGroup> {
  const scripts = new Set<ScriptGroup>();
  for (const char of label) {
    scripts.add(scriptOfCodePoint(char.codePointAt(0) ?? 0));
  }
  return scripts;
}

export interface ScriptCheckResult {
  ok: boolean;
  scripts: ScriptGroup[];
  /** Populated when `ok` is false. */
  conflict?: ScriptGroup[];
}

export function checkScriptMixing(label: string, enabled = true): ScriptCheckResult {
  const scripts = scriptsOf(label);
  const present = CONFUSABLE_SCRIPTS.filter((script) => scripts.has(script));
  if (!enabled || present.length <= 1) {
    return { ok: true, scripts: [...scripts] };
  }
  return { ok: false, scripts: [...scripts], conflict: present };
}

export function assertNoScriptMixing(label: string, enabled = true): void {
  const result = checkScriptMixing(label, enabled);
  if (!result.ok) {
    throw new MusePassError('MIXED_SCRIPT', 'name mixes scripts that look alike', {
      label,
      conflict: result.conflict,
    });
  }
}

/** True when the label contains at least one emoji-ish token according to ENS normalization. */
export function hasEmoji(label: string): boolean {
  const tokens = ens_tokenize(label) as Array<{ type: string }>;
  return tokens.some((token) => token.type === 'emoji');
}

/**
 * Folds characters that are visually interchangeable with ASCII letters.
 *
 * ENSIP-15 already rejects mixing Latin with Cyrillic or Greek, so the classic
 * homoglyph attack fails at normalization. What normalization does *not* catch
 * is digit substitution: `g00gle` and `google` are both valid, distinct labels
 * that look the same. Folding gives the reserved-list check a second pass so
 * those variants cannot slip past a brand entry.
 */
const FOLD_ALTERNATIVES: Record<string, string[]> = {
  '0': ['o'],
  '1': ['l', 'i'],
  '2': ['z'],
  '3': ['e'],
  '4': ['a'],
  '5': ['s'],
  '6': ['g'],
  '7': ['t'],
  '8': ['b'],
  '9': ['g'],
  _: ['-'],
};

/** How many fold variants we are willing to test; bounds the work per lookup. */
export const MAX_FOLD_VARIANTS = 32;

function applyPairFolds(value: string): string {
  return value.replace(/vv/g, 'w').replace(/rn/g, 'm');
}

/** The primary fold: first alternative for every interchangeable character. */
export function foldConfusables(label: string): string {
  let output = '';
  for (const char of label) {
    output += FOLD_ALTERNATIVES[char]?.[0] ?? char;
  }
  return applyPairFolds(output);
}

/**
 * Every plausible reading of a label, e.g. `adm1n` -> `admln`, `admin`.
 *
 * `1` can be an `l` or an `i`, so a single fold is not enough to catch brand
 * spoofs. The expansion is capped at {@link MAX_FOLD_VARIANTS} so a label full
 * of digits cannot blow up the reserved-list check.
 */
export function foldVariants(label: string, limit = MAX_FOLD_VARIANTS): string[] {
  const variants = new Set<string>();
  let frontier: string[] = [''];

  for (const char of label) {
    const options = FOLD_ALTERNATIVES[char] ?? [char];
    const next: string[] = [];
    for (const prefix of frontier) {
      for (const option of options) {
        next.push(prefix + option);
        if (next.length >= limit) break;
      }
      if (next.length >= limit) break;
    }
    frontier = next;
  }

  for (const candidate of frontier) {
    variants.add(applyPairFolds(candidate));
  }
  if (variants.size === 0) variants.add(label);

  variants.delete(label);
  return [...variants].slice(0, limit);
}

/** True when folding changes the label, i.e. it is worth a second reserved-list pass. */
export function isFoldable(label: string): boolean {
  return foldConfusables(label) !== label;
}
