import type { Address, Hex } from 'viem';
import type {
  CardVersion,
  CardsRepo,
  InvitationClaim,
  InvitationClaimsRepo,
  NamesRepo,
  NewRegistry,
  PurchaseQuote,
  PurchaseRepo,
  PurchaseQuoteStatus,
  RegistrationRequest,
  RegistrationRequestRepo,
  RegistrationRequestStatus,
  Registry,
  SponsorshipEntry,
  SponsorshipRepo,
} from '../deps.js';
import type { Sql } from './sql.js';

interface NameRow {
  id: string;
  label: string;
  full_name: string;
  normalized: string;
  owner_address: string;
  tier: string;
  status: string;
  registered_at: Date | string;
  registered_via: string;
  agent_host: string | null;
  tx_hash: string | null;
}

interface RequestRow {
  id: string;
  label: string;
  requested_by_host: string | null;
  requested_for: string;
  confirm_token_hash: string;
  expires_at: Date | string;
  status: string;
  created_at: Date | string;
  confirmed_at: Date | string | null;
}

interface PurchaseQuoteRow {
  id: string;
  label: string;
  owner_address: string;
  kind: string;
  price_usd: string;
  amount_base_units: string;
  token: string;
  treasury: string;
  chain_id: number;
  status: string;
  payment_tx_hash: string | null;
  register_tx_hash: string | null;
  expires_at: Date | string;
  created_at: Date | string;
  settled_at: Date | string | null;
}

function toPurchaseQuote(row: PurchaseQuoteRow): PurchaseQuote {
  return {
    id: row.id,
    label: row.label,
    owner: row.owner_address as Address,
    kind: row.kind as PurchaseQuote['kind'],
    priceUsd: Number(row.price_usd),
    amountBaseUnits: row.amount_base_units,
    token: row.token as Address,
    treasury: row.treasury as Address,
    chainId: Number(row.chain_id),
    status: row.status as PurchaseQuoteStatus,
    paymentTxHash: (row.payment_tx_hash as Hex | null) ?? null,
    registerTxHash: (row.register_tx_hash as Hex | null) ?? null,
    expiresAt: new Date(row.expires_at),
    createdAt: new Date(row.created_at),
  };
}

function toRegistry(row: NameRow): Registry {
  return {
    id: Number(row.id),
    label: row.label,
    fullName: row.full_name,
    normalized: row.normalized,
    ownerAddress: row.owner_address as Address,
    tier: row.tier as Registry['tier'],
    status: row.status as Registry['status'],
    registeredAt: new Date(row.registered_at),
    registeredVia: row.registered_via as Registry['registeredVia'],
    agentHost: row.agent_host,
    txHash: (row.tx_hash as Hex | null) ?? null,
  };
}

function toRequest(row: RequestRow): RegistrationRequest {
  return {
    id: row.id,
    label: row.label,
    requestedByHost: row.requested_by_host,
    requestedFor: row.requested_for,
    confirmTokenHash: row.confirm_token_hash,
    expiresAt: new Date(row.expires_at),
    status: row.status as RegistrationRequestStatus,
    createdAt: new Date(row.created_at),
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at) : null,
  };
}

/**
 * Postgres implementation of the three repositories.
 *
 * Everything here is an index over chain state, never a source of truth: when
 * the two disagree the chain wins and a reconciliation job repairs the row.
 */
