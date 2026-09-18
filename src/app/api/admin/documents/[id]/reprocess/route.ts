// POST /api/admin/documents/[id]/reprocess
//   body: { force?: "ocr" | "pdf-parse", resume?: boolean }
//
// Re-runs extraction + embedding for an already-ingested document. With
// no `force` the extractor auto-detects (text layer, per-page OCR for
// scanned inserts, whole-document OCR when the text layer is empty) just
// like a fresh ingest; "ocr" is for the operator who knows the heuristic
// got it wrong. The old chunks stay searchable until the new text is in.
//
// Big documents span multiple calls: a 202 { done: false } response
// means the invocation's time budget ran out mid-work — the client
// POSTs again with resume: true to continue from the checkpoint. A
// document that is currently mid-pipeline answers 409 unless resume is
// set, so a second click cannot restart a run underneath the first.

import {
  assertDocumentAccess,
  AuthError,
  requireAdmin,
} from "@/lib/auth";
import {
  IngestRequestError,
  IngestTimeoutError,
  reprocessPdf,
} from "@/lib/ingestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Reprocess does the same heavy lifting as ingest (Claude OCR + Voyage),
// so we need the same generous timeout.
export const maxDuration = 300;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const requestStartedAt = Date.now();
  const { id } = await ctx.params;
  try {
    const admin = await requireAdmin(req);
    await assertDocumentAccess(admin, id);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }
  let body: { force?: unknown; resume?: unknown } = {};
  try {
    if (req.headers.get("content-length") !== "0") {
      body = (await req.json().catch(() => ({}))) as {
        force?: unknown;
        resume?: unknown;
      };
    }
  } catch {
    // ignore bad bodies — auto-detect below
  }

  const force =
    body.force === "ocr" || body.force === "pdf-parse"
      ? (body.force as "ocr" | "pdf-parse")
      : undefined;
  const resume = body.resume === true;

  try {
    const outcome = await reprocessPdf({
      documentId: id,
      force,
      resume,
      requestStartedAt,
    });
    if (!outcome.done) {
      return Response.json(outcome, { status: 202 });
    }
    return Response.json(outcome);
  } catch (err) {
    if (err instanceof IngestRequestError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof IngestTimeoutError) {
      return Response.json(
        { error: err.message, code: "timeout" },
        { status: 504 },
      );
    }
    console.error("reprocess failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json(
      { error: `Reprocess failed: ${message}` },
      { status: 500 },
    );
  }
}
