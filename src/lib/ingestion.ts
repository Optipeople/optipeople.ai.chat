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
import { embedDocuments, VOYAGE_MODEL } from "./voyage";

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

// Vercel kills the function at 300s. We give the actual work 270s and
// reserve ~30s for the failure path (mark the row failed, return a
// response). The reserved budget is generous because Supabase writes
// from a cold instance can spike to a few seconds.
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

// The actual extract → chunk → embed → figures pipeline. Assumes the
// kb_documents row already exists (status='extracting') and the PDF is
// already in Storage at storagePath. The fileBuffer is the same bytes,
// passed in directly to avoid a redundant download. Shared by the
// buffer-based (CLI) and storage-based (direct-upload) entry points.
async function runPdfPipeline(args: {
  documentId: string;
  machineId: string;
  storagePath: string;
  fileBuffer: Buffer;
  byteSize: number;
}): Promise<IngestPdfResult> {
  const supabase = getSupabaseServerClient();
  const { documentId, machineId, storagePath, fileBuffer, byteSize } = args;

  const extracted = await extractPdfText(fileBuffer, {
    onPhaseStart: async (phase) => {
      if (phase === "claude-ocr") {
        await writeProgress(documentId, 10, "Running OCR (Claude vision)…");
      }
    },
  });

  await supabase
    .from("kb_documents")
    .update({
      status: "embedding",
      page_count: extracted.pageCount,
      extraction_source: extracted.source,
      progress: 30,
      progress_label: `Chunker (${extracted.pageCount} sider)`,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId);

  const chunks = chunkText(extracted.text);
  await writeProgress(documentId, 40, `Embedder (${chunks.length} chunks)`);
  const embeddings = await embedDocuments(chunks, {
    onBatchProgress: async (done, total) => {
      await writeProgress(
        documentId,
        embedProgressPct(done, total),
        `Embedder ${done}/${total}`,
      );
    },
  });
  if (embeddings.length !== chunks.length) {
    throw new Error(
      `embedding count mismatch (${embeddings.length} vs ${chunks.length})`,
    );
  }

  const rows = chunks.map((chunkTextValue, i) => ({
    document_id: documentId,
    machine_id: machineId,
    ordinal: i,
    page_from: null,
    page_to: null,
    text: chunkTextValue,
    embedding: embeddings[i],
    embedding_model: VOYAGE_MODEL,
  }));

  await writeProgress(documentId, 95, "Inserting chunks");
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { error } = await supabase.from("kb_chunks").insert(slice);
    if (error) {
      throw new Error(
        `kb_chunks insert failed at offset ${i}: ${error.message}`,
      );
    }
  }

  // Figure extraction is best-effort and runs after text chunks are
  // persisted so a failure here can't strand the document in an
  // unsearchable state. The function logs and returns 0 on any error.
  await writeProgress(documentId, 97, "Finder figurer…");
  await attachPdfFigures({
    documentId,
    machineId,
    pdfBuffer: fileBuffer,
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

  await regenerateSuggestedQuestionsSafe(machineId);

  return {
    documentId,
    chunkCount: chunks.length,
    pageCount: extracted.pageCount,
    byteSize,
    storagePath,
    extractionSource: extracted.source,
  };
}

// Races the pipeline against the budget timer and, on any non-timeout
// failure, marks the row failed so the operator sees what happened
// instead of a perpetual "extracting" badge. Storage object stays so
// they can retry via the reprocess button. The timeout path already
// wrote a Danish-language label in withIngestBudget.
async function finalizePdfIngest(
  documentId: string,
  work: Promise<IngestPdfResult>,
): Promise<IngestPdfResult> {
  try {
    return await withIngestBudget(documentId, work);
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

  return finalizePdfIngest(
    documentId,
    runPdfPipeline({
      documentId,
      machineId: input.machineId,
      storagePath,
      fileBuffer: input.fileBuffer,
      byteSize,
    }),
  );
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
// Storage via a signed URL, then calls this to run the pipeline. We
// download the bytes once (for extraction + figure rendering) rather
// than receiving them through the function request body.
export async function ingestPdfFromStorage(
  input: IngestPdfFromStorageInput,
): Promise<IngestPdfResult> {
  const supabase = getSupabaseServerClient();

  await ensureMachineKb(input.machineId, input.accountId);

  const { data: blob, error: dlErr } = await supabase.storage
    .from("kb-documents")
    .download(input.storagePath);
  if (dlErr || !blob) {
    throw new Error(
      `download from Storage failed: ${dlErr?.message ?? "object missing"}`,
    );
  }
  const fileBuffer = Buffer.from(await blob.arrayBuffer());
  const byteSize = fileBuffer.byteLength;

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

  return finalizePdfIngest(
    input.documentId,
    runPdfPipeline({
      documentId: input.documentId,
      machineId: input.machineId,
      storagePath: input.storagePath,
      fileBuffer,
      byteSize,
    }),
  );
}

export type ReprocessPdfResult = {
  documentId: string;
  chunkCount: number;
  pageCount: number;
  extractionSource: PdfExtractionSource;
};

// Re-runs extraction + embedding for an existing document. Downloads
// the original PDF from Storage, wipes its chunks, re-extracts (with
// optional force="ocr" override), re-chunks and re-embeds. The
// kb_documents row stays — only its chunks, page_count, and
// extraction_source are touched.
export async function reprocessPdf(args: {
  documentId: string;
  force?: PdfExtractionForce;
}): Promise<ReprocessPdfResult> {
  const supabase = getSupabaseServerClient();

  const { data: doc, error: docErr } = await supabase
    .from("kb_documents")
    .select("id, machine_id, storage_path")
    .eq("id", args.documentId)
    .maybeSingle();
  if (docErr) throw new Error(`reprocess lookup failed: ${docErr.message}`);
  if (!doc) throw new Error("Document not found");
  const row = doc as {
    id: string;
    machine_id: string;
    storage_path: string | null;
  };
  if (!row.storage_path) {
    throw new Error("Document has no original file in Storage");
  }

  const { data: blob, error: dlErr } = await supabase.storage
    .from("kb-documents")
    .download(row.storage_path);
  if (dlErr || !blob) {
    throw new Error(
      `download from Storage failed: ${dlErr?.message ?? "unknown"}`,
    );
  }
  const buf = Buffer.from(await blob.arrayBuffer());

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

  const work = (async (): Promise<ReprocessPdfResult> => {
    const extracted = await extractPdfText(buf, {
      force: args.force,
      onPhaseStart: async (phase) => {
        if (phase === "claude-ocr") {
          await writeProgress(row.id, 10, "Running OCR (Claude vision)…");
        }
      },
    });

    await supabase
      .from("kb_documents")
      .update({
        status: "embedding",
        progress: 30,
        progress_label: `Chunker (${extracted.pageCount} sider)`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    const chunks = chunkText(extracted.text);
    await writeProgress(
      row.id,
      40,
      `Embedder (${chunks.length} chunks)`,
    );
    const embeddings = await embedDocuments(chunks, {
      onBatchProgress: async (done, total) => {
        await writeProgress(
          row.id,
          embedProgressPct(done, total),
          `Embedder ${done}/${total}`,
        );
      },
    });
    if (embeddings.length !== chunks.length) {
      throw new Error(
        `embedding count mismatch (${embeddings.length} vs ${chunks.length})`,
      );
    }

    const rows = chunks.map((text, i) => ({
      document_id: row.id,
      machine_id: row.machine_id,
      ordinal: i,
      page_from: null,
      page_to: null,
      text,
      embedding: embeddings[i],
      embedding_model: VOYAGE_MODEL,
    }));
    await writeProgress(row.id, 95, "Inserting chunks");
    const BATCH = 50;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const { error } = await supabase.from("kb_chunks").insert(slice);
      if (error) {
        throw new Error(
          `kb_chunks insert failed at offset ${i}: ${error.message}`,
        );
      }
    }

    await writeProgress(row.id, 97, "Finder figurer…");
    await attachPdfFigures({
      documentId: row.id,
      machineId: row.machine_id,
      pdfBuffer: buf,
      pdfStoragePath: row.storage_path!,
    });

    await supabase
      .from("kb_documents")
      .update({
        status: "ready",
        page_count: extracted.pageCount,
        extraction_source: extracted.source,
        progress: null,
        progress_label: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    await regenerateSuggestedQuestionsSafe(row.machine_id);

    return {
      documentId: row.id,
      chunkCount: chunks.length,
      pageCount: extracted.pageCount,
      extractionSource: extracted.source,
    };
  })();

  try {
    return await withIngestBudget(row.id, work);
  } catch (err) {
    if (!(err instanceof IngestTimeoutError)) {
      await supabase
        .from("kb_documents")
        .update({
          status: "failed",
          progress: null,
          progress_label:
            err instanceof Error ? err.message.slice(0, 200) : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }
    throw err;
  }
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
