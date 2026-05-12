-- Image support in the knowledge base.
--
-- Two entry points:
--   1. Standalone image uploads — operator drops a PNG/JPG of a wiring
--      diagram, decal, etc. One kb_documents row (source_type='image'),
--      one kb_assets row, one kb_chunks row for the caption embedding.
--   2. Figures auto-extracted from PDFs — during ingestPdf we ask Claude
--      to enumerate figures by page. Each becomes a kb_assets row that
--      points back at the parent PDF's storage object (page_from=N), and
--      a kb_chunks row carrying the caption embedding. No separate image
--      file is stored — the "asset" is a page reference into the PDF.
--
-- A chunk with asset_id set IS an image-caption chunk and should be
-- rendered as an image source in chat. A chunk with asset_id NULL is a
-- normal text chunk. This is what lets one PDF document contribute both
-- text chunks and figure chunks to retrieval.

-- Allow 'image' as a document source type. Postgres doesn't support
-- ALTER CHECK CONSTRAINT in-place, so drop+recreate.
alter table kb_documents drop constraint kb_documents_source_type_check;
alter table kb_documents
  add constraint kb_documents_source_type_check
  check (source_type in ('pdf','url','manual_note','feedback','image'));

create table kb_assets (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references kb_documents (id) on delete cascade,
  machine_id   text not null,
  -- For standalone images this is a path inside the kb-images bucket. For
  -- PDF-figure assets it's the parent PDF's path inside kb-documents (we
  -- reuse the existing storage object instead of duplicating bytes).
  storage_path text not null,
  storage_bucket text not null check (storage_bucket in ('kb-images','kb-documents')),
  -- 'application/pdf' for PDF-figure assets (paired with page_from);
  -- 'image/png' | 'image/jpeg' | 'image/webp' for standalone images.
  mime_type    text not null,
  byte_size    bigint,
  width        int,
  height       int,
  page_from    int,
  ordinal      int not null default 0,
  -- The Claude-generated description used as the embedding source.
  caption      text not null,
  -- Short alt text suitable for an <img alt>. Optional — Claude often
  -- emits a single sentence that doubles for both, in which case we
  -- write it to both columns.
  alt_text     text,
  created_at   timestamptz not null default now()
);

create index kb_assets_document_id_idx on kb_assets (document_id);
create index kb_assets_machine_id_idx  on kb_assets (machine_id);

-- A chunk can now be tied to an asset. Image-caption chunks ride the
-- same hybrid-search pipeline as text chunks — the difference shows up
-- at render time in the chat UI when the chunk also carries an asset_id.
alter table kb_chunks
  add column asset_id uuid references kb_assets (id) on delete cascade;

create index kb_chunks_asset_id_idx on kb_chunks (asset_id) where asset_id is not null;

alter table kb_assets enable row level security;

-- Private bucket for standalone image uploads. 25 MB cap; the admin UI
-- enforces a stricter limit before upload, this is just a backstop. We
-- accept the common web formats only — TIFF/HEIC etc. would need extra
-- handling we don't do yet.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'kb-images',
  'kb-images',
  false,
  26214400,
  array['image/png','image/jpeg','image/webp']
)
on conflict (id) do nothing;
