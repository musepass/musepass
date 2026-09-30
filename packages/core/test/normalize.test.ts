import { describe, expect, it } from 'vitest';
import { isMusePassError } from '../src/errors.js';
import {
  countCodePoints,
  fullNameFromLabel,
  isNormalized,
  labelFromFullName,
  normalizeLabel,
  normalizeName,
  utf8ByteLength,
} from '../src/normalize.js';

/**
 * Acceptance for phase 1 asks for at least 30 normalization cases covering
 * Chinese, emoji, look-alike characters, case and whitespace. The table below
 * is deliberately explicit rather than generated, so a reader can audit it.
 */
describe('normalizeLabel — accepted inputs', () => {
  const accepted: Array<[string, string, string]> = [
    ['plain latin', 'aguang', 'aguang'],
    ['upper case', 'AGUANG', 'aguang'],
    ['mixed case', 'Aguang123', 'aguang123'],
    ['latin with hyphen', 'hello-world', 'hello-world'],
    ['digits only', '12345', '12345'],
    ['accented latin', 'café', 'café'],
    ['decomposed accent (NFC)', 'cafe\u0301', 'café'],
    ['umlaut and slash-o', 'ünïcøde', 'ünïcøde'],
    ['chinese', '中文名字', '中文名字'],
    ['chinese plus latin', '中文Name', '中文name'],
    ['chinese plus digits', '中文123', '中文123'],
    ['japanese kana', 'さくら', 'さくら'],
    ['korean hangul', '하늘', '하늘'],
    ['cyrillic only', 'ТЕСТ', 'тест'],
    ['cyrillic lowercase', 'абв', 'абв'],
    ['fullwidth latin', 'ＡＢＣ', 'abc'],
    ['fullwidth word', 'ｆｕｌｌｗｉｄｔｈ', 'fullwidth'],
    ['fullwidth brand', 'ＧＯＯＧＬＥ', 'google'],
    ['emoji only', '😀', '😀'],
    ['emoji with chinese', '中文😀', '中文😀'],
    ['leading hyphen', '-abc', '-abc'],
    ['trailing hyphen', 'abc-', 'abc-'],
    ['underscore prefix', '_abc', '_abc'],
    ['zero width space is dropped', 'a\u200Bb', 'ab'],
    ['hex-looking name', '0x1234', '0x1234'],
    ['single character', 'a', 'a'],
    ['255 byte ascii label', 'a'.repeat(255), 'a'.repeat(255)],
  ];

  it.each(accepted)('%s: %j -> %j', (_title, input, expected) => {
    const result = normalizeLabel(input);
    expect(result.normalized).toBe(expected);
    expect(result.codePoints).toBe(countCodePoints(expected));
    expect(result.bytes).toBe(utf8ByteLength(expected));
    expect(isNormalized(result.normalized)).toBe(true);
  });
});

describe('normalizeLabel — rejected inputs', () => {
  const rejected: Array<[string, string, string]> = [
    ['empty string', '', 'EMPTY_LABEL'],
    ['leading space', ' hello', 'INVALID_CHARACTER'],
    ['trailing space', 'hello ', 'INVALID_CHARACTER'],
    ['inner space', 'hel lo', 'INVALID_CHARACTER'],
    ['newline', 'foo\n', 'INVALID_CHARACTER'],
    ['parenthesis', '(abc)', 'INVALID_CHARACTER'],
    ['plus sign', 'a+b', 'INVALID_CHARACTER'],
    ['url-like string', 'http://x', 'INVALID_CHARACTER'],
    ['inner underscore', 'aguang_01', 'INVALID_CHARACTER'],
    ['latin plus cyrillic homoglyph', 'aа', 'INVALID_CHARACTER'],
    ['brand spoof with cyrillic a', 'googleа', 'INVALID_CHARACTER'],
    ['dotted name passed as a label', 'a.b', 'INVALID_NAME'],
  ];

  it.each(rejected)('%s: %j -> %s', (_title, input, code) => {
    try {
      normalizeLabel(input);
      throw new Error('expected normalizeLabel to throw');
    } catch (error) {
      expect(isMusePassError(error)).toBe(true);
      if (isMusePassError(error)) expect(error.code).toBe(code);
    }
  });
});

describe('normalizeLabel — properties', () => {
  it('is idempotent', () => {
    for (const input of ['Aguang', '中文Name', 'ＧＯＯＧＬＥ', 'cafe\u0301', 'café']) {
      const once = normalizeLabel(input).normalized;
      const twice = normalizeLabel(once).normalized;
      expect(twice).toBe(once);
    }
  });

  it('counts by code point, not UTF-16 units', () => {
    // The astral-plane emoji is 2 UTF-16 units but a single character.
    expect([...'😀'].length).toBe(1);
    expect('😀'.length).toBe(2);
    expect(normalizeLabel('😀').codePoints).toBe(1);
  });

  it('measures bytes, not characters, for the registry limit', () => {
    const label = normalizeLabel('中文中文中文');
    expect(label.codePoints).toBe(6);
    expect(label.bytes).toBe(18);
  });

  it('keeps the raw input for debugging without leaking it into the normalized field', () => {
    const label = normalizeLabel('Aguang');
    expect(label.input).toBe('Aguang');
    expect(label.normalized).toBe('aguang');
  });
});

describe('normalizeName and labelFromFullName', () => {
  it('normalizes every label of a dotted name', () => {
    const name = normalizeName('ＡＧＵＡＮＧ.MusePass.eth');
    expect(name.normalized).toBe('aguang.musepass.eth');
    expect(name.labels.map((label) => label.normalized)).toEqual(['aguang', 'musepass', 'eth']);
  });

  it('rejects names with an empty label', () => {
    expect(() => normalizeName('a..b')).toThrow();
  });

  it('extracts the label under the configured root', () => {
    const label = labelFromFullName('阿光.musepass.eth', 'musepass.eth');
    expect(label.normalized).toBe('阿光');
  });

  it('rejects names outside the configured root', () => {
    expect(() => labelFromFullName('aguang.other.eth', 'musepass.eth')).toThrow();
  });

  it('rejects nested subnames in phase 1', () => {
    expect(() => labelFromFullName('a.b.musepass.eth', 'musepass.eth')).toThrow();
  });

  it('builds full names from labels', () => {
    expect(fullNameFromLabel('aguang', 'musepass.eth')).toBe('aguang.musepass.eth');
  });
});
