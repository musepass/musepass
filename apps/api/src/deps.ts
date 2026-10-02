import type { MusenameConfig, ReservedIndex } from '@musename/core';
import type { Address, Hex } from 'viem';
import type { Logger } from './observability.js';

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
  /** Every indexed row. Used by the reconciliation job. */
  listAll(): Promise<Registry[]>;
  /** Used by reconciliation: the chain says the owner changed. */
  updateOwner(normalized: string, ownerAddress: Address): Promise<Registry | null>;
}

export interface SponsorshipEntry {
  wallet: Address;
  txHash: Hex;
  nameId?: number | null;
  gasCostWei?: bigint;
  sponsoredAt?: Date;
  /** D19: true when the wallet paid for this name. Paid rows are excluded from every free-claim cap. */
  paid?: boolean;
}

export interface SponsorshipRepo {
  countForWalletSince(wallet: Address, since: Date): Promise<number>;
  countForWalletLifetime(wallet: Address): Promise<number>;
  countPlatformSince(since: Date): Promise<number>;
  /** Every sponsored registration ever, for the total count and USD caps. */
  countPlatformLifetime(): Promise<number>;
  record(entry: SponsorshipEntry): Promise<void>;
}

export type PurchaseQuoteStatus = 'open' | 'settling' | 'settled' | 'expired' | 'failed';
export type PurchaseKind = 'tier-4' | 'additional-name';

/**
 * D19: a price locked for one label and one payer. The buyer transfers the
 * quoted USDG amount on-chain, then submits with the payment tx hash; the API
 * verifies the Transfer and only then sponsors the registration.
 *
 * `paymentTxHash` is unique across the table: one payment buys exactly one
 * name, enforced by the database, not by application discipline.
 */
export interface PurchaseQuote {
  id: string;
  label: string;
  owner: Address;
  kind: PurchaseKind;
  priceUsd: number;
  /** Integer amount in token base units, decimal string (e.g. "5000000"). */
  amountBaseUnits: string;
  token: Address;
  treasury: Address;
  chainId: number;
  status: PurchaseQuoteStatus;
  paymentTxHash: Hex | null;
  registerTxHash: Hex | null;
  expiresAt: Date;
  createdAt: Date;
}

export interface PurchaseRepo {
  insertQuote(
    quote: Omit<PurchaseQuote, 'status' | 'paymentTxHash' | 'registerTxHash' | 'createdAt'> & {
      createdAt?: Date;
    },
  ): Promise<PurchaseQuote>;
  findQuote(id: string): Promise<PurchaseQuote | null>;
  countOpenByOwner(owner: Address): Promise<number>;
  /**
   * Atomically binds a payment tx to an open, unexpired quote.
   * Null when the quote is gone, not open, expired, or the tx is already used.
   */
  settleQuote(id: string, paymentTxHash: Hex, at: Date): Promise<PurchaseQuote | null>;
  /** Register failed: the payment stays bound and the same tx can be retried. */
  reopenQuote(id: string): Promise<void>;
  markSettled(id: string, registerTxHash: Hex, at: Date): Promise<void>;
  markStatus(id: string, status: 'expired' | 'failed', at: Date): Promise<void>;
  /** Settled purchases for a wallet since a date (daily purchase cap). */
  countSettledForOwnerSince(owner: Address, since: Date): Promise<number>;
  /** Aggregate over settled purchases, for the public scoreboard. */
  purchaseTotals(): Promise<{ count: number; totalUsd: number; lastSettledAt: Date | null }>;
}

/**
 * D17: the proof that an invitation was spent. One invitation is worth one
 * name, so this ledger — not the config file — is what stops a second claim.
 *
 * The config file lists who was invited; this table records who already used
 * it. Keeping them apart means `pnpm push:config` cannot reset a claim, and a
 * claim survives the invitation row being edited out of the list.
 */
export interface InvitationClaim {
  wallet: Address;
  claimedLabel: string;
  txHash: Hex | null;
  claimedAt: Date;
}

export interface InvitationClaimsRepo {
  findByWallet(wallet: Address): Promise<InvitationClaim | null>;
  /** Idempotent per wallet: writing a second claim for the same wallet is a no-op. */
  markClaimed(claim: InvitationClaim): Promise<void>;
  /** Every wallet that has spent its invitation, lowercased. For the public count. */
  listClaimedWallets(): Promise<string[]>;
}

/**
 * Card version history.
 *
 * The chain keeps every version too — Durin's resolver writes text records into
 * versioned storage — but this index is what lets us show the history without
 * walking chain state. It only knows what was published through this API; a
 * record written directly to the registry will not appear here.
 */
export interface CardVersion {
  id: number;
  nameId: number;
  version: number;
  contentHash: string;
  visibility: Record<string, string>;
  ipfsCid: string | null;
  createdAt: Date;
}

