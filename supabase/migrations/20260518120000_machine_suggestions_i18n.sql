-- Bilingual chat starter questions.
--
-- The empty-state chips need to follow the operator's selected interface
-- language (en/da). Replace the single text[] column with a jsonb shaped
-- { en: string[], da: string[] } so both translations live on the same
-- row and the API can return the right bucket per request.
--
-- Existing per-machine arrays are dropped. A one-time backfill
-- (`npm run regenerate-suggestions`) refills them for every machine_kb
-- row after this migration runs.

alter table machine_kb
  drop column suggested_questions;

alter table machine_kb
  add column suggested_questions jsonb not null default '{}'::jsonb;
