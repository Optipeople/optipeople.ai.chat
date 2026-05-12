-- Per-machine starter questions for the chat empty state. Generated from
-- the KB after each ingest / reset / delete so the suggestions stay in
-- sync with the manual content. Empty array = chat falls back to broad
-- generic prompts client-side.

alter table machine_kb
  add column suggested_questions    text[]      not null default '{}',
  add column suggestions_updated_at timestamptz;
