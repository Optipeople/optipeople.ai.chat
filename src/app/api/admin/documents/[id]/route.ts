// PATCH  /api/admin/documents/[id] — update summary or title
// DELETE /api/admin/documents/[id] — remove the document, its chunks
//                                    (cascade), and its Storage object

import { AuthError, requireSuperAdmin } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function gate(req: Request): Promise<Response | null> {
  try {
    await requireSuperAdmin(req);
    return null;
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await gate(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  let body: { title?: unknown; summary?: unknown };
  try {
    body = (await req.json()) as { title?: unknown; summary?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const update: Record<string, string> = {};
  if (typeof body.title === "string" && body.title.trim()) {
    update.title = body.title.trim();
  }
  if (typeof body.summary === "string" && body.summary.trim()) {
    update.summary = body.summary.trim();
  }
  if (Object.keys(update).length === 0) {
    return Response.json(
      { error: "Nothing to update — provide title or summary" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("kb_documents")
    .update(update)
    .eq("id", id);

  if (error) {
    console.error("admin PATCH document failed:", error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  return Response.json({ ok: true, ...update });
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await gate(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  const supabase = getSupabaseServerClient();

  // Look up the storage path before deleting the row so we can clean up
  // the underlying object too. ON DELETE CASCADE drops the chunks.
  const { data: doc, error: lookupErr } = await supabase
    .from("kb_documents")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();

  if (lookupErr) {
    console.error("admin DELETE lookup failed:", lookupErr);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  if (!doc) {
    return Response.json({ error: "Document not found" }, { status: 404 });
  }

  const storagePath = (doc as { storage_path: string | null }).storage_path;
  if (storagePath) {
    // Best-effort: if the object's already gone we still want to drop the row.
    const { error: storageErr } = await supabase.storage
      .from("kb-documents")
      .remove([storagePath]);
    if (storageErr) {
      console.warn("admin DELETE storage cleanup failed:", storageErr);
    }
  }

  const { error: delErr } = await supabase
    .from("kb_documents")
    .delete()
    .eq("id", id);

  if (delErr) {
    console.error("admin DELETE row failed:", delErr);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
