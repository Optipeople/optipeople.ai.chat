-- Ingest integrity: chunk uniqueness + stale-writer fencing.
--
-- Two production defects motivated this:
--
--   1. kb_chunks had no uniqueness on (document_id, ordinal,
--      embedding_model). The resumable pipeline recomputes the chunk list
--      and continues at "max ordinal + 1"; when two invocations of the same
--      document overlapped (a client retry racing a still-running function,
--      or the platform reaping an instance that kept writing for a few
--      seconds) both inserted the same ordinals and retrieval returned the
--      same passage twice, crowding out real matches.
--
--   2. Nothing told a pipeline invocation that it had been superseded. A
--      reprocess or delete could start while a ghost invocation was still
--      embedding, and the ghost would happily flip the row back to 'ready'
--      or insert chunks for text that had just been wiped.
--
-- The unique index fixes 1 at the database (inserts become upserts with
-- ignoreDuplicates in src/lib/ingestion.ts). run_id fixes 2: every
-- pipeline invocation mints a uuid, writes it to the row, and re-checks it
-- before every chunk batch and every status flip; a mismatch means "you
-- were fenced out, stop quietly".

-- Dedupe before the index can be created. Keep the lowest id per key;
-- uuids compare bytewise, so "lowest" is arbitrary but deterministic, and
-- the duplicate rows carry identical text + embedding by construction.
delete from kb_chunks a
using kb_chunks b
where a.document_id = b.document_id
  and a.ordinal = b.ordinal
  and a.embedding_model = b.embedding_model
  and a.id > b.id;

create unique index if not exists kb_chunks_doc_ordinal_model_key
  on kb_chunks (document_id, ordinal, embedding_model);

-- Owner token of the pipeline invocation currently allowed to write this
-- document. Null on rows that predate this migration and on rows nothing
-- is processing. See runPdfPipeline / assertRunOwner in src/lib/ingestion.ts.
alter table kb_documents
  add column if not exists run_id uuid;
