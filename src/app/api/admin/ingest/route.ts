// POST /api/admin/ingest — multipart upload of a single PDF onto an
// existing machine_kb row. Synchronous: returns once the document has
// transitioned to status='ready' (or failed). The route handler runs
// the full pipeline from src/lib/ingestion.ts, so a heavy PDF can take
// 30+ seconds — the UI shows a spinner.

import { AuthError, requireSuperAdmin } from "@/lib/auth";
import { IngestTimeoutError, ingestPdf } from "@/lib/ingestion";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Voyage embeddings + pdf-parse are CPU-bound and slow on the free tier.
// 5 minutes is the new platform default but we set it explicitly so this
// doesn't get clipped by an env override.
export const maxDuration = 300;

export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireSuperAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json(
      { error: "Expected multipart/form-data" },
      { status: 400 },
    );
  }

  const machineId = form.get("machineId");
  const summaryRaw = form.get("summary");
  const folderRaw = form.get("folderPath");
  const file = form.get("file");

  if (typeof machineId !== "string" || !machineId) {
    return Response.json({ error: "machineId is required" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return Response.json(
      { error: "file is required (multipart File)" },
      { status: 400 },
    );
  }
  if (file.type && file.type !== "application/pdf") {
    return Response.json(
      { error: "Only application/pdf files are accepted" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServerClient();
  const { data: machine, error: lookupErr } = await supabase
    .from("machine_kb")
    .select("account_id")
    .eq("machine_id", machineId)
    .maybeSingle();

  if (lookupErr) {
    console.error("admin ingest lookup failed:", lookupErr);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  if (!machine) {
    return Response.json({ error: "Machine not found" }, { status: 404 });
  }
  const accountId = (machine as { account_id: string }).account_id;

  const summary =
    typeof summaryRaw === "string" && summaryRaw.trim()
      ? summaryRaw.trim()
      : null;
  const folderPath =
    typeof folderRaw === "string" && folderRaw.trim() ? folderRaw.trim() : null;

  const buf = Buffer.from(await file.arrayBuffer());

  try {
    const result = await ingestPdf({
      machineId,
      accountId,
      // Don't pass machineName — we don't want to overwrite the existing
      // display_name with whatever happened to be uploaded.
      fileName: file.name || "upload.pdf",
      fileBuffer: buf,
      summary,
      folderPath,
      createdBy: admin.email,
    });
    return Response.json(result);
  } catch (err) {
    if (err instanceof IngestTimeoutError) {
      // The doc row is already flipped to 'failed' with the same label
      // by withIngestBudget — the queue panel will pick it up on the
      // next poll regardless of the status code we return here.
      return Response.json(
        { error: err.message, code: "timeout" },
        { status: 504 },
      );
    }
    console.error("admin ingest pipeline failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json(
      { error: `Ingestion failed: ${message}` },
      { status: 500 },
    );
  }
}
