-- Retrieval v2 for search_kb / search_kb_multi.
-- Plan: docs/answer-correctness-plan.md ("implemented 2026-09-18").
--
-- What changes, and why:
--
--   1. p_query_embedding is nullable. When Voyage is down the chat route
--      passes null and gets a keyword-only search instead of a 500.
--   2. New return column `similarity` = 1 - cosine distance of the returned
--      chunk to the query (null in keyword-only mode). RRF scores are
--      rank-based and not comparable across queries; the route needs an
--      absolute signal to tell "the manual covers this" from "these were
--      merely the least bad chunks".
--   3. Both candidate branches join kb_documents on status = 'ready', so
--      chunks of failed or half-ingested documents never surface.
--   4. hnsw.ef_search = 200 at function level (default 40 is too small once
--      the machine_id / embedding_model / status filters discard most of
--      the graph neighbourhood). hnsw.iterative_scan = relaxed_order is
--      added by the DO block below only where pgvector >= 0.8 has it.
--   5. Keyword branch: an OR of the query's simple-config lexemes instead
--      of plainto_tsquery's AND. A five-word question no longer needs all
--      five words in one chunk to get a BM25 hit. Ranked with ts_rank_cd
--      normalisation 1|32 (log-length penalty, clamped to 0..1).
--   6. Diversity caps before the final limit: at most 3 chunks per
--      document, at most 2 figure-caption chunks (asset_id not null), and
--      in fleet search at most greatest(2, p_match_count / #machines)
--      chunks per machine when more than one machine is searched.
--
-- Adding a return column changes the function's result type, which
-- CREATE OR REPLACE refuses, hence the DROP IF EXISTS on the exact old
-- signature first. Both drops are no-ops on a fresh database.

drop function if exists search_kb(text, vector, text, text, int, int, int);
drop function if exists search_kb_multi(text[], vector, text, text, int, int, int);

-- ---------------------------------------------------------------------------
-- Single machine
-- ---------------------------------------------------------------------------
create or replace function search_kb(
  p_machine_id      text,
  p_query_embedding vector(1024) default null,
  p_query_text      text         default '',
  p_embedding_model text         default 'voyage-4-large',
  p_match_count     int          default 6,
  p_candidates      int          default 30,
  p_rrf_k           int          default 60
)
returns table (
  chunk_id    uuid,
  document_id uuid,
  ordinal     int,
  page_from   int,
  page_to     int,
  text        text,
  rrf_score   float,
  similarity  float
)
language sql
stable
set hnsw.ef_search = 200
as $$
  with kw_text as (
    -- Every distinct lexeme of the query under the same 'simple' config
    -- that built text_tsv, quoted so a lexeme can never be read as a
    -- tsquery operator, OR-ed together. Null when the query has none.
    select nullif(
      (select string_agg(quote_literal(lex), ' | ')
         from unnest(tsvector_to_array(to_tsvector('simple', coalesce(p_query_text, '')))) as lex),
      '') as q_text
  ),
  kw_query as (
    select case when q_text is null then null::tsquery
                else to_tsquery('simple', q_text) end as q
    from kw_text
  ),
  vector_hits as (
    select
      c.id,
      row_number() over (order by c.embedding <=> p_query_embedding) as rank
    from kb_chunks c
    join kb_documents d on d.id = c.document_id and d.status = 'ready'
    where p_query_embedding is not null
      and c.machine_id      = p_machine_id
      and c.embedding_model = p_embedding_model
    order by c.embedding <=> p_query_embedding
    limit p_candidates
  ),
  keyword_hits as (
    select
      c.id,
      row_number() over (order by ts_rank_cd(c.text_tsv, kq.q, 1 | 32) desc) as rank
    from kb_chunks c
    join kb_documents d on d.id = c.document_id and d.status = 'ready'
    cross join kw_query kq
    where kq.q is not null
      and numnode(kq.q) > 0
      and c.machine_id = p_machine_id
      and c.text_tsv @@ kq.q
    order by ts_rank_cd(c.text_tsv, kq.q, 1 | 32) desc
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
  ),
  ranked as (
    select
      f.id,
      f.score,
      c.asset_id,
      row_number() over (partition by c.document_id order by f.score desc, f.id) as doc_rn
    from fused f
    join kb_chunks c on c.id = f.id
  ),
  doc_capped as (
    select id, score, asset_id
    from ranked
    where doc_rn <= 3
  ),
  asset_capped as (
    select
      id,
      score,
      asset_id,
      row_number() over (partition by (asset_id is not null) order by score desc, id) as kind_rn
    from doc_capped
  ),
  top_hits as (
    select id, score
    from asset_capped
    where asset_id is null or kind_rn <= 2
    order by score desc, id
    limit p_match_count
  )
  select
    c.id          as chunk_id,
    c.document_id,
    c.ordinal,
    c.page_from,
    c.page_to,
    c.text,
    t.score::float as rrf_score,
    case when p_query_embedding is not null
         then (1 - (c.embedding <=> p_query_embedding))::float
         else null::float
    end           as similarity
  from top_hits t
  join kb_chunks c on c.id = t.id
  order by t.score desc, c.id;
$$;

-- ---------------------------------------------------------------------------
-- Fleet (several machines)
-- ---------------------------------------------------------------------------
create or replace function search_kb_multi(
  p_machine_ids     text[],
  p_query_embedding vector(1024) default null,
  p_query_text      text         default '',
  p_embedding_model text         default 'voyage-4-large',
  p_match_count     int          default 6,
  p_candidates      int          default 30,
  p_rrf_k           int          default 60
)
returns table (
  chunk_id    uuid,
  document_id uuid,
  machine_id  text,
  ordinal     int,
  page_from   int,
  page_to     int,
  text        text,
  rrf_score   float,
  similarity  float
)
language sql
stable
set hnsw.ef_search = 200
as $$
  with kw_text as (
    select nullif(
      (select string_agg(quote_literal(lex), ' | ')
         from unnest(tsvector_to_array(to_tsvector('simple', coalesce(p_query_text, '')))) as lex),
      '') as q_text
  ),
  kw_query as (
    select case when q_text is null then null::tsquery
                else to_tsquery('simple', q_text) end as q
    from kw_text
  ),
  vector_hits as (
    select
      c.id,
      row_number() over (order by c.embedding <=> p_query_embedding) as rank
    from kb_chunks c
    join kb_documents d on d.id = c.document_id and d.status = 'ready'
    where p_query_embedding is not null
      and c.machine_id      = any(p_machine_ids)
      and c.embedding_model = p_embedding_model
    order by c.embedding <=> p_query_embedding
    limit p_candidates
  ),
  keyword_hits as (
    select
      c.id,
      row_number() over (order by ts_rank_cd(c.text_tsv, kq.q, 1 | 32) desc) as rank
    from kb_chunks c
    join kb_documents d on d.id = c.document_id and d.status = 'ready'
    cross join kw_query kq
    where kq.q is not null
      and numnode(kq.q) > 0
      and c.machine_id = any(p_machine_ids)
      and c.text_tsv @@ kq.q
    order by ts_rank_cd(c.text_tsv, kq.q, 1 | 32) desc
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
  ),
  ranked as (
    select
      f.id,
      f.score,
      c.asset_id,
      c.machine_id,
      row_number() over (partition by c.document_id order by f.score desc, f.id) as doc_rn
    from fused f
    join kb_chunks c on c.id = f.id
  ),
  doc_capped as (
    select id, score, asset_id, machine_id
    from ranked
    where doc_rn <= 3
  ),
  -- Fleet quota: no single machine may fill the result set when several
  -- are searched. Skipped (rn always allowed) for a one-machine array.
  machine_capped as (
    select id, score, asset_id
    from (
      select
        id, score, asset_id,
        row_number() over (partition by machine_id order by score desc, id) as machine_rn
      from doc_capped
    ) m
    where cardinality(p_machine_ids) <= 1
       or machine_rn <= greatest(2, p_match_count / greatest(cardinality(p_machine_ids), 1))
  ),
  asset_capped as (
    select
      id,
      score,
      asset_id,
      row_number() over (partition by (asset_id is not null) order by score desc, id) as kind_rn
    from machine_capped
  ),
  top_hits as (
    select id, score
    from asset_capped
    where asset_id is null or kind_rn <= 2
    order by score desc, id
    limit p_match_count
  )
  select
    c.id          as chunk_id,
    c.document_id,
    c.machine_id,
    c.ordinal,
    c.page_from,
    c.page_to,
    c.text,
    t.score::float as rrf_score,
    case when p_query_embedding is not null
         then (1 - (c.embedding <=> p_query_embedding))::float
         else null::float
    end           as similarity
  from top_hits t
  join kb_chunks c on c.id = t.id
  order by t.score desc, c.id;
$$;

-- ---------------------------------------------------------------------------
-- hnsw.iterative_scan exists only on pgvector >= 0.8. An unknown GUC in a
-- CREATE FUNCTION ... SET clause fails the whole statement on older
-- versions, so it is attached afterwards, and only when supported.
-- ---------------------------------------------------------------------------
do $$
declare
  v_version text;
  v_parts   int[];
begin
  select extversion into v_version from pg_extension where extname = 'vector';
  if v_version is null then
    return;
  end if;
  -- "0.8.0" -> {0,8,0}; tolerate suffixes like "0.8.0-1".
  v_parts := string_to_array(regexp_replace(v_version, '[^0-9.].*$', ''), '.')::int[];
  if v_parts >= array[0, 8, 0] then
    begin
      execute 'alter function search_kb(text, vector, text, text, int, int, int) '
           || 'set hnsw.iterative_scan = ''relaxed_order''';
      execute 'alter function search_kb_multi(text[], vector, text, text, int, int, int) '
           || 'set hnsw.iterative_scan = ''relaxed_order''';
    exception when others then
      raise notice 'hnsw.iterative_scan not applied: %', sqlerrm;
    end;
  end if;
end $$;
