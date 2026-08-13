// Per-machine PDF ingestion pipeline.
//
// One PDF in → one Storage object + one kb_documents row + N kb_chunks rows.
// Used by both the ingest CLI (scripts/ingest.ts) and the admin upload
// endpoint coming in iteration 2. machine_kb is upserted on each call so
// the row exists before the document references it.
//
// Server-only: uses the service-role Supabase client.

import { randomUUID } from "node:crypto";
import { attachPdfFigures, wipePdfFigures } from "./imageIngestion";
import {
  extractPdfText,
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

// Recursive splitter: tries the most natural break points first
// (paragraph → newline → sentence → hard char split). Then a second
// merging pass packs the small pieces back up to ~target chars with
// ~overlap chars of trailing context shared into the next chunk.
//
// We can't rely on PDF text being well-formatted (pdf-parse often loses
// paragraph breaks), so the recursive fallback is what makes this robust.
function splitRecursive(text: string, target: number): string[] {
  if (text.length <= target) return [text];
  const seps = ["\n\n", "\n", ". ", " ", ""];
  for (const sep of seps) {
    if (sep === "") {
      // Last resort: hard split.
      const out: string[] = [];
      for (let i = 0; i < text.length; i += target) {
        out.push(text.slice(i, i + target));
      }
      return out;
    }
    const parts = text.split(sep);
    if (parts.length === 1) continue;
    const out: string[] = [];
    for (const part of parts) {
      if (part.length <= target) out.push(part);
      else out.push(...splitRecursive(part, target));
    }
    return out;
  }
  return [text];
}

export function chunkText(text: string, target = 3500, overlap = 400): string[] {
  const pieces = splitRecursive(text, target).filter((p) => p.trim());
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const sep = current ? "\n\n" : "";
    if (current.length + sep.length + piece.length > target && current) {
      chunks.push(current.trim());
      current = current.slice(-overlap) + "\n\n" + piece;
    } else {
      current += sep + piece;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
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

// Best-effort progress writes. We intentionally swallow errors here —
// progress is observability, not a correctness primitive, and a failed
// update mid-pipeline shouldn't tank the whole ingest. Bumps updated_at
// so the watchdog can tell the difference between "still working" and
// "stuck".
async function writeProgress(
  documentId: string,
  pct: number,
  label: string,
): Promise<void> {
  try {
    const supabase = getSupabaseServerClient();
    await supabase
      .from("kb_documents")
      .update({
        progress: pct,
        progress_label: label,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);
  } catch (err) {
    console.warn("writeProgress failed:", err);
  }
}

// Vercel kills the function at 300s. Long-running ingests don't fail on
// that anymore: the pipeline checkpoints between embedding batches and,
// once the SOFT budget is spent, returns { done: false } so the client
// immediately calls back and the next invocation resumes where this one
// stopped. The HARD budget below is a backstop for a single step that
// can't checkpoint (Claude OCR of a huge scan, a Voyage batch stuck in
// retries) — it flips the row to failed before the platform reaps us.
export const INGEST_SOFT_BUDGET_MS = 210_000;
const INGEST_BUDGET_MS = 270_000;

const TIMEOUT_LABEL =
  "5-minute time limit reached — split the PDF into smaller files or contact support@optipeople.dk";

export class IngestTimeoutError extends Error {
  constructor() {
    super(TIMEOUT_LABEL);
    this.name = "IngestTimeoutError";
  }
}

// Race the actual ingestion against a hard timer. On timeout we flip
// the row to failed with a Danish-language label that's safe to show to
// the operator (the queue panel surfaces progress_label as the failure
// reason). The underlying work may continue running in the background
// until Vercel reaps the invocation; if it happens to finish and write
// 'ready' afterwards, the row recovers — benign race.
async function withIngestBudget<T>(
  documentId: string,
  work: Promise<T>,
): Promise<T> {
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
              updated_at: new Date().toISOString(),
            })
            .eq("id", documentId);
        } catch (err) {
          console.warn("ingest timeout: status flip failed:", err);
        }
        reject(new IngestTimeoutError());
      })();
    }, INGEST_BUDGET_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Extraction checkpoint: the extracted text is persisted as a JSON
