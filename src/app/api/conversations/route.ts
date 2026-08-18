// GET /api/conversations
//   ?scope=machine&machineId=<id>    conversations pinned to that machine
//   ?scope=fleet&accountId=<id>      account-wide ("all machines") chats
//   &page=N&perPage=M                (defaults: page=0, perPage=25)
//
// The caller's OWN chat history for one chat target — the operator-side
// counterpart of /api/admin/machines/[id]/conversations, which is an
// auditor's cross-user view. Rows are always filtered by user_id, so a
// bearer user sees only their own chats and a QR sticker session sees
// only chats started from that sticker.
//
// Scoped to a single chat target on purpose: a conversation's scope is
// fixed at creation, so a row from another machine could not be resumed
// in the current chat anyway.

import { AuthError } from "@/lib/auth";
import { resolveOperator } from "@/lib/operatorAuth";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type OperatorConversationListItem = {
  id: string;
  startedAt: string;
  lastMessageAt: string | null;
  // First thing the operator typed, trimmed to a headline length.
  // Null when the opening turn carried only a photo.
  title: string | null;
  // How many questions the operator asked. Counting user turns keeps
  // this exactly what the reopened transcript shows — assistant rows
  // are per agentic-loop step and several collapse into one bubble.
  questionCount: number;
  resolution: string | null;
};

export type OperatorConversationsResponse = {
  conversations: OperatorConversationListItem[];
  page: number;
  perPage: number;
  hasMore: boolean;
};

const DEFAULT_PER_PAGE = 25;
const MAX_PER_PAGE = 50;
const TITLE_MAX_CHARS = 120;

export async function GET(req: Request) {
  let operator;
  try {
    operator = await resolveOperator(req);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") === "fleet" ? "fleet" : "machine";
  const machineId = url.searchParams.get("machineId");
  const accountId = url.searchParams.get("accountId");
  const page = Math.max(
    0,
    parseInt(url.searchParams.get("page") ?? "0", 10) || 0,
  );
  const perPage = Math.min(
    MAX_PER_PAGE,
    Math.max(
      1,
      parseInt(url.searchParams.get("perPage") ?? "", 10) || DEFAULT_PER_PAGE,
    ),
  );

  if (scope === "machine" && !machineId) {
    return Response.json({ error: "machineId is required" }, { status: 400 });
  }
  if (scope === "fleet" && !accountId) {
    return Response.json({ error: "accountId is required" }, { status: 400 });
  }
  // Fleet scope is unreachable from a sticker — QR sessions are pinned
  // to one machine by design.
  if (operator.qrMachineId && scope === "fleet") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (operator.qrMachineId && operator.qrMachineId !== machineId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = getSupabaseServerClient();
  const offset = page * perPage;
  // One extra row is the "is there more" probe — cheaper than a second
  // exact-count query for a list nobody paginates deeply.
  let query = supabase
    .from("conversations")
    .select("id, started_at, resolution")
    .eq("user_id", operator.userId)
    .eq("scope", scope)
    .order("started_at", { ascending: false })
    .range(offset, offset + perPage);
  query =
    scope === "machine"
      ? query.eq("machine_id", machineId!)
      : query.eq("account_id", accountId!);

  const { data, error } = await query;
  if (error) {
    console.error("operator conversations list failed:", error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }

  const rows = (data ?? []) as {
    id: string;
    started_at: string;
    resolution: string | null;
  }[];
  const hasMore = rows.length > perPage;
  const slice = hasMore ? rows.slice(0, perPage) : rows;
  const ids = slice.map((r) => r.id);

  // Two narrow passes rather than one wide one: the count/recency pass
  // never pulls message bodies (assistant answers are the bulk of the
  // table), and the title pass pulls bodies for user turns only.
  const stats = new Map<
    string,
    { questions: number; visible: number; lastAt: string | null }
  >();
  const titles = new Map<string, string>();
  if (ids.length > 0) {
    const [
      { data: meta, error: metaErr },
      { data: firstTurns, error: turnsErr },
    ] = await Promise.all([
      supabase
        .from("messages")
        .select("conversation_id, role, created_at")
        .in("conversation_id", ids),
      supabase
        .from("messages")
        .select("conversation_id, content, created_at")
        .in("conversation_id", ids)
        .eq("role", "user")
        .order("created_at", { ascending: true }),
    ]);
    if (metaErr || turnsErr) {
      console.error("operator conversations stats failed:", metaErr, turnsErr);
      return Response.json({ error: "Database error" }, { status: 500 });
    }

    for (const m of (meta ?? []) as {
      conversation_id: string;
      role: string;
      created_at: string;
    }[]) {
      const cur = stats.get(m.conversation_id) ?? {
        questions: 0,
        visible: 0,
        lastAt: null,
      };
      if (m.role === "user") cur.questions += 1;
      if (m.role !== "tool") cur.visible += 1;
      if (!cur.lastAt || m.created_at > cur.lastAt) cur.lastAt = m.created_at;
      stats.set(m.conversation_id, cur);
    }
    // Ordered ascending, so the first row seen per conversation is the
    // opening question.
    for (const m of (firstTurns ?? []) as {
      conversation_id: string;
      content: string;
    }[]) {
      if (titles.has(m.conversation_id)) continue;
      const text = m.content.trim();
      if (text) titles.set(m.conversation_id, text);
    }
  }

  // A conversation with nothing in it is an abandoned first request —
  // noise in a history list.
  const conversations: OperatorConversationListItem[] = slice
    .filter((r) => (stats.get(r.id)?.visible ?? 0) > 0)
    .map((r) => {
      const s = stats.get(r.id) ?? { questions: 0, visible: 0, lastAt: null };
      const title = titles.get(r.id);
      return {
        id: r.id,
        startedAt: r.started_at,
        lastMessageAt: s.lastAt,
        title: title
          ? title.length > TITLE_MAX_CHARS
            ? `${title.slice(0, TITLE_MAX_CHARS).trimEnd()}…`
            : title
          : null,
        questionCount: s.questions,
        resolution: r.resolution,
      };
    });

  const body: OperatorConversationsResponse = {
    conversations,
    page,
    perPage,
    hasMore,
  };
  return Response.json(body);
}
