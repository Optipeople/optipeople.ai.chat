-- Optipeople Docs — authored documents
--
-- Documents are text content written inside the app (as opposed to
-- uploaded files). A document lives in a folder like a file does, carries
-- editorial metadata (status, category, device, tags), keeps a snapshot
-- history in doc.document_versions (one row per explicit Save), and can
-- have file attachments stored in the same `doc-files` bucket.

-- Document: the editable head row. `body` is the current working text —
-- autosave writes here without creating a version.
create table doc.documents (
  id               uuid primary key default gen_random_uuid(),
  folder_id        uuid not null references doc.folders (id) on delete cascade,
  account_id       text not null,
  name             text not null default '',
  body             text not null default '',
  status           text not null default 'draft'
                     check (status in ('draft', 'approved', 'archived')),
  category         text,
  subcategory      text,
  -- Optipeople machine id (master data, stored as text) — the "Device"
  -- the document is an instruction for.
  machine_id       text,
  tags             text[] not null default '{}',
  author           text not null,
  created_by       text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_autosave_at timestamptz
);
create index documents_folder_id_idx  on doc.documents (folder_id);
create index documents_account_id_idx on doc.documents (account_id);
create function doc.assert_document_account_match() returns trigger as $$
begin
  if (select account_id from doc.folders where id = new.folder_id) <> new.account_id then
    raise exception 'documents.account_id must match the parent folder''s account_id';
  end if;
  return new;
end;
$$ language plpgsql;
create trigger documents_account_match
  before insert or update on doc.documents
  for each row execute function doc.assert_document_account_match();
create trigger documents_touch_updated_at
  before update on doc.documents
  for each row execute function doc.touch_updated_at();
-- Version: immutable snapshot of name + body taken on every explicit Save.
create table doc.document_versions (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references doc.documents (id) on delete cascade,
  account_id  text not null,
  name        text not null,
  body        text not null,
  saved_by    text not null,
  saved_at    timestamptz not null default now()
);
create index document_versions_document_id_idx
  on doc.document_versions (document_id, saved_at desc);
-- Attachment: one row per uploaded blob attached to a document. Separate
-- from doc.files because attachments belong to the document (and die with
-- it), not to the folder listing.
create table doc.document_files (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references doc.documents (id) on delete cascade,
  account_id   text not null,
  name         text not null,
  description  text,
  storage_path text not null,
  mime_type    text,
  byte_size    bigint,
  uploaded_by  text not null,
  created_at   timestamptz not null default now()
);
create index document_files_document_id_idx on doc.document_files (document_id);
-- RLS on, no policies: service role only, same model as the initial schema.
-- (Grants come from the `alter default privileges` in the initial migration.)
alter table doc.documents         enable row level security;
alter table doc.document_versions enable row level security;
alter table doc.document_files    enable row level security;
