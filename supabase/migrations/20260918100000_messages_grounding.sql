-- Grounding audit for assistant answers.
--
-- grounded: true when at least one search_kb call ran in the turn that
-- produced this answer, false when the model answered without searching,
-- null on intermediate (tool-calling) assistant rows and on rows written
-- before this migration.
--
-- max_similarity: best cosine similarity (1 - distance) any search_kb hit
-- reached during that turn; null when no search ran, when the embedding
-- was unavailable (keyword-only fallback), or when nothing matched.
-- A grounded answer with a low ceiling is the audit's signal that the
-- model was working from weak evidence.

alter table messages add column if not exists grounded boolean;
alter table messages add column if not exists max_similarity float;
