import type { Address } from 'viem';
import type {
  NamesRepo,
  NewRegistry,
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
export function createMemoryRepos(): { names: NamesRepo; sponsorship: SponsorshipRepo } {
  const byNormalized = new Map<string, Registry>();
  const sponsorships: Array<SponsorshipEntry & { sponsoredAt: Date }> = [];
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
    async record(entry) {
      sponsorships.push({ ...entry, sponsoredAt: entry.sponsoredAt ?? new Date() });
    },
  };

  return { names, sponsorship };
}
