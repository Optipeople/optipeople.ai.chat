// search_kb implementation for the realtime voice tool.
//
// Mirrors the chat route's executor but kept as a separate module so the
// voice path can evolve independently. Returns text snippets along with
// the originating document id and an image flag so the model can cite
// figures by description even though voice has no thumbnail UI.

import { readDocumentMeta } from "./docMeta";
import { getSupabaseServerClient } from "./supabase";
import { embedQuery, VOYAGE_MODEL } from "./voyage";

export type SearchKbHit = {
  document_id: string;
  title: string;
  page_from: number | null;
  page_to: number | null;
  score: number;
  text: string;
  is_image: boolean;
  image_alt: string | null;
  /**
   * Catalogue number of the source manual when known. Lets the assistant
   * notice that two hits come from two different manuals covering two
   * different product series instead of merging their tables. See
   * docs/answer-correctness-plan.md fix F.
   */
  catalog_no: string | null;
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
  const queryEmbedding = await embedQuery(query, {
    machineId: args.machineId,
  });
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
  const chunkIds = rows.map((r) => r.chunk_id);
  const [docTitles, chunkAssets] = await Promise.all([
    docIds.length > 0
      ? supabase
          .from("kb_documents")
          .select("id, title, meta")
          .in("id", docIds)
      : Promise.resolve({ data: [] }),
    chunkIds.length > 0
      ? supabase.from("kb_chunks").select("id, asset_id").in("id", chunkIds)
      : Promise.resolve({ data: [] }),
  ]);

  const titleByDoc = new Map<string, string>();
  const catalogByDoc = new Map<string, string>();
  for (const d of (docTitles.data ?? []) as {
    id: string;
    title: string;
    meta: unknown;
  }[]) {
    titleByDoc.set(d.id, d.title);
    const catalogNo = readDocumentMeta(d.meta).catalogNo;
    if (catalogNo) catalogByDoc.set(d.id, catalogNo);
  }
  const assetByChunk = new Map<string, string>();
  for (const c of (chunkAssets.data ?? []) as {
    id: string;
    asset_id: string | null;
  }[]) {
    if (c.asset_id) assetByChunk.set(c.id, c.asset_id);
  }

  const assetIds = [...new Set(assetByChunk.values())];
  const altByAsset = new Map<string, string | null>();
  if (assetIds.length > 0) {
    const { data: assets } = await supabase
      .from("kb_assets")
      .select("id, alt_text, caption")
      .in("id", assetIds);
    for (const a of (assets ?? []) as {
      id: string;
      alt_text: string | null;
      caption: string;
    }[]) {
      altByAsset.set(a.id, a.alt_text ?? a.caption.slice(0, 80));
    }
  }

  return {
    results: rows.map((r) => {
      const assetId = assetByChunk.get(r.chunk_id);
      return {
        document_id: r.document_id,
        title: titleByDoc.get(r.document_id) ?? "(unknown)",
        page_from: r.page_from,
        page_to: r.page_to,
        score: r.rrf_score,
        text: r.text,
        is_image: !!assetId,
        image_alt: assetId ? altByAsset.get(assetId) ?? null : null,
        catalog_no: catalogByDoc.get(r.document_id) ?? null,
      };
    }),
    chunkIds,
  };
}

export type DocumentManifestEntry = {
  document_id: string;
  title: string;
  summary: string;
  page_count: number | null;
};

export async function listDocuments(
  machineId: string,
): Promise<DocumentManifestEntry[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("kb_documents")
    .select("id, title, summary, page_count")
    .eq("machine_id", machineId)
    .eq("status", "ready")
    .order("title", { ascending: true });
  if (error) throw new Error(`listDocuments: ${error.message}`);
  return ((data ?? []) as Array<{
    id: string;
    title: string;
    summary: string;
    page_count: number | null;
  }>).map((d) => ({
    document_id: d.id,
    title: d.title,
    summary: d.summary,
    page_count: d.page_count,
  }));
}
