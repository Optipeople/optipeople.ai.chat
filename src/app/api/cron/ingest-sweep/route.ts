// GET /api/cron/ingest-sweep: server-driven continuation for documents
// whose client went away mid-ingest.
//
// The admin upload flow drives long ingests by calling the finalize
// endpoint again every time it answers 202 { done: false }. That works
// until the operator closes the tab (or the instance is reaped), at which
// point the document sits in 'extracting' or 'embedding'. This sweep runs
// on a schedule (vercel.json), resumes what has a checkpoint or an
// original PDF to resume from, one document at a time inside the
// function's own budget, and only then fails what is truly stuck.
//
// Authenticated by Vercel's cron secret: the platform sends
// `Authorization: Bearer $CRON_SECRET` with every scheduled invocation.

import { resumeQueuedFiles } from "@/lib/fileIngestion";
import { sweepStuckDocuments } from "@/lib/ingestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Leave room in front of the platform's 300 s for the last resumed
// document's own hard-budget handler to write its 'failed' row.
const SWEEP_BUDGET_MS = 240_000;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret || header !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    // Generic files queued for retry first: each is one short pass, and
    // the PDF sweep below would otherwise spend the whole budget.
    const files = await resumeQueuedFiles({
      deadlineAt: startedAt + SWEEP_BUDGET_MS,
      limit: 2,
    });
    const result = await sweepStuckDocuments({
      deadlineAt: startedAt + SWEEP_BUDGET_MS,
      limit: 5,
    });
    return Response.json({
      ok: true,
      ...result,
      files,
      ms: Date.now() - startedAt,
    });
  } catch (err) {
    console.error("ingest sweep failed:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
