// GET /api/admin/machines/[id]/conversations
//   ?page=N&perPage=M  (defaults: page=0, perPage=25)
//
// Paginated list of conversations for the machine, with a count of
// messages and the timestamp of the most recent one for sorting / display.

import {
  assertMachineAccess,
  AuthError,
  requireAdmin,
} from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type AdminConversationListItem = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  userEmail: string | null;
  userName: string | null;
  entryMode: string | null;
  resolution: string | null;
  messageCount: number;
  lastMessageAt: string | null;
};

const DEFAULT_PER_PAGE = 25;
const MAX_PER_PAGE = 100;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  try {
    const admin = await requireAdmin(req);
    await assertMachineAccess(admin, id);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }
  const url = new URL(req.url);
  const page = Math.max(0, parseInt(url.searchParams.get("page") ?? "0", 10) || 0);
  const perPage = Math.min(
    MAX_PER_PAGE,
    Math.max(1, parseInt(url.searchParams.get("perPage") ?? "", 10) || DEFAULT_PER_PAGE),
  );

  const supabase = getSupabaseServerClient();
  const offset = page * perPage;

  // Fetch one extra row beyond the page size to know if there's more
  // without a separate COUNT(*) query (cheap pagination indicator).
  const {
    data: rows,
    error,
  } = await supabase
    .from("conversations")
    .select(
      "id, started_at, ended_at, user_email, user_name, entry_mode, resolution",
    )
    .eq("machine_id", id)
    .order("started_at", { ascending: false })
    .range(offset, offset + perPage); // inclusive

  if (error) {
    console.error("admin conversations list failed:", error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }

  const slice = (rows ?? []).slice(0, perPage) as Array<{
    id: string;
    started_at: string;
    ended_at: string | null;
    user_email: string | null;
    user_name: string | null;
    entry_mode: string | null;
    resolution: string | null;
  }>;
  const hasMore = (rows?.length ?? 0) > perPage;

  // Bulk-fetch message counts + last-message timestamps for the slice.
  const ids = slice.map((r) => r.id);
  const stats = new Map<string, { count: number; lastAt: string | null }>();
  if (ids.length > 0) {
    const { data: msgs, error: msgErr } = await supabase
      .from("messages")
      .select("conversation_id, created_at")
      .in("conversation_id", ids);
    if (msgErr) {
      console.error("admin conversations stats failed:", msgErr);
      return Response.json({ error: "Database error" }, { status: 500 });
    }
    for (const m of (msgs ?? []) as {
      conversation_id: string;
      created_at: string;
    }[]) {
      const cur = stats.get(m.conversation_id) ?? { count: 0, lastAt: null };
      cur.count += 1;
      if (!cur.lastAt || m.created_at > cur.lastAt) cur.lastAt = m.created_at;
      stats.set(m.conversation_id, cur);
    }
  }

  const items: AdminConversationListItem[] = slice.map((r) => {
    const s = stats.get(r.id) ?? { count: 0, lastAt: null };
    return {
      id: r.id,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      userEmail: r.user_email,
      userName: r.user_name,
      entryMode: r.entry_mode,
      resolution: r.resolution,
      messageCount: s.count,
      lastMessageAt: s.lastAt,
    };
  });

  return Response.json({ conversations: items, page, perPage, hasMore });
}
