// GET    /api/admin/machines/[id] — machine summary + its documents
// PATCH  /api/admin/machines/[id] — update display_name
// DELETE /api/admin/machines/[id] — drop machine_kb row + storage objects.
//                                   kb_documents/kb_chunks/kb_folders cascade
//                                   via FK; conversation/feedback/escalation
//                                   audit history stays (no FK to machine_kb).

import {
  assertMachineAccess,
  AuthError,
  requireAdmin,
} from "@/lib/auth";
import { cleanupStuckDocuments } from "@/lib/ingestion";
import { getMcpConfigSummary, type McpStatus } from "@/lib/mcpConfig";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type AdminDocument = {
  id: string;
  title: string;
  summary: string;
  status: string;
  sourceType: "pdf" | "url" | "manual_note" | "feedback" | "image";
  pageCount: number | null;
  byteSize: number | null;
  createdAt: string;
  createdBy: string;
  extractionSource: "pdf-parse" | "claude-ocr" | null;
  folderPath: string | null;
  progress: number | null;
  progressLabel: string | null;
  operatorVisible: boolean;
};

// MCP integration status for the machine's account. Null means the
// account has no MCP config row at all (admin hasn't registered yet);
// otherwise we surface the status + label so the machine page can
// show a "Connected via Optipeople / Not connected / Token expired"
// badge without a second round-trip.
export type AdminMachineMcp = {
  status: McpStatus;
  label: string | null;
  statusMessage: string | null;
  serverUrl: string;
  accessTokenExpiresAt: string | null;
};

export type AdminMachineDetail = {
  machineId: string;
  accountId: string;
  displayName: string | null;
  updatedAt: string;
  // Active QR token. Null means no QR access has been provisioned yet,
  // or it's been revoked. The token itself is the URL parameter — it's
  // not secret beyond "anyone with the sticker can chat".
  qrToken: string | null;
  qrTokenCreatedAt: string | null;
  documents: AdminDocument[];
  // Explicit folder list, including empty folders. Tree rendering merges
  // these with folders implied by document paths so nothing is missed.
  folders: string[];
  // Null when this machine's account has never been wired to MCP.
  mcp: AdminMachineMcp | null;
};

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

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const denied = await gate(req, id);
  if (denied) return denied;
  const supabase = getSupabaseServerClient();

  // Watchdog: flip any in-pipeline doc that hasn't progressed in
  // STUCK_THRESHOLD_MS to failed before we read the list, so the admin
  // sees the correct status without a manual refresh round-trip.
  // Best-effort and cheap (single conditional UPDATE).
  await cleanupStuckDocuments(id);

  const [
    { data: machine, error: mErr },
    { data: docs, error: dErr },
    { data: folders, error: fErr },
  ] = await Promise.all([
    supabase
      .from("machine_kb")
      .select(
        "machine_id, account_id, display_name, updated_at, qr_token, qr_token_created_at",
      )
      .eq("machine_id", id)
      .maybeSingle(),
    supabase
      .from("kb_documents")
      .select(
        "id, title, summary, status, source_type, page_count, byte_size, created_at, created_by, extraction_source, folder_path, progress, progress_label, operator_visible",
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

  const m = machine as {
    machine_id: string;
    account_id: string;
    display_name: string | null;
    updated_at: string;
    qr_token: string | null;
    qr_token_created_at: string | null;
  };

  // MCP lookup is best-effort and isolated from the rest of the
  // response — a DB hiccup here shouldn't 500 the whole page.
  let mcp: AdminMachineMcp | null = null;
  try {
    const summary = await getMcpConfigSummary(m.account_id);
    if (summary) {
      mcp = {
        status: summary.status,
        label: summary.label,
        statusMessage: summary.statusMessage,
        serverUrl: summary.serverUrl,
        accessTokenExpiresAt: summary.accessTokenExpiresAt,
      };
    }
  } catch (err) {
    console.error("admin/machines/[id] MCP lookup failed:", err);
  }

  const result: AdminMachineDetail = {
    machineId: m.machine_id,
    accountId: m.account_id,
    displayName: m.display_name ?? null,
    updatedAt: m.updated_at,
    qrToken: m.qr_token ?? null,
    qrTokenCreatedAt: m.qr_token_created_at ?? null,
    folders: (folders ?? [])
      .map((f) => (f as { path: string }).path)
      .filter(Boolean),
    documents: (docs ?? []).map((d) => {
      const r = d as {
        id: string;
        title: string;
        summary: string;
        status: string;
        source_type: "pdf" | "url" | "manual_note" | "feedback" | "image";
        page_count: number | null;
        byte_size: number | null;
        created_at: string;
        created_by: string;
        extraction_source: "pdf-parse" | "claude-ocr" | null;
        folder_path: string | null;
        progress: number | null;
        progress_label: string | null;
        operator_visible: boolean;
      };
      return {
        id: r.id,
        title: r.title,
        summary: r.summary,
        status: r.status,
        sourceType: r.source_type,
        pageCount: r.page_count,
        byteSize: r.byte_size,
        createdAt: r.created_at,
        createdBy: r.created_by,
        extractionSource: r.extraction_source ?? null,
        folderPath: r.folder_path ?? null,
        progress: r.progress ?? null,
        progressLabel: r.progress_label ?? null,
        operatorVisible: r.operator_visible === true,
      };
    }),
    mcp,
  };

  return Response.json(result);
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const denied = await gate(req, id);
  if (denied) return denied;

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

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const denied = await gate(req, id);
  if (denied) return denied;

  const supabase = getSupabaseServerClient();

  // Best-effort storage cleanup: list everything under <machineId>/ in
  // both buckets (pdfs in kb-documents, images in kb-images) and remove.
  // Done before the row delete so we still have a foothold if the
  // listing fails. The DB cascade drops kb_documents/kb_chunks/kb_assets/
  // kb_folders.
  for (const bucket of ["kb-documents", "kb-images"] as const) {
    const { data: objects, error: listErr } = await supabase.storage
      .from(bucket)
      .list(id, { limit: 1000 });
    if (listErr) {
      console.warn(
        `admin DELETE machine: ${bucket} list failed:`,
        listErr,
      );
      continue;
    }
    if (objects && objects.length > 0) {
      const paths = objects.map((o) => `${id}/${o.name}`);
      const { error: rmErr } = await supabase.storage
        .from(bucket)
        .remove(paths);
      if (rmErr) {
        console.warn(
          `admin DELETE machine: ${bucket} remove failed:`,
          rmErr,
        );
      }
    }
  }

  const { error: delErr } = await supabase
    .from("machine_kb")
    .delete()
    .eq("machine_id", id);

  if (delErr) {
    console.error("admin DELETE machine row failed:", delErr);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
