// POST /api/admin/documents/[id]/reprocess
//   body: { force?: "ocr" | "pdf-parse", resume?: boolean }
//
// Re-runs extraction + embedding for an already-ingested document.
// Useful when the auto-fallback heuristic missed an image-heavy PDF and
// the operator wants to force a Claude OCR pass without delete/re-upload.
//
// Big documents span multiple calls: a 202 { done: false } response
// means the invocation's time budget ran out mid-work — the client
// POSTs again with resume: true to continue from the checkpoint.

import {
  assertDocumentAccess,
  AuthError,
  requireAdmin,
} from "@/lib/auth";
import { IngestTimeoutError, reprocessPdf } from "@/lib/ingestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Reprocess does the same heavy lifting as ingest (Claude OCR + Voyage),
// so we need the same generous timeout.
export const maxDuration = 300;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
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
    // ignore bad bodies — default to forced OCR below
  }

  const force =
    body.force === "ocr" || body.force === "pdf-parse"
      ? (body.force as "ocr" | "pdf-parse")
      : "ocr";
  const resume = body.resume === true;

  try {
    const outcome = await reprocessPdf({ documentId: id, force, resume });
    if (!outcome.done) {
      return Response.json(outcome, { status: 202 });
    }
    return Response.json(outcome);
  } catch (err) {
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
