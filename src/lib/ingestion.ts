// Per-machine PDF ingestion pipeline.
//
// One PDF in → one Storage object + one kb_documents row + N kb_chunks rows.
// Used by the ingest CLI (scripts/ingest.ts), the admin upload endpoints
// and the cron sweep. machine_kb is upserted on each call so the row
// exists before the document references it.
//
// Concurrency model: a document is only ever written by ONE pipeline
// invocation at a time, enforced by kb_documents.run_id. Every entry point
// mints a run id, writes it to the row, and the pipeline re-reads it
// before every chunk batch and every status flip. A mismatch means a
// later invocation (client retry, reprocess, cron sweep, delete) took the
// document over, and this one stops quietly (StaleRunError). Chunk writes
// are additionally upserts against a unique (document_id, ordinal,
// embedding_model) index, so even a ghost that slips one batch past the
// fence cannot duplicate a passage.
//
// Server-only: uses the service-role Supabase client.

import { randomUUID } from "node:crypto";
import { chunkText } from "./chunking";
import { extractDocumentMeta } from "./docMeta";
import { attachPdfFigures, wipePdfFigures } from "./imageIngestion";
import {
  extractPdfText,
  type OcrCheckpoint,
  type PdfExtractionForce,
  type PdfExtractionSource,
} from "./pdfText";
import { regenerateSuggestedQuestionsSafe } from "./suggestions";
import { getSupabaseServerClient } from "./supabase";
import {
  embedDocumentBatch,
  planEmbedBatches,
  VOYAGE_MODEL,
} from "./voyage";

// ---------------------------------------------------------------------------
// Progress labels
// ---------------------------------------------------------------------------
//
// kb_documents.progress_label carries a machine-readable code while a
// document is in flight, so the admin UI can translate it. Shape:
//
//   phase:<code>                     e.g. phase:reading_pdf
//   phase:<code>|k=v|k=v             e.g. phase:embedding|done=12|total=40
//
// Codes emitted by this module and its siblings:
//
//   phase:reading_pdf                       pdf-parse over the text layer
//   phase:ocr|done=<pages>|total=<pages>    Claude vision OCR, per page
//   phase:tables                            table-page repair pass
//   phase:chunking|pages=<n>                extraction done, chunking
//   phase:metadata                          document identity metadata
//   phase:embedding|done=<n>|total=<n>      Voyage embedding, per chunk
//   phase:figures                           figure inventory + captions
//   phase:reading_file                      generic file text extraction
//   phase:describing_image                  Claude vision caption
//   phase:embedding_caption                 embedding that caption
//
// Failure labels are NOT codes: once status is 'failed', progress_label
// holds a plain English sentence describing what went wrong, and the UI
// shows it verbatim.
export function phaseLabel(
  code: string,
  params?: Record<string, number | string>,
): string {
  const parts = [`phase:${code}`];
  for (const [k, v] of Object.entries(params ?? {})) parts.push(`${k}=${v}`);
  return parts.join("|");
}

// ---------------------------------------------------------------------------
// Errors the routes map to HTTP statuses
// ---------------------------------------------------------------------------

// A request-level rejection (wrong machine, wrong state, bad file). The
// routes map `status` straight onto the response. Distinct from an Error
// so a 409 is not logged as a pipeline crash.
export class IngestRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "IngestRequestError";
  }
}

// Thrown when kb_documents.run_id no longer matches this invocation's id:
// a newer invocation owns the document. Everything this run wrote before
// the fence is either idempotent (upserts) or already superseded, so the
// right reaction is to stop without touching the row.
export class StaleRunError extends Error {
  constructor(documentId: string) {
    super(`document ${documentId} was taken over by a newer run`);
    this.name = "StaleRunError";
  }
}

export type IngestPdfInput = {
  machineId: string;
  accountId: string;
  machineName?: string | null;
  fileName: string;
  fileBuffer: Buffer;
  // Optional human-written one-line manifest entry. Falls back to the
  // filename (sans .pdf) if absent — the CLI relies on this fallback.
  summary?: string | null;
  // Optional slash-separated folder path ("Setup/Calibration"). Null
  // lands the doc at the root in the admin tree view.
  folderPath?: string | null;
  // Free-form audit field on kb_documents.created_by. CLI passes "cli";
  // the admin endpoint will pass the operator's email.
  createdBy?: string;
};

export type IngestPdfResult = {
  documentId: string;
  chunkCount: number;
  pageCount: number;
  byteSize: number;
  storagePath: string;
  // Which extraction path produced the text. "claude-ocr" means the PDF
  // had no usable text layer and was processed via vision instead.
  extractionSource: PdfExtractionSource;
};

// The chunker moved to chunking.ts when it gained page provenance and
// table awareness. Re-exported here because it was part of this module's
// public surface (feedback.ts, fileIngestion.ts) and the import path is
// not worth churning.
export { chunkText };

// ---------------------------------------------------------------------------
// Folder paths
// ---------------------------------------------------------------------------

const FOLDER_PATH_MAX_CHARS = 200;

/**
 * Canonical form of a user-supplied folder path: segments trimmed, empty
 * ones dropped, joined with single slashes. Null for "root". Throws an
 * IngestRequestError (400) for "." / ".." segments or an over-long path —
 * the folder path is only a label in kb_folders, but a traversal-looking
 * segment has no legitimate use and the cap keeps the tree renderable.
 */
export function normalizeFolderPath(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const segs = input
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segs.length === 0) return null;
  for (const seg of segs) {
    if (seg === "." || seg === "..") {
      throw new IngestRequestError(400, "folderPath contains an invalid segment");
    }
  }
  const joined = segs.join("/");
  if (joined.length > FOLDER_PATH_MAX_CHARS) {
    throw new IngestRequestError(
      400,
      `folderPath is longer than ${FOLDER_PATH_MAX_CHARS} characters`,
    );
  }
  return joined;
}

