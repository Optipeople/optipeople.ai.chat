// POST /api/conversations/[id]/close — the chat screen reset itself after
// 30 idle minutes (or restored a stash that old) and is done with this
// conversation. Stamps ended_at and, if nobody answered the resolution
// card, resolution 'unknown'. The distill sweep then turns whatever the
// conversation held into knowledge (src/lib/distill.ts).
//
// Same ownership rules as GET /api/conversations/[id]: only the caller's
// own rows, and a QR session only on its own machine.

import { AuthError } from "@/lib/auth";
import { closeConversation } from "@/lib/distill";
import { resolveOperator } from "@/lib/operatorAuth";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let operator;
  try {
    operator = await resolveOperator(req);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  const supabase = getSupabaseServerClient();
  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select("user_id, machine_id")
    .eq("id", id)
    .maybeSingle<{ user_id: string; machine_id: string | null }>();
  if (convErr) {
    console.error("close conversation lookup failed:", convErr);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  if (!conv || conv.user_id !== operator.userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (operator.qrMachineId && conv.machine_id !== operator.qrMachineId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await closeConversation(id);
  return Response.json({ ok: true });
}
