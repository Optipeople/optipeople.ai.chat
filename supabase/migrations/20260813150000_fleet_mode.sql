-- Fleet mode: account-wide ("all machines") conversations alongside the
-- existing per-machine ones. Plan: docs/fleet-mode-plan.md
--
-- A conversation now has an explicit scope, fixed at creation:
--   machine — today's behavior, machine_id required (QR sessions are
--             always machine-scoped)
--   fleet   — spans every machine on the account, machine_id is null

alter table conversations alter column machine_id drop not null;
alter table conversations add column scope text not null default 'machine'
  check (scope in ('machine', 'fleet'));
-- machine-scoped rows must carry a machine, fleet rows must not.
alter table conversations add constraint conversations_scope_machine_ck
  check ((scope = 'machine') = (machine_id is not null));

create index conversations_account_scope_idx
  on conversations (account_id, scope);

-- conversation_attachments: fleet chats have no single machine to key
-- an upload by. The chat route scopes fleet attachment access by the
-- account's machine set instead, so relax the column the same way.
-- (Client currently disables uploads in fleet scope; this keeps the
-- schema from blocking it when that lands.)
alter table conversation_attachments alter column machine_id drop not null;

-- Multi-machine hybrid retrieval. Same BM25 + vector + RRF formula as
-- search_kb, over a set of machines instead of one, and returning
-- machine_id so results can be attributed per machine (fleet source
-- chips). The single-machine search_kb function stays untouched — the
-- voice path and any pinned callers keep using it.
create or replace function search_kb_multi(
  p_machine_ids     text[],
  p_query_embedding vector(1024),
  p_query_text      text,
  p_embedding_model text default 'voyage-4-large',
  p_match_count     int  default 6,
  p_candidates      int  default 30,
  p_rrf_k           int  default 60
)
returns table (
  chunk_id    uuid,
  document_id uuid,
  machine_id  text,
  ordinal     int,
  page_from   int,
  page_to     int,
  text        text,
  rrf_score   float
)
language sql
stable
as $$
  with vector_hits as (
    select
      id,
      row_number() over (order by embedding <=> p_query_embedding) as rank
    from kb_chunks
    where machine_id      = any(p_machine_ids)
      and embedding_model = p_embedding_model
    order by embedding <=> p_query_embedding
    limit p_candidates
  ),
  keyword_hits as (
    select
      id,
      row_number() over (order by ts_rank_cd(text_tsv, plainto_tsquery('simple', p_query_text)) desc) as rank
    from kb_chunks
    where machine_id = any(p_machine_ids)
      and text_tsv @@ plainto_tsquery('simple', p_query_text)
    order by ts_rank_cd(text_tsv, plainto_tsquery('simple', p_query_text)) desc
    limit p_candidates
  ),
  fused as (
    select
      id,
      sum(1.0 / (p_rrf_k + rank)) as score
    from (
      select id, rank from vector_hits
      union all
      select id, rank from keyword_hits
    ) combined
    group by id
  )
  select
    c.id          as chunk_id,
    c.document_id,
    c.machine_id,
    c.ordinal,
    c.page_from,
    c.page_to,
    c.text,
    f.score::float as rrf_score
  from fused f
  join kb_chunks c on c.id = f.id
  order by f.score desc
  limit p_match_count;
$$;
