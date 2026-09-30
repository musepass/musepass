/**
 * The signer's value is that it says no. An agent that can reach it can ask for
 * any signature; a prompt-injected agent will ask for the wrong one. These tests
 * are the list of things it must refuse.
 */
import { describe, expect, it } from 'vitest';

import { checkCardPayload, checkRegistrationPayload, type SignerConfig } from '../src/policy.js';

const config: SignerConfig = {
  chainId: 4663,
  registrar: '0x093919fd8a200a1a2cbc0e5f7ade88b4dd557ab1',
  rootName: 'musename.eth',
};

const deadline = Math.floor(Date.now() / 1000) + 900;

const payload = (over: Record<string, unknown> = {}, message: Record<string, unknown> = {}) => ({
  domain: {
    name: 'MuseName',
    version: '1',
    chainId: 4663,
    verifyingContract: '0x093919fd8a200a1a2cbc0e5f7ade88b4dd557ab1',
  },
  types: { Register: [] },
  primaryType: 'Register',
  message: { label: 'peter', owner: '0x022Ce19a356bc18c1977F6816Fdf05fAF22985b7', deadline, ...message },
  ...over,
});

describe('registration payloads', () => {
  it('accepts the payload this deployment exists to sign', () => {
    const result = checkRegistrationPayload(payload(), config);
    expect(result.ok).toBe(true);
  });

  it('refuses another chain', () => {
    const request = payload();
    request.domain = { ...request.domain, chainId: 1 };
    const result = checkRegistrationPayload(request, config);
    expect(result).toMatchObject({ ok: false, code: 'WRONG_CHAIN' });
  });

  it('refuses another contract', () => {
    const request = payload();
    request.domain = { ...request.domain, verifyingContract: '0x1111111111111111111111111111111111111111' };
    const result = checkRegistrationPayload(request, config);
    expect(result).toMatchObject({ ok: false, code: 'WRONG_CONTRACT' });
  });

  it('refuses another typed message', () => {
    const result = checkRegistrationPayload(payload({ primaryType: 'Transfer' }), config);
    expect(result).toMatchObject({ ok: false, code: 'WRONG_TYPE' });
  });

  it('refuses an expired deadline, and one far in the future', () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    expect(checkRegistrationPayload(payload({}, { deadline: past }), config)).toMatchObject({
      ok: false,
      code: 'EXPIRED',
    });
    const far = Math.floor(Date.now() / 1000) + 86_400;
    expect(checkRegistrationPayload(payload({}, { deadline: far }), config)).toMatchObject({
      ok: false,
      code: 'DEADLINE_TOO_FAR',
    });
  });

  it('refuses a label or an owner it cannot make sense of', () => {
    expect(checkRegistrationPayload(payload({}, { label: 'has spaces' }), config)).toMatchObject({
      ok: false,
      code: 'BAD_LABEL',
    });
    expect(checkRegistrationPayload(payload({}, { owner: 'not-an-address' }), config)).toMatchObject({
      ok: false,
      code: 'BAD_OWNER',
    });
  });
});

describe('card payloads', () => {
  it('accepts a 32 byte hash', () => {
    const hash = `0x${'ab'.repeat(32)}`;
    expect(checkCardPayload(hash)).toMatchObject({ ok: true });
  });

  it('refuses anything that is not a 32 byte hash', () => {
    expect(checkCardPayload('0xdeadbeef')).toMatchObject({ ok: false, code: 'BAD_PAYLOAD' });
    expect(checkCardPayload({ data: '0x…' })).toMatchObject({ ok: false, code: 'BAD_PAYLOAD' });
    expect(checkCardPayload(`0x${'ab'.repeat(64)}`)).toMatchObject({ ok: false, code: 'BAD_PAYLOAD' });
  });
});
