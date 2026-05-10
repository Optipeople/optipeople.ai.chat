-- kb_documents.progress / progress_label — fine-grained per-document
-- progress so the admin queue panel can show a live progress bar (e.g.
-- "Embedder 2/4 batches", "Kører OCR…") instead of just the coarse
-- status enum. Cleared (NULL) once the row reaches a terminal state.

alter table kb_documents
  add column progress       smallint check (progress >= 0 and progress <= 100),
  add column progress_label text;
