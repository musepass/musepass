import type { Address } from 'viem';
import type {
  CardVersion,
  CardsRepo,
  InvitationClaim,
  InvitationClaimsRepo,
  NamesRepo,
  NewRegistry,
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
} {
  const byNormalized = new Map<string, Registry>();
  const sponsorships: Array<SponsorshipEntry & { sponsoredAt: Date }> = [];
  const registrationRequests = new Map<string, RegistrationRequest>();
  const cardVersions: CardVersion[] = [];
  const invitationClaims = new Map<string, InvitationClaim>();
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
        (entry) => entry.wallet.toLowerCase() === target && entry.sponsoredAt >= since,
      ).length;
    },
    async countForWalletLifetime(wallet) {
      const target = wallet.toLowerCase();
      return sponsorships.filter((entry) => entry.wallet.toLowerCase() === target).length;
    },
    async countPlatformSince(since) {
      return sponsorships.filter((entry) => entry.sponsoredAt >= since).length;
    },
    async countPlatformLifetime() {
      return sponsorships.length;
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

  return { names, sponsorship, requests, cards, invitationClaims: claims };
}
