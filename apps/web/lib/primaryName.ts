/**
 * Primary names: the reverse direction.
 *
 * Forward resolution (name → address) works and is what every wallet uses to
 * send. This is the other direction: what a wallet *displays* for an address.
 * Without a reverse record it shows `0x603b…`, with one it shows the name, and
 * that difference is most of what "my AI has a name" looks like in practice.
 *
 * The record lives on Ethereum mainnet, in the reverse namespace ENS owns at
 * `addr.reverse`, and the only account that can set it is the address it
 * describes — so this is a button the name's owner has to press, not something
 * the platform can do for them.
 */
import { encodeFunctionData, namehash, type Address, type Hex } from 'viem';

/** ENS's ReverseRegistrar: the owner of `addr.reverse`, read from the registry. */
export const REVERSE_REGISTRAR: Address = '0xa58E81fe9b61B5c3fE2AFD33CF304c454AbFc7Cb';

export const REVERSE_REGISTRAR_ABI = [
  {
    type: 'function',
    name: 'setName',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [],
  },
] as const;

export const REVERSE_RESOLVER_ABI = [
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'string' }],
  },
] as const;

export const ENS_REGISTRY_ABI_FOR_REVERSE = [
  {
    type: 'function',
    name: 'resolver',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
  },
] as const;

export const ENS_REGISTRY: Address = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';

/** `<address>.addr.reverse`, the node that holds an address's primary name. */
export function reverseNodeFor(address: Address): Hex {
  return namehash(`${address.slice(2).toLowerCase()}.addr.reverse`);
}

export function setNameCalldata(fullName: string): Hex {
  return encodeFunctionData({
    abi: REVERSE_REGISTRAR_ABI,
    functionName: 'setName',
    args: [fullName],
  });
}

export interface PrimaryNameState {
  connected: Address | null;
  owner: string;
  fullName: string;
  /** What the reverse record currently says, or null when unset. */
  currentPrimary: string | null;
}

export interface PrimaryNamePrompt {
  /** Whether the button should be offered at all. */
  offer: boolean;
  /** Already pointing here. */
  done: boolean;
  /** One sentence for the page, whatever the state. */
  message: string;
  /** False when the visitor cannot act: a different wallet is connected. */
  actionable: boolean;
}

export function describePrimaryName(state: PrimaryNameState): PrimaryNamePrompt {
  const isOwner = Boolean(
    state.connected && state.owner && state.connected.toLowerCase() === state.owner.toLowerCase(),
  );

  if (state.currentPrimary && state.currentPrimary.toLowerCase() === state.fullName.toLowerCase()) {
    return {
      offer: false,
      done: true,
      actionable: false,
      message: `这个地址的主名字已经设成 ${state.fullName}，钱包里会显示名字而不是地址。`,
    };
  }

  if (!isOwner) {
    return {
      offer: true,
      done: false,
      actionable: false,
      message: state.currentPrimary
        ? `这个地址现在的主名字是 ${state.currentPrimary}。只有持有者本人能改——请用 ${state.owner} 连接钱包。`
        : `这个地址还没有设主名字，所以钱包里显示的是 0x 地址。只有持有者本人能设——请用 ${state.owner} 连接钱包。`,
    };
  }

  return {
    offer: true,
    done: false,
    actionable: true,
    message: state.currentPrimary
      ? `你现在的主名字是 ${state.currentPrimary}，可以改成 ${state.fullName}。`
      : `把 ${state.fullName} 设成主名字，钱包里就会显示名字而不是 0x 地址。这是主网上的一笔交易，gas 由你付。`,
  };
}
