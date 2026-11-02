-- Pre-printed QR sticker pool (docs/qr-sticker-pool-plan.md).
--
-- A super admin creates a batch of stickers before any machine exists.
-- Each sticker carries a random token (the URL secret, /q/<token>) and a
-- short human code printed under the QR. Scanning an unlinked sticker
-- lets an admin link it to a machine; once linked, resolveQrToken()
-- accepts the token exactly like machine_kb.qr_token.
--
-- Status is derived, never stored: retired_at set means retired,
-- machine_id set means linked, otherwise unclaimed. RLS is on with no
-- policies, so only the service role touches these tables.

create table qr_sticker_batches (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  -- Reserved for this account, or null for the global pool.
  account_id  text,
  created_by  text,
  created_at  timestamptz not null default now()
);

create table qr_stickers (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references qr_sticker_batches (id) on delete cascade,
  -- Stored without the dash (7F3K9PQX), displayed as 7F3K-9PQX.
  code        text not null unique
              check (code ~ '^[2-9A-HJ-NP-Z]{8}$'),
  token       text not null unique,
  -- Reserved account (from the batch) or bound account (set on first
  -- link). Survives an unlink so the sticker stays with that customer.
  account_id  text,
  machine_id  text references machine_kb (machine_id) on delete set null,
  linked_at   timestamptz,
  linked_by   text,
  retired_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index qr_stickers_machine_id_idx on qr_stickers (machine_id);
create index qr_stickers_batch_id_idx on qr_stickers (batch_id);

alter table qr_sticker_batches enable row level security;
alter table qr_stickers enable row level security;

-- Per-batch counts for the admin batch list. Aggregated in the database
-- so large batches are not cut off by the PostgREST row limit.
-- security_invoker keeps the underlying RLS in force for anon callers.
create view qr_sticker_batch_stats
with (security_invoker = true) as
select
  b.id,
  b.label,
  b.account_id,
  b.created_by,
  b.created_at,
  count(s.id)::int as sticker_count,
  count(s.id) filter (
    where s.machine_id is not null and s.retired_at is null
  )::int as linked_count,
  count(s.id) filter (where s.retired_at is not null)::int as retired_count
from qr_sticker_batches b
left join qr_stickers s on s.batch_id = b.id
group by b.id;
