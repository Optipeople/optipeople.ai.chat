// POST /api/admin/ingest — finalize a PDF that the client already
// uploaded directly to Storage via /api/admin/ingest/sign. The request
// body is small JSON (no file bytes) so we never hit Vercel's ~4.5 MB
// function body limit.
//
// Big documents span multiple calls: the pipeline checkpoints its work
// and, when the invocation's soft time budget runs out, responds with
// 202 { done: false }. The client immediately POSTs the same body again
// and the pipeline resumes from the checkpoint (the existing
// kb_documents row is the resume signal). Small documents complete in
// one call and get { done: true, ...result }.

import {
  assertMachineAccess,
  AuthError,
  requireAdmin,
} from "@/lib/auth";
import { IngestTimeoutError, ingestPdfFromStorage } from "@/lib/ingestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Voyage embeddings + pdf-parse are CPU-bound and slow on the free tier.
// 5 minutes is the new platform default but we set it explicitly so this
// doesn't get clipped by an env override.
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

  // Reconstruct the storage path server-side from the validated machine
  // + document IDs rather than trusting a client-supplied path — it must
  // match what /sign minted for this document.
  const storagePath = `${machineId}/${documentId}.pdf`;
  const fileName =
    typeof body.fileName === "string" && body.fileName ? body.fileName : "upload.pdf";
  const summary =
    typeof body.summary === "string" && body.summary.trim()
      ? body.summary.trim()
      : null;
  const folderPath =
    typeof body.folderPath === "string" && body.folderPath.trim()
      ? body.folderPath.trim()
      : null;

  try {
    const outcome = await ingestPdfFromStorage({
      machineId,
      accountId,
      documentId,
      storagePath,
      fileName,
      summary,
      folderPath,
      createdBy: admin.email,
    });
    if (!outcome.done) {
      return Response.json(outcome, { status: 202 });
    }
    return Response.json(outcome);
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
    console.error("admin ingest failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: `Ingest failed: ${message}` }, { status: 500 });
  }
}
