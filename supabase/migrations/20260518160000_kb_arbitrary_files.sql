-- Arbitrary file uploads in the knowledge base.
--
-- Operators can now drop *any* file (proprietary machine formats, CSVs,
-- log dumps, .smc2, etc.) — not just PDFs and images. Each becomes a
-- kb_documents row with source_type='file'. The raw bytes are always
-- stored; when the bytes decode as valid UTF-8 text the pipeline also
-- chunks + embeds them so the file participates in chat retrieval.
-- Binary files are store-only (downloadable, but not searchable).
--
-- Generic files reuse the existing kb-documents bucket so all the
-- download / signed-URL plumbing ("everything that isn't an image lives
-- in kb-documents") keeps working unchanged. The only catch is that the
-- bucket was locked to application/pdf — we widen it to accept any type.

-- Allow 'file' as a document source type. Postgres can't ALTER a CHECK
-- constraint in place, so drop + recreate.
alter table kb_documents drop constraint kb_documents_source_type_check;
alter table kb_documents
  add constraint kb_documents_source_type_check
  check (source_type in ('pdf','url','manual_note','feedback','image','file'));

-- Drop the application/pdf-only allow-list on the kb-documents bucket so
-- arbitrary content types can be stored. NULL means "accept any MIME".
-- The bucket stays private and keeps its 100 MB size cap.
update storage.buckets
  set allowed_mime_types = null
  where id = 'kb-documents';
