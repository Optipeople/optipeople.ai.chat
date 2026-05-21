// POST /api/admin/ingest/image — multipart upload of a single image.
// Captions it with Claude vision, embeds the caption, and writes one
// kb_documents (source_type='image') + kb_assets + kb_chunks row. Mirrors
// the PDF ingest endpoint at /api/admin/ingest for parity in the queue.

import {
  assertMachineAccess,
  AuthError,
  requireAdmin,
} from "@/lib/auth";
import { ingestImage } from "@/lib/imageIngestion";
import { isSupportedImageMime } from "@/lib/imageCaption";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireAdmin(req);
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
  if (!isSupportedImageMime(file.type)) {
    return Response.json(
      {
        error: `Unsupported image type: ${file.type || "(unknown)"} — accept PNG, JPEG, or WebP`,
      },
      { status: 400 },
    );
  }

  let accountId: string;
  try {
    accountId = await assertMachineAccess(admin, machineId);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  const summary =
    typeof summaryRaw === "string" && summaryRaw.trim()
      ? summaryRaw.trim()
      : null;
  const folderPath =
    typeof folderRaw === "string" && folderRaw.trim() ? folderRaw.trim() : null;

  const buf = Buffer.from(await file.arrayBuffer());

  try {
    const result = await ingestImage({
      machineId,
      accountId,
      fileName: file.name || "image",
      fileBuffer: buf,
      mimeType: file.type,
      summary,
      folderPath,
      createdBy: admin.email,
    });
    return Response.json(result);
  } catch (err) {
    console.error("admin image ingest failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json(
      { error: `Image ingest failed: ${message}` },
      { status: 500 },
    );
  }
}
