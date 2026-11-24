-- Per-conversation AI usage.
--
-- usage_events has carried conversation_id since it was created, but
-- nothing read it: the admin views stopped at the account. This adds the
-- conversation level — the admin conversation list shows tokens and cost
-- per row, and the conversation detail breaks them down by operation and
-- model, the same way the account usage panel does.
--
-- Grouped by operation + model (not just conversation) because pricing
-- happens in TypeScript (src/lib/pricing.ts) and depends on both.

create index if not exists usage_events_conversation_id_idx
  on usage_events (conversation_id)
  where conversation_id is not null;

create or replace function usage_conversation_summary(
  p_conversation_ids uuid[]
)
returns table (
  conversation_id    uuid,
  operation          text,
  model              text,
  events             bigint,
  input_tokens       bigint,
  output_tokens      bigint,
  cache_read_tokens  bigint,
  cache_write_tokens bigint
)
language sql
stable
as $$
  select
    u.conversation_id,
    u.operation,
    u.model,
    count(*)::bigint                  as events,
    sum(u.input_tokens)::bigint       as input_tokens,
    sum(u.output_tokens)::bigint      as output_tokens,
    sum(u.cache_read_tokens)::bigint  as cache_read_tokens,
    sum(u.cache_write_tokens)::bigint as cache_write_tokens
  from usage_events u
  where u.conversation_id = any (p_conversation_ids)
  group by u.conversation_id, u.operation, u.model
  order by u.conversation_id, sum(u.input_tokens) + sum(u.output_tokens) desc;
$$;
