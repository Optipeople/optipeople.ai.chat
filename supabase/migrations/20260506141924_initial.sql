-- Opti Assist Chat — initial schema
-- Architecture: docs/architecture.md §3.2

-- Extensions
create extension if not exists vector;

-- Per-machine knowledge base root.
-- machine_id is the Optipeople machine id (we never duplicate master data).
create table machine_kb (
  machine_id              text primary key,
  account_id              text not null,
  display_name            text,
  system_prompt_extra     text,
  active_embedding_model  text not null default 'voyage-4-large',
  updated_at              timestamptz not null default now()
);

create index machine_kb_account_id_idx on machine_kb (account_id);

-- One row per uploaded document (PDF, URL, manual note, promoted feedback).
create table kb_documents (
  id            uuid primary key default gen_random_uuid(),
  machine_id    text not null references machine_kb (machine_id) on delete cascade,
  title         text not null,
  summary       text not null,
  source_type   text not null check (source_type in ('pdf','url','manual_note','feedback')),
  storage_path  text,
  byte_size     bigint,
  page_count    int,
  status        text not null default 'uploaded'
                check (status in ('uploaded','extracting','embedding','ready','failed')),
  created_by    text not null,
  created_at    timestamptz not null default now()
);

create index kb_documents_machine_id_idx on kb_documents (machine_id);
create index kb_documents_status_idx     on kb_documents (status);

-- One row per (chunk, embedding_model). Re-embedding inserts new rows
-- rather than overwriting, so we can blue/green a model upgrade.
create table kb_chunks (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references kb_documents (id) on delete cascade,
  machine_id      text not null,
  ordinal         int  not null,
  page_from       int,
  page_to         int,
  text            text not null,
  text_tsv        tsvector generated always as (to_tsvector('simple', text)) stored,
  embedding       vector(1024) not null,
  embedding_model text not null
);

create index kb_chunks_machine_id_idx  on kb_chunks (machine_id);
create index kb_chunks_document_id_idx on kb_chunks (document_id);
create index kb_chunks_text_tsv_idx    on kb_chunks using gin (text_tsv);
-- HNSW: no training step required, performs well on small and large sets.
create index kb_chunks_embedding_idx   on kb_chunks
  using hnsw (embedding vector_cosine_ops);

-- Conversations and messages — every operator chat is persisted for audit.
create table conversations (
  id          uuid primary key default gen_random_uuid(),
  machine_id  text not null,
  account_id  text not null,
  user_id     text not null,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  entry_mode  text check (entry_mode in ('qr','manual','deep_link')),
  resolution  text check (resolution in ('resolved','unresolved','escalated','unknown'))
);

create index conversations_machine_id_idx on conversations (machine_id);
create index conversations_account_id_idx on conversations (account_id);
create index conversations_user_id_idx    on conversations (user_id);

create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations (id) on delete cascade,
  role            text not null check (role in ('user','assistant','tool')),
  content         text not null,
  tool_name       text,
  tool_input      jsonb,
  tool_chunks     uuid[],
  tokens_in       int,
  tokens_out      int,
  cache_hit       boolean,
  created_at      timestamptz not null default now()
);

create index messages_conversation_id_idx on messages (conversation_id);

-- Feedback (did the AI solve it?). Promoted feedback becomes a kb_documents row.
create table feedback (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations (id) on delete set null,
  resolved        boolean not null,
  solution_text   text,
  promoted_doc_id uuid references kb_documents (id) on delete set null,
  created_at      timestamptz not null default now()
);

-- Escalations: snapshot of context handed off to a human service team.
create table escalations (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations (id) on delete set null,
  channel         text not null check (channel in ('phone','email','service_ticket')),
  target          text not null,
  context_blob    jsonb,
  created_at      timestamptz not null default now()
);

-- RLS: enable on every table. No policies = no access for anon/authenticated
-- roles. The service role (used by the Opti Assist backend) bypasses RLS, which is
-- the security model for Phase 1: backend is the security boundary.
alter table machine_kb    enable row level security;
alter table kb_documents  enable row level security;
alter table kb_chunks     enable row level security;
alter table conversations enable row level security;
alter table messages      enable row level security;
alter table feedback      enable row level security;
alter table escalations   enable row level security;

-- Storage bucket for raw uploaded PDFs. Private (not public).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kb-documents', 'kb-documents', false, 104857600, array['application/pdf'])
on conflict (id) do nothing;
