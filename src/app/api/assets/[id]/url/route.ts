// GET /api/assets/[id]/url — mint a short-lived signed URL for a single
// kb_assets row. For standalone images this points at the kb-images
// bucket; for PDF-figure assets it points at the parent PDF in
// kb-documents (the client can append #page=N from the page_from field
// also returned here).
//
// Auth: bearer (Optipeople token) OR QR token. QR sessions are pinned
// to the machine they came from — cross-machine asset lookups return
// 404 even if the operator knows a UUID.

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
  const { data: asset, error } = await supabase
    .from("kb_assets")
    .select(
      "storage_path, storage_bucket, mime_type, page_from, alt_text, machine_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("asset url lookup failed:", error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  if (!asset) {
    return Response.json({ error: "Asset not found" }, { status: 404 });
  }
  const row = asset as {
    storage_path: string;
    storage_bucket: "kb-images" | "kb-documents";
    mime_type: string;
    page_from: number | null;
    alt_text: string | null;
    machine_id: string;
  };
  if (qrMachineId && row.machine_id !== qrMachineId) {
    return Response.json({ error: "Asset not found" }, { status: 404 });
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from(row.storage_bucket)
    .createSignedUrl(row.storage_path, SIGN_EXPIRY_SECONDS);
  if (signErr || !signed) {
    console.error("asset signed url failed:", signErr);
    return Response.json({ error: "Could not sign URL" }, { status: 500 });
  }

  return Response.json({
    url: signed.signedUrl,
    mimeType: row.mime_type,
    pageFrom: row.page_from,
    altText: row.alt_text,
  });
}
