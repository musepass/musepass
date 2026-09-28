import { describe, expect, it } from 'vitest';
import {
  checkScriptMixing,
  foldConfusables,
  foldVariants,
  hasEmoji,
  isFoldable,
  scriptsOf,
} from '../src/confusables.js';

describe('script detection', () => {
  it('classifies pure latin', () => {
    expect([...scriptsOf('aguang')]).toEqual(['latin']);
  });

  it('classifies cyrillic', () => {
    expect([...scriptsOf('абв')]).toEqual(['cyrillic']);
  });

  it('classifies chinese', () => {
    expect([...scriptsOf('中文')]).toEqual(['han']);
  });

  it('classifies kana and hangul separately', () => {
    expect(scriptsOf('さくら').has('kana')).toBe(true);
    expect(scriptsOf('하늘').has('hangul')).toBe(true);
  });

  it('detects accented latin as latin', () => {
    expect(scriptsOf('café').has('latin')).toBe(true);
  });
});

describe('checkScriptMixing (defence in depth behind ENSIP-15)', () => {
  it('accepts a single confusable-family script', () => {
    expect(checkScriptMixing('aguang').ok).toBe(true);
    expect(checkScriptMixing('абв').ok).toBe(true);
  });

  it('rejects a label that mixes latin and cyrillic', () => {
    const result = checkScriptMixing('aguаng');
    expect(result.ok).toBe(false);
    expect(result.conflict).toEqual(['latin', 'cyrillic']);
  });

  it('can be disabled by config', () => {
    expect(checkScriptMixing('aguаng', false).ok).toBe(true);
  });
});

describe('foldConfusables', () => {
  it('folds digit look-alikes', () => {
    expect(foldConfusables('g00gle')).toBe('google');
    expect(foldConfusables('b4se')).toBe('base');
  });

  it('picks one reading for ambiguous digits (1 can be l or i)', () => {
    expect(foldConfusables('adm1n')).toBe('admln');
  });

  it('folds letter pair look-alikes', () => {
    expect(foldConfusables('rnuse')).toBe('muse');
    expect(foldConfusables('vvollet')).toBe('wollet');
  });

  it('leaves a clean label untouched', () => {
    expect(foldConfusables('aguang')).toBe('aguang');
    expect(isFoldable('aguang')).toBe(false);
    expect(isFoldable('g00gle')).toBe(true);
  });
});

describe('foldVariants', () => {
  it('returns every reading of an ambiguous digit', () => {
    const variants = foldVariants('adm1n');
    expect(variants).toContain('admin');
    expect(variants).toContain('admln');
  });

  it('excludes the original label', () => {
    expect(foldVariants('google')).not.toContain('google');
  });

  it('is bounded for a label full of digits', () => {
    expect(foldVariants('1111111111').length).toBeLessThanOrEqual(32);
  });

  it('returns an empty list when nothing can be folded', () => {
    expect(foldVariants('aguang')).toEqual([]);
  });
});

describe('hasEmoji', () => {
  it('detects emoji only labels', () => {
    expect(hasEmoji('😀')).toBe(true);
    expect(hasEmoji('中文😀')).toBe(true);
  });

  it('does not flag plain text', () => {
    expect(hasEmoji('aguang')).toBe(false);
    expect(hasEmoji('中文')).toBe(false);
  });
});
