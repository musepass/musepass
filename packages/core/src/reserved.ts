import type { ReservedConfig } from './config.js';
import { foldVariants } from './confusables.js';
import { normalizeLabel } from './normalize.js';

export interface ReservedEntry {
  category: string;
  note?: string;
  matched: string;
}

export interface ReservedPattern {
  category: string;
  note?: string;
  pattern: string;
  prefix?: string;
  suffix?: string;
}

export interface ReservedIndex {
  exact: Map<string, { category: string; note?: string }>;
  patterns: ReservedPattern[];
}

export interface ReservedHit extends ReservedEntry {
  reserved: true;
  appealable: boolean;
  appealChannel?: string;
}

export function buildReservedIndex(config: ReservedConfig): ReservedIndex {
  const exact = new Map<string, { category: string; note?: string }>();
  const patterns: ReservedPattern[] = [];

  for (const [category, entry] of Object.entries(config.categories ?? {})) {
    for (const raw of entry.labels ?? []) {
      const normalized = safeNormalize(raw);
      if (!normalized) continue;
      if (!exact.has(normalized)) exact.set(normalized, { category, note: entry.note });
    }
    for (const raw of entry.patterns ?? []) {
      const pattern = raw.trim();
      if (!pattern.includes('*')) {
        const normalized = safeNormalize(pattern);
        if (normalized && !exact.has(normalized)) exact.set(normalized, { category, note: entry.note });
        continue;
      }
      const prefix = pattern.endsWith('*') ? safeNormalize(pattern.slice(0, -1)) ?? undefined : undefined;
      const suffix = pattern.startsWith('*') ? safeNormalize(pattern.slice(1)) ?? undefined : undefined;
      if (!prefix && !suffix) continue;
      patterns.push({ category, note: entry.note, pattern, prefix, suffix });
    }
  }

  return { exact, patterns };
}

function safeNormalize(value: string): string | null {
  try {
    return normalizeLabel(value).normalized;
  } catch {
    return null;
  }
}

/**
 * Matching runs against the normalized label, so `ＡＤＭＩＮ` (full width) and
 * `admin` hit the same entry.
 */
export function checkReserved(label: string, index: ReservedIndex, config?: ReservedConfig): ReservedHit | null {
  const makeHit = (category: string, note: string | undefined, matched: string): ReservedHit => ({
    reserved: true,
    category,
    note,
    matched,
    appealable: config?.appeal?.allowed ?? false,
    appealChannel: config?.appeal?.channel,
  });

  const matchPattern = (value: string): ReservedPattern | null => {
    for (const pattern of index.patterns) {
      const prefixHit = pattern.prefix ? value.startsWith(pattern.prefix) : true;
      const suffixHit = pattern.suffix ? value.endsWith(pattern.suffix) : true;
      if (prefixHit && suffixHit) return pattern;
    }
    return null;
  };

  const entry = index.exact.get(label);
  if (entry) return makeHit(entry.category, entry.note, label);

  const directPattern = matchPattern(label);
  if (directPattern) return makeHit(directPattern.category, directPattern.note, directPattern.pattern);

  // Second pass: `g00gle` reads as `google`, `adm1n` reads as `admin`.
  for (const variant of foldVariants(label)) {
    const variantEntry = index.exact.get(variant);
    if (variantEntry) {
      return makeHit(variantEntry.category, `confusable with reserved name "${variant}"`, variant);
    }
    const variantPattern = matchPattern(variant);
    if (variantPattern) {
      return makeHit(
        variantPattern.category,
        `confusable with reserved pattern "${variantPattern.pattern}"`,
        variantPattern.pattern,
      );
    }
  }

  return null;
}

export function reservedCount(index: ReservedIndex): number {
  return index.exact.size + index.patterns.length;
}
