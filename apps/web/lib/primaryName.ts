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
      message: `This address already points at ${state.fullName} as its primary name, so wallets show the name instead of the address.`,
    };
  }

  if (!isOwner) {
    return {
      offer: true,
      done: false,
      actionable: false,
      message: state.currentPrimary
        ? `This address currently uses ${state.currentPrimary} as its primary name. Only the holder can change it — connect with ${state.owner}.`
        : `This address has no primary name yet, which is why wallets show a hex address. Only the holder can set it — connect with ${state.owner}.`,
    };
  }

  return {
    offer: true,
    done: false,
    actionable: true,
    message: state.currentPrimary
      ? `Your primary name is currently ${state.currentPrimary}; you can change it to ${state.fullName}.`
      : `Set ${state.fullName} as your primary name and wallets will show the name instead of a hex address. It is one transaction on Ethereum mainnet, and you pay the gas.`,
  };
}
