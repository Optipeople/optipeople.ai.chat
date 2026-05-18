// GET /api/documents/[id]/url — mint a short-lived signed URL for the
// original PDF. Operator-accessible counterpart to the admin endpoint at
// /api/admin/documents/[id]/url; only requires that the caller is logged
// in (no SuperAdministrator gate). Used by the chat UI to turn source
// citations into clickable links opening in a new tab.

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
  // Either Optipeople bearer or a QR token (header X-QR-Token, or
  // ?qrToken=… on the URL). For QR sessions we additionally restrict
  // access to documents on the operator's resolved machine.
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
  const { data: doc, error } = await supabase
    .from("kb_documents")
    .select("storage_path, title, machine_id, source_type")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("doc url lookup failed:", error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  if (!doc) {
    return Response.json({ error: "Document not found" }, { status: 404 });
  }
  const row = doc as {
    storage_path: string | null;
    title: string;
    machine_id: string;
    source_type: "pdf" | "url" | "manual_note" | "feedback" | "image";
  };
  // QR sessions are pinned to one machine — refuse cross-machine doc
  // lookups even if the operator guesses a UUID.
  if (qrMachineId && row.machine_id !== qrMachineId) {
    return Response.json({ error: "Document not found" }, { status: 404 });
  }
  if (!row.storage_path) {
    return Response.json(
      { error: "Document has no original file" },
      { status: 404 },
    );
  }

  const bucket = row.source_type === "image" ? "kb-images" : "kb-documents";
  const { data: signed, error: signErr } = await supabase.storage
    .from(bucket)
    .createSignedUrl(row.storage_path, SIGN_EXPIRY_SECONDS);

  if (signErr || !signed) {
    console.error("doc signed url failed:", signErr);
    return Response.json({ error: "Could not sign URL" }, { status: 500 });
  }

  return Response.json({
    url: signed.signedUrl,
    title: row.title,
    sourceType: row.source_type,
  });
}
