import type { ApiEnvelope, AvailabilityData } from './api';

/**
 * The five result states the homepage design draws.
 *
 * Order matters and is deliberate:
 *   invalid  — the name cannot exist at all, nothing else is worth saying
 *   reserved — a policy block that applies whether or not the name is taken
 *   taken    — a hard, checkable fact; more useful than a pricing rule
 *   premium  — the name is fine, we just do not sell it yet
 *   available
 *
 * `unavailable` is a sixth state the design does not draw: the chain could not
 * be read. We must not show "available" when we did not actually check.
 */
export type AvailabilityView =
  | {
      kind: 'available';
      label: string;
      fullName: string;
      invited: boolean;
      /** D19: what the connected wallet would pay to buy instead of claim. */
      purchase: { kind: string; priceUsd: number } | null;
    }
  | { kind: 'taken'; label: string; fullName: string; suggestions: string[] }
  | { kind: 'premium'; label: string; priceUsd: number | null; purchase: { kind: string; priceUsd: number } | null }
  | { kind: 'reserved'; label: string; appealable: boolean }
  | { kind: 'invalid'; message: string }
  | { kind: 'unavailable'; message: string };

const INVALID_CODES = new Set([
  'EMPTY_LABEL',
  'INVALID_NAME',
  'INVALID_CHARACTER',
  'MIXED_SCRIPT',
  'EMOJI_NOT_ALLOWED',
  'LABEL_TOO_SHORT',
  'LABEL_TOO_LONG',
  'LABEL_TOO_MANY_BYTES',
]);

export function resolveAvailability(
  payload: ApiEnvelope<AvailabilityData>,
  fallbackLabel = '',
): AvailabilityView {
  const codes = new Set(payload.errors.map((error) => error.code));
  const label = payload.data?.label ?? fallbackLabel;
  const fullName = payload.data?.fullName ?? label;

  if (payload.errors.some((error) => INVALID_CODES.has(error.code))) {
    return { kind: 'invalid', message: payload.summary?.en ?? 'That name does not pass the naming rules.' };
  }

  if (codes.has('RESERVED_NAME') || payload.data?.reserved) {
    return {
      kind: 'reserved',
      label,
      appealable: payload.data?.reserved?.appealable ?? false,
    };
  }

  if (codes.has('NAME_TAKEN')) {
    return { kind: 'taken', label, fullName, suggestions: payload.data?.suggestions ?? [] };
  }

  if (codes.has('NOT_FREE_TIER')) {
    return {
      kind: 'premium',
      label,
      priceUsd: payload.data?.price?.priceUsd ?? null,
      purchase: payload.data?.purchase ?? null,
    };
  }

  // Never claim a name is free when the chain was not read.
  if (payload.data?.available === true && payload.meta?.verified !== false) {
    return {
      kind: 'available',
      label,
      fullName,
      invited: payload.data?.invited === true,
      purchase: payload.data?.purchase ?? null,
    };
  }

  if (payload.data?.available === null || payload.meta?.verified === false) {
    return {
      kind: 'unavailable',
      message: payload.summary?.en ?? 'The chain could not be read just now. Try again shortly.',
    };
  }

  return { kind: 'unavailable', message: payload.summary?.en ?? 'This name cannot be judged right now.' };
}