export interface CardsRepo {
  addVersion(input: {
    nameId: number;
    contentHash: string;
    visibility: Record<string, string>;
    ipfsCid?: string | null;
    createdAt?: Date;
  }): Promise<CardVersion>;
  listVersions(nameId: number): Promise<CardVersion[]>;
}

export interface ChainReader {
  /**
   * Every name this registrar has minted, read from its own events.
   *
   * The index is a cache and can be empty (a memory index is emptied by a
   * restart), so anything published as a fact about the world has to come from
   * here. Implementations may cache: this walks logs, it is not a per-request
   * read.
   */
  listNames(): Promise<Array<{ label: string; owner: Address; blockNumber: number; txHash: Hex }>>;
  /** Registrar's own view: min length, on-chain reserved mirror and ownership. */
  isLabelAvailable(label: string): Promise<boolean>;
  getOwner(label: string): Promise<Address | null>;
  /** Reads an ENS text record off the L2 registry. */
  readText(label: string, key: string): Promise<string | null>;
  /** Writes one, authorised by the owner's signature rather than by us. */
  writeText(input: {
    label: string;
    key: string;
    value: string;
    expiration: bigint;
    signer: Address;
    signature: Hex;
  }): Promise<{ txHash: Hex }>;
  register(input: {
    label: string;
    owner: Address;
    deadline: bigint;
    signature: Hex;
  }): Promise<{ txHash: Hex; node: Hex }>;
  /**
   * D19: verifies an ERC-20 payment. Checks the receipt exists and succeeded,
   * then scans Transfer logs for `token` moving `from` → `to` with at least
   * `minAmount` base units. Read-only, so it works on a read-only node.
   */
  verifyPayment(input: {
    txHash: Hex;
    token: Address;
    from: Address;
    to: Address;
    minAmount: bigint;
  }): Promise<
    | { ok: true; amount: bigint; blockNumber: number }
    | { ok: false; reason: 'NOT_FOUND' | 'REVERTED' | 'WRONG_TOKEN' | 'WRONG_FROM' | 'WRONG_TO' | 'INSUFFICIENT' }
  >;
  /**
   * Live ETH balance of the sponsor (issuer) wallet on the L2, published in
   * the metrics budget block so a stranger can see the giveaway is funded.
   * Optional: null when no issuer key is configured; implementations may
   * cache, and an RPC failure surfaces as null rather than an error.
   */
  getSponsorBalanceEth?(): Promise<number | null>;
}

export type RegistrationRequestStatus = 'pending' | 'confirmed' | 'expired' | 'rejected';

/**
 * A registration an AI asked for on its owner's behalf. It is only a request:
 * nothing is minted until the owner signs, and the token is stored hashed so a
 * database leak does not hand out confirm links.
 */
export interface RegistrationRequest {
  id: string;
  label: string;
  requestedByHost: string | null;
  /** Email address or wallet address the link is meant for. */
  requestedFor: string;
  confirmTokenHash: string;
  expiresAt: Date;
  status: RegistrationRequestStatus;
  createdAt: Date;
  confirmedAt: Date | null;
}

export interface RegistrationRequestRepo {
  insert(record: Omit<RegistrationRequest, 'createdAt'> & { createdAt?: Date }): Promise<RegistrationRequest>;
  findById(id: string): Promise<RegistrationRequest | null>;
  countOpenByHost(host: string): Promise<number>;
  countOpenBySubject(subject: string): Promise<number>;
  markStatus(id: string, status: RegistrationRequestStatus, at: Date): Promise<void>;
}

/**
 * Certification is designed ($5/month, phase 5) but not running, so there is
 * nothing to buy yet. This table collects who wants to be told when it opens.
 * Contacts stay private — only counts are published, same rule as invitations.
 */
export interface CertificationIntent {
  id: string;
  contact: string;
  note: string | null;
  createdAt: Date;
}

export interface CertificationIntentsRepo {
  /** Idempotent per contact (case-insensitive): a repeat sign-up is a no-op. */
  insert(input: { contact: string; note?: string | null; createdAt?: Date }): Promise<CertificationIntent>;
  countAll(): Promise<number>;
  countSince(since: Date): Promise<number>;
}

export interface MusenameDeps {
  config: MusenameConfig;
  reservedIndex: ReservedIndex;
  chain: ChainReader;
  names: NamesRepo;
  requests: RegistrationRequestRepo;
  cards: CardsRepo;
  sponsorship: SponsorshipRepo;
  invitationClaims: InvitationClaimsRepo;
  purchases: PurchaseRepo;
  certificationIntents: CertificationIntentsRepo;
  /**
   * 'postgres' when DATABASE_URL is set, 'memory' otherwise.
   *
   * Everything the index holds is a cache of chain facts, so a memory index is
   * not wrong — but a restart empties it, and any count read from it would look
   * like a fact about the world while actually being a fact about one process.
   * Public numbers must say which one they are.
   */
  indexKind: 'memory' | 'postgres';
  /** Injectable so tests are not time dependent. */
  clock: () => Date;
  /** Injectable so tests can assert on log lines. */
  logger?: Logger;
}
