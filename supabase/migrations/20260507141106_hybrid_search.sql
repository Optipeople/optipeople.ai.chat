-- Hybrid retrieval (BM25 + vector) over kb_chunks, fused with Reciprocal
-- Rank Fusion. Used by the /api/chat search_kb tool.
--
-- Why a stored function rather than client-side fusion: it's one round
-- trip instead of two, the ranking happens next to the data, and we can
-- evolve the formula (rerankers, score thresholds, etc.) without touching
-- application code.

create or replace function search_kb(
  p_machine_id      text,
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
    where machine_id      = p_machine_id
      and embedding_model = p_embedding_model
    order by embedding <=> p_query_embedding
    limit p_candidates
  ),
  keyword_hits as (
    select
      id,
      row_number() over (order by ts_rank_cd(text_tsv, plainto_tsquery('simple', p_query_text)) desc) as rank
    from kb_chunks
    where machine_id = p_machine_id
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
