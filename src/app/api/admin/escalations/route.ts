// GET /api/admin/escalations — global escalation inbox.
//   ?page=N&perPage=M            (defaults: page=0, perPage=25)
//   &status=open|handled         (optional filter; omitted = all)
//
// Cross-machine list of escalations, newest first, with an exact total.
// Super admins/partners see every account; account admins only their
// own (scoped via the joined conversation's account_id). Escalations
// whose conversation was deleted have no account to scope by and are
// excluded by the inner join.

import { getTranslations } from "next-intl/server";
import { AuthError, requireAdmin, type Admin } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type AdminEscalationInboxItem = {
  id: string;
  conversationId: string;
  machineId: string;
  machineName: string | null;
  accountId: string;
  channel: "sms" | "email" | "service_ticket" | "webhook";
  target: string;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  shareToken: string | null;
  status: "open" | "handled";
  handledAt: string | null;
  handledBy: string | null;
};

export type AdminEscalationInboxResponse = {
  escalations: AdminEscalationInboxItem[];
  page: number;
  perPage: number;
  total: number;
};

const DEFAULT_PER_PAGE = 25;
const MAX_PER_PAGE = 100;

export async function GET(req: Request) {
  let admin: Admin;
  try {
    admin = await requireAdmin(req);
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
  const status = statusRaw === "open" || statusRaw === "handled" ? statusRaw : null;

  const supabase = getSupabaseServerClient();
  const offset = page * perPage;

  let query = supabase
    .from("escalations")
    .select(
      "id, conversation_id, channel, target, note, created_by, created_at, share_token, status, handled_at, handled_by, conversations!inner(machine_id, account_id)",
      { count: "exact" },
    );
  if (admin.role === "account") {
    query = query.eq("conversations.account_id", admin.accountId);
  }
  if (status) {
    query = query.eq("status", status);
  }
  const { data: rows, count, error } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + perPage - 1);

  if (error) {
    console.error("admin escalations inbox failed:", error);
    const t = await getTranslations("server");
    return Response.json({ error: t("dbError") }, { status: 500 });
  }

  type Row = {
    id: string;
    conversation_id: string;
    channel: AdminEscalationInboxItem["channel"];
    target: string;
    note: string | null;
    created_by: string | null;
    created_at: string;
    share_token: string | null;
    status: "open" | "handled";
    handled_at: string | null;
    handled_by: string | null;
    conversations:
      | { machine_id: string; account_id: string }
      | { machine_id: string; account_id: string }[];
  };
  const slice = (rows ?? []) as unknown as Row[];

  // The joined row is an object for 1:1 embeds, but typings sometimes
  // infer an array — handle both (same idiom as assertDocumentAccess).
  const conv = (r: Row) => (Array.isArray(r.conversations) ? r.conversations[0] : r.conversations);

  // Bulk-resolve machine display names for the page.
  const machineIds = [...new Set(slice.map((r) => conv(r).machine_id))];
  const nameByMachine = new Map<string, string | null>();
  if (machineIds.length > 0) {
    const { data: machines, error: mErr } = await supabase
      .from("machine_kb")
      .select("machine_id, display_name")
      .in("machine_id", machineIds);
    if (mErr) {
      console.error("admin escalations inbox machine lookup failed:", mErr);
      const t = await getTranslations("server");
      return Response.json({ error: t("dbError") }, { status: 500 });
    }
    for (const m of (machines ?? []) as { machine_id: string; display_name: string | null }[]) {
      nameByMachine.set(m.machine_id, m.display_name);
    }
  }

  const result: AdminEscalationInboxResponse = {
    escalations: slice.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      machineId: conv(r).machine_id,
      machineName: nameByMachine.get(conv(r).machine_id) ?? null,
      accountId: conv(r).account_id,
      channel: r.channel,
      target: r.target,
      note: r.note,
      createdBy: r.created_by,
      createdAt: r.created_at,
      shareToken: r.share_token,
      status: r.status,
      handledAt: r.handled_at,
      handledBy: r.handled_by,
    })),
    page,
    perPage,
    total: count ?? slice.length,
  };
  return Response.json(result);
}
