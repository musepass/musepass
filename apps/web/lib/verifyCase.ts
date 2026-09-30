/**
 * Run the offline verifier on a pasted package.
 *
 * This is the whole point of putting it in the browser: the verdict is computed
 * on the reader's machine, from the documents in front of them. Nothing about
 * the answer depends on our server being up, honest, or reachable.
 */
import { verifyPackage, type VerificationResult } from '@musename/verify';

export interface VerifiedCase {
  ok: true;
  result: VerificationResult;
}

export interface FailedCase {
  ok: false;
  error: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function runVerification(text: string): Promise<VerifiedCase | FailedCase> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `That JSON does not parse: ${(error as Error).message}` };
  }

  const candidate = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!isRecord(candidate)) return { ok: false, error: 'The top level should be a JSON object.' };
  for (const key of ['chain', 'criteria', 'bundle', 'attestation'] as const) {
    if (!isRecord(candidate[key])) {
      return { ok: false, error: `Missing ${key}. A package needs all four: chain / criteria / bundle / attestation.` };
    }
  }

  try {
    const result = await verifyPackage(candidate as never);
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: `The verifier rejected this input: ${(error as Error).message}` };
  }
}
