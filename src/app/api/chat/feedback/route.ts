// POST /api/chat/feedback
//   Body: { conversationId, resolved, solutionText? }
//
// Operator answers "Var dette nyttigt?" at the end of a chat. We write a
// `feedback` row, set `conversations.resolution` (resolved/unresolved) and
// stamp `ended_at`. Idempotent per conversation: re-submitting overwrites
// the previous answer (an operator can change their mind before the page
// is gone).

import { AuthError, resolveCurrentUser } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FeedbackBody = {
  conversationId?: unknown;
  resolved?: unknown;
  solutionText?: unknown;
};

export async function POST(req: Request) {
  let user;
  try {
    user = await resolveCurrentUser(req);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  let body: FeedbackBody;
  try {
    body = (await req.json()) as FeedbackBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
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
    .select("id, user_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (convErr) {
    console.error("feedback: conversation lookup failed:", convErr);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  if (!conv || (conv as { user_id: string }).user_id !== user.userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Replace any prior feedback for this conversation so the operator can
  // change their answer before navigating away.
  const { error: delErr } = await supabase
    .from("feedback")
    .delete()
    .eq("conversation_id", conversationId);
  if (delErr) {
    console.error("feedback: delete prior failed:", delErr);
    return Response.json({ error: "Database error" }, { status: 500 });
  }

  const { error: insErr } = await supabase.from("feedback").insert({
    conversation_id: conversationId,
    resolved,
    solution_text: solutionText,
  });
  if (insErr) {
    console.error("feedback: insert failed:", insErr);
    return Response.json({ error: "Database error" }, { status: 500 });
  }

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

  return Response.json({ ok: true });
}
