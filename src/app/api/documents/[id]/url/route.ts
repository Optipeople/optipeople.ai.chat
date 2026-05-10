// GET /api/documents/[id]/url — mint a short-lived signed URL for the
// original PDF. Operator-accessible counterpart to the admin endpoint at
// /api/admin/documents/[id]/url; only requires that the caller is logged
// in (no SuperAdministrator gate). Used by the chat UI to turn source
// citations into clickable links opening in a new tab.

import { AuthError, resolveCurrentUser } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGN_EXPIRY_SECONDS = 600;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await resolveCurrentUser(req);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  const { id } = await ctx.params;

  const supabase = getSupabaseServerClient();
  const { data: doc, error } = await supabase
    .from("kb_documents")
    .select("storage_path, title")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("doc url lookup failed:", error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  if (!doc) {
    return Response.json({ error: "Document not found" }, { status: 404 });
  }
  const row = doc as { storage_path: string | null; title: string };
  if (!row.storage_path) {
    return Response.json(
      { error: "Document has no original file" },
      { status: 404 },
    );
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from("kb-documents")
    .createSignedUrl(row.storage_path, SIGN_EXPIRY_SECONDS);

  if (signErr || !signed) {
    console.error("doc signed url failed:", signErr);
    return Response.json({ error: "Could not sign URL" }, { status: 500 });
  }

  return Response.json({ url: signed.signedUrl, title: row.title });
}
