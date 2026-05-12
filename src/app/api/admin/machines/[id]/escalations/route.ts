// GET /api/admin/machines/[id]/escalations
//   ?page=N&perPage=M  (defaults: page=0, perPage=25)
//
// Paginated list of escalations originating from any conversation tied
// to this machine. Joined to conversations to scope by machine_id;
// escalations.machine_id isn't a column (the row references conversation
// only) so the filter goes through a sub-select.

import { getTranslations } from "next-intl/server";
import { AuthError, requireSuperAdmin } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type AdminEscalationListItem = {
  id: string;
  conversationId: string;
  channel: "sms" | "email" | "service_ticket" | "webhook";
  target: string;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string | null;
  shareToken: string | null;
};

const DEFAULT_PER_PAGE = 25;
const MAX_PER_PAGE = 100;

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
  const url = new URL(req.url);
  const page = Math.max(0, parseInt(url.searchParams.get("page") ?? "0", 10) || 0);
  const perPage = Math.min(
    MAX_PER_PAGE,
    Math.max(1, parseInt(url.searchParams.get("perPage") ?? "", 10) || DEFAULT_PER_PAGE),
  );

  const supabase = getSupabaseServerClient();
  const offset = page * perPage;

  // PostgREST inner join syntax: `conversations!inner(machine_id)` filters
  // escalations down to those whose linked conversation matches the
  // machine. The .eq("conversations.machine_id", id) is the actual filter.
  const { data: rows, error } = await supabase
    .from("escalations")
    .select(
      "id, conversation_id, channel, target, note, created_by, created_at, expires_at, share_token, conversations!inner(machine_id)",
    )
    .eq("conversations.machine_id", id)
    .order("created_at", { ascending: false })
    .range(offset, offset + perPage);

  if (error) {
    console.error("admin escalations list failed:", error);
    const t = await getTranslations("server");
    return Response.json({ error: t("dbError") }, { status: 500 });
  }

  const slice = (rows ?? []).slice(0, perPage) as Array<{
    id: string;
    conversation_id: string;
    channel: AdminEscalationListItem["channel"];
    target: string;
    note: string | null;
    created_by: string | null;
    created_at: string;
    expires_at: string | null;
    share_token: string | null;
  }>;
  const hasMore = (rows?.length ?? 0) > perPage;

  const items: AdminEscalationListItem[] = slice.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    channel: r.channel,
    target: r.target,
    note: r.note,
    createdBy: r.created_by,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    shareToken: r.share_token,
  }));

  return Response.json({ escalations: items, page, perPage, hasMore });
}
