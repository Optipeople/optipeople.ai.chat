// Per-machine generic file ingestion.
//
// Handles arbitrary uploads that aren't PDFs or images — proprietary
// machine formats, CSVs, log dumps, .smc2, etc. Behaviour ("store +
// best-effort text"):
//
//   1. The raw bytes are ALWAYS stored in the kb-documents bucket and a
//      kb_documents row (source_type='file') is written, so the file is
//      listed and downloadable in the admin tree. The client uploads
//      those bytes directly to Storage via /api/admin/ingest/sign; we
//      download them back here rather than taking them through the
//      function request body, which Vercel caps at ~4.5 MB.
//   2. We try to extract text (see fileText.ts): plain UTF-8 files are
//      taken as-is; ZIP containers (.zip, Office docs, Omron Sysmac
//      .smc2, …) are unzipped and their member files mined for text. If
//      that yields anything we chunk + embed it so the file participates
//      in chat retrieval, exactly like a PDF. Files we can't turn into
//      text land 'ready' with zero chunks — store-only.
//
// Server-only: uses the service-role Supabase client.

import { extractFileText } from "./fileText";
import {
  chunkText,
  ensureFolderPath,
  ensureMachineKb,
  insertChunkRows,
  markFailedOnError,
  normalizeFolderPath,
  phaseLabel,
  withIngestBudget,
} from "./ingestion";
import { regenerateSuggestedQuestionsSafe } from "./suggestions";
import { getSupabaseServerClient } from "./supabase";
import { embedDocuments, VOYAGE_MODEL } from "./voyage";

export type IngestFileInput = {
  machineId: string;
  accountId: string;
  machineName?: string | null;
  // documentId + storagePath were minted by the /sign endpoint; the
  // client PUT the bytes straight to Storage under that path.
  documentId: string;
  storagePath: string;
  fileName: string;
  summary?: string | null;
  folderPath?: string | null;
  createdBy?: string;
  // ms epoch when the HTTP request arrived; the time budget counts from
  // here. Defaults to now.
  requestStartedAt?: number;
};

export type IngestFileResult = {
  documentId: string;
  // Number of embedded text chunks. 0 means the file was stored but its
  // bytes weren't recognised as text (store-only / not searchable).
  chunkCount: number;
  byteSize: number;
  storagePath: string;
  // Whether the bytes were treated as embeddable text.
  textIngested: boolean;
};

// Storage-based entry point: the bytes are already in the bucket, so we
// download them once for text extraction instead of receiving them
// through the function request body. Wrapped in the same hard time budget
// and failure marking as the PDF pipeline: a ZIP full of text that embeds
// for longer than the platform allows used to be reaped mid-flight and
// sit in 'embedding' forever.
export async function ingestFileFromStorage(
  input: IngestFileInput,
): Promise<IngestFileResult> {
  const supabase = getSupabaseServerClient();
  await ensureMachineKb(input.machineId, input.accountId, input.machineName);

  const { documentId, storagePath } = input;
  // Path validation happens before any row exists so a bad path is a
  // plain 400 rather than a failed document.
  const folderPath = normalizeFolderPath(input.folderPath);

  const { data: blob, error: dlErr } = await supabase.storage
    .from("kb-documents")
    .download(storagePath);
  if (dlErr || !blob) {
    throw new Error(
      `download from Storage failed: ${dlErr?.message ?? "object missing"}`,
    );
  }
  const fileBuffer = Buffer.from(await blob.arrayBuffer());
  const byteSize = fileBuffer.byteLength;
  const title =
    input.fileName.replace(/\.[^.]+$/, "").trim() ||
    input.fileName.trim() ||
    "upload";

  if (folderPath) {
    await ensureFolderPath(input.machineId, folderPath);
  }

  const { error: docErr } = await supabase.from("kb_documents").insert({
    id: documentId,
    machine_id: input.machineId,
    title,
    summary: input.summary?.trim() || title,
    source_type: "file",
    storage_path: storagePath,
    byte_size: byteSize,
    status: "embedding",
    created_by: input.createdBy ?? "admin",
    folder_path: folderPath,
    progress: 20,
    progress_label: phaseLabel("reading_file"),
  });
  if (docErr) throw new Error(`kb_documents insert failed: ${docErr.message}`);

  return markFailedOnError(
    documentId,
    withIngestBudget(documentId, runFilePipeline(input, fileBuffer), {
      startedAt: input.requestStartedAt,
    }),
  );
}

// ---------------------------------------------------------------------------
// Retry from the cron sweep
// ---------------------------------------------------------------------------

// A generic file has no checkpoints: a retry re-runs the whole pipeline on
// the stored bytes. To queue one, set its row to status 'extracting' (a
// state the upload path never leaves a file row in, so it means "retry
// me") with updated_at at least a minute old; the sweep picks it up.
const FILE_RETRY_STALE_MS = 60_000;
// A file pipeline is one download, one extraction and a few embedding
// batches; don't start one with less than this left in the sweep.
const FILE_RETRY_RESERVE_MS = 150_000;

