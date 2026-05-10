// POST /api/chat/feedback
//   Body: { conversationId, resolved, solutionText? }
//
// Operator answers "Var dette nyttigt?" at the end of a chat. We write a
// `feedback` row, set `conversations.resolution` (resolved/unresolved) and
// stamp `ended_at`. Idempotent per conversation: re-submitting overwrites
// the previous answer (an operator can change their mind before the page
// is gone).

import { AuthError, resolveCurrentUser } from "@/lib/auth";
import { promoteFeedbackToKb } from "@/lib/feedback";
import { readQrTokenFromRequest, resolveQrToken } from "@/lib/qrAuth";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FeedbackBody = {
  conversationId?: unknown;
  resolved?: unknown;
  solutionText?: unknown;
  qrToken?: unknown;
};

export async function POST(req: Request) {
  let body: FeedbackBody;
  try {
    body = (await req.json()) as FeedbackBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Bearer takes precedence; fall back to QR token for shop-floor
  // sticker sessions. Either path resolves to a stable userId we can
  // match against conversations.user_id.
  const hasBearer = !!req.headers.get("authorization");
  const qrToken = readQrTokenFromRequest(req, body);

  let userIdentity: { userId: string; email: string | null };
  if (hasBearer) {
    try {
      const u = await resolveCurrentUser(req);
      userIdentity = { userId: u.userId, email: u.email };
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
    userIdentity = { userId: session.userId, email: session.email };
  } else {
    return Response.json(
      { error: "Missing or malformed Authorization header" },
      { status: 401 },
    );
  }

  const conversationId = body.conversationId;
  const resolved = body.resolved;
  const rawSolution = body.solutionText;

  if (typeof conversationId !== "string" || conversationId.length === 0) {
    return Response.json(
      { error: "conversationId is required" },
      { status: 400 },
    );
  }
  if (typeof resolved !== "boolean") {
    return Response.json(
      { error: "resolved must be a boolean" },
      { status: 400 },
    );
  }
  const solutionText =
    typeof rawSolution === "string" && rawSolution.trim().length > 0
      ? rawSolution.trim().slice(0, 4000)
      : null;

  const supabase = getSupabaseServerClient();

  // Confirm the conversation belongs to this user — prevents one
  // operator stamping resolution on someone else's row by guessing UUIDs.
  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select("id, user_id, machine_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (convErr) {
    console.error("feedback: conversation lookup failed:", convErr);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  const conversation = conv as
    | { user_id: string; machine_id: string }
    | null;
  if (!conversation || conversation.user_id !== userIdentity.userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // If a prior feedback row exists, find its promoted doc (if any) so
  // we can wipe it before re-promoting from the new answer. Keeps the
  // KB consistent with the operator's latest verdict.
  const { data: priorRow } = await supabase
    .from("feedback")
    .select("promoted_doc_id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const priorPromotedDocId =
    (priorRow as { promoted_doc_id: string | null } | null)?.promoted_doc_id ??
    null;

  // Replace any prior feedback for this conversation so the operator
  // can change their answer before navigating away.
  const { error: delErr } = await supabase
    .from("feedback")
    .delete()
    .eq("conversation_id", conversationId);
  if (delErr) {
    console.error("feedback: delete prior failed:", delErr);
    return Response.json({ error: "Database error" }, { status: 500 });
  }

  if (priorPromotedDocId) {
    const { error: docDelErr } = await supabase
      .from("kb_documents")
      .delete()
      .eq("id", priorPromotedDocId);
    if (docDelErr) {
      console.warn("feedback: prior promoted doc cleanup failed:", docDelErr);
      // Soft-fail — the new promotion will still create a fresh doc; the
      // old one lingers until an admin removes it manually.
    }
  }

  const { data: inserted, error: insErr } = await supabase
    .from("feedback")
    .insert({
      conversation_id: conversationId,
      resolved,
      solution_text: solutionText,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    console.error("feedback: insert failed:", insErr);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  const feedbackId = (inserted as { id: string }).id;

  const { error: updErr } = await supabase
    .from("conversations")
    .update({
      resolution: resolved ? "resolved" : "unresolved",
      ended_at: new Date().toISOString(),
    })
    .eq("id", conversationId);
  if (updErr) {
    console.error("feedback: conversation update failed:", updErr);
    // Best-effort — the feedback row landed, which is the source of truth.
  }

  // Auto-promote on "Ja + here's what worked". Synchronous: typical
  // solution_text is short (one chunk → one Voyage call). Failures are
  // logged but don't fail the request — the operator already submitted
  // their feedback successfully; promotion is a downstream effect.
  if (resolved && solutionText) {
    try {
      await promoteFeedbackToKb({
        feedbackId,
        conversationId,
        machineId: conversation.machine_id,
        solutionText,
        createdBy: userIdentity.email ?? userIdentity.userId,
      });
    } catch (err) {
      console.error("feedback: auto-promote failed:", err);
    }
  }

  return Response.json({ ok: true });
}
