// POST /api/chat/escalate
//   Body: { conversationId, note?, qrToken? }
//
// Operator hits "Tilkald service". We snapshot the conversation, mint a
// share token, write an `escalations` row and stamp the conversation
// with resolution='escalated'. Returns the configured channel/target so
// the client can open tel:/mailto: or render the share URL for copy.
//
// Auth dual-path (bearer or QR), mirrors the feedback route. The
// snapshot is stored on the row so the tech's view doesn't depend on
// the live `messages` table — escalation is a frozen handoff.

import { AuthError, resolveCurrentUser } from "@/lib/auth";
import { EmailError, sendEmail } from "@/lib/email";
import {
  mintShareToken,
  SHARE_TOKEN_TTL_MS,
  type EscalationChannel,
  type EscalationSnapshot,
} from "@/lib/escalation";
import { readQrTokenFromRequest, resolveQrToken } from "@/lib/qrAuth";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  conversationId?: unknown;
  note?: unknown;
  qrToken?: unknown;
};

export type EscalateResponse = {
  ok: true;
  escalationId: string;
  channel: EscalationChannel;
  target: string;
  label: string | null;
  shareToken: string;
  shareUrl: string;
  expiresAt: string;
  // 'email' channel: server-sent via Resend; client should not open mailto.
  // 'phone'         : client opens tel:.
  // 'service_ticket': client surfaces the share URL for copy.
  emailSent: boolean;
  emailId: string | null;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const hasBearer = !!req.headers.get("authorization");
  const qrToken = readQrTokenFromRequest(req, body);

  let userIdentity: { userId: string; email: string | null; name: string | null };
  if (hasBearer) {
    try {
      const u = await resolveCurrentUser(req);
      userIdentity = { userId: u.userId, email: u.email, name: u.name };
    } catch (err) {
      if (err instanceof AuthError) return err.toResponse();
      throw err;
    }
  } else if (qrToken) {
    const session = await resolveQrToken(qrToken);
    if (!session) {
      return Response.json(
        { error: "Invalid or revoked QR token" },
        { status: 401 },
      );
    }
    userIdentity = {
      userId: session.userId,
      email: session.email,
      name: session.name,
    };
  } else {
    return Response.json(
      { error: "Missing or malformed Authorization header" },
      { status: 401 },
    );
  }

  const conversationId = body.conversationId;
  if (typeof conversationId !== "string" || conversationId.length === 0) {
    return Response.json(
      { error: "conversationId is required" },
      { status: 400 },
    );
  }
  const note =
    typeof body.note === "string" && body.note.trim().length > 0
      ? body.note.trim().slice(0, 1000)
      : null;

  const supabase = getSupabaseServerClient();

  // Confirm ownership — same IDOR guard as the feedback route.
  const { data: convRow, error: convErr } = await supabase
    .from("conversations")
    .select("id, machine_id, account_id, user_id, started_at")
    .eq("id", conversationId)
    .maybeSingle();
  if (convErr) {
    console.error("escalate: conversation lookup failed:", convErr);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  const conversation = convRow as
    | {
        id: string;
        machine_id: string;
        account_id: string;
        user_id: string;
        started_at: string;
      }
    | null;
  if (!conversation || conversation.user_id !== userIdentity.userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Pull the configured target for the conversation's account. Without
  // one, escalation can't proceed — surface the precise reason so the
  // operator knows to ask their admin to configure it.
  const { data: targetRow, error: targetErr } = await supabase
    .from("escalation_targets")
    .select("channel, target, label")
    .eq("account_id", conversation.account_id)
    .maybeSingle();
  if (targetErr) {
    console.error("escalate: target lookup failed:", targetErr);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  const target = targetRow as
    | { channel: EscalationChannel; target: string; label: string | null }
    | null;
  if (!target) {
    return Response.json(
      {
        error:
          "Service-eskalering er ikke konfigureret for denne konto. Bed en admin om at sætte den op.",
        code: "no_target",
      },
      { status: 409 },
    );
  }

  // Look up machine display name + recent messages for the snapshot.
  // Tool turns are skipped — the tech wants the operator/AI dialogue,
  // not the search internals.
  const [{ data: machineRow }, { data: messages, error: msgErr }] =
    await Promise.all([
      supabase
        .from("machine_kb")
        .select("display_name")
        .eq("machine_id", conversation.machine_id)
        .maybeSingle(),
      supabase
        .from("messages")
        .select("role, content, created_at")
        .eq("conversation_id", conversationId)
        .in("role", ["user", "assistant"])
        .order("created_at", { ascending: true }),
    ]);
  if (msgErr) {
    console.error("escalate: messages lookup failed:", msgErr);
    return Response.json({ error: "Database error" }, { status: 500 });
  }

  const snapshot: EscalationSnapshot = {
    machineId: conversation.machine_id,
    machineName:
      (machineRow as { display_name: string | null } | null)?.display_name ??
      null,
    accountId: conversation.account_id,
    startedAt: conversation.started_at,
    operator: {
      userId: userIdentity.userId,
      email: userIdentity.email,
      name: userIdentity.name,
    },
    messages: ((messages ?? []) as Array<{
      role: "user" | "assistant";
      content: string;
      created_at: string;
    }>)
      // Skip empty assistant rows (e.g. tool-only turns that never wrote text).
      .filter((m) => m.content && m.content.length > 0)
      .map((m) => ({
        role: m.role,
        content: m.content,
        createdAt: m.created_at,
      })),
  };

  const shareToken = mintShareToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SHARE_TOKEN_TTL_MS);

  // Build absolute share URL ahead of insert so we can put it in the
  // outbound email body. Host header is good enough; if we end up
  // behind a proxy that strips it we'll need to read x-forwarded-host
  // instead.
  const proto =
    req.headers.get("x-forwarded-proto") ??
    new URL(req.url).protocol.replace(":", "") ??
    "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const shareUrl = host
    ? `${proto}://${host}/escalation/${shareToken}`
    : `/escalation/${shareToken}`;

  // Send the email FIRST for the 'email' channel — if Resend fails we
  // refuse to create the escalations row (per the explicit "hard fail"
  // policy: the operator should know mail didn't go out, not discover
  // a stranded row in audit). For phone / service_ticket channels mail
  // isn't part of the contract; the row is the contract.
  let emailId: string | null = null;
  if (target.channel === "email") {
    const subject = `Service-anmodning${
      snapshot.machineName ? ` — ${snapshot.machineName}` : ""
    }`;
    const body = renderEscalationEmail({
      machineName: snapshot.machineName,
      operatorName: snapshot.operator.name,
      operatorEmail: snapshot.operator.email,
      note,
      shareUrl,
      expiresAt,
    });
    try {
      const sent = await sendEmail({
        to: target.target,
        subject,
        text: body,
        replyTo: snapshot.operator.email ?? null,
      });
      emailId = sent.id;
    } catch (err) {
      const detail =
        err instanceof EmailError ? err.message : "Ukendt mail-fejl";
      console.error("escalate: email send failed:", err);
      return Response.json(
        {
          error: `Kunne ikke sende e-mail: ${detail}`,
          code: "email_failed",
        },
        { status: 502 },
      );
    }
  }

  const { data: inserted, error: insErr } = await supabase
    .from("escalations")
    .insert({
      conversation_id: conversationId,
      channel: target.channel,
      target: target.target,
      context_blob: snapshot,
      share_token: shareToken,
      share_token_created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      created_by: userIdentity.email ?? userIdentity.userId,
      note,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    console.error("escalate: insert failed:", insErr);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  const escalationId = (inserted as { id: string }).id;

  const { error: updErr } = await supabase
    .from("conversations")
    .update({
      resolution: "escalated",
      ended_at: now.toISOString(),
    })
    .eq("id", conversationId);
  if (updErr) {
    console.warn("escalate: conversation update failed (soft):", updErr);
    // Best-effort — the escalation row landed, which is what the tech needs.
  }

  const result: EscalateResponse = {
    ok: true,
    escalationId,
    channel: target.channel,
    target: target.target,
    label: target.label,
    shareToken,
    shareUrl,
    expiresAt: expiresAt.toISOString(),
    emailSent: emailId !== null,
    emailId,
  };
  return Response.json(result);
}

const DA_DT = new Intl.DateTimeFormat("da-DK", {
  dateStyle: "long",
  timeStyle: "short",
});

function renderEscalationEmail(args: {
  machineName: string | null;
  operatorName: string | null;
  operatorEmail: string | null;
  note: string | null;
  shareUrl: string;
  expiresAt: Date;
}): string {
  const machine = args.machineName ?? "(ukendt maskine)";
  const operator =
    args.operatorName ?? args.operatorEmail ?? "(ukendt operatør)";
  const operatorLine = args.operatorEmail
    ? `${operator} (${args.operatorEmail})`
    : operator;
  const noteSection = args.note
    ? `Operatørens beskrivelse:\n${args.note}\n\n`
    : "";
  return (
    `Hej,\n\n` +
    `En operatør har bedt om service via OptiAI.\n\n` +
    `Maskine: ${machine}\n` +
    `Operatør: ${operatorLine}\n\n` +
    noteSection +
    `Læs hele samtalen her (gyldig til ${DA_DT.format(args.expiresAt)}):\n` +
    `${args.shareUrl}\n\n` +
    `— OptiAI`
  );
}
