// POST /api/admin/ingest/image — finalize an image that the client
// already uploaded directly to Storage via /api/admin/ingest/sign. The
// request body is small JSON (no file bytes) so we never hit Vercel's
// ~4.5 MB function body limit. Captions the image with Claude vision,
// embeds the caption, and writes one kb_documents (source_type='image')
// + kb_assets + kb_chunks row. Mirrors the PDF finalize endpoint at
// /api/admin/ingest for parity in the queue.

import {
  assertMachineAccess,
  AuthError,
  requireAdmin,
} from "@/lib/auth";
import { ingestImageFromStorage } from "@/lib/imageIngestion";
import { extensionForMime, isSupportedImageMime } from "@/lib/imageCaption";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  let body: {
    machineId?: unknown;
    documentId?: unknown;
    contentType?: unknown;
    fileName?: unknown;
    summary?: unknown;
    folderPath?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const machineId = typeof body.machineId === "string" ? body.machineId : "";
  const documentId = typeof body.documentId === "string" ? body.documentId : "";
  const contentType =
    typeof body.contentType === "string" ? body.contentType : "";

  if (!machineId) {
    return Response.json({ error: "machineId is required" }, { status: 400 });
  }
  if (!UUID_RE.test(documentId)) {
    return Response.json({ error: "documentId is invalid" }, { status: 400 });
  }
  if (!isSupportedImageMime(contentType)) {
    return Response.json(
      {
        error: `Unsupported image type: ${contentType || "(unknown)"} — accept PNG, JPEG, or WebP`,
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

  // Reconstruct the storage path server-side from the validated machine
  // + document IDs rather than trusting a client-supplied path — it must
  // match what /sign minted for this document.
  const storagePath = `${machineId}/${documentId}.${extensionForMime(contentType)}`;
  const fileName =
    typeof body.fileName === "string" && body.fileName ? body.fileName : "image";
  const summary =
    typeof body.summary === "string" && body.summary.trim()
      ? body.summary.trim()
      : null;
  const folderPath =
    typeof body.folderPath === "string" && body.folderPath.trim()
      ? body.folderPath.trim()
      : null;

  try {
    const result = await ingestImageFromStorage({
      machineId,
      accountId,
      documentId,
      storagePath,
      mimeType: contentType,
      fileName,
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
