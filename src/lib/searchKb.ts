// Minimal search_kb implementation for the realtime voice tool.
//
// This is intentionally a separate, simpler path from the chat route's
// in-line executor: voice doesn't render image thumbnails or source
// chips, so we strip the asset-join logic and just return text snippets
// the model can read aloud.

import { getSupabaseServerClient } from "./supabase";
import { embedQuery, VOYAGE_MODEL } from "./voyage";

export type SearchKbHit = {
  document_id: string;
  title: string;
  page_from: number | null;
  page_to: number | null;
  score: number;
  text: string;
};

export type SearchKbResult = {
  results: SearchKbHit[];
  chunkIds: string[];
};

export async function searchKb(args: {
  machineId: string;
  query: string;
  topK?: number;
}): Promise<SearchKbResult> {
  const topK = Math.min(Math.max(args.topK ?? 6, 1), 12);
  const query = args.query.trim();
  if (!query) return { results: [], chunkIds: [] };

  const supabase = getSupabaseServerClient();
  const queryEmbedding = await embedQuery(query);
  const { data, error } = await supabase.rpc("search_kb", {
    p_machine_id: args.machineId,
    p_query_embedding: queryEmbedding,
    p_query_text: query,
    p_embedding_model: VOYAGE_MODEL,
    p_match_count: topK,
  });
  if (error) throw new Error(`search_kb rpc: ${error.message}`);

  const rows = (data ?? []) as Array<{
    chunk_id: string;
    document_id: string;
    page_from: number | null;
    page_to: number | null;
    text: string;
    rrf_score: number;
  }>;

  const docIds = [...new Set(rows.map((r) => r.document_id))];
  const titleByDoc = new Map<string, string>();
  if (docIds.length > 0) {
    const { data: docs } = await supabase
      .from("kb_documents")
      .select("id, title")
      .in("id", docIds);
    for (const d of (docs ?? []) as { id: string; title: string }[]) {
      titleByDoc.set(d.id, d.title);
    }
  }

  return {
    results: rows.map((r) => ({
      document_id: r.document_id,
      title: titleByDoc.get(r.document_id) ?? "(unknown)",
      page_from: r.page_from,
      page_to: r.page_to,
      score: r.rrf_score,
      text: r.text,
    })),
    chunkIds: rows.map((r) => r.chunk_id),
  };
}
