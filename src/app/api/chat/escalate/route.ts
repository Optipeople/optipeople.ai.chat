// POST /api/chat/escalate
//   Body: { conversationId, note?, qrToken? }
//
// Operator hits "Call service". We snapshot the conversation, mint a
// share token, write an `escalations` row and stamp the conversation
// with resolution='escalated'. Returns the configured channel/target so
// the client can confirm what was sent, or render the share URL for copy.
//
// Auth dual-path (bearer or QR), mirrors the feedback route. The
// snapshot is stored on the row so the tech's view doesn't depend on
// the live `messages` table — escalation is a frozen handoff.

import { randomUUID } from "node:crypto";
import { getLocale, getTranslations } from "next-intl/server";
import { defaultLocale, type Locale } from "@/i18n/config";
import { AuthError, resolveCurrentUser } from "@/lib/auth";
import { appendUserMessage, createConversation } from "@/lib/conversations";
import { EmailError, sendEmail } from "@/lib/email";
import {
  mintShareToken,
  SHARE_TOKEN_TTL_MS,
  WebhookError,
  sendEscalationWebhook,
  type EscalationChannel,
  type EscalationSnapshot,
  type EscalationWebhookPayload,
} from "@/lib/escalation";
import { readQrTokenFromRequest, resolveQrToken } from "@/lib/qrAuth";
import {
  SmsError,
  getRecipientLocale,
  renderEscalationSms,
  sendSms,
} from "@/lib/sms";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  conversationId?: unknown;
  // Used when escalating before any chat has started — server creates a
  // conversation on the fly and stores `note` as the first user message.
  // For QR auth these are ignored in favor of the token's pinned IDs.
  machineId?: unknown;
  accountId?: unknown;
  note?: unknown;
  qrToken?: unknown;
};

export type EscalateResponse = {
  ok: true;
  escalationId: string;
  // The conversation the escalation is attached to. When the client
  // didn't provide a conversationId, this is the id of the conversation
  // we created on the fly — useful for the operator's local state.
  conversationId: string;
  channel: EscalationChannel;
  target: string;
  label: string | null;
  shareToken: string;
  shareUrl: string;
  expiresAt: string;
  // 'email'         : server-sent via Resend.
  // 'sms'           : server-sent via Twilio.
  // 'service_ticket': client surfaces the share URL for copy.
  // 'webhook'       : server POSTs JSON to the configured URL.
  emailSent: boolean;
  emailId: string | null;
  smsSent: boolean;
  smsId: string | null;
  webhookSent: boolean;
  webhookStatus: number | null;
};

