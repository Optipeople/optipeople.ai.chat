// GET /api/admin/machines/[id]/insights
//   ?status=pending|published|rejected|nothing|all  (default pending;
//     "all" covers everything except 'nothing', which held nothing worth
//     keeping and is only shown when asked for explicitly)
//   &page=N&perPage=M  (defaults: page=0, perPage=25)
//
// Paginated list (with exact total) of the insights the distill sweep
// extracted from this machine's conversations (src/lib/distill.ts),
// newest first. conversationId lets the UI link to the conversation.

import { getTranslations } from "next-intl/server";
import {
  assertMachineAccess,
  AuthError,
  requireAdmin,
} from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase";
import {
  INSIGHT_SELECT_COLS,
  toAdminInsight,
  type AdminInsightRow,
} from "@/app/api/admin/insights/shared";

export type { AdminInsight, AdminInsightStatus } from "@/app/api/admin/insights/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_FILTERS = ["pending", "published", "rejected", "nothing", "all"] as const;
export type AdminInsightStatusFilter = (typeof STATUS_FILTERS)[number];

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
  const statusRaw = url.searchParams.get("status");
  const status: AdminInsightStatusFilter = (STATUS_FILTERS as readonly string[]).includes(
    statusRaw ?? "",
  )
    ? (statusRaw as AdminInsightStatusFilter)
    : "pending";

  const supabase = getSupabaseServerClient();
  const offset = page * perPage;

  let q = supabase
    .from("kb_insights")
    .select(INSIGHT_SELECT_COLS, { count: "exact" })
    .eq("machine_id", id);
  q = status === "all" ? q.neq("status", "nothing") : q.eq("status", status);

  const { data, count, error } = await q
    .order("created_at", { ascending: false })
    .range(offset, offset + perPage - 1);

  if (error) {
    console.error("admin insights list failed:", error);
    const t = await getTranslations("server");
    return Response.json({ error: t("dbError") }, { status: 500 });
  }

  const items = ((data ?? []) as unknown as AdminInsightRow[]).map(toAdminInsight);
  const total = count ?? items.length;

  return Response.json({
    insights: items,
    page,
    perPage,
    total,
    hasMore: offset + items.length < total,
  });
}
