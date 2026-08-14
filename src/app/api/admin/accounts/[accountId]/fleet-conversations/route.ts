// GET /api/admin/accounts/[accountId]/fleet-conversations
//   ?page=N&perPage=M          (defaults: page=0, perPage=25)
//   &resolution=resolved|unresolved|escalated|none   (optional filter;
//     "none" = rows without a resolution)
//   &from=YYYY-MM-DD&to=YYYY-MM-DD   (optional started_at range, inclusive)
//   &sort=newest|problems      (default newest; "problems" puts
//     unresolved/escalated conversations first, then recency)
//
// Account-level counterpart of /api/admin/machines/[id]/conversations
// for fleet ("all machines") chats — scope='fleet' rows carry no
// machine_id, so they are invisible to the machine-keyed audit views.
// Same query params, same response shape (the client reuses
// ConversationsList for both), same partitioned "problems first" sort.

import { getTranslations } from "next-intl/server";
import { assertAccountAccess, AuthError, requireAdmin } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase";
import type { AdminConversationListItem } from "@/app/api/admin/machines/[id]/conversations/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PER_PAGE = 25;
const MAX_PER_PAGE = 100;

const RESOLUTION_FILTERS = ["resolved", "unresolved", "escalated", "none"] as const;
const PROBLEM_RESOLUTIONS = ["unresolved", "escalated"] as const;
// PostgREST or-filter matching everything that is NOT a problem row.
// `.not("resolution", "in", ...)` would drop NULL rows (SQL NOT IN), so
// the null case is spelled out.
const NON_PROBLEM_OR = "resolution.is.null,resolution.in.(resolved,unknown)";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Filters = {
  resolution: (typeof RESOLUTION_FILTERS)[number] | null;
  from: string | null;
  // Exclusive upper bound (the day after the requested inclusive `to`).
  toExclusive: string | null;
};

type ConversationRow = {
  id: string;
  started_at: string;
  ended_at: string | null;
  user_email: string | null;
  user_name: string | null;
  entry_mode: string | null;
  resolution: string | null;
};

const SELECT_COLS =
  "id, started_at, ended_at, user_email, user_name, entry_mode, resolution";

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await ctx.params;
  try {
    const admin = await requireAdmin(req);
    assertAccountAccess(admin, accountId);
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
  const resolutionRaw = url.searchParams.get("resolution");
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");
  const filters: Filters = {
    resolution: (RESOLUTION_FILTERS as readonly string[]).includes(resolutionRaw ?? "")
      ? (resolutionRaw as Filters["resolution"])
      : null,
    from: fromRaw && DATE_RE.test(fromRaw) ? fromRaw : null,
    toExclusive: toRaw && DATE_RE.test(toRaw) ? nextDay(toRaw) : null,
  };
  const sort = url.searchParams.get("sort") === "problems" ? "problems" : "newest";

  const supabase = getSupabaseServerClient();
  const offset = page * perPage;

  const baseQuery = (head: boolean) => {
    let q = supabase
      .from("conversations")
      .select(head ? "id" : SELECT_COLS, { count: "exact", head })
      .eq("account_id", accountId)
      .eq("scope", "fleet");
    if (filters.resolution === "none") q = q.is("resolution", null);
    else if (filters.resolution) q = q.eq("resolution", filters.resolution);
    if (filters.from) q = q.gte("started_at", filters.from);
    if (filters.toExclusive) q = q.lt("started_at", filters.toExclusive);
    return q;
  };

  let slice: ConversationRow[];
  let total: number;

  // "Problems first" can't be expressed as a PostgREST order (no CASE
  // expressions), so it's served as two date-ordered partitions —
  // problems, then the rest — with the page window mapped across the
  // seam. A resolution filter collapses to a single partition, where
  // plain recency ordering is equivalent.
  if (sort === "problems" && !filters.resolution) {
    const [
      { count: problemCount, error: pErr },
      { count: restCount, error: rErr },
    ] = await Promise.all([
      baseQuery(true).in("resolution", [...PROBLEM_RESOLUTIONS]),
      baseQuery(true).or(NON_PROBLEM_OR),
    ]);
    if (pErr || rErr) {
      console.error("admin fleet conversations count failed:", pErr, rErr);
      const t = await getTranslations("server");
      return Response.json({ error: t("dbError") }, { status: 500 });
    }
    const problems = problemCount ?? 0;
    total = problems + (restCount ?? 0);

    slice = [];
    if (offset < problems) {
      const end = Math.min(offset + perPage, problems) - 1;
      const { data, error } = await baseQuery(false)
        .in("resolution", [...PROBLEM_RESOLUTIONS])
        .order("started_at", { ascending: false })
        .range(offset, end);
      if (error) {
        console.error("admin fleet conversations list failed:", error);
        const t = await getTranslations("server");
        return Response.json({ error: t("dbError") }, { status: 500 });
      }
      slice = (data ?? []) as unknown as ConversationRow[];
    }
    const remaining = perPage - slice.length;
    const restOffset = Math.max(0, offset - problems);
    if (remaining > 0 && restOffset < (restCount ?? 0)) {
      const { data, error } = await baseQuery(false)
        .or(NON_PROBLEM_OR)
        .order("started_at", { ascending: false })
        .range(restOffset, restOffset + remaining - 1);
      if (error) {
        console.error("admin fleet conversations list failed:", error);
        const t = await getTranslations("server");
        return Response.json({ error: t("dbError") }, { status: 500 });
      }
      slice = slice.concat((data ?? []) as unknown as ConversationRow[]);
    }
  } else {
    const { data, count, error } = await baseQuery(false)
      .order("started_at", { ascending: false })
      .range(offset, offset + perPage - 1);
    if (error) {
      console.error("admin fleet conversations list failed:", error);
      const t = await getTranslations("server");
      return Response.json({ error: t("dbError") }, { status: 500 });
    }
    slice = (data ?? []) as unknown as ConversationRow[];
    total = count ?? slice.length;
  }

  // Bulk-fetch message counts + last-message timestamps for the slice.
  const ids = slice.map((r) => r.id);
  const stats = new Map<string, { count: number; lastAt: string | null }>();
  if (ids.length > 0) {
    const { data: msgs, error: msgErr } = await supabase
      .from("messages")
      .select("conversation_id, created_at")
      .in("conversation_id", ids);
    if (msgErr) {
      console.error("admin fleet conversations stats failed:", msgErr);
      const t = await getTranslations("server");
      return Response.json({ error: t("dbError") }, { status: 500 });
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

  return Response.json({
    conversations: items,
    page,
    perPage,
    total,
    hasMore: offset + items.length < total,
  });
}
