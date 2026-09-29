/**
 * Anchoring: many records, one root.
 *
 * ERC-8412 pins each verdict to its criteria and its evidence. What it does not
 * say is where a whole day of verdicts goes. That part is ours: every record's
 * digest is a leaf, the leaves are folded into one root, and only the root is
 * written on chain. Anybody holding one record plus its proof can show it was in
 * that root without us being online or trusted.
 *
 * The pairing rule is the one OpenZeppelin's MerkleProof uses — sort each pair
 * before hashing — so a proof produced here verifies on chain against a
 * standard verifier, and vice versa.
 */
import { concat, keccak256, type Hex } from 'viem';

export interface MerkleProof {
  leaf: Hex;
  proof: Hex[];
  root: Hex;
  index: number;
}

function hashPair(a: Hex, b: Hex): Hex {
  return BigInt(a) < BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

export function merkleRoot(leaves: Hex[]): Hex {
  if (leaves.length === 0) throw new Error('a merkle root needs at least one leaf');
  let level = [...leaves];
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]!;
      const right = level[index + 1];
      // An odd leaf is carried up unchanged, which is the convention ZK
      // circuits and OpenZeppelin both assume.
      next.push(right === undefined ? left : hashPair(left, right));
    }
    level = next;
  }
  return level[0]!;
}

export function merkleProof(leaves: Hex[], index: number): MerkleProof {
  if (index < 0 || index >= leaves.length) throw new Error(`no leaf at ${index}`);
  const leaf = leaves[index]!;
  const proof: Hex[] = [];
  let level = [...leaves];
  let position = index;

  while (level.length > 1) {
    const sibling = position % 2 === 0 ? position + 1 : position - 1;
    if (sibling < level.length) proof.push(level[sibling]!);
    const next: Hex[] = [];
    for (let cursor = 0; cursor < level.length; cursor += 2) {
      const left = level[cursor]!;
      const right = level[cursor + 1];
      next.push(right === undefined ? left : hashPair(left, right));
    }
    level = next;
    position = Math.floor(position / 2);
  }

  return { leaf, proof, root: level[0]!, index };
}

export function verifyMerkleProof(input: { root: Hex; leaf: Hex; proof: Hex[] }): boolean {
  let computed = input.leaf;
  for (const step of input.proof) computed = hashPair(computed, step);
  return computed === input.root;
}
