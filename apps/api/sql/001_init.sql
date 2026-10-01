-- MuseName schema. Chain is the source of truth; this database is an index and
-- a cache. When the two disagree, the chain wins and a reconciliation job
-- repairs the row (see Todo: daily reconciliation).

create table if not exists names (
  id                bigserial primary key,
  label             text        not null,
  full_name         text        not null,
  normalized        text        not null,
  owner_address     text        not null,
  token_id          numeric(78, 0),
  tier              text        not null check (tier in ('free', 'premium', 'enterprise')),
  status            text        not null check (status in ('active', 'expired', 'reserved')),
  registered_at     timestamptz not null default now(),
  registered_via    text        not null check (registered_via in ('web', 'mcp')),
  agent_host        text,
  tx_hash           text,
  unique (normalized)
);

create index if not exists names_owner_idx on names (owner_address);

create table if not exists reserved_names (
  label_normalized  text primary key,
  reason            text not null check (reason in ('brand', 'public_figure', 'platform', 'sensitive', 'system')),
  note              text,
  added_at          timestamptz not null default now()
);

create table if not exists registration_requests (
  id                uuid primary key,
  label             text        not null,
  requested_by_host text,
  requested_for     text        not null,
  confirm_token_hash text       not null,
  expires_at        timestamptz not null,
  status            text        not null check (status in ('pending', 'confirmed', 'expired', 'rejected')),
  created_at        timestamptz not null default now(),
  confirmed_at      timestamptz
);

create index if not exists registration_requests_status_idx
  on registration_requests (status, expires_at);

create table if not exists cards (
  id                bigserial primary key,
  name_id           bigint      not null references names (id) on delete cascade,
  version           integer     not null,
  ipfs_cid          text,
  content_hash      text        not null,
  visibility        jsonb       not null default '{}'::jsonb,
  erc8004_id        numeric(78, 0),
  created_at        timestamptz not null default now(),
  unique (name_id, version)
);

create table if not exists criteria (
  id                bigserial primary key,
  subject_name_id   bigint      not null references names (id) on delete cascade,
  content           jsonb       not null,
  content_hash      text        not null,
  registered_at     timestamptz not null default now(),
  registered_by     text        not null
);

create table if not exists records (
  id                bigserial primary key,
  subject_name_id   bigint      not null references names (id) on delete cascade,
  claim             text        not null,
  criteria_id       bigint      references criteria (id),
  evidence          jsonb       not null,
  verdict           text        not null check (verdict in ('pass', 'fail', 'insufficient')),
  issuer            text        not null,
  signature         text        not null,
  anchor_batch_id   bigint,
  created_at        timestamptz not null default now()
);

create table if not exists anchor_batches (
  id                bigserial primary key,
  merkle_root       text        not null,
  tx_hash           text,
  record_count      integer     not null,
  anchored_at       timestamptz not null default now()
);

create table if not exists subscriptions (
  id                bigserial primary key,
  name_id           bigint      not null references names (id) on delete cascade,
  plan              text        not null,
  paid_tx_hash      text,
  starts_at         timestamptz,
  ends_at           timestamptz,
  status            text        not null check (status in ('active', 'expired', 'pending'))
);

create table if not exists sponsorship_ledger (
  id                bigserial primary key,
  name_id           bigint      references names (id) on delete set null,
  wallet_address    text        not null,
  tx_hash           text        not null,
  gas_cost_wei      numeric(78, 0),
  sponsored_at      timestamptz not null default now(),
  paid              boolean     not null default false
);

-- D19: the column is new on an existing table, so it needs an ALTER as well as
-- the CREATE above (create table if not exists is a no-op on the live DB).
alter table sponsorship_ledger add column if not exists paid boolean not null default false;

create index if not exists sponsorship_ledger_wallet_idx
  on sponsorship_ledger (wallet_address, sponsored_at);

-- D17: one invitation is worth one name. This is the spend record; who was
-- invited lives in config/invitations.json. Not a chain index: the chain
-- cannot say whether an invitation was used.
create table if not exists invitation_claims (
  wallet_address  text primary key,
  claimed_label   text        not null,
  tx_hash         text,
  claimed_at      timestamptz not null default now()
);

create table if not exists abuse_reports (
  id                bigserial primary key,
  name_id           bigint      references names (id) on delete set null,
  reporter          text        not null,
  reason            text        not null,
  status            text        not null default 'open',
  handled_at        timestamptz
);

create table if not exists api_usage (
  client_id         text        not null,
  endpoint          text        not null,
  ts                timestamptz not null default now(),
  units             integer     not null default 1,
  result            text
);

create index if not exists api_usage_client_idx on api_usage (client_id, ts);

-- D19: paid purchase rail. A quote locks label+price+payer for a TTL; the
-- buyer pays USDG on-chain, submits the payment tx hash, and the API verifies
-- the Transfer before sponsoring the registration. The UNIQUE constraint on
-- payment_tx_hash is the double-spend guard: one payment buys exactly one name,
-- even under concurrent submits.
create table if not exists purchase_quotes (
  id                 uuid primary key,
  label              text          not null,
  owner_address      text          not null,
  kind               text          not null check (kind in ('tier-4', 'additional-name')),
  price_usd          numeric(12,2) not null,
  amount_base_units  numeric(78,0) not null,
  token              text          not null,
  treasury           text          not null,
  chain_id           integer       not null,
  status             text          not null check (status in ('open', 'settling', 'settled', 'expired', 'failed')),
  payment_tx_hash    text unique,
  register_tx_hash   text,
  expires_at         timestamptz   not null,
  created_at         timestamptz   not null default now(),
  settled_at         timestamptz
);

create index if not exists purchase_quotes_owner_idx on purchase_quotes (owner_address, status);
