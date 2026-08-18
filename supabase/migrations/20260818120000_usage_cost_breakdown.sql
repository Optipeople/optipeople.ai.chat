-- Per-account usage broken down by model, so the admin views can price it.
--
-- usage_accounts_overview returned one row per account with token sums
-- only. Cost depends on the model (Haiku input is $1/MTok, Sonnet $3,
-- Opus $5), so an account-grained row cannot be converted to money
-- without assuming a model. This replaces it with a model+operation
-- grain; src/lib/pricing.ts prices each row and the route sums per
-- account.
--
-- Row counts stay tiny: the grain is (account, operation, model), so an
-- account using every operation on every model is still a handful of
-- rows, not one per event.
--
-- Deliberately ADDITIVE: usage_accounts_overview is left in place even
-- though nothing calls it after this change ships. Dropping it here would
-- make the migration order-dependent — apply it before the deploy and the
-- still-running admin accounts list 500s on a missing function. Drop it in
-- a follow-up migration once the new code is live everywhere.

create or replace function usage_accounts_breakdown(
  p_since timestamptz
)
returns table (
  account_id         text,
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
    u.account_id,
    u.operation,
    u.model,
    count(*)::bigint                  as events,
    sum(u.input_tokens)::bigint       as input_tokens,
    sum(u.output_tokens)::bigint      as output_tokens,
    sum(u.cache_read_tokens)::bigint  as cache_read_tokens,
    sum(u.cache_write_tokens)::bigint as cache_write_tokens
  from usage_events u
  where u.created_at >= p_since
  group by u.account_id, u.operation, u.model;
$$;
