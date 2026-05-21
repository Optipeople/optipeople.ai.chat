// GET    /api/admin/accounts/[accountId]/escalation — current target (or null).
// PUT    /api/admin/accounts/[accountId]/escalation — upsert target.
// DELETE /api/admin/accounts/[accountId]/escalation — clear target.
//
// One row per Optipeople account in escalation_targets. Super-admin
// gated. The chat "Tilkald service" button checks this row at click time
// — if no target is configured, the operator gets a "service ikke
// konfigureret" hint.

import { getTranslations } from "next-intl/server";
import { AuthError, assertAccountAccess, requireAdmin } from "@/lib/auth";
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

const VALID_CHANNELS: EscalationChannel[] = [
  "sms",
  "email",
  "service_ticket",
  "webhook",
];

// E.164 with a leading + and 8–15 digits. Twilio accepts looser inputs
// but normalises them in unpredictable ways; we'd rather reject up-front
// than send to the wrong number.
const E164_RE = /^\+[1-9]\d{7,14}$/;

async function gate(req: Request, accountId: string) {
  try {
    const user = await requireAdmin(req);
    assertAccountAccess(user, accountId);
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
  const { accountId } = await ctx.params;
  const { denied } = await gate(req, accountId);
  if (denied) return denied;
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("escalation_targets")
    .select("account_id, channel, target, label, updated_at, updated_by")
    .eq("account_id", accountId)
    .maybeSingle();

  if (error) {
    console.error("admin escalation GET failed:", error);
    const t = await getTranslations("server");
    return Response.json({ error: t("dbError") }, { status: 500 });
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
  const { accountId } = await ctx.params;
  const { user, denied } = await gate(req, accountId);
  if (denied) return denied;

  const t = await getTranslations("server");

  let body: { channel?: unknown; target?: unknown; label?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: t("invalidJson") }, { status: 400 });
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
      { error: t("admin.invalidChannel") },
      { status: 400 },
    );
  }
  if (target.length === 0 || target.length > 500) {
    return Response.json(
      { error: t("admin.invalidTargetLength") },
      { status: 400 },
    );
  }
  if (channel === "sms" && !E164_RE.test(target)) {
    return Response.json(
      { error: t("admin.invalidPhone") },
      { status: 400 },
    );
  }
  // Webhook URLs must parse and use http(s). Reject anything else
  // up-front so the admin gets a clear error rather than a 502 at chat
  // time when the operator hits "Tilkald service".
  if (channel === "webhook") {
    try {
      const u = new URL(target);
      if (u.protocol !== "https:" && u.protocol !== "http:") {
        throw new Error("non-http");
      }
    } catch {
      return Response.json(
        { error: t("admin.invalidWebhookUrl") },
        { status: 400 },
      );
    }
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
    return Response.json({ error: t("dbError") }, { status: 500 });
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
  const { accountId } = await ctx.params;
  const { denied } = await gate(req, accountId);
  if (denied) return denied;

  const supabase = getSupabaseServerClient();

  const { error } = await supabase
    .from("escalation_targets")
    .delete()
    .eq("account_id", accountId);

  if (error) {
    console.error("admin escalation DELETE failed:", error);
    const t = await getTranslations("server");
    return Response.json({ error: t("dbError") }, { status: 500 });
  }
  return Response.json({ ok: true });
}
