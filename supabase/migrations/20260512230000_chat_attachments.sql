-- Operator-supplied images attached to a chat message.
--
-- Different from kb_assets: those are derived from the knowledge base
-- (figures pulled from PDFs, or standalone images an admin uploaded as a
-- learning source). conversation_attachments are ad-hoc photos an
-- operator takes from the shop floor — picture of an HMI panel, an
-- alarm screen, a damaged part — to give the model visual context for
-- the current question. They're never embedded or indexed; they live
-- only inside their conversation.

create table conversation_attachments (
  id              uuid primary key default gen_random_uuid(),
  -- Nullable: the client uploads attachments BEFORE the first turn is
  -- sent (so the operator can preview them), at which point we don't
  -- have a conversation row yet. The chat route links them in once the
  -- conversation id is known.
  conversation_id uuid references conversations (id) on delete cascade,
  machine_id      text not null,
  uploader_user_id text not null,
  storage_path    text not null,
  mime_type       text not null check (mime_type in ('image/png','image/jpeg','image/webp')),
  byte_size       bigint,
  created_at      timestamptz not null default now()
);

create index conversation_attachments_conv_idx
  on conversation_attachments (conversation_id);
create index conversation_attachments_machine_idx
  on conversation_attachments (machine_id);

alter table conversation_attachments enable row level security;

-- Private bucket. 10 MB cap — operators are uploading phone snaps, not
-- print-quality scans. Same three formats as kb-images.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-attachments',
  'chat-attachments',
  false,
  10485760,
  array['image/png','image/jpeg','image/webp']
)
on conflict (id) do nothing;
