-- Per-account AI usage metering.
--
-- One row per upstream AI API call (Anthropic message, Voyage embedding
-- batch). Written best-effort from src/lib/usage.ts — a failed insert
-- never breaks the calling flow. account_id is the Optipeople account id
-- (opaque text, same convention as conversations.account_id); rows where
-- only a machine id was known at the call site are resolved to their
-- account via machine_kb before insert.
--
-- Token semantics follow the Anthropic usage object: input_tokens is the
-- non-cached prompt portion, cache_read/cache_write are the prompt-cache
-- split. Voyage only reports a single total, stored as input_tokens.

create table usage_events (
  id                 bigint generated always as identity primary key,
  account_id         text not null,
  machine_id         text,
  conversation_id    uuid references conversations (id) on delete set null,
  user_id            text,
  provider           text not null check (provider in ('anthropic','voyage','openai')),
  model              text not null,
  operation          text not null,
  input_tokens       bigint not null default 0,
  output_tokens      bigint not null default 0,
  cache_read_tokens  bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  created_at         timestamptz not null default now()
);

create index usage_events_account_created_idx
  on usage_events (account_id, created_at desc);
create index usage_events_machine_id_idx on usage_events (machine_id);

alter table usage_events enable row level security;

-- Per-account breakdown by operation + model since a cutoff. Grouping
-- happens next to the data so the admin endpoint stays a single round
-- trip regardless of event volume.
create or replace function usage_account_summary(
  p_account_id text,
  p_since      timestamptz
)
returns table (
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
    u.operation,
    u.model,
    count(*)::bigint                as events,
    sum(u.input_tokens)::bigint     as input_tokens,
    sum(u.output_tokens)::bigint    as output_tokens,
    sum(u.cache_read_tokens)::bigint  as cache_read_tokens,
    sum(u.cache_write_tokens)::bigint as cache_write_tokens
  from usage_events u
  where u.account_id = p_account_id
    and u.created_at >= p_since
  group by u.operation, u.model
  order by sum(u.input_tokens) + sum(u.output_tokens) desc;
$$;

-- Totals per account since a cutoff — feeds the admin accounts list.
create or replace function usage_accounts_overview(
  p_since timestamptz
)
returns table (
  account_id         text,
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
    u.account_id,
    count(*)::bigint                as events,
    sum(u.input_tokens)::bigint     as input_tokens,
    sum(u.output_tokens)::bigint    as output_tokens,
    sum(u.cache_read_tokens)::bigint  as cache_read_tokens,
    sum(u.cache_write_tokens)::bigint as cache_write_tokens
  from usage_events u
  where u.created_at >= p_since
  group by u.account_id;
$$;
