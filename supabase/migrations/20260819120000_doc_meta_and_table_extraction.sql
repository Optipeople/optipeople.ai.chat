-- Document identity metadata + the table-repair extraction source.
--
-- Both come from docs/answer-correctness-plan.md, written after an
-- operator was given the wrong DIP switch pin because pdf-parse
-- linearized the manual's switch table.
--
-- kb_documents.meta (fixes F and G) holds, per document:
--   catalogNo  text    - this manual's own catalogue number ("W629-E1-09")
--   appliesTo  text[]  - product series / models it documents
--   references text[]  - base catalogue numbers of manuals it defers to
--   summary    text    - one paragraph for the tool-routing manifest
--   version    int     - shape version, see src/lib/docMeta.ts
--
-- jsonb rather than four columns: the shape is still moving (the plan's
-- structured-extraction item will add to it), and nothing queries it
-- relationally. Nullable, so every pre-existing row stays valid and simply
-- behaves as it did before.
alter table kb_documents
  add column if not exists meta jsonb;

-- extraction_source gains 'pdf-parse+tables': the text layer was used,
-- then the table-bearing pages were re-read with vision and replaced.
-- Kept distinct from 'pdf-parse' so the admin UI can tell which documents
-- predate the table repair and therefore still need a reprocess.
alter table kb_documents
  drop constraint if exists kb_documents_extraction_source_check;

alter table kb_documents
  add constraint kb_documents_extraction_source_check
    check (extraction_source in ('pdf-parse', 'pdf-parse+tables', 'claude-ocr'));
