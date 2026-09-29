/**
 * Canonical JSON (RFC 8785) for the subset ERC-8412 documents are allowed to
 * use, plus the hash they are identified by.
 *
 * The subset matters: ERC-8412 says documents MUST NOT contain non-integer
 * numbers, precisely so that canonicalisation never depends on how a language
 * serialises floating point. Anything that is not an object, array, string,
 * integer, boolean or null is rejected here rather than hashed differently
 * across implementations.
 *
 * Key order is by UTF-16 code unit, which is what JCS asks for and what
 * JavaScript's default string sort does. That is not the same as UTF-8 byte
 * order for strings containing astral characters, so this is not a coincidence
 * we can ignore: the ERC's reference implementation sorts the same way.
 */
import { keccak256, toHex } from 'viem';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export class JcsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JcsError';
  }
}

/** The JSON string escape rules both Python and JavaScript agree on. */
function quote(value: string): string {
  let out = '"';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (char === '"') out += '\\"';
    else if (char === '\\') out += '\\\\';
    else if (char === '\b') out += '\\b';
    else if (char === '\f') out += '\\f';
    else if (char === '\n') out += '\\n';
    else if (char === '\r') out += '\\r';
    else if (char === '\t') out += '\\t';
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += char;
  }
  return `${out}"`;
}

function check(value: unknown, path: string): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new JcsError(`${path}: non-integer numbers are not permitted in ERC-8412 documents`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => check(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) check(entry, `${path}.${key}`);
    return;
  }
  throw new JcsError(`${path}: ${typeof value} cannot be canonicalised`);
}

function serialize(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return quote(value);
  if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${quote(key)}:${serialize(value[key])}`).join(',')}}`;
}

export function canonicalJson(value: unknown): string {
  check(value, '$');
  return serialize(value as JsonValue);
}

/** `keccak256(jcs(document))`, the digest an ERC-8412 document is known by. */
export function documentDigest(value: unknown): `0x${string}` {
  return keccak256(toHex(canonicalJson(value)));
}
