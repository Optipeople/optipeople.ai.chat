-- Max cosine similarity between a query embedding and any chunk in a
-- machine's KB. Used by the starter-question generator to check that a
-- candidate question actually has manual content behind it before it is
-- shown to operators.
--
-- Why not reuse search_kb(): its rrf_score is rank-based (sum of
-- 1/(k+rank)), so the top hit scores roughly the same whether the best
-- chunk is a direct answer or barely related — useless as an absolute
-- relevance signal. Raw cosine similarity is comparable across queries.

create or replace function kb_max_similarity(
  p_machine_id      text,
  p_query_embedding vector(1024),
  p_embedding_model text default 'voyage-4-large'
)
returns float
language sql
stable
as $$
  select coalesce(max(1 - dist), 0)::float
  from (
    select embedding <=> p_query_embedding as dist
    from kb_chunks
    where machine_id      = p_machine_id
      and embedding_model = p_embedding_model
    order by embedding <=> p_query_embedding
    limit 1
  ) nearest;
$$;