// sidecar next to the PDF in Storage so a continuation invocation can
// skip straight to embedding (re-running Claude OCR would cost dollars
// and minutes). chunkText() is deterministic, so the continuation
// recomputes the same chunk list from the sidecar text and resumes at
// the first ordinal that isn't in kb_chunks yet. The sidecar is deleted
// when the document reaches 'ready'.
type ExtractedSidecar = {
  text: string;
  pageCount: number;
  source: PdfExtractionSource;
};

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
    if (typeof parsed.text !== "string" || !parsed.text) return null;
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

// Watchdog: any kb_documents row whose status is mid-pipeline AND
// hasn't been touched in STUCK_THRESHOLD_MS gets flipped to failed.
// Catches the case where a function instance died (OOM, deploy, network
// drop) before withIngestBudget could fire its own timer. Cheap to call
// — single conditional UPDATE per machine.
const STUCK_THRESHOLD_MS = 6 * 60_000;
const STUCK_LABEL =
  "Processing was interrupted (server restart or timeout). Try again.";

export async function cleanupStuckDocuments(machineId: string): Promise<void> {
  try {
    const supabase = getSupabaseServerClient();
    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString();
    const { error } = await supabase
      .from("kb_documents")
      .update({
        status: "failed",
        progress: null,
        progress_label: STUCK_LABEL,
        updated_at: new Date().toISOString(),
      })
      .eq("machine_id", machineId)
      .in("status", ["uploaded", "extracting", "embedding"])
      .lt("updated_at", cutoff);
    if (error) console.warn("cleanupStuckDocuments failed:", error);
  } catch (err) {
    console.warn("cleanupStuckDocuments threw:", err);
  }
}

// Maps embedding-batch progress onto a 40 → 90 % range so the bar
// keeps moving smoothly between the chunking step (30 %) and the
// chunk-insert step (95 %).
function embedProgressPct(done: number, total: number): number {
  if (total <= 0) return 90;
  const span = 50; // 40..90
  return Math.min(90, 40 + Math.round((done / total) * span));
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
}): Promise<void> {
  const supabase = getSupabaseServerClient();
  const folderPath =
    typeof args.folderPath === "string" && args.folderPath.trim()
      ? args.folderPath.trim()
      : null;
  if (folderPath) {
    await ensureFolderPath(args.machineId, folderPath);
  }

  const title = args.fileName.replace(/\.pdf$/i, "");
  const { error: docError } = await supabase.from("kb_documents").insert({
    id: args.documentId,
    machine_id: args.machineId,
    title,
    summary: args.summary ?? title,
    source_type: "pdf",
    storage_path: args.storagePath,
    byte_size: args.byteSize,
    status: "extracting",
    created_by: args.createdBy ?? "cli",
    folder_path: folderPath,
    progress: 5,
    progress_label: "Reading PDF",
  });
  if (docError) throw new Error(`kb_documents insert failed: ${docError.message}`);
}

// Outcome of one pipeline invocation. done:false means the soft budget
// ran out mid-work — everything completed so far is persisted, and the
// caller (ultimately the admin client) should call again to continue.
export type IngestPdfOutcome =
  | ({ done: true } & IngestPdfResult)
  | { done: false; documentId: string };

