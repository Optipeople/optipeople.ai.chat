-- Keep operator photos attached to the message they were sent with, so
-- reopened conversations, the model's later turns, admin views and
-- learnings all see the full context.
--
-- Before this, conversation_attachments only pointed at a conversation:
-- which message a photo belonged to was lost, so history replay showed a
-- "[Photo]" placeholder and the distiller never saw the image at all.

alter table conversation_attachments
  add column if not exists message_id uuid references messages (id) on delete set null,
  -- Claude-vision description, generated once (best effort) when the
  -- message is saved. Older turns are replayed to the model as this text
  -- instead of re-sending the image, which keeps the prompt cache stable
  -- and avoids re-billing image tokens every turn.
  add column if not exists caption  text,
  add column if not exists alt_text text;

create index if not exists conversation_attachments_message_idx
  on conversation_attachments (message_id);

-- Backfill: link each existing attachment to the first user message in
-- its conversation sent at or after the upload. Uploads happen just
-- before the message is sent, so this is the message it rode on.
update conversation_attachments a
set message_id = (
  select m.id
  from messages m
  where m.conversation_id = a.conversation_id
    and m.role = 'user'
    and m.created_at >= a.created_at
  order by m.created_at asc
  limit 1
)
where a.message_id is null
  and a.conversation_id is not null;

-- Photos a learning was distilled from. Published learnings also get a
-- kb_assets row per photo (pointing at the chat-attachments object) so
-- search_kb can surface them as image results.
alter table kb_insights
  add column if not exists attachment_ids uuid[] not null default '{}';

alter table kb_assets drop constraint if exists kb_assets_storage_bucket_check;
alter table kb_assets
  add constraint kb_assets_storage_bucket_check
  check (storage_bucket in ('kb-images','kb-documents','chat-attachments'));