export function createPostgresRepos(sql: Sql): {
  names: NamesRepo;
  sponsorship: SponsorshipRepo;
  requests: RegistrationRequestRepo;
  cards: CardsRepo;
  invitationClaims: InvitationClaimsRepo;
  purchases: PurchaseRepo;
} {
  const names: NamesRepo = {
    async findByNormalized(normalized) {
      const { rows } = await sql.query<NameRow>(
        'select * from names where normalized = $1 limit 1',
        [normalized],
      );
      return rows[0] ? toRegistry(rows[0]) : null;
    },

    async listByOwner(owner) {
      const { rows } = await sql.query<NameRow>(
        'select * from names where lower(owner_address) = lower($1) order by registered_at',
        [owner],
      );
      return rows.map(toRegistry);
    },

    async insert(record: NewRegistry) {
      const { rows } = await sql.query<NameRow>(
        `insert into names
           (label, full_name, normalized, owner_address, tier, status,
            registered_via, agent_host, tx_hash, registered_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9, coalesce($10, now()))
         returning *`,
        [
          record.label,
          record.fullName,
          record.normalized,
          record.ownerAddress,
          record.tier,
          record.status,
          record.registeredVia,
          record.agentHost,
          record.txHash,
          record.registeredAt ?? null,
        ],
      );
      return toRegistry(rows[0]);
    },

    async listAll() {
      const { rows } = await sql.query<NameRow>('select * from names order by registered_at');
      return rows.map(toRegistry);
    },

    async updateOwner(normalized, ownerAddress) {
      const { rows } = await sql.query<NameRow>(
        `update names
            set owner_address = $2, status = 'active'
          where normalized = $1
          returning *`,
        [normalized, ownerAddress],
      );
      return rows[0] ? toRegistry(rows[0]) : null;
    },
  };

  const sponsorship: SponsorshipRepo = {
    async countForWalletSince(wallet, since) {
      const { rows } = await sql.query<{ count: string }>(
        `select count(*)::text as count from sponsorship_ledger
         where lower(wallet_address) = lower($1) and sponsored_at >= $2 and not paid`,
        [wallet, since],
      );
      return Number(rows[0]?.count ?? 0);
    },

    async countForWalletLifetime(wallet) {
      const { rows } = await sql.query<{ count: string }>(
        `select count(*)::text as count from sponsorship_ledger
         where lower(wallet_address) = lower($1) and not paid`,
        [wallet],
      );
      return Number(rows[0]?.count ?? 0);
    },

    async countPlatformSince(since) {
      const { rows } = await sql.query<{ count: string }>(
        'select count(*)::text as count from sponsorship_ledger where sponsored_at >= $1 and not paid',
        [since],
      );
      return Number(rows[0]?.count ?? 0);
    },

    async countPlatformLifetime() {
      const { rows } = await sql.query<{ count: string }>(
        'select count(*)::text as count from sponsorship_ledger where not paid',
      );
      return Number(rows[0]?.count ?? 0);
    },

    async record(entry: SponsorshipEntry) {
      await sql.query(
        `insert into sponsorship_ledger
           (name_id, wallet_address, tx_hash, gas_cost_wei, sponsored_at, paid)
         values ($1,$2,$3,$4, coalesce($5, now()), $6)`,
        [
          entry.nameId ?? null,
          entry.wallet,
          entry.txHash,
          entry.gasCostWei ?? null,
          entry.sponsoredAt ?? null,
          entry.paid ?? false,
        ],
      );
    },
  };

  const requests: RegistrationRequestRepo = {
    async insert(record) {
      const { rows } = await sql.query<RequestRow>(
        `insert into registration_requests
           (id, label, requested_by_host, requested_for, confirm_token_hash,
            expires_at, status, confirmed_at, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8, coalesce($9, now()))
         returning *`,
        [
          record.id,
          record.label,
          record.requestedByHost,
          record.requestedFor,
          record.confirmTokenHash,
          record.expiresAt,
          record.status,
          record.confirmedAt,
          record.createdAt ?? null,
        ],
      );
      return toRequest(rows[0]);
    },

    async findById(id) {
      const { rows } = await sql.query<RequestRow>(
        'select * from registration_requests where id = $1 limit 1',
        [id],
      );
      return rows[0] ? toRequest(rows[0]) : null;
    },

    async countOpenByHost(host) {
      const { rows } = await sql.query<{ count: string }>(
        `select count(*)::text as count from registration_requests
         where status = 'pending' and requested_by_host = $1`,
        [host],
      );
      return Number(rows[0]?.count ?? 0);
    },

    async countOpenBySubject(subject) {
      const { rows } = await sql.query<{ count: string }>(
        `select count(*)::text as count from registration_requests
         where status = 'pending' and lower(requested_for) = lower($1)`,
        [subject],
      );
      return Number(rows[0]?.count ?? 0);
    },

    async markStatus(id, status, at) {
      await sql.query(
        `update registration_requests
            set status = $2,
                confirmed_at = case when $2 = 'confirmed' then $3 else confirmed_at end
          where id = $1`,
        [id, status, at],
      );
    },
  };

  const cards: CardsRepo = {
    async addVersion(input) {
      // version is computed in SQL so two concurrent publishes cannot both
      // claim the same number.
      const { rows } = await sql.query<{
        id: string;
        name_id: string;
        version: number;
        content_hash: string;
        visibility: Record<string, string>;
        ipfs_cid: string | null;
        created_at: Date | string;
      }>(
        `insert into cards (name_id, version, content_hash, visibility, ipfs_cid, created_at)
         values (
           $1,
           coalesce((select max(version) from cards where name_id = $1), 0) + 1,
           $2, $3, $4, coalesce($5, now())
         )
         returning *`,
        [
          input.nameId,
          input.contentHash,
          JSON.stringify(input.visibility),
          input.ipfsCid ?? null,
          input.createdAt ?? null,
        ],
      );
      const row = rows[0];
      return {
        id: Number(row.id),
        nameId: Number(row.name_id),
        version: Number(row.version),
        contentHash: row.content_hash,
        visibility: row.visibility,
        ipfsCid: row.ipfs_cid,
        createdAt: new Date(row.created_at),
      } satisfies CardVersion;
    },

    async listVersions(nameId) {
      const { rows } = await sql.query<{
        id: string;
        name_id: string;
        version: number;
        content_hash: string;
        visibility: Record<string, string>;
        ipfs_cid: string | null;
        created_at: Date | string;
      }>('select * from cards where name_id = $1 order by version desc', [nameId]);
      return rows.map((row) => ({
        id: Number(row.id),
        nameId: Number(row.name_id),
        version: Number(row.version),
        contentHash: row.content_hash,
        visibility: row.visibility,
        ipfsCid: row.ipfs_cid,
        createdAt: new Date(row.created_at),
      }));
    },
  };

  // Unlike the other tables here, this one is not an index over chain state: it
  // is the record that an invitation was spent, and the chain cannot say that.
  // on conflict do nothing: the first write wins, so a claim cannot be rewritten.
  const invitationClaims: InvitationClaimsRepo = {
    async findByWallet(wallet) {
      const { rows } = await sql.query<{
        wallet_address: string;
        claimed_label: string;
        tx_hash: string | null;
        claimed_at: Date | string;
      }>(
        'select * from invitation_claims where lower(wallet_address) = lower($1) limit 1',
        [wallet],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        wallet: row.wallet_address as Address,
        claimedLabel: row.claimed_label,
        txHash: (row.tx_hash as Hex | null) ?? null,
        claimedAt: new Date(row.claimed_at),
      };
    },

    async markClaimed(claim) {
      await sql.query(
        `insert into invitation_claims (wallet_address, claimed_label, tx_hash, claimed_at)
         values ($1,$2,$3, coalesce($4, now()))
         on conflict (wallet_address) do nothing`,
        [claim.wallet, claim.claimedLabel, claim.txHash, claim.claimedAt],
      );
    },

    async listClaimedWallets() {
      const { rows } = await sql.query<{ wallet: string }>(
        'select lower(wallet_address) as wallet from invitation_claims',
      );
      return rows.map((row) => row.wallet);
    },
  };

  // D19: paid purchase rail. settleQuote is the double-spend guard: the
  // conditional UPDATE plus the UNIQUE index on payment_tx_hash means a
  // payment hash can only ever bind to one quote, even under concurrent calls.
  const purchases: PurchaseRepo = {
    async insertQuote(input) {
      const { rows } = await sql.query<PurchaseQuoteRow>(
        `insert into purchase_quotes
           (id, label, owner_address, kind, price_usd, amount_base_units,
            token, treasury, chain_id, status, expires_at, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open',$10, coalesce($11, now()))
         returning *`,
        [
          input.id,
          input.label,
          input.owner,
          input.kind,
          input.priceUsd,
          input.amountBaseUnits,
          input.token,
          input.treasury,
          input.chainId,
          input.expiresAt,
          input.createdAt ?? null,
        ],
      );
      return toPurchaseQuote(rows[0]);
    },

    async findQuote(id) {
      const { rows } = await sql.query<PurchaseQuoteRow>(
        'select * from purchase_quotes where id = $1 limit 1',
        [id],
      );
      return rows[0] ? toPurchaseQuote(rows[0]) : null;
    },

    async countOpenByOwner(owner) {
      const { rows } = await sql.query<{ count: string }>(
        `select count(*)::text as count from purchase_quotes
         where status = 'open' and lower(owner_address) = lower($1)`,
        [owner],
      );
      return Number(rows[0]?.count ?? 0);
    },

    async settleQuote(id, paymentTxHash, at) {
      try {
        // The `case` keeps a retried submit (after reopenQuote) from
        // rewriting payment_tx_hash with the value it already holds — a fresh
        // index insert trips the unique check even when nothing changed. The
        // where clause also refuses to bind a *different* payment to a
        // reopened quote: the first payment stays the owner of that quote.
        const { rows } = await sql.query<PurchaseQuoteRow>(
          `update purchase_quotes
              set status = 'settling',
                  payment_tx_hash = case when payment_tx_hash is null then $2 else payment_tx_hash end
            where id = $1 and status = 'open' and expires_at > $3
              and (payment_tx_hash is null or payment_tx_hash = $2)
            returning *`,
          [id, paymentTxHash, at],
        );
        return rows[0] ? toPurchaseQuote(rows[0]) : null;
      } catch (error) {
        // Unique violation on payment_tx_hash: this payment already bought something.
        if (isUniqueViolation(error)) return null;
        throw error;
      }
    },

    async reopenQuote(id) {
      await sql.query(
        `update purchase_quotes set status = 'open'
          where id = $1 and status = 'settling'`,
        [id],
      );
    },

    async markSettled(id, registerTxHash, at) {
      await sql.query(
        `update purchase_quotes
            set status = 'settled', register_tx_hash = $2, settled_at = $3
          where id = $1`,
        [id, registerTxHash, at],
      );
    },

    async markStatus(id, status, at) {
      await sql.query(
        `update purchase_quotes set status = $2 where id = $1`,
        [id, status],
      );
    },

    async countSettledForOwnerSince(owner, since) {
      const { rows } = await sql.query<{ count: string }>(
        `select count(*)::text as count from purchase_quotes
         where lower(owner_address) = lower($1)
           and status in ('settled', 'settling')
           and coalesce(settled_at, created_at) >= $2`,
        [owner, since],
      );
      return Number(rows[0]?.count ?? 0);
    },
  };

  return { names, sponsorship, requests, cards, invitationClaims, purchases };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505';
}