export async function resumeQueuedFiles(opts: {
  deadlineAt: number;
  limit?: number;
}): Promise<{ completed: string[]; failed: string[] }> {
  const supabase = getSupabaseServerClient();
  const result = { completed: [] as string[], failed: [] as string[] };
  const { data, error } = await supabase
    .from("kb_documents")
    .select("id, machine_id, storage_path, title, summary, folder_path")
    .eq("source_type", "file")
    .eq("status", "extracting")
    .not("storage_path", "is", null)
    .lt("updated_at", new Date(Date.now() - FILE_RETRY_STALE_MS).toISOString())
    .order("updated_at", { ascending: true })
    .limit(opts.limit ?? 3);
  if (error) throw new Error(`file retry lookup failed: ${error.message}`);

  for (const row of (data ?? []) as {
    id: string;
    machine_id: string;
    storage_path: string;
    title: string;
    summary: string | null;
    folder_path: string | null;
  }[]) {
    if (Date.now() >= opts.deadlineAt - FILE_RETRY_RESERVE_MS) break;
    try {
      await retryFile(row, opts.deadlineAt + 30_000);
      result.completed.push(row.id);
    } catch (err) {
      result.failed.push(row.id);
      console.warn(
        `file retry of ${row.id} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return result;
}

async function retryFile(
  row: {
    id: string;
    machine_id: string;
    storage_path: string;
    title: string;
    summary: string | null;
    folder_path: string | null;
  },
  hardDeadlineAt: number,
): Promise<void> {
  const supabase = getSupabaseServerClient();
  const startedAt = Date.now();
  // Claim: only one sweep gets to flip extracting -> embedding.
  const { data: claimed } = await supabase
    .from("kb_documents")
    .update({
      status: "embedding",
      progress: 20,
      progress_label: phaseLabel("reading_file"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("status", "extracting")
    .select("id");
  if (!claimed || claimed.length === 0) return;

  const { data: kb } = await supabase
    .from("machine_kb")
    .select("account_id")
    .eq("machine_id", row.machine_id)
    .maybeSingle();

  const work = (async () => {
    const { data: blob, error: dlErr } = await supabase.storage
      .from("kb-documents")
      .download(row.storage_path);
    if (dlErr || !blob) {
      throw new Error(
        `download from Storage failed: ${dlErr?.message ?? "object missing"}`,
      );
    }
    const fileBuffer = Buffer.from(await blob.arrayBuffer());
    // Start clean: a failed earlier attempt may have left partial rows.
    await supabase.from("kb_chunks").delete().eq("document_id", row.id);
    return runFilePipeline(
      {
        machineId: row.machine_id,
        accountId: (kb as { account_id?: string } | null)?.account_id ?? "",
        documentId: row.id,
        storagePath: row.storage_path,
        fileName: row.title,
        summary: row.summary,
        folderPath: row.folder_path,
      },
      fileBuffer,
    );
  })();
  await markFailedOnError(
    row.id,
    withIngestBudget(row.id, work, {
      startedAt,
      hardBudgetMs: Math.max(30_000, hardDeadlineAt - startedAt),
    }),
  );
}

async function runFilePipeline(
  input: IngestFileInput,
  fileBuffer: Buffer,
): Promise<IngestFileResult> {
  const supabase = getSupabaseServerClient();
  const { documentId, storagePath } = input;
  const byteSize = fileBuffer.byteLength;

  try {
    const { text, source } = extractFileText(fileBuffer);

    if (source === "none" || !text) {
      // Store-only: a binary blob we can't turn into text. Land it
      // 'ready' so the operator sees it in the tree as a downloadable
      // attachment.
      await supabase
        .from("kb_documents")
        .update({
          status: "ready",
          progress: null,
          progress_label: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId);
      await regenerateSuggestedQuestionsSafe(input.machineId);
      return {
        documentId,
        chunkCount: 0,
        byteSize,
        storagePath,
        textIngested: false,
      };
    }

    const chunks = chunkText(text);
    await supabase
      .from("kb_documents")
      .update({
        progress: 40,
        progress_label: phaseLabel("embedding", {
          done: 0,
          total: chunks.length,
        }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);
    const embeddings = await embedDocuments(
      chunks.map((c) => c.text),
      { usage: { accountId: input.accountId, machineId: input.machineId } },
    );
    if (embeddings.length !== chunks.length) {
      throw new Error(
        `embedding count mismatch (${embeddings.length} vs ${chunks.length})`,
      );
    }

    // Page provenance stays null for these: the extractors here return a
    // flat text stream with no page structure to carry sentinels.
    const rows = chunks.map((chunk, i) => ({
      document_id: documentId,
      machine_id: input.machineId,
      ordinal: i,
      page_from: chunk.pageFrom,
      page_to: chunk.pageTo,
      text: chunk.text,
      embedding: embeddings[i],
      embedding_model: VOYAGE_MODEL,
    }));

    await insertChunkRows(rows, 0);

    await supabase
      .from("kb_documents")
      .update({
        status: "ready",
        progress: null,
        progress_label: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    await regenerateSuggestedQuestionsSafe(input.machineId);

    return {
      documentId,
      chunkCount: chunks.length,
      byteSize,
      storagePath,
      textIngested: true,
    };
  } catch (err) {
    // Clean up any partial chunks and flag the row so the queue surfaces
    // the failure instead of a stuck 'embedding' badge. The Storage
    // object stays behind for forensics.
    await supabase.from("kb_chunks").delete().eq("document_id", documentId);
    await supabase
      .from("kb_documents")
      .update({
        status: "failed",
        progress: null,
        progress_label:
          err instanceof Error ? err.message.slice(0, 200) : "Failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);
    throw err;
  }
}
