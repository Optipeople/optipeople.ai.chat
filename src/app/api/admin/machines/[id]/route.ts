// GET    /api/admin/machines/[id] — machine summary + its documents
// PATCH  /api/admin/machines/[id] — update display_name

import { AuthError, requireSuperAdmin } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type AdminDocument = {
  id: string;
  title: string;
  summary: string;
  status: string;
  pageCount: number | null;
  byteSize: number | null;
  createdAt: string;
  createdBy: string;
  extractionSource: "pdf-parse" | "claude-ocr" | null;
  folderPath: string | null;
};

export type AdminMachineDetail = {
  machineId: string;
  accountId: string;
  displayName: string | null;
  updatedAt: string;
  documents: AdminDocument[];
  // Explicit folder list, including empty folders. Tree rendering merges
  // these with folders implied by document paths so nothing is missed.
  folders: string[];
};

async function gate(req: Request): Promise<Response | null> {
  try {
    await requireSuperAdmin(req);
    return null;
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await gate(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  const supabase = getSupabaseServerClient();

  const [
    { data: machine, error: mErr },
    { data: docs, error: dErr },
    { data: folders, error: fErr },
  ] = await Promise.all([
    supabase
      .from("machine_kb")
      .select("machine_id, account_id, display_name, updated_at")
      .eq("machine_id", id)
      .maybeSingle(),
    supabase
      .from("kb_documents")
      .select(
        "id, title, summary, status, page_count, byte_size, created_at, created_by, extraction_source, folder_path",
      )
      .eq("machine_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("kb_folders")
      .select("path")
      .eq("machine_id", id),
  ]);

  if (mErr || dErr || fErr) {
    console.error("admin/machines/[id] query failed:", mErr, dErr, fErr);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  if (!machine) {
    return Response.json({ error: "Machine not found" }, { status: 404 });
  }

  const result: AdminMachineDetail = {
    machineId: machine.machine_id as string,
    accountId: machine.account_id as string,
    displayName: (machine.display_name as string | null) ?? null,
    updatedAt: machine.updated_at as string,
    folders: (folders ?? [])
      .map((f) => (f as { path: string }).path)
      .filter(Boolean),
    documents: (docs ?? []).map((d) => {
      const r = d as {
        id: string;
        title: string;
        summary: string;
        status: string;
        page_count: number | null;
        byte_size: number | null;
        created_at: string;
        created_by: string;
        extraction_source: "pdf-parse" | "claude-ocr" | null;
        folder_path: string | null;
      };
      return {
        id: r.id,
        title: r.title,
        summary: r.summary,
        status: r.status,
        pageCount: r.page_count,
        byteSize: r.byte_size,
        createdAt: r.created_at,
        createdBy: r.created_by,
        extractionSource: r.extraction_source ?? null,
        folderPath: r.folder_path ?? null,
      };
    }),
  };

  return Response.json(result);
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await gate(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  let body: { displayName?: unknown };
  try {
    body = (await req.json()) as { displayName?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const displayName =
    typeof body.displayName === "string" ? body.displayName.trim() : null;
  if (displayName === null) {
    return Response.json(
      { error: "displayName must be a string" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("machine_kb")
    .update({ display_name: displayName, updated_at: new Date().toISOString() })
    .eq("machine_id", id);

  if (error) {
    console.error("admin PATCH machine failed:", error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  return Response.json({ ok: true, displayName });
}
