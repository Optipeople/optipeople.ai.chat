// GET /api/chat/attachments/[id]/url — short-lived signed URL for an
// operator-uploaded chat attachment. Used by the chat client to render
// thumbnails next to user messages (own session and admin replay).
//
// Auth: bearer OR QR token. QR sessions are scoped to a single machine
// — cross-machine reads return 404.

import { AuthError, resolveCurrentUser } from "@/lib/auth";
import { readQrTokenFromRequest, resolveQrToken } from "@/lib/qrAuth";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGN_EXPIRY_SECONDS = 600;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const hasBearer = !!req.headers.get("authorization");
  const url = new URL(req.url);
  const qrToken =
    readQrTokenFromRequest(req, null) ?? url.searchParams.get("qrToken");

  let qrMachineId: string | null = null;
  if (hasBearer) {
    try {
      await resolveCurrentUser(req);
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
    qrMachineId = session.machineId;
  } else {
    return Response.json(
      { error: "Missing or malformed Authorization header" },
      { status: 401 },
    );
  }

  const { id } = await ctx.params;
  const supabase = getSupabaseServerClient();
  const { data: row, error } = await supabase
    .from("conversation_attachments")
    .select("storage_path, mime_type, machine_id")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("chat attachment url lookup failed:", error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  if (!row) {
    return Response.json({ error: "Attachment not found" }, { status: 404 });
  }
  const r = row as {
    storage_path: string;
    mime_type: string;
    machine_id: string;
  };
  if (qrMachineId && r.machine_id !== qrMachineId) {
    return Response.json({ error: "Attachment not found" }, { status: 404 });
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from("chat-attachments")
    .createSignedUrl(r.storage_path, SIGN_EXPIRY_SECONDS);
  if (signErr || !signed) {
    console.error("chat attachment signed url failed:", signErr);
    return Response.json({ error: "Could not sign URL" }, { status: 500 });
  }

  return Response.json({
    url: signed.signedUrl,
    mimeType: r.mime_type,
  });
}
