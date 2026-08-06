// POST /api/admin/ingest/file — finalize an arbitrary (non-PDF,
// non-image) file the client already uploaded directly to Storage via
// /api/admin/ingest/sign. The request body is small JSON (no file
// bytes) so we never hit Vercel's ~4.5 MB function body limit. Stores
// the raw bytes and, when text can be recovered from them, chunks +
// embeds it. Mirrors the PDF and image finalize endpoints for parity in
// the admin upload queue.

import {
  assertMachineAccess,
  AuthError,
  requireAdmin,
} from "@/lib/auth";
import { ingestFileFromStorage } from "@/lib/fileIngestion";
import { extensionForFile } from "@/lib/storagePaths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// documentId comes from the /sign response; validating its shape keeps a
// client from smuggling a crafted storage path through string templating.
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
  if (!machineId) {
    return Response.json({ error: "machineId is required" }, { status: 400 });
  }
  if (!UUID_RE.test(documentId)) {
    return Response.json({ error: "documentId is invalid" }, { status: 400 });
  }

  let accountId: string;
  try {
    accountId = await assertMachineAccess(admin, machineId);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  const fileName =
    typeof body.fileName === "string" && body.fileName
      ? body.fileName
      : "upload.bin";
  const summary =
    typeof body.summary === "string" && body.summary.trim()
      ? body.summary.trim()
      : null;
  const folderPath =
    typeof body.folderPath === "string" && body.folderPath.trim()
      ? body.folderPath.trim()
      : null;

  // Reconstruct the storage path server-side from the validated machine
  // + document IDs rather than trusting a client-supplied path. The
  // extension is derived from fileName with the same sanitising helper
  // /sign used, so the two agree on the object name.
  const storagePath = `${machineId}/${documentId}.${extensionForFile(fileName)}`;

  try {
    const result = await ingestFileFromStorage({
      machineId,
      accountId,
      documentId,
      storagePath,
      fileName,
      summary,
      folderPath,
      createdBy: admin.email,
    });
    return Response.json(result);
  } catch (err) {
    console.error("admin file ingest failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json(
      { error: `File ingest failed: ${message}` },
      { status: 500 },
    );
  }
}
