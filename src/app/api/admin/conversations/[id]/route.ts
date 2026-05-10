// GET /api/admin/conversations/[id] — full conversation drilldown.
// Returns the conversation + every message in order, with chunk
// metadata expanded for tool messages (so the audit can show which
// manual snippets the AI saw).

import { AuthError, requireSuperAdmin } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type AdminChunkRef = {
  id: string;
  documentId: string;
  documentTitle: string;
  ordinal: number;
  pageFrom: number | null;
  pageTo: number | null;
  text: string;
};

export type AdminConversationMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName: string | null;
  toolInput: unknown;
  chunks: AdminChunkRef[] | null;
  tokensIn: number | null;
  tokensOut: number | null;
  cacheHit: boolean | null;
  createdAt: string;
};

export type AdminConversationDetail = {
  id: string;
  machineId: string;
  accountId: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  startedAt: string;
  endedAt: string | null;
  entryMode: string | null;
  resolution: string | null;
  messages: AdminConversationMessage[];
};

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  const { id } = await ctx.params;
  const supabase = getSupabaseServerClient();

  const [
    { data: conv, error: cErr },
    { data: msgs, error: mErr },
  ] = await Promise.all([
    supabase
      .from("conversations")
      .select(
        "id, machine_id, account_id, user_id, user_email, user_name, started_at, ended_at, entry_mode, resolution",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("messages")
      .select(
        "id, role, content, tool_name, tool_input, tool_chunks, tokens_in, tokens_out, cache_hit, created_at",
      )
      .eq("conversation_id", id)
      .order("created_at", { ascending: true }),
  ]);

  if (cErr || mErr) {
    console.error("admin conversation detail failed:", cErr, mErr);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  if (!conv) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Bulk-resolve chunks across all tool messages so we don't
  // round-trip per row.
  const chunkIds = new Set<string>();
  for (const m of (msgs ?? []) as { tool_chunks: string[] | null }[]) {
    if (m.tool_chunks) for (const c of m.tool_chunks) chunkIds.add(c);
  }

  const chunkMap = new Map<string, AdminChunkRef>();
  if (chunkIds.size > 0) {
    const { data: chunks, error: chErr } = await supabase
      .from("kb_chunks")
      .select("id, document_id, ordinal, page_from, page_to, text")
      .in("id", Array.from(chunkIds));
    if (chErr) {
      console.error("admin conversation chunks failed:", chErr);
      return Response.json({ error: "Database error" }, { status: 500 });
    }

    const docIds = [
      ...new Set(
        ((chunks ?? []) as { document_id: string }[]).map((c) => c.document_id),
      ),
    ];
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

    for (const c of (chunks ?? []) as {
      id: string;
      document_id: string;
      ordinal: number;
      page_from: number | null;
      page_to: number | null;
      text: string;
    }[]) {
      chunkMap.set(c.id, {
        id: c.id,
        documentId: c.document_id,
        documentTitle: titleByDoc.get(c.document_id) ?? "(unknown)",
        ordinal: c.ordinal,
        pageFrom: c.page_from,
        pageTo: c.page_to,
        text: c.text,
      });
    }
  }

  const conversation = conv as {
    id: string;
    machine_id: string;
    account_id: string;
    user_id: string;
    user_email: string | null;
    user_name: string | null;
    started_at: string;
    ended_at: string | null;
    entry_mode: string | null;
    resolution: string | null;
  };

  const result: AdminConversationDetail = {
    id: conversation.id,
    machineId: conversation.machine_id,
    accountId: conversation.account_id,
    userId: conversation.user_id,
    userEmail: conversation.user_email,
    userName: conversation.user_name,
    startedAt: conversation.started_at,
    endedAt: conversation.ended_at,
    entryMode: conversation.entry_mode,
    resolution: conversation.resolution,
    messages: ((msgs ?? []) as Array<{
      id: string;
      role: "user" | "assistant" | "tool";
      content: string;
      tool_name: string | null;
      tool_input: unknown;
      tool_chunks: string[] | null;
      tokens_in: number | null;
      tokens_out: number | null;
      cache_hit: boolean | null;
      created_at: string;
    }>).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      toolName: m.tool_name,
      toolInput: m.tool_input,
      chunks: m.tool_chunks
        ? m.tool_chunks
            .map((cid) => chunkMap.get(cid))
            .filter((c): c is AdminChunkRef => !!c)
        : null,
      tokensIn: m.tokens_in,
      tokensOut: m.tokens_out,
      cacheHit: m.cache_hit,
      createdAt: m.created_at,
    })),
  };

  return Response.json(result);
}
