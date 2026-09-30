import { describe, expect, it } from 'vitest';
import { encodeFunctionData, keccak256, toBytes, type Hex } from 'viem';

import { createL2Reader } from '../src/l2.js';

/**
 * Reads a real name off the real Base Sepolia registry.
 *
 * Skipped unless MUSENAME_LIVE=1 because it needs the network. Run it with:
 *   MUSENAME_LIVE=1 pnpm --filter @musename/gateway test
 */
const live = process.env.MUSENAME_LIVE === '1';

const REGISTRY = '0xdb0e02b4e3509d72c660241f4069b3a477815eb9' as const;
const CHAIN_ID = 84532n;
const ROOT = 'musepass.eth';

/** The address that signed the claim for xiaoming; recorded in deployments/. */
const EXPECTED_OWNER = '0x603b8B1f7a0Bc152b7D0Dcd7bFfBF1f2Af115f6d';

function nodeFor(label: string): Hex {
  const labels = ROOT.split('.');
  let node = `0x${'00'.repeat(32)}` as Hex;
  for (let index = labels.length - 1; index >= 0; index -= 1) {
    node = keccak256(
      new Uint8Array([
        ...hexToBytes(node),
        ...hexToBytes(keccak256(toBytes(labels[index]))),
      ]),
    );
  }
  return keccak256(
    new Uint8Array([...hexToBytes(node), ...hexToBytes(keccak256(toBytes(label)))]),
  );
}

function hexToBytes(hex: Hex): Uint8Array {
  const clean = hex.slice(2);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

describe.runIf(live)('live registry read', () => {
  it('resolves the address record of a name that really exists', async () => {
    const reader = createL2Reader({ rpcUrls: { 84532: 'https://sepolia.base.org' } });
    const node = nodeFor('xiaoming');

    const result = await reader.read({
      chainId: CHAIN_ID,
      registryAddress: REGISTRY,
      callData: encodeFunctionData({
        abi: [
          {
            type: 'function',
            name: 'addr',
            stateMutability: 'view',
            inputs: [
              { name: 'node', type: 'bytes32' },
              { name: 'coinType', type: 'uint256' },
            ],
            outputs: [{ type: 'bytes' }],
          },
        ],
        functionName: 'addr',
        args: [node, 2147568180n],
      }),
    });

    expect(result.toLowerCase()).toContain(EXPECTED_OWNER.toLowerCase().slice(2));
  });
});
