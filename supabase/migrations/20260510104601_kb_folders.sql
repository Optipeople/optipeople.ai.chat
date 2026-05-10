-- kb_folders — explicit list of folder paths per machine, so empty
-- folders survive across refresh. ingestPdf upserts every ancestor of
-- the document's folder_path on every upload, keeping this in sync
-- automatically; the admin UI also adds rows for explicitly created
-- empty folders.

create table kb_folders (
  machine_id  text not null references machine_kb (machine_id) on delete cascade,
  path        text not null,
  created_at  timestamptz not null default now(),
  primary key (machine_id, path)
);

create index kb_folders_machine_id_idx on kb_folders (machine_id);

alter table kb_folders enable row level security;
