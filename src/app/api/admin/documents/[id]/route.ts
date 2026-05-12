// PATCH  /api/admin/documents/[id] — update summary, title, or folder
// DELETE /api/admin/documents/[id] — remove the document, its chunks
//                                    (cascade), and its Storage object

import { AuthError, requireSuperAdmin } from "@/lib/auth";
import { ensureFolderPath } from "@/lib/ingestion";
import { regenerateSuggestedQuestionsSafe } from "@/lib/suggestions";
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
  let body: {
    title?: unknown;
    summary?: unknown;
    folderPath?: unknown;
    operatorVisible?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const update: Record<string, string | boolean | null> = {};
  if (typeof body.title === "string" && body.title.trim()) {
    update.title = body.title.trim();
  }
  if (typeof body.summary === "string" && body.summary.trim()) {
    update.summary = body.summary.trim();
  }
  // folderPath is the only field that accepts null (= move to root).
  if (body.folderPath === null) {
    update.folder_path = null;
  } else if (typeof body.folderPath === "string") {
    const cleaned = body.folderPath.trim();
    update.folder_path = cleaned || null;
  }
  if (typeof body.operatorVisible === "boolean") {
    update.operator_visible = body.operatorVisible;
  }
  if (Object.keys(update).length === 0) {
    return Response.json(
      {
        error:
          "Nothing to update — provide title, summary, folderPath or operatorVisible",
      },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServerClient();

  // If we're moving a doc into a folder, make sure that folder (and any
  // ancestors) exist in kb_folders. Drag-drop in the UI always targets
  // an existing folder, but a direct API caller might not.
  if (typeof update.folder_path === "string" && update.folder_path) {
    const { data: doc } = await supabase
      .from("kb_documents")
      .select("machine_id")
      .eq("id", id)
      .maybeSingle();
    if (doc) {
      await ensureFolderPath(
        (doc as { machine_id: string }).machine_id,
        update.folder_path,
      );
    }
  }

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

  // Look up the storage path + machine id before deleting the row so we
  // can clean up the underlying object and regenerate that machine's
  // starter questions afterwards. ON DELETE CASCADE drops the chunks.
  const { data: doc, error: lookupErr } = await supabase
    .from("kb_documents")
    .select("storage_path, machine_id, source_type")
    .eq("id", id)
    .maybeSingle();

  if (lookupErr) {
    console.error("admin DELETE lookup failed:", lookupErr);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  if (!doc) {
    return Response.json({ error: "Document not found" }, { status: 404 });
  }

  const {
    storage_path: storagePath,
    machine_id: machineId,
    source_type: sourceType,
  } = doc as {
    storage_path: string | null;
    machine_id: string;
    source_type: "pdf" | "url" | "manual_note" | "feedback" | "image";
  };
  if (storagePath) {
    // Standalone images live in kb-images; everything else in kb-documents.
    const bucket = sourceType === "image" ? "kb-images" : "kb-documents";
    const { error: storageErr } = await supabase.storage
      .from(bucket)
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

  await regenerateSuggestedQuestionsSafe(machineId);

  return Response.json({ ok: true });
}
