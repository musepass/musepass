import type { MusenameConfig, ReservedIndex } from '@musename/core';
import type { Address, Hex } from 'viem';

export type Registry = {
  id: number;
  label: string;
  fullName: string;
  normalized: string;
  ownerAddress: Address;
  tier: 'free' | 'premium' | 'enterprise';
  status: 'active' | 'expired' | 'reserved';
  registeredAt: Date;
  registeredVia: 'web' | 'mcp';
  agentHost: string | null;
  txHash: Hex | null;
};

export type NewRegistry = Omit<Registry, 'id' | 'registeredAt'> & { registeredAt?: Date };

export interface NamesRepo {
  findByNormalized(normalized: string): Promise<Registry | null>;
  listByOwner(owner: Address): Promise<Registry[]>;
  insert(record: NewRegistry): Promise<Registry>;
}

export interface SponsorshipEntry {
  wallet: Address;
  txHash: Hex;
  nameId?: number | null;
  gasCostWei?: bigint;
  sponsoredAt?: Date;
}

export interface SponsorshipRepo {
  countForWalletSince(wallet: Address, since: Date): Promise<number>;
  countForWalletLifetime(wallet: Address): Promise<number>;
  countPlatformSince(since: Date): Promise<number>;
  record(entry: SponsorshipEntry): Promise<void>;
}

export interface ChainReader {
  /** Registrar's own view: min length, on-chain reserved mirror and ownership. */
  isLabelAvailable(label: string): Promise<boolean>;
  getOwner(label: string): Promise<Address | null>;
  register(input: {
    label: string;
    owner: Address;
    deadline: bigint;
    signature: Hex;
  }): Promise<{ txHash: Hex; node: Hex }>;
}

export interface MusenameDeps {
  config: MusenameConfig;
  reservedIndex: ReservedIndex;
  chain: ChainReader;
  names: NamesRepo;
  sponsorship: SponsorshipRepo;
  /** Injectable so tests are not time dependent. */
  clock: () => Date;
}
