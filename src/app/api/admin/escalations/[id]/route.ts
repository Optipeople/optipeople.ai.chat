// PATCH /api/admin/escalations/[id] — toggle handled/unhandled state.
//   Body: { status: "open" | "handled" }
//
// Marking handled stamps handled_at/handled_by (the admin's email);
// reopening clears both. Account admins are scoped via the escalation's
// conversation — rows whose conversation was deleted have no account to
// verify against, so only super admins/partners may touch those.

import { getTranslations } from "next-intl/server";
import {
  assertAccountAccess,
  AuthError,
  requireAdmin,
  type Admin,
} from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type AdminEscalationStatusResponse = {
  escalation: {
    id: string;
    status: "open" | "handled";
    handledAt: string | null;
    handledBy: string | null;
  };
};

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let admin: Admin;
  try {
    admin = await requireAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  const t = await getTranslations("server");

  let body: { status?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: t("invalidJson") }, { status: 400 });
  }
  const status =
    body.status === "open" || body.status === "handled" ? body.status : null;
  if (!status) {
    return Response.json({ error: t("invalidJson") }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();

  const { data: row, error: lookupErr } = await supabase
    .from("escalations")
    .select("id, conversations(account_id)")
    .eq("id", id)
    .maybeSingle();

  if (lookupErr) {
    console.error("admin escalation status lookup failed:", lookupErr);
    return Response.json({ error: t("dbError") }, { status: 500 });
  }
  if (!row) {
    return Response.json({ error: t("notFound") }, { status: 404 });
  }

  // 1:1 embed can be typed as object or array depending on inference.
  const joined = (row as { conversations: { account_id: string } | { account_id: string }[] | null })
    .conversations;
  const accountId = Array.isArray(joined) ? joined[0]?.account_id : joined?.account_id;
  try {
    if (admin.role === "account") {
      if (!accountId) {
        throw new AuthError(403, "Not authorised for this account");
      }
      assertAccountAccess(admin, accountId);
    }
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  const patch =
    status === "handled"
      ? {
          status,
          handled_at: new Date().toISOString(),
          handled_by: admin.email,
        }
      : { status, handled_at: null, handled_by: null };

  const { data, error } = await supabase
    .from("escalations")
    .update(patch)
    .eq("id", id)
    .select("id, status, handled_at, handled_by")
    .single();

  if (error || !data) {
    console.error("admin escalation status PATCH failed:", error);
    return Response.json({ error: t("dbError") }, { status: 500 });
  }

  const updated = data as {
    id: string;
    status: "open" | "handled";
    handled_at: string | null;
    handled_by: string | null;
  };
  const result: AdminEscalationStatusResponse = {
    escalation: {
      id: updated.id,
      status: updated.status,
      handledAt: updated.handled_at,
      handledBy: updated.handled_by,
    },
  };
  return Response.json(result);
}
