-- kb_documents.extraction_source — which path produced the chunk text.
-- 'pdf-parse' = embedded text layer, 'claude-ocr' = Claude vision fallback.
-- Nullable so legacy rows ingested before this column existed stay valid.

alter table kb_documents
  add column extraction_source text
    check (extraction_source in ('pdf-parse', 'claude-ocr'));
