import { describe, expect, it } from 'vitest';
import {
  decodeAbiParameters,
  parseAbiParameters,
  recoverAddress,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { createGatewayApp } from '../src/app.js';
import { encodeStuffedCall, makeSignatureHash } from '../src/ccipRead.js';
import { GatewayError, type L2Reader } from '../src/l2.js';

const SIGNER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const signer = privateKeyToAccount(SIGNER_KEY);

const SENDER = '0x8A968aB9eb8C084FBC44c531058Fc9ef945c3D61' as const;
const OTHER_SENDER = '0x1111111111111111111111111111111111111111' as const;
// viem checksums addresses when it decodes them, so the fixture matches.
const REGISTRY = '0xdB0e02b4E3509D72C660241f4069b3a477815Eb9' as const;
const NOW = 1790619000;
const TTL = 300;

/** 32-byte ABI word holding the owner address, which is what addr() returns. */
const OWNER_RESULT =
  '0x000000000000000000000000603b8b1f7a0bc152b7d0dcd7bffbf1f2af115f6d' as Hex;

const stuffed = encodeStuffedCall({
  name: '0x0b7869616f6d696e67066d7573656e616d650365746800' as Hex,
  resolveCall: '0x3b3b57de13a4f3c8b0c3a0a0d0e0f00000000000000000000000000000000000' as Hex,
  targetChainId: 84532n,
  targetRegistryAddress: REGISTRY,
});

function build(options: { result?: Hex; fail?: GatewayError; allowed?: boolean } = {}) {
  const calls: Array<{ chainId: bigint; registryAddress: string; callData: string }> = [];
  const l2: L2Reader = {
    chains: () => [8453, 84532],
    async read(request) {
      calls.push({
        chainId: request.chainId,
        registryAddress: request.registryAddress,
        callData: request.callData,
      });
      if (options.fail) throw options.fail;
      return options.result ?? OWNER_RESULT;
    },
  };

  const { app, metrics } = createGatewayApp({
    l2,
    signer,
    allowedSenders: options.allowed === false ? [] : [SENDER],
    ttlSeconds: TTL,
    now: () => NOW,
    logger: () => {},
  });
  return { app, metrics, calls };
}

describe('GET /:sender/:data', () => {
  it('answers with a signed CCIP-Read payload', async () => {
    const { app, calls } = build();
    const response = await app.request(`/${SENDER}/${stuffed}`);
    const body = (await response.json()) as { data: Hex };

    expect(response.status).toBe(200);
    // The L2 read forwards the inner resolver call untouched.
    expect(calls).toHaveLength(1);
    expect(calls[0].chainId).toBe(84532n);
    expect(calls[0].registryAddress).toBe(REGISTRY);

    const [result, expires, signature] = decodeAbiParameters(
      parseAbiParameters('bytes result, uint64 expires, bytes sig'),
      body.data,
    ) as [Hex, bigint, Hex];

    expect(result).toBe(OWNER_RESULT);
    expect(expires).toBe(BigInt(NOW + TTL));

    const expectedHash = makeSignatureHash({
      sender: SENDER,
      expires: expires,
      request: stuffed,
      result,
    });
    expect(await recoverAddress({ hash: expectedHash, signature })).toBe(signer.address);
  });

  it('accepts the .json suffix some clients append', async () => {
    const { app } = build();
    const response = await app.request(`/${SENDER}/${stuffed}.json`);
    expect(response.status).toBe(200);
  });

  it('refuses a sender that is not an address', async () => {
    const { app } = build();
    const response = await app.request(`/not-an-address/${stuffed}`);
    expect(response.status).toBe(400);
  });

  it('refuses a resolver it was not told to serve', async () => {
    const { app } = build();
    const response = await app.request(`/${OTHER_SENDER}/${stuffed}`);
    expect(response.status).toBe(403);
  });

  it('serves any sender only when no allow list is configured', async () => {
    const { app } = build({ allowed: false });
    const response = await app.request(`/${OTHER_SENDER}/${stuffed}`);
    expect(response.status).toBe(200);
  });

  it('reports an L2 failure as 502, not as a signed empty answer', async () => {
    const { app } = build({ fail: new GatewayError('L2_CALL_FAILED', 'rpc down', 502) });
    const response = await app.request(`/${SENDER}/${stuffed}`);
    const body = (await response.json()) as { code: string };
    expect(response.status).toBe(502);
    expect(body.code).toBe('L2_CALL_FAILED');
  });

  it('rejects a call that is not a stuffed resolve call', async () => {
    const { app } = build();
    const response = await app.request(`/${SENDER}/0xdeadbeef`);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

describe('health and metrics', () => {
  it('reports the signer and served chains', async () => {
    const { app } = build();
    const body = (await (await app.request('/healthz')).json()) as {
      status: string;
      signer: string;
      chains: number[];
    };
    expect(body.status).toBe('ok');
    expect(body.signer).toBe(signer.address);
    expect(body.chains).toContain(84532);
  });

  it('counts requests and errors so an alert can fire', async () => {
    const { app, metrics } = build();
    await app.request(`/${SENDER}/${stuffed}`);
    await app.request(`/not-an-address/${stuffed}`);

    const text = metrics.render();
    expect(text).toContain('musename_gateway_requests_total');
    expect(text).toContain('musename_gateway_request_errors_total');
    expect(text).toMatch(/musename_gateway_request_errors_total\{chain="unknown"\} 1/);

    const endpoint = await app.request('/metrics');
    expect(await endpoint.text()).toContain('musename_gateway_requests_total');
  });
});