export async function POST(req: Request) {
  const t = await getTranslations("server");
  const userLocale = (await getLocale()) as Locale;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: t("invalidJson") }, { status: 400 });
  }

  const hasBearer = !!req.headers.get("authorization");
  const qrToken = readQrTokenFromRequest(req, body);

  let userIdentity: { userId: string; email: string | null; name: string | null };
  // When auth is QR, machine/account are pinned by the token and must
  // override any client-supplied IDs. For bearer auth we trust the body
  // (same as /api/chat does) but fall back to the user's home account.
  let pinnedMachineId: string | null = null;
  let pinnedAccountId: string | null = null;
  let fallbackAccountId: string | null = null;
  let pinnedEntryMode: "qr" | "manual" = "manual";
  if (hasBearer) {
    try {
      const u = await resolveCurrentUser(req);
      userIdentity = { userId: u.userId, email: u.email, name: u.name };
      fallbackAccountId = u.accountId;
    } catch (err) {
      if (err instanceof AuthError) return err.toResponse();
      throw err;
    }
  } else if (qrToken) {
    const session = await resolveQrToken(qrToken);
    if (!session) {
      return Response.json(
        { error: t("invalidQrToken") },
        { status: 401 },
      );
    }
    userIdentity = {
      userId: session.userId,
      email: session.email,
      name: session.name,
    };
    pinnedMachineId = session.machineId;
    pinnedAccountId = session.accountId;
    pinnedEntryMode = "qr";
  } else {
    return Response.json(
      { error: t("missingAuthHeader") },
      { status: 401 },
    );
  }

  const note =
    typeof body.note === "string" && body.note.trim().length > 0
      ? body.note.trim().slice(0, 1000)
      : null;

  const supabase = getSupabaseServerClient();

  let conversationId: string;
  let conversation: {
    id: string;
    machine_id: string;
    account_id: string;
    user_id: string;
    started_at: string;
  };

  const rawConversationId = body.conversationId;
  const hasConversationId =
    typeof rawConversationId === "string" && rawConversationId.length > 0;

  if (hasConversationId) {
    conversationId = rawConversationId as string;

    // Confirm ownership — same IDOR guard as the feedback route.
    const { data: convRow, error: convErr } = await supabase
      .from("conversations")
      .select("id, machine_id, account_id, user_id, started_at")
      .eq("id", conversationId)
      .maybeSingle();
    if (convErr) {
      console.error("escalate: conversation lookup failed:", convErr);
      return Response.json({ error: t("dbError") }, { status: 500 });
    }
    const found = convRow as typeof conversation | null;
    if (!found || found.user_id !== userIdentity.userId) {
      return Response.json({ error: t("notFound") }, { status: 404 });
    }
    conversation = found;
  } else {
    // No prior chat — escalate directly from the operator's note. We
    // mint a conversation row so the rest of the flow (snapshot, audit
    // join, share view) doesn't have to branch.
    const machineId =
      pinnedMachineId ??
      (typeof body.machineId === "string" && body.machineId.length > 0
        ? body.machineId
        : null);
    if (!machineId) {
      return Response.json(
        { error: t("missingField", { field: "machineId" }) },
        { status: 400 },
      );
    }
    const accountId =
      pinnedAccountId ??
      (typeof body.accountId === "string" && body.accountId.length > 0
        ? body.accountId
        : fallbackAccountId);
    if (!accountId) {
      return Response.json(
        { error: t("missingField", { field: "accountId" }) },
        { status: 400 },
      );
    }

    try {
      conversationId = await createConversation({
        scope: { kind: "machine", machineId },
        accountId,
        userId: userIdentity.userId,
        userEmail: userIdentity.email,
        userName: userIdentity.name,
        entryMode: pinnedEntryMode,
      });
    } catch (err) {
      console.error("escalate: createConversation failed:", err);
      return Response.json({ error: t("dbError") }, { status: 500 });
    }

    // Persist the note as the first user turn so the technician's
    // snapshot includes it. Best-effort: a failure here doesn't block
    // escalation since `note` is also delivered out-of-band in
    // email/SMS/webhook payloads.
    if (note) {
      try {
        await appendUserMessage(conversationId, note);
      } catch (err) {
        console.warn("escalate: appendUserMessage failed (soft):", err);
      }
    }

    conversation = {
      id: conversationId,
      machine_id: machineId,
      account_id: accountId,
      user_id: userIdentity.userId,
      started_at: new Date().toISOString(),
    };
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
    return Response.json({ error: t("dbError") }, { status: 500 });
  }
  const target = targetRow as
    | { channel: EscalationChannel; target: string; label: string | null }
    | null;
  if (!target) {
    return Response.json(
      {
        error: t("escalation.noTarget"),
        code: "no_target",
      },
      { status: 409 },
    );
  }

  // Look up machine display name + recent messages for the snapshot.
  // Tool turns are skipped — the tech wants the operator/AI dialogue,
  // not the search internals. Fault photos the operator attached are
  // captured too (paths only; the view signs URLs at render time).
  const [
    { data: machineRow },
    { data: messages, error: msgErr },
    { data: attachmentRows },
  ] = await Promise.all([
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
    supabase
      .from("conversation_attachments")
      .select("id, storage_path, mime_type, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(12),
  ]);
  if (msgErr) {
    console.error("escalate: messages lookup failed:", msgErr);
    return Response.json({ error: t("dbError") }, { status: 500 });
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
    attachments: ((attachmentRows ?? []) as Array<{
      id: string;
      storage_path: string;
      mime_type: string;
      created_at: string;
    }>).map((a) => ({
      id: a.id,
      storagePath: a.storage_path,
      mimeType: a.mime_type,
      createdAt: a.created_at,
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

  // Send the email/SMS/webhook FIRST for the active channels — if the
  // delivery fails we refuse to create the escalations row (per the
  // explicit "hard fail" policy: the operator should know nothing went
  // out, not discover a stranded row in audit). For service_ticket the
  // row IS the contract; nothing leaves the server.
  // Mint the escalationId up-front so the webhook payload can include
  // a stable id (the downstream system needs it to dedupe retries).
  // We use the same id when inserting the row a few lines down.
  const escalationId = randomUUID();

  let emailId: string | null = null;
  let smsId: string | null = null;
  let webhookStatus: number | null = null;
  if (target.channel === "email") {
    // Email goes to a technician — use the recipient's locale, not the
    // operator's. Falls back to English when no preference is stored.
    const recipientLocale = await getRecipientLocale(target.target);
    const tEmail = await getTranslations({
      locale: recipientLocale,
      namespace: "server.escalation",
    });
    const subject = snapshot.machineName
      ? tEmail("emailSubjectWithMachine", { machine: snapshot.machineName })
      : tEmail("emailSubjectBase");
    const emailBody = await renderEscalationEmail({
      locale: recipientLocale,
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
        text: emailBody,
        replyTo: snapshot.operator.email ?? null,
      });
      emailId = sent.id;
    } catch (err) {
      const detail =
        err instanceof EmailError
          ? err.message
          : t("escalation.unknownEmailError");
      console.error("escalate: email send failed:", err);
      return Response.json(
        {
          error: t("escalation.emailFailed", { detail }),
          code: "email_failed",
        },
        { status: 502 },
      );
    }
  }

  if (target.channel === "sms") {
    // SMS recipient is identified by phone — we don't have an email to
    // look up. Use default locale ('en') unless a future schema change
    // ties phones to preferences.
    const smsBody = await renderEscalationSms({
      machineName: snapshot.machineName,
      shareUrl,
      locale: defaultLocale,
    });
    try {
      const sent = await sendSms({ to: target.target, body: smsBody });
      smsId = sent.id;
    } catch (err) {
      const detail =
        err instanceof SmsError
          ? err.message
          : t("escalation.unknownSmsError");
      console.error("escalate: sms send failed:", err);
      return Response.json(
        {
          error: t("escalation.smsFailed", { detail }),
          code: "sms_failed",
        },
        { status: 502 },
      );
    }
  }

  if (target.channel === "webhook") {
    const payload: EscalationWebhookPayload = {
      type: "optipeople.escalation.created",
      version: 1,
      escalationId,
      conversationId,
      machine: { id: snapshot.machineId, name: snapshot.machineName },
      account: { id: snapshot.accountId },
      operator: snapshot.operator,
      note,
      shareUrl,
      expiresAt: expiresAt.toISOString(),
      startedAt: snapshot.startedAt,
      transcript: snapshot.messages,
    };
    try {
      const sent = await sendEscalationWebhook(target.target, payload);
      webhookStatus = sent.status;
    } catch (err) {
      const detail =
        err instanceof WebhookError
          ? err.message
          : t("escalation.unknownWebhookError");
      console.error("escalate: webhook send failed:", err);
      return Response.json(
        {
          error: t("escalation.webhookFailed", { detail }),
          code: "webhook_failed",
        },
        { status: 502 },
      );
    }
  }

  const { error: insErr } = await supabase
    .from("escalations")
    .insert({
      id: escalationId,
      conversation_id: conversationId,
      channel: target.channel,
      target: target.target,
      context_blob: snapshot,
      share_token: shareToken,
      share_token_created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      created_by: userIdentity.email ?? userIdentity.userId,
      note,
    });
  if (insErr) {
    console.error("escalate: insert failed:", insErr);
    return Response.json({ error: t("dbError") }, { status: 500 });
  }

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

  // userLocale is currently only used implicitly by getTranslations("server")
  // above — kept named for clarity that operator-facing errors render in
  // the operator's cookie locale.
  void userLocale;

  const result: EscalateResponse = {
    ok: true,
    escalationId,
    conversationId,
    channel: target.channel,
    target: target.target,
    label: target.label,
    shareToken,
    shareUrl,
    expiresAt: expiresAt.toISOString(),
    emailSent: emailId !== null,
    emailId,
    smsSent: smsId !== null,
    smsId,
    webhookSent: webhookStatus !== null,
    webhookStatus,
  };
  return Response.json(result);
}

async function renderEscalationEmail(args: {
  locale: Locale;
  machineName: string | null;
  operatorName: string | null;
  operatorEmail: string | null;
  note: string | null;
  shareUrl: string;
  expiresAt: Date;
}): Promise<string> {
  const t = await getTranslations({
    locale: args.locale,
    namespace: "server.escalation",
  });
  // Format the expiry timestamp in the recipient's locale.
  const dtLocale = args.locale === "da" ? "da-DK" : "en-US";
  const dt = new Intl.DateTimeFormat(dtLocale, {
    dateStyle: "long",
    timeStyle: "short",
  });

  const machine = args.machineName ?? t("emailUnknownMachine");
  const operatorBase =
    args.operatorName ?? args.operatorEmail ?? t("emailUnknownOperator");
  const operatorLine = args.operatorEmail
    ? `${operatorBase} (${args.operatorEmail})`
    : operatorBase;
  const noteSection = args.note
    ? `${t("emailNoteHeading")}\n${args.note}\n\n`
    : "";
  return (
    `${t("emailGreeting")}\n\n` +
    `${t("emailIntro")}\n\n` +
    `${t("emailMachineLine", { machine })}\n` +
    `${t("emailOperatorLine", { operator: operatorLine })}\n\n` +
    noteSection +
    `${t("emailLinkIntro", { expires: dt.format(args.expiresAt) })}\n` +
    `${args.shareUrl}\n\n` +
    `${t("emailSignature")}`
  );
}
