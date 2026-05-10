// GET    /api/admin/accounts/[accountId]/escalation — current target (or null).
// PUT    /api/admin/accounts/[accountId]/escalation — upsert target.
// DELETE /api/admin/accounts/[accountId]/escalation — clear target.
//
// One row per Optipeople account in escalation_targets. Super-admin
// gated. The chat "Tilkald service" button checks this row at click time
// — if no target is configured, the operator gets a "service ikke
// konfigureret" hint.

import { AuthError, requireSuperAdmin } from "@/lib/auth";
import type { EscalationChannel } from "@/lib/escalation";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type AdminEscalationTarget = {
  accountId: string;
  channel: EscalationChannel;
  target: string;
  label: string | null;
  updatedAt: string;
  updatedBy: string | null;
};

export type AdminEscalationTargetResponse = {
  target: AdminEscalationTarget | null;
};

const VALID_CHANNELS: EscalationChannel[] = ["phone", "email", "service_ticket"];

async function gate(req: Request) {
  try {
    const user = await requireSuperAdmin(req);
    return { user, denied: null as Response | null };
  } catch (err) {
    if (err instanceof AuthError) return { user: null, denied: err.toResponse() };
    throw err;
  }
}

function rowToTarget(row: {
  account_id: string;
  channel: EscalationChannel;
  target: string;
  label: string | null;
  updated_at: string;
  updated_by: string | null;
}): AdminEscalationTarget {
  return {
    accountId: row.account_id,
    channel: row.channel,
    target: row.target,
    label: row.label,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ accountId: string }> },
) {
  const { denied } = await gate(req);
  if (denied) return denied;

  const { accountId } = await ctx.params;
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("escalation_targets")
    .select("account_id, channel, target, label, updated_at, updated_by")
    .eq("account_id", accountId)
    .maybeSingle();

  if (error) {
    console.error("admin escalation GET failed:", error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }

  const result: AdminEscalationTargetResponse = {
    target: data ? rowToTarget(data as Parameters<typeof rowToTarget>[0]) : null,
  };
  return Response.json(result);
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ accountId: string }> },
) {
  const { user, denied } = await gate(req);
  if (denied) return denied;

  const { accountId } = await ctx.params;

  let body: { channel?: unknown; target?: unknown; label?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const channel =
    typeof body.channel === "string" &&
    (VALID_CHANNELS as string[]).includes(body.channel)
      ? (body.channel as EscalationChannel)
      : null;
  const target = typeof body.target === "string" ? body.target.trim() : "";
  const label =
    typeof body.label === "string" && body.label.trim().length > 0
      ? body.label.trim().slice(0, 200)
      : null;

  if (!channel) {
    return Response.json(
      { error: "channel must be 'phone', 'email' or 'service_ticket'" },
      { status: 400 },
    );
  }
  if (target.length === 0 || target.length > 500) {
    return Response.json(
      { error: "target is required (1–500 chars)" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("escalation_targets")
    .upsert(
      {
        account_id: accountId,
        channel,
        target,
        label,
        updated_at: new Date().toISOString(),
        updated_by: user?.email ?? null,
      },
      { onConflict: "account_id" },
    )
    .select("account_id, channel, target, label, updated_at, updated_by")
    .single();

  if (error || !data) {
    console.error("admin escalation PUT failed:", error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }

  const result: AdminEscalationTargetResponse = {
    target: rowToTarget(data as Parameters<typeof rowToTarget>[0]),
  };
  return Response.json(result);
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ accountId: string }> },
) {
  const { denied } = await gate(req);
  if (denied) return denied;

  const { accountId } = await ctx.params;
  const supabase = getSupabaseServerClient();

  const { error } = await supabase
    .from("escalation_targets")
    .delete()
    .eq("account_id", accountId);

  if (error) {
    console.error("admin escalation DELETE failed:", error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
