// GET /api/escalations/[token] — public, token-gated.
//
// Service tech opens the share URL from the operator's escalation. The
// token IS the auth: anyone with the link can read the transcript until
// it expires. Returns the snapshot stored on the escalation row, plus
// channel/target metadata so the tech sees who the operator was trying
// to reach.

import { getTranslations } from "next-intl/server";
import type { EscalationChannel, EscalationSnapshot } from "@/lib/escalation";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type EscalationViewResponse = {
  escalationId: string;
  createdAt: string;
  expiresAt: string | null;
  channel: EscalationChannel;
  target: string;
  note: string | null;
  createdBy: string | null;
  snapshot: EscalationSnapshot;
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const t = await getTranslations("server");
  if (!token || token.length < 16) {
    return Response.json({ error: t("escalation.invalidToken") }, { status: 404 });
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("escalations")
    .select(
      "id, channel, target, note, created_by, created_at, expires_at, context_blob",
    )
    .eq("share_token", token)
    .maybeSingle();

  if (error) {
    console.error("escalation view lookup failed:", error);
    return Response.json({ error: t("dbError") }, { status: 500 });
  }
  if (!data) {
    return Response.json({ error: t("notFound") }, { status: 404 });
  }

  const row = data as {
    id: string;
    channel: EscalationChannel;
    target: string;
    note: string | null;
    created_by: string | null;
    created_at: string;
    expires_at: string | null;
    context_blob: EscalationSnapshot | null;
  };

  // Soft expiry — we don't delete the row when it lapses (the audit
  // trail is forever) but the tech-facing view stops resolving so a
  // photographed link doesn't live indefinitely.
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return Response.json(
      { error: t("escalation.linkExpired") },
      { status: 410 },
    );
  }
  if (!row.context_blob) {
    return Response.json(
      { error: t("escalation.snapshotMissing") },
      { status: 500 },
    );
  }

  const result: EscalationViewResponse = {
    escalationId: row.id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    channel: row.channel,
    target: row.target,
    note: row.note,
    createdBy: row.created_by,
    snapshot: row.context_blob,
  };
  return Response.json(result);
}