// The actual extract → chunk → embed → figures pipeline, resumable at
// every embedding-batch boundary. Assumes the kb_documents row already
// exists and the PDF is in Storage at storagePath. Each phase persists
// its result before the next starts (sidecar after extraction, kb_chunks
// rows after every Voyage batch), so an invocation that runs out of soft
// budget returns { done: false } and the next invocation picks up from
// the checkpoint instead of redoing work.
async function runPdfPipeline(args: {
  documentId: string;
  machineId: string;
  storagePath: string;
  byteSize: number;
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
  const { documentId, machineId, storagePath, byteSize } = args;

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

  // 1. Extraction — skipped entirely when a checkpoint sidecar exists.
  let sidecar = await readSidecar(storagePath);
  if (!sidecar) {
    const extracted = await extractPdfText(await getBuffer(), {
      force: args.force,
      usage: { machineId },
      onPhaseStart: async (phase) => {
        if (phase === "claude-ocr") {
          await writeProgress(documentId, 10, "Running OCR (Claude vision)…");
        }
      },
    });
    sidecar = {
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
        progress_label: `Chunker (${sidecar.pageCount} sider)`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);
  }

  // 2. Chunking is deterministic, so a continuation recomputes the same
  // list and resumes at the first ordinal missing from kb_chunks. Figure
  // caption chunks don't interfere: they carry asset_id and live at
  // ordinal ≥ 1e6.
  const chunks = chunkText(sidecar.text);
  const { data: lastChunk, error: lastErr } = await supabase
    .from("kb_chunks")
    .select("ordinal")
    .eq("document_id", documentId)
    .is("asset_id", null)
    .order("ordinal", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastErr) throw new Error(`resume lookup failed: ${lastErr.message}`);
  let next = lastChunk ? (lastChunk as { ordinal: number }).ordinal + 1 : 0;

  // 3. Embed the remaining chunks batch-by-batch, persisting each batch
  // before starting the next. Deadline is checked between batches — the
  // slots where stopping loses no work.
  if (next < chunks.length) {
    await writeProgress(
      documentId,
      embedProgressPct(next, chunks.length),
      `Embedder ${next}/${chunks.length}`,
    );
    for (const batch of planEmbedBatches(chunks.slice(next))) {
      if (outOfTime()) return { done: false, documentId };
      const embeddings = await embedDocumentBatch(batch, { machineId });
      if (embeddings.length !== batch.length) {
        throw new Error(
          `embedding count mismatch (${embeddings.length} vs ${batch.length})`,
        );
      }
      const rows = batch.map((text, i) => ({
        document_id: documentId,
        machine_id: machineId,
        ordinal: next + i,
        page_from: null,
        page_to: null,
        text,
        embedding: embeddings[i],
        embedding_model: VOYAGE_MODEL,
      }));
      const INSERT_BATCH = 50;
      for (let i = 0; i < rows.length; i += INSERT_BATCH) {
        const slice = rows.slice(i, i + INSERT_BATCH);
        const { error } = await supabase.from("kb_chunks").insert(slice);
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
        `Embedder ${next}/${chunks.length}`,
      );
    }
  }

  // 4. Figure extraction is best-effort and runs after text chunks are
  // persisted so a failure here can't strand the document in an
  // unsearchable state. Wipe-then-attach keeps it idempotent if a prior
  // invocation died between attaching figures and flipping to ready.
  if (outOfTime()) return { done: false, documentId };
  await writeProgress(documentId, 97, "Finder figurer…");
  await wipePdfFigures(documentId);
  await attachPdfFigures({
    documentId,
    machineId,
    pdfBuffer: await getBuffer(),
    pdfStoragePath: storagePath,
  });

  await supabase
    .from("kb_documents")
    .update({
      status: "ready",
      progress: null,
      progress_label: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId);

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

// On any non-timeout failure, marks the row failed so the operator sees
// what happened instead of a perpetual "extracting" badge. Storage
// object (and the extraction sidecar) stay so a retry can resume.
async function markFailedOnError<T>(
  documentId: string,
  work: Promise<T>,
): Promise<T> {
  try {
    return await work;
  } catch (err) {
    if (!(err instanceof IngestTimeoutError)) {
      await getSupabaseServerClient()
        .from("kb_documents")
        .update({
          status: "failed",
          progress: null,
          progress_label:
            err instanceof Error ? err.message.slice(0, 200) : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId);
    }
    throw err;
  }
}

// Buffer-based entry point. Used by the ingest CLI (scripts/ingest.ts),
// which has the bytes in hand and uploads them as part of ingestion.
// Runs with no deadline (a local process has no platform time limit),
// so the outcome is always done:true.
export async function ingestPdf(input: IngestPdfInput): Promise<IngestPdfResult> {
  const supabase = getSupabaseServerClient();

  await ensureMachineKb(input.machineId, input.accountId, input.machineName);

  const documentId = randomUUID();
  const storagePath = `${input.machineId}/${documentId}.pdf`;
  const byteSize = input.fileBuffer.byteLength;

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
    }),
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
};

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
  const deadlineAt = Date.now() + INGEST_SOFT_BUDGET_MS;

  await ensureMachineKb(input.machineId, input.accountId);

  // Resume detection: a row for this documentId means an earlier
  // invocation already started the pipeline.
  const { data: existing, error: exErr } = await supabase
    .from("kb_documents")
    .select("id, byte_size")
    .eq("id", input.documentId)
    .maybeSingle();
  if (exErr) throw new Error(`ingest lookup failed: ${exErr.message}`);

  let byteSize: number;
  let fileBuffer: Buffer | undefined;
  if (existing) {
    byteSize = (existing as { byte_size: number | null }).byte_size ?? 0;
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

    await insertPdfDocRow({
      documentId: input.documentId,
      machineId: input.machineId,
      storagePath: input.storagePath,
      byteSize,
      fileName: input.fileName,
      summary: input.summary,
      folderPath: input.folderPath,
      createdBy: input.createdBy,
    });
  }

  return markFailedOnError(
    input.documentId,
    withIngestBudget(
      input.documentId,
      runPdfPipeline({
        documentId: input.documentId,
        machineId: input.machineId,
        storagePath: input.storagePath,
        fileBuffer,
        byteSize,
        deadlineAt,
      }),
    ),
  );
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

// Re-runs extraction + embedding for an existing document. Wipes its
// chunks, re-extracts (with optional force="ocr" override), re-chunks
// and re-embeds via the same resumable pipeline as fresh ingests. The
// kb_documents row stays — only its chunks, page_count, and
// extraction_source are touched.
//
// resume: true skips the wipe and continues a reprocess that returned
// { done: false } — only honored while the doc is mid-embedding with a
// checkpoint sidecar present; anything else falls back to a full rerun.
export async function reprocessPdf(args: {
  documentId: string;
  force?: PdfExtractionForce;
  resume?: boolean;
}): Promise<ReprocessPdfOutcome> {
  const supabase = getSupabaseServerClient();
  const deadlineAt = Date.now() + INGEST_SOFT_BUDGET_MS;

  const { data: doc, error: docErr } = await supabase
    .from("kb_documents")
    .select("id, machine_id, storage_path, status")
    .eq("id", args.documentId)
    .maybeSingle();
  if (docErr) throw new Error(`reprocess lookup failed: ${docErr.message}`);
  if (!doc) throw new Error("Document not found");
  const row = doc as {
    id: string;
    machine_id: string;
    storage_path: string | null;
    status: string;
  };
  if (!row.storage_path) {
    throw new Error("Document has no original file in Storage");
  }

  const resuming =
    args.resume === true &&
    row.status === "embedding" &&
    (await readSidecar(row.storage_path)) !== null;

  if (!resuming) {
    // Fresh reprocess: clear every checkpoint so the pipeline starts
    // from extraction. Stale sidecar first — it would otherwise short-
    // circuit the forced re-extraction.
    await deleteSidecar(row.storage_path);

    await supabase
      .from("kb_documents")
      .update({
        status: "extracting",
        progress: 5,
        progress_label: "Reading PDF",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    // Drop the old chunks before re-inserting. ON DELETE CASCADE on
    // kb_chunks handles document deletion, but for re-embed we delete
    // explicitly since the document row is being kept. Figure assets are
    // wiped too so the upcoming attachPdfFigures pass writes a fresh set
    // (their caption chunks cascade away with them).
    const { error: delErr } = await supabase
      .from("kb_chunks")
      .delete()
      .eq("document_id", row.id);
    if (delErr) {
      throw new Error(`wipe old chunks failed: ${delErr.message}`);
    }
    await wipePdfFigures(row.id);
  }

  const outcome = await markFailedOnError(
    row.id,
    withIngestBudget(
      row.id,
      runPdfPipeline({
        documentId: row.id,
        machineId: row.machine_id,
        storagePath: row.storage_path,
        byteSize: 0, // unused by the reprocess result shape
        deadlineAt,
        force: args.force,
      }),
    ),
  );
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
