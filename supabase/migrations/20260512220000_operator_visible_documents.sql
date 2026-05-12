-- Per-document opt-in for the operator-facing knowledge drawer. Default
-- false so existing KB stays admin-only until an admin explicitly toggles
-- documents on. The chat itself still uses every document for retrieval —
-- this flag only gates manual browsing from the operator UI.

alter table kb_documents
  add column operator_visible boolean not null default false;

create index kb_documents_operator_visible_idx
  on kb_documents (machine_id, operator_visible)
  where operator_visible = true;