// Upserts the given folder path AND every ancestor into kb_folders so
// the admin tree shows them even after their last document is deleted.
// "Setup/Calibration" → upserts both "Setup" and "Setup/Calibration".
export async function ensureFolderPath(
  machineId: string,
  folderPath: string,
): Promise<void> {
  const supabase = getSupabaseServerClient();
  const segs = folderPath.split("/").filter(Boolean);
  if (segs.length === 0) return;
  const rows: { machine_id: string; path: string }[] = [];
  for (let i = 1; i <= segs.length; i++) {
    rows.push({ machine_id: machineId, path: segs.slice(0, i).join("/") });
  }
  const { error } = await supabase
    .from("kb_folders")
    .upsert(rows, { onConflict: "machine_id,path", ignoreDuplicates: true });
  if (error) throw new Error(`kb_folders upsert failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Progress + run fencing
// ---------------------------------------------------------------------------

// Best-effort progress writes. We intentionally swallow errors here —
// progress is observability, not a correctness primitive, and a failed
// update mid-pipeline shouldn't tank the whole ingest. Bumps updated_at
// so the watchdog can tell the difference between "still working" and
// "stuck". Scoped to the current run so a fenced-out ghost cannot
// overwrite the live run's progress.
export async function writeProgress(
  documentId: string,
  pct: number,
  label: string,
  runId?: string,
): Promise<void> {
  try {
    const supabase = getSupabaseServerClient();
    let q = supabase
      .from("kb_documents")
      .update({
        progress: pct,
        progress_label: label,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);
    if (runId) q = q.eq("run_id", runId);
    await q;
  } catch (err) {
    console.warn("writeProgress failed:", err);
  }
}

// Claims the document for this invocation. Every entry point calls it
// before starting the pipeline; the pipeline then verifies ownership at
// each write that matters.
async function claimRun(documentId: string, runId: string): Promise<void> {
  const { error } = await getSupabaseServerClient()
    .from("kb_documents")
    .update({ run_id: runId, updated_at: new Date().toISOString() })
    .eq("id", documentId);
  if (error) throw new Error(`run claim failed: ${error.message}`);
}

// Throws StaleRunError when another invocation has claimed the document
// since we did. A missing row counts as stale too (deleted mid-run).
async function assertRunOwner(documentId: string, runId: string): Promise<void> {
  const { data, error } = await getSupabaseServerClient()
    .from("kb_documents")
    .select("run_id")
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw new Error(`run check failed: ${error.message}`);
  const current = (data as { run_id: string | null } | null)?.run_id ?? null;
  if (current !== runId) throw new StaleRunError(documentId);
}

// Rotates run_id so any pipeline invocation currently working on the
// document fails its next ownership check. Used by DELETE (a cascade
// would otherwise race a ghost's late inserts) and the timeout handler.
export async function fenceDocument(documentId: string): Promise<void> {
  try {
    await getSupabaseServerClient()
      .from("kb_documents")
      .update({ run_id: randomUUID() })
      .eq("id", documentId);
  } catch (err) {
    console.warn("fenceDocument failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Time budgets
// ---------------------------------------------------------------------------

// Vercel kills the function at 300s. Long-running ingests don't fail on
// that anymore: the pipeline checkpoints between steps and, once the SOFT
// budget is spent, returns { done: false } so the caller (admin client or
// cron sweep) calls back and the next invocation resumes where this one
// stopped. The HARD budget below is a backstop for a single step that
// can't checkpoint (one OCR slice, a Voyage batch stuck in retries) — it
// flips the row to failed before the platform reaps us.
//
// Both are measured from the moment the HTTP request arrived, not from
// when the pipeline got going: auth, JSON parsing and the Storage
// download in front of the pipeline are part of the same 300 s.
export const INGEST_SOFT_BUDGET_MS = 210_000;
const INGEST_HARD_BUDGET_MS = 270_000;

// Steps that cannot checkpoint internally must not start with less than
// this left before the soft deadline. Figures (one vision call plus one
// embedding call) and metadata (one Haiku call) each fit comfortably.
const STEP_RESERVE_MS = 90_000;

const TIMEOUT_LABEL =
  "5-minute time limit reached — split the PDF into smaller files or contact support@optipeople.dk";

export class IngestTimeoutError extends Error {
  constructor() {
    super(TIMEOUT_LABEL);
    this.name = "IngestTimeoutError";
  }
}

/**
 * Races `work` against a hard timer. On timeout the row is flipped to
 * failed with a label that is safe to show to the operator, and run_id is
 * rotated so the underlying work — which may keep running until Vercel
 * reaps the invocation — is fenced out of every later write.
 *
 * `startedAt` lets the caller measure the budget from request arrival.
 * Shared with the file and image pipelines.
 */
export async function withIngestBudget<T>(
  documentId: string,
  work: Promise<T>,
  opts: { startedAt?: number; hardBudgetMs?: number } = {},
): Promise<T> {
  const budget = opts.hardBudgetMs ?? INGEST_HARD_BUDGET_MS;
  const startedAt = opts.startedAt ?? Date.now();
  const delay = Math.max(1_000, startedAt + budget - Date.now());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void (async () => {
        try {
          const supabase = getSupabaseServerClient();
          await supabase
            .from("kb_documents")
            .update({
              status: "failed",
              progress: null,
              progress_label: TIMEOUT_LABEL,
              run_id: randomUUID(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", documentId);
        } catch (err) {
          console.warn("ingest timeout: status flip failed:", err);
        }
        reject(new IngestTimeoutError());
      })();
    }, delay);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * On any failure that is not a timeout (already handled by
 * withIngestBudget), a stale-run abort (the newer owner reports its own
 * outcome) or a request rejection (nothing started), marks the row failed
 * so the operator sees what happened instead of a perpetual "extracting"
 * badge. Storage object and checkpoints stay so a retry can resume.
 * Shared with the file and image pipelines.
 */
export async function markFailedOnError<T>(
  documentId: string,
  work: Promise<T>,
  opts: { runId?: string } = {},
): Promise<T> {
  try {
    return await work;
  } catch (err) {
    if (
      !(err instanceof IngestTimeoutError) &&
      !(err instanceof StaleRunError) &&
      !(err instanceof IngestRequestError)
    ) {
      let q = getSupabaseServerClient()
        .from("kb_documents")
        .update({
          status: "failed",
          progress: null,
          progress_label:
            err instanceof Error ? err.message.slice(0, 200) : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId);
      if (opts.runId) q = q.eq("run_id", opts.runId);
      await q;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Extraction checkpoint (sidecar)
// ---------------------------------------------------------------------------

// The extracted text is persisted as a JSON sidecar next to the PDF in
// Storage so a continuation invocation can skip straight to embedding
// (re-running Claude OCR would cost dollars and minutes). chunkText() is
// deterministic, so the continuation recomputes the same chunk list from
// the sidecar text and resumes at the first ordinal that isn't in
// kb_chunks yet. The sidecar is deleted when the document reaches 'ready'.
//
// Two special shapes:
//   - `ocrCheckpoint` set: OCR ran out of time mid-document. `text` is
//     partial and must not be chunked; extraction re-runs with the
//     checkpoint and only OCRs the pages still missing.
//   - `text` empty and no checkpoint: extraction finished and found
//     nothing. Terminal — the document fails with a human label rather
//     than paying for another extraction that would find nothing again.
//
// The text carries `<<<page:N>>>` sentinels from version 2 onwards, which
// is what makes per-chunk page provenance possible. A version 1 sidecar
// has none, and its chunk list would therefore differ from what this code
// produces, so it is treated as absent: the document re-extracts.
const SIDECAR_VERSION = 2;

type ExtractedSidecar = {
  version?: number;
  text: string;
  pageCount: number;
  source: PdfExtractionSource;
  ocrCheckpoint?: OcrCheckpoint;
};

const NO_TEXT_LABEL = "No extractable text in this PDF";

export function extractionSidecarPath(storagePath: string): string {
  return `${storagePath}.extracted.json`;
}

async function writeSidecar(
  storagePath: string,
  sidecar: ExtractedSidecar,
): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.storage
    .from("kb-documents")
    .upload(extractionSidecarPath(storagePath), JSON.stringify(sidecar), {
      contentType: "application/json",
      upsert: true,
    });
  if (error) throw new Error(`sidecar write failed: ${error.message}`);
}

async function readSidecar(
  storagePath: string,
): Promise<ExtractedSidecar | null> {
  const supabase = getSupabaseServerClient();
  const { data: blob, error } = await supabase.storage
    .from("kb-documents")
    .download(extractionSidecarPath(storagePath));
  if (error || !blob) return null;
  try {
    const parsed = JSON.parse(await blob.text()) as ExtractedSidecar;
    if (typeof parsed.text !== "string") return null;
    if ((parsed.version ?? 1) !== SIDECAR_VERSION) {
      console.warn(
        `readSidecar: ignoring version ${parsed.version ?? 1} checkpoint ` +
          `(current is ${SIDECAR_VERSION}); the document re-extracts`,
      );
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function deleteSidecar(storagePath: string): Promise<void> {
  try {
    const supabase = getSupabaseServerClient();
    await supabase.storage
      .from("kb-documents")
      .remove([extractionSidecarPath(storagePath)]);
  } catch (err) {
    console.warn("sidecar cleanup failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Watchdog + sweep
// ---------------------------------------------------------------------------

// Any kb_documents row whose status is mid-pipeline AND hasn't been
// touched in STUCK_THRESHOLD_MS gets flipped to failed. Catches the case
// where a function instance died (OOM, deploy, network drop) before
// withIngestBudget could fire its own timer. Cheap to call — single
// conditional UPDATE.
const STUCK_THRESHOLD_MS = 6 * 60_000;
const STUCK_LABEL =
  "Processing was interrupted (server restart or timeout). Try again.";

async function flipStuck(machineId: string | null): Promise<number> {
  try {
    const supabase = getSupabaseServerClient();
    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString();
    let q = supabase
      .from("kb_documents")
      .update({
        status: "failed",
        progress: null,
        progress_label: STUCK_LABEL,
        run_id: randomUUID(),
        updated_at: new Date().toISOString(),
      })
      .in("status", ["uploaded", "extracting", "embedding"])
      .lt("updated_at", cutoff);
    if (machineId) q = q.eq("machine_id", machineId);
    const { data, error } = await q.select("id");
    if (error) {
      console.warn("cleanupStuckDocuments failed:", error);
      return 0;
    }
    return data?.length ?? 0;
  } catch (err) {
    console.warn("cleanupStuckDocuments threw:", err);
    return 0;
  }
}

export async function cleanupStuckDocuments(machineId: string): Promise<void> {
  await flipStuck(machineId);
}

// A document mid-pipeline that nobody has touched for this long is
// presumed abandoned by its client (tab closed, network gone) and picked
// up by the cron sweep. Progress writes bump updated_at at least once per
// embedding batch / OCR slice, so a live run stays well inside it.
const RESUME_STALE_MS = 90_000;

export type SweepResult = {
  flipped: number;
  resumed: string[];
  completed: string[];
  failed: string[];
};

/**
 * Server-driven continuation for the cron sweep. Flips documents that
 * have been silent past the stuck threshold to failed (globally, unlike
 * cleanupStuckDocuments), then resumes up to `limit` documents stuck
 * between RESUME_STALE_MS and that threshold, one at a time, until
 * `deadlineAt`. Each resumed document checkpoints as usual, so a run
 * that ends with { done: false } is simply picked up by the next sweep.
 */
export async function sweepStuckDocuments(opts: {
  deadlineAt: number;
  limit?: number;
}): Promise<SweepResult> {
  const result: SweepResult = {
    flipped: 0,
    resumed: [],
    completed: [],
    failed: [],
  };
  result.flipped = await flipStuck(null);

  const supabase = getSupabaseServerClient();
  const cutoff = new Date(Date.now() - RESUME_STALE_MS).toISOString();
  const { data, error } = await supabase
    .from("kb_documents")
    .select("id, machine_id, storage_path, byte_size, status")
    .eq("source_type", "pdf")
    .in("status", ["extracting", "embedding"])
    .lt("updated_at", cutoff)
    .not("storage_path", "is", null)
    .order("updated_at", { ascending: true })
    .limit(opts.limit ?? 5);
  if (error) throw new Error(`sweep lookup failed: ${error.message}`);

  for (const raw of (data ?? []) as {
    id: string;
    machine_id: string;
    storage_path: string;
    byte_size: number | null;
  }[]) {
    if (Date.now() >= opts.deadlineAt - STEP_RESERVE_MS) break;

    // Only resume what can actually be resumed: a sidecar or the original
    // PDF must still be there. A row with neither is an orphan and the
    // stuck flip will get it eventually.
    const hasSidecar = (await readSidecar(raw.storage_path)) !== null;
    if (!hasSidecar) {
      const dir = raw.storage_path.split("/").slice(0, -1).join("/");
      const name = raw.storage_path.split("/").pop() ?? "";
      const { data: objects } = await supabase.storage
        .from("kb-documents")
        .list(dir, { search: name, limit: 1 });
      if (!objects || !objects.some((o) => o.name === name)) continue;
    }

    result.resumed.push(raw.id);
    try {
      const outcome = await resumePdfDocument({
        documentId: raw.id,
        machineId: raw.machine_id,
        storagePath: raw.storage_path,
        byteSize: raw.byte_size ?? 0,
        // Per-document soft deadline: the usual budget, but never past the
        // sweep's own deadline.
        deadlineAt: Math.min(Date.now() + INGEST_SOFT_BUDGET_MS, opts.deadlineAt),
        hardDeadlineAt: opts.deadlineAt + 30_000,
      });
      if (outcome.done) result.completed.push(raw.id);
    } catch (err) {
      result.failed.push(raw.id);
      console.warn(
        `sweep: resume of ${raw.id} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Row setup
// ---------------------------------------------------------------------------

// Maps embedding-batch progress onto a 40 → 90 % range so the bar
// keeps moving smoothly between the chunking step (30 %) and the
// chunk-insert step (95 %).
function embedProgressPct(done: number, total: number): number {
  if (total <= 0) return 90;
  const span = 50; // 40..90
  return Math.min(90, 40 + Math.round((done / total) * span));
}

// OCR sits between "reading" (5 %) and "chunking" (30 %).
function ocrProgressPct(done: number, total: number): number {
  if (total <= 0) return 25;
  return Math.min(25, 10 + Math.round((done / total) * 15));
}

// Idempotent: safe to call before every ingestPdf. Only writes
// display_name when machineName is a non-empty string — passing null /
// undefined leaves the existing value alone, which is what the admin
// upload flow wants (the row already exists with its name set).
export async function ensureMachineKb(
  machineId: string,
  accountId: string,
  machineName?: string | null,
): Promise<void> {
  const supabase = getSupabaseServerClient();
  const row: Record<string, unknown> = {
    machine_id: machineId,
    account_id: accountId,
  };
  if (typeof machineName === "string" && machineName.length > 0) {
    row.display_name = machineName;
  }
  const { error } = await supabase
    .from("machine_kb")
    .upsert(row, { onConflict: "machine_id" });
  if (error) throw new Error(`machine_kb upsert failed: ${error.message}`);
}

// Inserts the kb_documents row up-front with status='extracting' so it
// shows in the admin queue panel from second one — without this the
// operator stares at nothing for 30–60s while OCR runs on a heavy PDF.
// We patch the extraction-source / page-count once we know them. Also
// upserts the folder path. Shared by both ingest entry points.
async function insertPdfDocRow(args: {
  documentId: string;
  machineId: string;
  storagePath: string;
  byteSize: number;
  fileName: string;
  summary?: string | null;
  folderPath?: string | null;
  createdBy?: string;
  runId: string;
}): Promise<void> {
  const supabase = getSupabaseServerClient();
  const folderPath = normalizeFolderPath(args.folderPath);
  if (folderPath) {
    await ensureFolderPath(args.machineId, folderPath);
  }

  const title = args.fileName.replace(/\.pdf$/i, "").trim() || "upload";
  const { error: docError } = await supabase.from("kb_documents").insert({
    id: args.documentId,
    machine_id: args.machineId,
    title,
    summary: args.summary?.trim() || title,
    source_type: "pdf",
    storage_path: args.storagePath,
    byte_size: args.byteSize,
    status: "extracting",
    created_by: args.createdBy ?? "cli",
    folder_path: folderPath,
    progress: 5,
    progress_label: phaseLabel("reading_pdf"),
    run_id: args.runId,
  });
  if (docError) throw new Error(`kb_documents insert failed: ${docError.message}`);
}

// Document identity metadata (docs/answer-correctness-plan.md fixes F and
// G): catalogue number, which product models the manual covers, which
// other manuals it defers to, and a real one-paragraph summary.
//
// Idempotent and best-effort. Skipped when the row already carries
// metadata, so a resumed invocation pays for it once. Every failure path
// leaves the column null, which every reader already treats as "unknown".
//
// The summary only replaces the fallback value. insertPdfDocRow defaults
// summary to the title (usually the filename); an admin who typed a real
// summary keeps it.
async function ensureDocumentMeta(args: {
  documentId: string;
  machineId: string;
  text: string;
  runId: string;
}): Promise<void> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("kb_documents")
      .select("title, summary, meta")
      .eq("id", args.documentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = data as {
      title: string;
      summary: string | null;
      meta: unknown;
    } | null;
    if (!row || row.meta) return;

    await writeProgress(args.documentId, 35, phaseLabel("metadata"), args.runId);

    const meta = await extractDocumentMeta({
      text: args.text,
      title: row.title,
      usage: { machineId: args.machineId },
    });

    const patch: Record<string, unknown> = {
      meta,
      updated_at: new Date().toISOString(),
    };
    const summaryIsFallback =
      !row.summary || row.summary.trim() === row.title.trim();
    if (meta.summary && summaryIsFallback) patch.summary = meta.summary;

    const { error: upErr } = await supabase
      .from("kb_documents")
      .update(patch)
      .eq("id", args.documentId)
      .eq("run_id", args.runId);
    if (upErr) throw new Error(upErr.message);
  } catch (err) {
    console.warn(
      "ensureDocumentMeta failed (continuing without metadata):",
      err instanceof Error ? err.message : err,
    );
  }
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

// Outcome of one pipeline invocation. done:false means the soft budget
// ran out mid-work — everything completed so far is persisted, and the
// caller (ultimately the admin client, or the cron sweep) should call
// again to continue.
export type IngestPdfOutcome =
  | ({ done: true } & IngestPdfResult)
  | { done: false; documentId: string };

// The actual extract → chunk → embed → figures pipeline, resumable at
// every step boundary. Assumes the kb_documents row already exists, the
// PDF is in Storage at storagePath and run_id has been claimed for
// `runId`. Each phase persists its result before the next starts (sidecar
// after extraction — or after each OCR slice when time runs out —
// kb_chunks rows after every Voyage batch), so an invocation that runs
// out of soft budget returns { done: false } and the next invocation
// picks up from the checkpoint instead of redoing work.
//
// Reprocessing is non-destructive until the swap point: the old chunks
// stay in place, and therefore searchable, while the new extraction runs.
// Only once the new text is in hand and has produced at least one chunk
// are the old text chunks and figures deleted, immediately before the
// complete sidecar is written. Ordering matters: a complete sidecar is
// what tells a continuation "the chunks in kb_chunks are from THIS text",
// so it must never exist while old chunks do. A run that yields or fails
// before the swap leaves the document exactly as it was.
async function runPdfPipeline(args: {
  documentId: string;
  machineId: string;
  storagePath: string;
  byteSize: number;
  runId: string;
  // ms epoch after which the pipeline should checkpoint and yield.
  // null = run to completion (the CLI has no platform time limit).
  deadlineAt: number | null;
  force?: PdfExtractionForce;
  // Pass when the caller already has the bytes; otherwise the pipeline
  // downloads from Storage only when a phase actually needs them
  // (a resumed embed run doesn't).
  fileBuffer?: Buffer;
}): Promise<IngestPdfOutcome> {
  const supabase = getSupabaseServerClient();
  const { documentId, machineId, storagePath, byteSize, runId } = args;

  let buf: Buffer | null = args.fileBuffer ?? null;
  const getBuffer = async (): Promise<Buffer> => {
    if (buf) return buf;
    const { data: blob, error } = await supabase.storage
      .from("kb-documents")
      .download(storagePath);
    if (error || !blob) {
      throw new Error(
        `download from Storage failed: ${error?.message ?? "object missing"}`,
      );
    }
    buf = Buffer.from(await blob.arrayBuffer());
    return buf;
  };
  const outOfTime = () =>
    args.deadlineAt !== null && Date.now() >= args.deadlineAt;
  // For steps that cannot checkpoint internally.
  const tooLateFor = (reserveMs: number) =>
    args.deadlineAt !== null && Date.now() >= args.deadlineAt - reserveMs;
  const yieldNow = (): IngestPdfOutcome => ({ done: false, documentId });

  // 1. Extraction — skipped entirely when a complete checkpoint sidecar
  // exists. A partial (OCR) checkpoint re-enters extraction with the
  // pages already done.
  let sidecar = await readSidecar(storagePath);
  if (!sidecar || sidecar.ocrCheckpoint) {
    const extracted = await extractPdfText(await getBuffer(), {
      force: args.force,
      usage: { machineId },
      // Every vision pass checks this between requests, so a long
      // document degrades to "checkpoint and continue" instead of
      // blowing the platform's function limit. The CLI passes null.
      deadlineAt: args.deadlineAt,
      ocrCheckpoint: sidecar?.ocrCheckpoint ?? null,
      onPhaseStart: async (phase) => {
        if (phase === "pdf-parse+tables") {
          await writeProgress(documentId, 15, phaseLabel("tables"), runId);
        }
      },
      onOcrProgress: async (done, total) => {
        await writeProgress(
          documentId,
          ocrProgressPct(done, total),
          phaseLabel("ocr", { done, total }),
          runId,
        );
      },
    });

    if (extracted.incomplete) {
      // OCR ran out of time. Persist the pages done so far and yield; the
      // next invocation only pays for the rest.
      await assertRunOwner(documentId, runId);
      await writeSidecar(storagePath, {
        version: SIDECAR_VERSION,
        text: "",
        pageCount: extracted.pageCount,
        source: extracted.source,
        ocrCheckpoint: {
          pages: extracted.incomplete.pages,
        },
      });
      return yieldNow();
    }

    // Zero-chunk guard, evaluated BEFORE the swap so a reprocess whose new
    // extraction came back empty keeps the old chunks.
    const chunkCount = chunkText(extracted.text).length;
    if (chunkCount === 0) {
      await assertRunOwner(documentId, runId);
      await writeSidecar(storagePath, {
        version: SIDECAR_VERSION,
        text: "",
        pageCount: extracted.pageCount,
        source: extracted.source,
      });
      throw new Error(NO_TEXT_LABEL);
    }

    // The swap: drop the previous text chunks and figures (no-op on a
    // fresh ingest), then write the sidecar that marks kb_chunks as
    // belonging to the new text.
    await assertRunOwner(documentId, runId);
    const { error: delErr } = await supabase
      .from("kb_chunks")
      .delete()
      .eq("document_id", documentId);
    if (delErr) throw new Error(`wipe old chunks failed: ${delErr.message}`);
    await wipePdfFigures(documentId);

    sidecar = {
      version: SIDECAR_VERSION,
      text: extracted.text,
      pageCount: extracted.pageCount,
      source: extracted.source,
    };
    await writeSidecar(storagePath, sidecar);
    await supabase
      .from("kb_documents")
      .update({
        status: "embedding",
        page_count: sidecar.pageCount,
        extraction_source: sidecar.source,
        progress: 30,
        progress_label: phaseLabel("chunking", { pages: sidecar.pageCount }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId)
      .eq("run_id", runId);
  } else if (!sidecar.text) {
    // A complete sidecar with no text is the terminal "nothing to index"
    // marker from an earlier run. Fail the same way rather than paying
    // for an extraction that will find nothing again.
    throw new Error(NO_TEXT_LABEL);
  }

  // 1b. Document identity metadata: which product family this manual
  // covers and which other manuals it defers to. Persisted on the row so
  // a resumed invocation doesn't pay for it twice, and best-effort
  // throughout: a document with no metadata behaves exactly as it did
  // before the column existed. One un-checkpointable model call, so it
  // needs the step reserve.
  if (tooLateFor(STEP_RESERVE_MS)) return yieldNow();
  await ensureDocumentMeta({
    documentId,
    machineId,
    text: sidecar.text,
    runId,
  });

  // 2. Chunking is deterministic, so a continuation recomputes the same
  // list and resumes at the first ordinal missing from kb_chunks. Figure
  // caption chunks don't interfere: they carry asset_id and live at
  // ordinal ≥ 1e6. Each chunk also carries the page range it came from,
  // parsed out of the extraction's page sentinels.
  const chunks = chunkText(sidecar.text);
  if (chunks.length === 0) throw new Error(NO_TEXT_LABEL);
  const { data: lastChunk, error: lastErr } = await supabase
    .from("kb_chunks")
    .select("ordinal")
    .eq("document_id", documentId)
    .eq("embedding_model", VOYAGE_MODEL)
    .is("asset_id", null)
    .order("ordinal", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastErr) throw new Error(`resume lookup failed: ${lastErr.message}`);
  let next = lastChunk ? (lastChunk as { ordinal: number }).ordinal + 1 : 0;

  // 3. Embed the remaining chunks batch-by-batch, persisting each batch
  // before starting the next. Deadline and ownership are checked between
  // batches — the slots where stopping loses no work.
  if (next < chunks.length) {
    await writeProgress(
      documentId,
      embedProgressPct(next, chunks.length),
      phaseLabel("embedding", { done: next, total: chunks.length }),
      runId,
    );
    for (const batch of planEmbedBatches(
      chunks.slice(next).map((c) => c.text),
    )) {
      if (outOfTime()) return yieldNow();
      const embeddings = await embedDocumentBatch(batch, { machineId });
      if (embeddings.length !== batch.length) {
        throw new Error(
          `embedding count mismatch (${embeddings.length} vs ${batch.length})`,
        );
      }
      // planEmbedBatches preserves order, so batch[i] is chunks[next + i].
      const rows = batch.map((text, i) => ({
        document_id: documentId,
        machine_id: machineId,
        ordinal: next + i,
        page_from: chunks[next + i]?.pageFrom ?? null,
        page_to: chunks[next + i]?.pageTo ?? null,
        text,
        embedding: embeddings[i],
        embedding_model: VOYAGE_MODEL,
      }));
      await assertRunOwner(documentId, runId);
      const INSERT_BATCH = 50;
      for (let i = 0; i < rows.length; i += INSERT_BATCH) {
        const slice = rows.slice(i, i + INSERT_BATCH);
        // Upsert + ignoreDuplicates: a ghost that already wrote these
        // ordinals (or this run re-embedding after a mid-batch crash)
        // leaves the existing rows alone instead of duplicating them.
        const { error } = await supabase.from("kb_chunks").upsert(slice, {
          onConflict: "document_id,ordinal,embedding_model",
          ignoreDuplicates: true,
        });
        if (error) {
          throw new Error(
            `kb_chunks insert failed at ordinal ${next + i}: ${error.message}`,
          );
        }
      }
      next += batch.length;
      await writeProgress(
        documentId,
        embedProgressPct(next, chunks.length),
        phaseLabel("embedding", { done: next, total: chunks.length }),
        runId,
      );
    }
  }

  // 4. Figure extraction is best-effort and runs after text chunks are
  // persisted so a failure here can't strand the document in an
  // unsearchable state. Wipe-then-attach keeps it idempotent if a prior
  // invocation died between attaching figures and flipping to ready. One
  // vision call plus one embedding call, neither of which checkpoints, so
  // it needs the step reserve; otherwise it runs on the next invocation.
  if (tooLateFor(STEP_RESERVE_MS)) return yieldNow();
  await assertRunOwner(documentId, runId);
  await writeProgress(documentId, 97, phaseLabel("figures"), runId);
  await wipePdfFigures(documentId);
  await attachPdfFigures({
    documentId,
    machineId,
    pdfBuffer: await getBuffer(),
    pdfStoragePath: storagePath,
  });

  await assertRunOwner(documentId, runId);
  const { error: readyErr } = await supabase
    .from("kb_documents")
    .update({
      status: "ready",
      progress: null,
      progress_label: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId)
    .eq("run_id", runId);
  if (readyErr) throw new Error(`status flip failed: ${readyErr.message}`);

  await deleteSidecar(storagePath);
  await regenerateSuggestedQuestionsSafe(machineId);

  return {
    done: true,
    documentId,
    chunkCount: chunks.length,
    pageCount: sidecar.pageCount,
    byteSize,
    storagePath,
    extractionSource: sidecar.source,
  };
}

// Claim + budget + failure marking around one pipeline run. Every entry
// point that runs on a platform time limit goes through here.
async function runGuarded(args: {
  documentId: string;
  machineId: string;
  storagePath: string;
  byteSize: number;
  deadlineAt: number | null;
  startedAt: number;
  hardBudgetMs?: number;
  force?: PdfExtractionForce;
  fileBuffer?: Buffer;
}): Promise<IngestPdfOutcome> {
  const runId = randomUUID();
  await claimRun(args.documentId, runId);
  return markFailedOnError(
    args.documentId,
    withIngestBudget(
      args.documentId,
      runPdfPipeline({ ...args, runId }),
      { startedAt: args.startedAt, hardBudgetMs: args.hardBudgetMs },
    ),
    { runId },
  );
}

// Continuation used by the cron sweep: the row exists, nobody is (or
// should be) working on it, just claim it and keep going.
async function resumePdfDocument(args: {
  documentId: string;
  machineId: string;
  storagePath: string;
  byteSize: number;
  deadlineAt: number;
  hardDeadlineAt: number;
}): Promise<IngestPdfOutcome> {
  const startedAt = Date.now();
  return runGuarded({
    ...args,
    startedAt,
    hardBudgetMs: Math.max(1_000, args.hardDeadlineAt - startedAt),
  });
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

// Buffer-based entry point. Used by the ingest CLI (scripts/ingest.ts),
// which has the bytes in hand and uploads them as part of ingestion.
// Runs with no deadline (a local process has no platform time limit),
// so the outcome is always done:true.
export async function ingestPdf(input: IngestPdfInput): Promise<IngestPdfResult> {
  const supabase = getSupabaseServerClient();

  await ensureMachineKb(input.machineId, input.accountId, input.machineName);

  const documentId = randomUUID();
  const runId = randomUUID();
  const storagePath = `${input.machineId}/${documentId}.pdf`;
  const byteSize = input.fileBuffer.byteLength;
  if (!looksLikePdf(input.fileBuffer)) {
    throw new IngestRequestError(400, INVALID_PDF_LABEL);
  }

  const { error: uploadError } = await supabase.storage
    .from("kb-documents")
    .upload(storagePath, input.fileBuffer, {
      contentType: "application/pdf",
      upsert: false,
    });
  if (uploadError) throw new Error(`storage upload failed: ${uploadError.message}`);

  await insertPdfDocRow({
    documentId,
    machineId: input.machineId,
    storagePath,
    byteSize,
    fileName: input.fileName,
    summary: input.summary,
    folderPath: input.folderPath,
    createdBy: input.createdBy,
    runId,
  });

  const outcome = await markFailedOnError(
    documentId,
    runPdfPipeline({
      documentId,
      machineId: input.machineId,
      storagePath,
      fileBuffer: input.fileBuffer,
      byteSize,
      deadlineAt: null,
      runId,
    }),
    { runId },
  );
  if (!outcome.done) {
    throw new Error("ingestPdf: pipeline yielded without a deadline");
  }
  return outcome;
}

export type IngestPdfFromStorageInput = {
  machineId: string;
  accountId: string;
  // documentId + storagePath were minted by the /sign endpoint; the
  // client uploaded the PDF straight to Storage under that path,
  // bypassing the ~4.5 MB Vercel function body limit.
  documentId: string;
  storagePath: string;
  fileName: string;
  summary?: string | null;
  folderPath?: string | null;
  createdBy?: string;
  // ms epoch when the HTTP request arrived. The soft and hard budgets are
  // measured from here so the work in front of the pipeline counts.
  // Defaults to now.
  requestStartedAt?: number;
};

const INVALID_PDF_LABEL = "The file is not a valid PDF";

// Every PDF starts with the "%PDF-" header. Cheap, and it catches the two
// ways a wrong file reaches us: a renamed .docx and a zero-byte upload
// from a client that lost its connection mid-PUT.
function looksLikePdf(buf: Buffer): boolean {
  return buf.byteLength > 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-";
}

// Storage-based entry point. The admin UI uploads the PDF directly to
// Storage via a signed URL, then calls this to run the pipeline. Called
// repeatedly for big documents: the first call creates the kb_documents
// row and starts the pipeline; when the soft budget runs out it returns
// { done: false } and the client calls again, which lands in the resume
// branch (row already exists) and continues from the checkpoint.
export async function ingestPdfFromStorage(
  input: IngestPdfFromStorageInput,
): Promise<IngestPdfOutcome> {
  const supabase = getSupabaseServerClient();
  const startedAt = input.requestStartedAt ?? Date.now();
  const deadlineAt = startedAt + INGEST_SOFT_BUDGET_MS;

  await ensureMachineKb(input.machineId, input.accountId);

  // Resume detection: a row for this documentId means an earlier
  // invocation already started the pipeline.
  const { data: existing, error: exErr } = await supabase
    .from("kb_documents")
    .select("id, byte_size, machine_id, status, source_type, storage_path")
    .eq("id", input.documentId)
    .maybeSingle();
  if (exErr) throw new Error(`ingest lookup failed: ${exErr.message}`);

  let byteSize: number;
  let fileBuffer: Buffer | undefined;
  if (existing) {
    const row = existing as {
      byte_size: number | null;
      machine_id: string;
      status: string;
      source_type: string;
      storage_path: string | null;
    };
    // The documentId is client-supplied. Without this check a caller with
    // access to machine A could continue (and re-own) a document that
    // belongs to machine B.
    if (row.machine_id !== input.machineId || row.source_type !== "pdf") {
      throw new IngestRequestError(403, "Document belongs to another machine");
    }
    if (row.status === "ready") {
      // Idempotent completion: the client's last request finished after
      // it gave up waiting. Report the result it would have received.
      return completedOutcome({
        documentId: input.documentId,
        storagePath: row.storage_path ?? input.storagePath,
        byteSize: row.byte_size ?? 0,
      });
    }
    if (row.status !== "extracting" && row.status !== "embedding") {
      throw new IngestRequestError(
        409,
        `Document is ${row.status}; use reprocess to run it again`,
      );
    }
    byteSize = row.byte_size ?? 0;
  } else {
    const { data: blob, error: dlErr } = await supabase.storage
      .from("kb-documents")
      .download(input.storagePath);
    if (dlErr || !blob) {
      throw new Error(
        `download from Storage failed: ${dlErr?.message ?? "object missing"}`,
      );
    }
    fileBuffer = Buffer.from(await blob.arrayBuffer());
    byteSize = fileBuffer.byteLength;

    const runId = randomUUID();
    await insertPdfDocRow({
      documentId: input.documentId,
      machineId: input.machineId,
      storagePath: input.storagePath,
      byteSize,
      fileName: input.fileName,
      summary: input.summary,
      folderPath: input.folderPath,
      createdBy: input.createdBy,
      runId,
    });

    if (!looksLikePdf(fileBuffer)) {
      // Keep the row (so the operator sees why) but not the bytes: there
      // is nothing to retry against, and a non-PDF must not be served
      // from the documents bucket.
      await supabase
        .from("kb_documents")
        .update({
          status: "failed",
          progress: null,
          progress_label: INVALID_PDF_LABEL,
          updated_at: new Date().toISOString(),
        })
        .eq("id", input.documentId);
      await supabase.storage.from("kb-documents").remove([input.storagePath]);
      throw new IngestRequestError(400, INVALID_PDF_LABEL);
    }
  }

  return runGuarded({
    documentId: input.documentId,
    machineId: input.machineId,
    storagePath: input.storagePath,
    fileBuffer,
    byteSize,
    deadlineAt,
    startedAt,
  });
}

// Result shape for a document that is already 'ready'. Counts come from
// kb_chunks so the answer matches what the pipeline would have returned.
async function completedOutcome(args: {
  documentId: string;
  storagePath: string;
  byteSize: number;
}): Promise<IngestPdfOutcome> {
  const supabase = getSupabaseServerClient();
  const [{ count }, { data: doc }] = await Promise.all([
    supabase
      .from("kb_chunks")
      .select("id", { count: "exact", head: true })
      .eq("document_id", args.documentId)
      .is("asset_id", null),
    supabase
      .from("kb_documents")
      .select("page_count, extraction_source")
      .eq("id", args.documentId)
      .maybeSingle(),
  ]);
  const row = doc as {
    page_count: number | null;
    extraction_source: PdfExtractionSource | null;
  } | null;
  return {
    done: true,
    documentId: args.documentId,
    chunkCount: count ?? 0,
    pageCount: row?.page_count ?? 0,
    byteSize: args.byteSize,
    storagePath: args.storagePath,
    extractionSource: row?.extraction_source ?? "pdf-parse",
  };
}

export type ReprocessPdfResult = {
  documentId: string;
  chunkCount: number;
  pageCount: number;
  extractionSource: PdfExtractionSource;
};

export type ReprocessPdfOutcome =
  | ({ done: true } & ReprocessPdfResult)
  | { done: false; documentId: string };

// Re-runs extraction + embedding for an existing document via the same
// resumable pipeline as fresh ingests. force is optional: left undefined
// the extractor auto-detects (text layer vs OCR) exactly as on first
// ingest; "ocr" is for the operator who knows the heuristic missed.
//
// Non-destructive: the old chunks stay searchable until the new text has
// been extracted and chunked (see runPdfPipeline's swap point). Only the
// checkpoint sidecar and the identity metadata are cleared up front.
//
// resume: true continues a reprocess that returned { done: false } —
// honoured while the doc is mid-pipeline with a checkpoint sidecar
// present (partial OCR or complete). Anything else is a 409: a document
// that is currently being worked on must not be restarted from scratch
// underneath that run.
export async function reprocessPdf(args: {
  documentId: string;
  force?: PdfExtractionForce;
  resume?: boolean;
  requestStartedAt?: number;
}): Promise<ReprocessPdfOutcome> {
  const supabase = getSupabaseServerClient();
  const startedAt = args.requestStartedAt ?? Date.now();
  const deadlineAt = startedAt + INGEST_SOFT_BUDGET_MS;

  const { data: doc, error: docErr } = await supabase
    .from("kb_documents")
    .select("id, machine_id, storage_path, status, source_type, byte_size")
    .eq("id", args.documentId)
    .maybeSingle();
  if (docErr) throw new Error(`reprocess lookup failed: ${docErr.message}`);
  if (!doc) throw new IngestRequestError(404, "Document not found");
  const row = doc as {
    id: string;
    machine_id: string;
    storage_path: string | null;
    status: string;
    source_type: string;
    byte_size: number | null;
  };
  if (row.source_type !== "pdf") {
    throw new IngestRequestError(409, "Only PDF documents can be reprocessed");
  }
  if (!row.storage_path) {
    throw new IngestRequestError(409, "Document has no original file in Storage");
  }

  const inFlight = row.status === "extracting" || row.status === "embedding";
  const resuming =
    args.resume === true &&
    inFlight &&
    (await readSidecar(row.storage_path)) !== null;

  if (!resuming) {
    if (row.status !== "ready" && row.status !== "failed") {
      throw new IngestRequestError(
        409,
        `Document is ${row.status}; wait for it to finish or resume it`,
      );
    }
    // Fresh reprocess: clear the extraction checkpoint so the pipeline
    // starts from extraction (a stale sidecar would short-circuit it),
    // and the identity metadata, which is derived from the extracted text
    // and would otherwise keep describing the old text. Chunks are NOT
    // touched here — runPdfPipeline swaps them once it has new ones.
    await deleteSidecar(row.storage_path);
    await supabase
      .from("kb_documents")
      .update({
        status: "extracting",
        progress: 5,
        progress_label: phaseLabel("reading_pdf"),
        meta: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
  }

  const outcome = await runGuarded({
    documentId: row.id,
    machineId: row.machine_id,
    storagePath: row.storage_path,
    byteSize: row.byte_size ?? 0,
    deadlineAt,
    startedAt,
    force: args.force,
  });
  if (!outcome.done) return outcome;
  return {
    done: true,
    documentId: outcome.documentId,
    chunkCount: outcome.chunkCount,
    pageCount: outcome.pageCount,
    extractionSource: outcome.extractionSource,
  };
}

// Wipes existing kb_documents (and via cascade, kb_chunks) for a machine,
// plus best-effort cleanup of Storage objects under that machine's prefix.
// Used by the CLI's --reset flag while iterating on the chunker.
export async function resetMachineKb(machineId: string): Promise<number> {
  const supabase = getSupabaseServerClient();
  const { data: oldDocs } = await supabase
    .from("kb_documents")
    .select("id, storage_path, source_type")
    .eq("machine_id", machineId);

  if (!oldDocs || oldDocs.length === 0) return 0;

  // Bucket per source type — PDFs in kb-documents, standalone images in
  // kb-images. We pre-bucket the paths so each remove() call hits the
  // right object set.
  const pdfPaths: string[] = [];
  const imagePaths: string[] = [];
  for (const d of oldDocs as {
    storage_path: string | null;
    source_type: string;
  }[]) {
    if (!d.storage_path) continue;
    if (d.source_type === "image") imagePaths.push(d.storage_path);
    else pdfPaths.push(d.storage_path);
  }
  if (pdfPaths.length > 0) {
    await supabase.storage.from("kb-documents").remove(pdfPaths);
  }
  if (imagePaths.length > 0) {
    await supabase.storage.from("kb-images").remove(imagePaths);
  }
  const { error } = await supabase
    .from("kb_documents")
    .delete()
    .eq("machine_id", machineId);
  if (error) throw new Error(`reset failed: ${error.message}`);

  await regenerateSuggestedQuestionsSafe(machineId);

  return oldDocs.length;
}
