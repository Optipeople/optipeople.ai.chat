-- Conversation lifecycle + distilled knowledge.
--
-- Customers leave the chat open on the shop floor for days, so one
-- conversation row used to collect unrelated problems indefinitely, and a
-- chat only turned into knowledge when the operator answered the
-- "was this solved?" card. Three changes:
--
--   1. conversations.last_message_at, kept current by a trigger on
--      messages. The chat route reads it to roll a follow-up older than
--      four hours into a fresh conversation, and the distill sweep reads
--      it to find conversations that have gone quiet.
--
--   2. conversations.distilled_at: null means "the distill sweep still
--      owes this conversation a pass". Every new message resets it, so a
--      conversation that is picked up again gets distilled again.
--
--   3. kb_insights: one row per distilled conversation. Operator-confirmed
--      (resolution = 'resolved') machine conversations are published into
--      the KB straight away; everything else waits as 'pending' for an
--      admin to approve, edit or reject. 'nothing' records that the
--      conversation held nothing worth keeping, so it is not re-billed.

alter table conversations
  add column if not exists last_message_at timestamptz,
  add column if not exists distilled_at timestamptz,
  -- Failed distill passes since the last message. The sweep stops
  -- retrying at three so a conversation that keeps failing cannot hog
  -- every run.
  add column if not exists distill_attempts int not null default 0;

update conversations c
set last_message_at = coalesce(
  (select max(m.created_at) from messages m where m.conversation_id = c.id),
  c.started_at
)
where c.last_message_at is null;

-- Existing history predates the distiller. Mark it done so the first sweep
-- does not bill a model call for every conversation ever held.
update conversations set distilled_at = now() where distilled_at is null;

create index if not exists conversations_distill_due_idx
  on conversations (last_message_at)
  where distilled_at is null;

create index if not exists messages_conversation_created_idx
  on messages (conversation_id, created_at);

create or replace function conversations_touch_last_message()
returns trigger
language plpgsql
as $$
begin
  update conversations
  set last_message_at = new.created_at,
      distilled_at = null,
      distill_attempts = 0
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_touch_conversation on messages;
create trigger messages_touch_conversation
  after insert on messages
  for each row execute function conversations_touch_last_message();

create table if not exists kb_insights (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null unique references conversations(id) on delete cascade,
  machine_id       text not null,
  account_id       text,
  status           text not null
    check (status in ('pending','published','rejected','nothing')),
  -- What the conversation ended as when it was distilled (resolved,
  -- unresolved, escalated, unknown). Explains why an insight was
  -- published automatically or queued.
  resolution       text,
  title            text not null default '',
  problem          text not null default '',
  cause            text not null default '',
  solution         text not null default '',
  facts            text[] not null default '{}',
  -- Questions the assistant could not answer from the KB: the gaps an
  -- admin closes by uploading documentation. Never published to the KB.
  open_questions   text[] not null default '{}',
  promoted_doc_id  uuid references kb_documents(id) on delete set null,
  model            text,
  reviewed_by      text,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists kb_insights_machine_status_idx
  on kb_insights (machine_id, status, created_at desc);

alter table kb_insights enable row level security;
