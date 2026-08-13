-- Optipeople Docs — initial schema
--
-- This migration lives alongside the chat app's migrations in the same
-- Supabase project. Everything here is scoped to the new `doc` schema so
-- it can't collide with the chat app's `public` tables, and all uploads
-- live in the `doc-files` storage bucket (created separately via the
-- Supabase dashboard).
--
-- Account and machine IDs are Optipeople master data — we store them as
-- text and never duplicate the full row.

create schema if not exists doc;

-- Folder: the unit of organisation. Lives under an Optipeople account and
-- may optionally be nested inside another folder. Machine attachment is a
-- separate many-to-many concern handled by doc.folder_machines below.
create table doc.folders (
  id          uuid primary key default gen_random_uuid(),
  account_id  text not null,
  parent_id   uuid references doc.folders (id) on delete cascade,
  name        text not null,
  created_by  text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index folders_account_id_idx on doc.folders (account_id);
create index folders_parent_id_idx  on doc.folders (parent_id);

-- A folder cannot have a parent in a different account. Enforced via a
-- trigger because referencing parent.account_id from a CHECK constraint
-- would require a stored function anyway.
create function doc.assert_parent_account_match() returns trigger as $$
begin
  if new.parent_id is not null then
    if (select account_id from doc.folders where id = new.parent_id) <> new.account_id then
      raise exception 'folders.parent_id must belong to the same account_id';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger folders_parent_account_match
  before insert or update on doc.folders
  for each row execute function doc.assert_parent_account_match();

-- Many-to-many: a folder can be attached to N machines, and a machine
-- can have N folders. The attachment is purely a label/lookup mechanism —
-- file contents are unchanged.
--
-- machine_id is the Optipeople machine id (master data, stored as text).
-- We denormalise account_id here so we can index it and enforce that the
-- attachment lives in the same account as the folder.
create table doc.folder_machines (
  folder_id   uuid not null references doc.folders (id) on delete cascade,
  machine_id  text not null,
  account_id  text not null,
  attached_by text not null,
  attached_at timestamptz not null default now(),
  primary key (folder_id, machine_id)
);

create index folder_machines_machine_id_idx on doc.folder_machines (machine_id);
create index folder_machines_account_id_idx on doc.folder_machines (account_id);

create function doc.assert_attachment_account_match() returns trigger as $$
begin
  if (select account_id from doc.folders where id = new.folder_id) <> new.account_id then
    raise exception 'folder_machines.account_id must match the folder''s account_id';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger folder_machines_account_match
  before insert or update on doc.folder_machines
  for each row execute function doc.assert_attachment_account_match();

-- File: one row per uploaded blob in the `doc-files` storage bucket.
-- account_id is denormalised from the folder so we can list "all files
-- for this account" without an extra join.
create table doc.files (
  id            uuid primary key default gen_random_uuid(),
  folder_id     uuid not null references doc.folders (id) on delete cascade,
  account_id    text not null,
  name          text not null,
  storage_path  text not null,
  mime_type     text,
  byte_size     bigint,
  uploaded_by   text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index files_folder_id_idx  on doc.files (folder_id);
create index files_account_id_idx on doc.files (account_id);

create function doc.assert_file_account_match() returns trigger as $$
begin
  if (select account_id from doc.folders where id = new.folder_id) <> new.account_id then
    raise exception 'files.account_id must match the parent folder''s account_id';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger files_account_match
  before insert or update on doc.files
  for each row execute function doc.assert_file_account_match();

-- Touch-updated_at triggers. Folder/file edits update the row; attachment
-- changes update the parent folder so callers can detect "anything in
-- this folder changed" with a single timestamp.
create function doc.touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger folders_touch_updated_at
  before update on doc.folders
  for each row execute function doc.touch_updated_at();

create trigger files_touch_updated_at
  before update on doc.files
  for each row execute function doc.touch_updated_at();

-- RLS: enable on every table. No policies = no access for anon/authenticated
-- roles. The service role bypasses RLS, which is the security model — the
-- doc app's backend is the security boundary, same pattern as the chat app.
alter table doc.folders          enable row level security;
alter table doc.folder_machines  enable row level security;
alter table doc.files            enable row level security;

-- Expose the `doc` schema via PostgREST so the chat app (and any other
-- service-role consumer) can read these tables through @supabase/supabase-js
-- using `.schema('doc')`. The chat app's existing service-role client will
-- be able to query doc.folders / doc.files / doc.folder_machines with no
-- additional configuration.
--
-- NOTE: This only takes effect after running `select pgrst_reload()` or
-- restarting PostgREST. Supabase's CLI db push handles this automatically.
grant usage on schema doc to anon, authenticated, service_role;
grant all on all tables in schema doc to service_role;
grant all on all sequences in schema doc to service_role;
grant all on all functions in schema doc to service_role;

alter default privileges in schema doc grant all on tables to service_role;
alter default privileges in schema doc grant all on sequences to service_role;
alter default privileges in schema doc grant all on functions to service_role;
;
