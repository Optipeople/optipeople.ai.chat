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
// through the function request body.
export async function ingestFileFromStorage(
  input: IngestFileInput,
): Promise<IngestFileResult> {
  const supabase = getSupabaseServerClient();
  await ensureMachineKb(input.machineId, input.accountId, input.machineName);

  const { documentId, storagePath } = input;

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
  const title = input.fileName.replace(/\.[^.]+$/, "") || input.fileName;

  const folderPath =
    typeof input.folderPath === "string" && input.folderPath.trim()
      ? input.folderPath.trim()
      : null;
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
    progress_label: "Læser fil",
  });
  if (docErr) throw new Error(`kb_documents insert failed: ${docErr.message}`);

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
    const embeddings = await embedDocuments(chunks);
    if (embeddings.length !== chunks.length) {
      throw new Error(
        `embedding count mismatch (${embeddings.length} vs ${chunks.length})`,
      );
    }

    const rows = chunks.map((chunk, i) => ({
      document_id: documentId,
      machine_id: input.machineId,
      ordinal: i,
      page_from: null,
      page_to: null,
      text: chunk,
      embedding: embeddings[i],
      embedding_model: VOYAGE_MODEL,
    }));

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
          err instanceof Error ? err.message.slice(0, 200) : "Fejlede",
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);
    throw err;
  }
}
