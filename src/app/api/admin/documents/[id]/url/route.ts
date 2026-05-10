// GET /api/admin/documents/[id]/url — mint a short-lived signed URL for
// the original PDF stored in Supabase Storage. Pass ?download=1 to force
// a Content-Disposition: attachment response (download instead of inline).

import { AuthError, requireSuperAdmin } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGN_EXPIRY_SECONDS = 600; // 10 minutes — long enough for a click,
//                                  short enough that a leaked URL is harmless.

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  const { id } = await ctx.params;
  const wantDownload =
    new URL(req.url).searchParams.get("download") === "1";

  const supabase = getSupabaseServerClient();
  const { data: doc, error } = await supabase
    .from("kb_documents")
    .select("storage_path, title")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("admin doc url lookup failed:", error);
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

  const fileName = `${row.title}.pdf`;
  const { data: signed, error: signErr } = await supabase.storage
    .from("kb-documents")
    .createSignedUrl(row.storage_path, SIGN_EXPIRY_SECONDS, {
      download: wantDownload ? fileName : false,
    });

  if (signErr || !signed) {
    console.error("admin doc signed url failed:", signErr);
    return Response.json({ error: "Could not sign URL" }, { status: 500 });
  }

  return Response.json({ url: signed.signedUrl, fileName });
}
