#!/usr/bin/env node
/**
 * Offline verification, from a shell.
 *
 *   musename-verify case.json
 *   musename-verify --chain c.json --criteria k.json --bundle b.json --attestation a.json
 *   musename-verify --vectors <dir>        # run a whole conformance set
 *
 * Exit code 0 when the recorded verdict stands, 1 when it is refuted. Unchecked
 * rules are printed but do not fail the run: they mean "this verifier cannot
 * decide that", which is different from "this is wrong".
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { verifyPackage, type VerificationInput } from './verify.js';

function read(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function argOf(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function asInput(value: unknown): VerificationInput {
  const record = Array.isArray(value) ? value[0] : value;
  if (!record || typeof record !== 'object') throw new Error('not a vector or a document set');
  const { chain, criteria, bundle, attestation } = record as Record<string, unknown>;
  if (!chain || !criteria || !bundle || !attestation) {
    throw new Error('expected chain, criteria, bundle and attestation in one object');
  }
  return { chain, criteria, bundle, attestation } as VerificationInput;
}

async function main(): Promise<number> {
  const vectors = argOf('vectors');
  if (vectors) {
    const files = readdirSync(vectors).filter((name) => name.endsWith('.json') && name !== 'manifest.json');
    let failures = 0;
    for (const file of files.sort()) {
      const vector = read(join(vectors, file)) as { expect?: { valid?: boolean } };
      const result = await verifyPackage(asInput(vector));
      const expected = vector.expect?.valid ?? true;
      const ok = result.valid === expected;
      if (!ok) failures += 1;
      console.log(
        `${ok ? 'ok  ' : 'FAIL'} ${file.padEnd(44)} valid=${result.valid} expected=${expected}` +
          (result.unchecked.length > 0 ? `  unchecked=${result.unchecked.length}` : ''),
      );
      if (!ok) {
        for (const violation of result.violations) console.log(`       ${violation.rule}: ${violation.detail}`);
      }
    }
    console.log(`\n${files.length - failures}/${files.length} vectors match`);
    return failures === 0 ? 0 : 1;
  }

  const single = process.argv.slice(2).find((value) => !value.startsWith('--'));
  const input = single ? asInput(read(single)) : undefined;
  const assembled: VerificationInput = input ?? {
    chain: read(argOf('chain') ?? '') as VerificationInput['chain'],
    criteria: read(argOf('criteria') ?? '') as VerificationInput['criteria'],
    bundle: read(argOf('bundle') ?? '') as VerificationInput['bundle'],
    attestation: read(argOf('attestation') ?? '') as VerificationInput['attestation'],
  };

  const result = await verifyPackage(assembled);
  console.log(JSON.stringify(result, null, 2));
  return result.valid ? 0 : 1;
}

process.exit(await main());
