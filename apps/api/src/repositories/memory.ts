import type { Address } from 'viem';
import type {
  CardVersion,
  CardsRepo,
  CertificationIntent,
  CertificationIntentsRepo,
  InvitationClaim,
  InvitationClaimsRepo,
  NamesRepo,
  NewRegistry,
  PurchaseQuote,
  PurchaseRepo,
  RegistrationRequest,
  RegistrationRequestRepo,
  RegistrationRequestStatus,
  Registry,
  SponsorshipEntry,
  SponsorshipRepo,
} from '../deps.js';

/**
 * In-memory index for tests and for local runs without Postgres.
 *
 * The chain remains the source of truth: this only caches what the API already
 * learned from the chain, so losing it costs nothing but a re-read.
 */
export function createMemoryRepos(): {
  names: NamesRepo;
  sponsorship: SponsorshipRepo;
  requests: RegistrationRequestRepo;
  cards: CardsRepo;
  invitationClaims: InvitationClaimsRepo;
  purchases: PurchaseRepo;
  certificationIntents: CertificationIntentsRepo;
} {
  const byNormalized = new Map<string, Registry>();
  const sponsorships: Array<SponsorshipEntry & { sponsoredAt: Date }> = [];
  const registrationRequests = new Map<string, RegistrationRequest>();
  const cardVersions: CardVersion[] = [];
  const invitationClaims = new Map<string, InvitationClaim>();
  const purchaseQuotes = new Map<string, PurchaseQuote>();
  const certificationIntents = new Map<string, CertificationIntent>();
  let nextId = 1;

  const names: NamesRepo = {
    async findByNormalized(normalized) {
      return byNormalized.get(normalized) ?? null;
    },
    async listByOwner(owner: Address) {
      const target = owner.toLowerCase();
      return [...byNormalized.values()].filter(
        (record) => record.ownerAddress.toLowerCase() === target,
      );
    },
    async insert(record: NewRegistry) {
      const stored: Registry = {
        ...record,
        id: nextId++,
        registeredAt: record.registeredAt ?? new Date(),
      };
      byNormalized.set(stored.normalized, stored);
      return stored;
    },
    async listAll() {
      return [...byNormalized.values()];
    },
    async updateOwner(normalized, ownerAddress) {
      const existing = byNormalized.get(normalized);
      if (!existing) return null;
      const updated: Registry = { ...existing, ownerAddress, status: 'active' };
      byNormalized.set(normalized, updated);
      return updated;
    },
  };

  const sponsorship: SponsorshipRepo = {
    async countForWalletSince(wallet, since) {
      const target = wallet.toLowerCase();
      return sponsorships.filter(
        (entry) =>
          !entry.paid &&
          entry.wallet.toLowerCase() === target &&
          entry.sponsoredAt >= since,
      ).length;
    },
    async countForWalletLifetime(wallet) {
      const target = wallet.toLowerCase();
      return sponsorships.filter(
        (entry) => !entry.paid && entry.wallet.toLowerCase() === target,
      ).length;
    },
    async countPlatformSince(since) {
      return sponsorships.filter((entry) => !entry.paid && entry.sponsoredAt >= since).length;
    },
    async countPlatformLifetime() {
      return sponsorships.filter((entry) => !entry.paid).length;
    },
    async record(entry) {
      sponsorships.push({ ...entry, sponsoredAt: entry.sponsoredAt ?? new Date() });
    },
  };

  const requests: RegistrationRequestRepo = {
    async insert(record) {
      const stored: RegistrationRequest = { ...record, createdAt: record.createdAt ?? new Date() };
      registrationRequests.set(stored.id, stored);
      return stored;
    },
    async findById(id) {
      return registrationRequests.get(id) ?? null;
    },
    async countOpenByHost(host) {
      return [...registrationRequests.values()].filter(
        (request) => request.status === 'pending' && request.requestedByHost === host,
      ).length;
    },
    async countOpenBySubject(subject) {
      const target = subject.toLowerCase();
      return [...registrationRequests.values()].filter(
        (request) => request.status === 'pending' && request.requestedFor.toLowerCase() === target,
      ).length;
    },
    async markStatus(id, status: RegistrationRequestStatus, at) {
      const existing = registrationRequests.get(id);
      if (!existing) return;
      registrationRequests.set(id, {
        ...existing,
        status,
        confirmedAt: status === 'confirmed' ? at : existing.confirmedAt,
      });
    },
  };

  const cards: CardsRepo = {
    async addVersion(input) {
      const existing = cardVersions.filter((row) => row.nameId === input.nameId);
      const version = existing.length === 0 ? 1 : Math.max(...existing.map((row) => row.version)) + 1;
      const stored: CardVersion = {
        id: cardVersions.length + 1,
        nameId: input.nameId,
        version,
        contentHash: input.contentHash,
        visibility: input.visibility,
        ipfsCid: input.ipfsCid ?? null,
        createdAt: input.createdAt ?? new Date(),
      };
      cardVersions.push(stored);
      return stored;
    },
    async listVersions(nameId) {
      return cardVersions
        .filter((row) => row.nameId === nameId)
        .sort((a, b) => b.version - a.version);
    },
  };

  const claims: InvitationClaimsRepo = {
    async findByWallet(wallet) {
      return invitationClaims.get(wallet.toLowerCase()) ?? null;
    },
    async markClaimed(claim) {
      invitationClaims.set(claim.wallet.toLowerCase(), claim);
    },
    async listClaimedWallets() {
      return [...invitationClaims.keys()];
    },
  };

  // D19: purchase quotes. The paid-tx set is shared state checked inside
  // settleQuote so a payment hash can never settle two quotes in one process.
  const usedPaymentTxHashes = new Set<string>();
  const purchases: PurchaseRepo = {
    async insertQuote(input) {
      const stored: PurchaseQuote = {
        ...input,
        status: 'open',
        paymentTxHash: null,
        registerTxHash: null,
        createdAt: input.createdAt ?? new Date(),
      };
      purchaseQuotes.set(stored.id, stored);
      return stored;
    },
    async findQuote(id) {
      return purchaseQuotes.get(id) ?? null;
    },
    async countOpenByOwner(owner) {
      const target = owner.toLowerCase();
      return [...purchaseQuotes.values()].filter(
        (quote) => quote.status === 'open' && quote.owner.toLowerCase() === target,
      ).length;
    },
    async settleQuote(id, paymentTxHash, at) {
      const quote = purchaseQuotes.get(id);
      if (!quote) return null;
      const tx = paymentTxHash.toLowerCase();
      if (quote.status !== 'open' || quote.expiresAt <= at) {
        return null;
      }
      // A payment hash already seen is double-spending — unless it is this
      // same quote retrying after a reopened register step, which is the
      // documented recovery path: the hash stays bound to this quote alone.
      if (usedPaymentTxHashes.has(tx) && quote.paymentTxHash !== tx) {
        return null;
      }
      const updated: PurchaseQuote = { ...quote, status: 'settling', paymentTxHash };
      purchaseQuotes.set(id, updated);
      usedPaymentTxHashes.add(tx);
      return updated;
    },
    async reopenQuote(id) {
      const quote = purchaseQuotes.get(id);
      if (!quote || quote.status !== 'settling') return;
      // Payment stays bound; only the register step is retried.
      purchaseQuotes.set(id, { ...quote, status: 'open' });
    },
    async markSettled(id, registerTxHash, at) {
      const quote = purchaseQuotes.get(id);
      if (!quote) return;
      purchaseQuotes.set(id, { ...quote, status: 'settled', registerTxHash, expiresAt: at });
    },
    async markStatus(id, status) {
      const quote = purchaseQuotes.get(id);
      if (!quote) return;
      purchaseQuotes.set(id, { ...quote, status });
    },
    async countSettledForOwnerSince(owner, since) {
      const target = owner.toLowerCase();
      return [...purchaseQuotes.values()].filter(
        (quote) =>
          quote.owner.toLowerCase() === target &&
          (quote.status === 'settled' || quote.status === 'settling') &&
          quote.createdAt >= since,
      ).length;
    },
    async purchaseTotals() {
      const settled = [...purchaseQuotes.values()].filter((quote) => quote.status === 'settled');
      const totalUsd = settled.reduce((sum, quote) => sum + quote.priceUsd, 0);
      const lastSettledAt = settled.reduce<Date | null>(
        (latest, quote) => (latest === null || quote.expiresAt > latest ? quote.expiresAt : latest),
        null,
      );
      return { count: settled.length, totalUsd: Math.round(totalUsd * 100) / 100, lastSettledAt };
    },
  };

  const certification: CertificationIntentsRepo = {
    async insert({ contact, note, createdAt }) {
      const key = contact.trim().toLowerCase();
      const existing = certificationIntents.get(key);
      // A repeat sign-up is not a new signal; it keeps its original date.
      if (existing) return existing;
      const record: CertificationIntent = {
        id: `cert-${nextId++}`,
        contact: contact.trim(),
        note: note?.trim() || null,
        createdAt: createdAt ?? new Date(),
      };
      certificationIntents.set(key, record);
      return record;
    },
    async countAll() {
      return certificationIntents.size;
    },
    async countSince(since) {
      return [...certificationIntents.values()].filter((entry) => entry.createdAt >= since).length;
    },
  };

  return { names, sponsorship, requests, cards, invitationClaims: claims, purchases, certificationIntents: certification };
}
