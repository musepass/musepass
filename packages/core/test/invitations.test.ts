import { describe, expect, it } from 'vitest';

import { resolve } from 'node:path';

import { loadConfig } from '../src/config.js';
import {
  findInvitation,
  invitedShortNameDecision,
  type Invitation,
} from '../src/invitations.js';

const invited: Invitation = {
  wallet: '0x022Ce19a356bc18c1977F6816Fdf05fAF22985b7',
  xHandle: '',
  claimedAt: null,
};

const claimed: Invitation = { ...invited, claimedAt: '2026-10-01', claimedLabel: 'abcd' };

describe('findInvitation', () => {
  it('matches a wallet regardless of case', () => {
    expect(findInvitation([invited], { wallet: '0x022ce19a356bc18c1977f6816fdf05faf22985b7' })).toBe(invited);
  });

  it('matches an X handle with or without the at sign', () => {
    const row: Invitation = { xHandle: 'musepass' };
    expect(findInvitation([row], { xHandle: '@MusePass' })).toBe(row);
  });

  it('ignores the documentation row in the config file', () => {
    const example: Invitation = { $example: 'documentation', wallet: '0x0000000000000000000000000000000000000000' };
    expect(findInvitation([example], { wallet: '0x0000000000000000000000000000000000000000' })).toBeNull();
  });

  it('returns null when there is nobody to look up', () => {
    expect(findInvitation([invited], {})).toBeNull();
  });
});

describe('invitedShortNameDecision', () => {
  it('refuses one and two units even for an invited wallet', () => {
    // The project keeps those; a campaign is not allowed to give them away.
    for (const units of [1, 2]) {
      const decision = invitedShortNameDecision(invited, units);
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.code).toBe('PROJECT_RESERVED');
    }
  });

  it('allows three and four units for an invited wallet', () => {
    for (const units of [3, 4]) {
      expect(invitedShortNameDecision(invited, units)).toEqual({ allowed: true, reason: 'invited-short' });
    }
  });

  it('refuses a short name to a wallet that was not invited', () => {
    const decision = invitedShortNameDecision(null, 4);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('NOT_INVITED');
  });

  it('refuses a name that is not short at all', () => {
    // Five units and up take the ordinary free path; an invitation is irrelevant
    // there, and saying otherwise would let an invitation bypass the price ladder.
    const decision = invitedShortNameDecision(invited, 5);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('NOT_SHORT');
  });

  it('refuses an invitation that has already been used', () => {
    const decision = invitedShortNameDecision(claimed, 3);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('ALREADY_CLAIMED');
  });

  it('the running configuration carries the list', () => {
    // The list is config, so it loads with everything else. An empty list is the
    // normal state before a campaign; a missing file would be a deployment error.
    const config = loadConfig({ configDir: resolve(__dirname, '../../../config'), env: {} });
    expect(Array.isArray(config.invitations.invitations)).toBe(true);
    expect(config.invitations.rules?.freeLabelUnits).toEqual({ min: 3, max: 4 });
  });
});
