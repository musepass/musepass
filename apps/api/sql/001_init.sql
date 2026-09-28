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
  sponsored_at      timestamptz not null default now()
);

create index if not exists sponsorship_ledger_wallet_idx
  on sponsorship_ledger (wallet_address, sponsored_at);

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
