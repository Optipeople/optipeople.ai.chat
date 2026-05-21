// POST   /api/admin/machines/[id]/folders { path }   — create empty folder
// DELETE /api/admin/machines/[id]/folders { path }   — remove if empty

import {
  assertMachineAccess,
  AuthError,
  requireAdmin,
} from "@/lib/auth";
import { ensureFolderPath } from "@/lib/ingestion";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function gate(req: Request, machineId: string): Promise<Response | null> {
  try {
    const admin = await requireAdmin(req);
    await assertMachineAccess(admin, machineId);
    return null;
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }
}

function normalisePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // Strip leading/trailing slashes and whitespace, collapse runs of "/".
  const cleaned = raw
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean)
    .join("/");
  return cleaned || null;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const denied = await gate(req, id);
  if (denied) return denied;
  let body: { path?: unknown };
  try {
    body = (await req.json()) as { path?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const path = normalisePath(body.path);
  if (!path) {
    return Response.json(
      { error: "path is required and must be non-empty" },
      { status: 400 },
    );
  }

  // Confirm the machine exists — without this an attacker could seed
  // folder rows for arbitrary machine_ids (still gated to super-admin,
  // but the cleanup is messy).
  const supabase = getSupabaseServerClient();
  const { data: machine } = await supabase
    .from("machine_kb")
    .select("machine_id")
    .eq("machine_id", id)
    .maybeSingle();
  if (!machine) {
    return Response.json({ error: "Machine not found" }, { status: 404 });
  }

  await ensureFolderPath(id, path);
  return Response.json({ ok: true, path });
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const denied = await gate(req, id);
  if (denied) return denied;
  let body: { path?: unknown };
  try {
    body = (await req.json()) as { path?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const path = normalisePath(body.path);
  if (!path) {
    return Response.json({ error: "path is required" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();

  // Empty = no docs in this exact folder, no docs in any descendant
  // folder, no kb_folders rows for descendants. Refuse otherwise.
  const prefix = `${path}/`;
  const [{ count: docHere }, { count: docBelow }, { count: folderBelow }] =
    await Promise.all([
      supabase
        .from("kb_documents")
        .select("id", { count: "exact", head: true })
        .eq("machine_id", id)
        .eq("folder_path", path),
      supabase
        .from("kb_documents")
        .select("id", { count: "exact", head: true })
        .eq("machine_id", id)
        .like("folder_path", `${prefix}%`),
      supabase
        .from("kb_folders")
        .select("path", { count: "exact", head: true })
        .eq("machine_id", id)
        .like("path", `${prefix}%`),
    ]);

  if ((docHere ?? 0) > 0 || (docBelow ?? 0) > 0 || (folderBelow ?? 0) > 0) {
    return Response.json(
      { error: "Folder is not empty" },
      { status: 409 },
    );
  }

  const { error } = await supabase
    .from("kb_folders")
    .delete()
    .eq("machine_id", id)
    .eq("path", path);

  if (error) {
    console.error("admin folder delete failed:", error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
