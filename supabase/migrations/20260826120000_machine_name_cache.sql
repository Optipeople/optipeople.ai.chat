-- Optipeople Docs — cached machine names
--
-- Machine master data lives in the Optipeople portal and is read through
-- the authenticated /auth-api proxy, so only a signed-in admin's browser
-- can resolve a machine id to its name. The public share viewer has no
-- credentials, which left it rendering raw machine uuids in the
-- "Attached to" row.
--
-- This table is a name cache, not a second source of truth: the browser
-- pushes the account's machine list here (PUT /api/machines) whenever it
-- loads it for the folder browser, and the /api/public/* routes read
-- names back out. A miss is not an error — callers fall back to the id,
-- which is exactly the old behaviour.
create table doc.machines (
  account_id text not null,
  machine_id text not null,
  name       text not null,
  synced_at  timestamptz not null default now(),
  primary key (account_id, machine_id)
);
create index machines_machine_id_idx on doc.machines (machine_id);
-- RLS on, no policies: service role only, same model as the rest of the
-- doc schema.
alter table doc.machines enable row level security;
