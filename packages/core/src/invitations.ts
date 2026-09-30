/**
 * Who is allowed to take a short name (D17), as a pure function.
 *
 * The rule has three parts and they are easy to get wrong in a route handler:
 * one and two character names are held by the project and are never given away,
 * three and four characters are free but only to an invited wallet, and anything
 * longer is on the ordinary free path and has nothing to do with invitations.
 *
 * Kept here, next to the pricing and the reserved-name rules, so the API route,
 * the MCP tool and the tests all ask the same function.
 */

export interface Invitation {
  wallet?: string;
  xHandle?: string;
  /** Suggested label. Empty means the person picks their own short name. */
  label?: string;
  issuedBy?: string;
  issuedAt?: string;
  claimedAt?: string | null;
  claimedLabel?: string | null;
  txHash?: string | null;
  note?: string;
  /** Documentation row inside the config file; never a real invitation. */
  $example?: string;
}

/** Three and four characters: what an invitation is for. */
export const INVITED_MIN_UNITS = 3;
export const INVITED_MAX_UNITS = 4;
/** One and two characters: held by the project, never invited, never sold. */
export const PROJECT_RESERVED_MAX_UNITS = 2;

const normalize = (value?: string): string => (value ?? '').trim().toLowerCase().replace(/^@/, '');

/** The invitation that belongs to this wallet or X handle, if there is one. */
export function findInvitation(
  invitations: Invitation[],
  who: { wallet?: string | null; xHandle?: string | null },
): Invitation | null {
  const wallet = normalize(who.wallet ?? '');
  const handle = normalize(who.xHandle ?? '');
  if (!wallet && !handle) return null;

  for (const row of invitations) {
    if (row.$example) continue;
    const rowWallet = normalize(row.wallet);
    const rowHandle = normalize(row.xHandle);
    if (wallet && rowWallet && rowWallet === wallet) return row;
    if (handle && rowHandle && rowHandle === handle) return row;
  }
  return null;
}

export type InviteDecision =
  | { allowed: true; reason: 'invited-short' }
  | { allowed: false; code: 'PROJECT_RESERVED' | 'NOT_SHORT' | 'NOT_INVITED' | 'ALREADY_CLAIMED'; reason: string };

/**
 * May this label be taken for free through an invitation?
 *
 * `units` is the display width (limits.lengthMetric), the same number the price
 * ladder uses — a CJK character counts as two, so a two-character Chinese name
 * is a four-unit name and is invited, which is what the rule intends.
 */
export function invitedShortNameDecision(invitation: Invitation | null, units: number): InviteDecision {
  if (units <= PROJECT_RESERVED_MAX_UNITS) {
    return {
      allowed: false,
      code: 'PROJECT_RESERVED',
      reason: 'one and two character names are held by the project and are never given away',
    };
  }
  if (units > INVITED_MAX_UNITS) {
    return {
      allowed: false,
      code: 'NOT_SHORT',
      reason: 'this is not a short name; the ordinary free rule applies instead',
    };
  }
  if (!invitation) {
    return {
      allowed: false,
      code: 'NOT_INVITED',
      reason: 'short names are only given to invited wallets',
    };
  }
  if (invitation.claimedAt) {
    return {
      allowed: false,
      code: 'ALREADY_CLAIMED',
      reason: 'this invitation has already been used',
    };
  }
  return { allowed: true, reason: 'invited-short' };
}
