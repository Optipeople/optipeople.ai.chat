// Per-machine PDF ingestion pipeline.
//
// One PDF in → one Storage object + one kb_documents row + N kb_chunks rows.
// Used by both the ingest CLI (scripts/ingest.ts) and the admin upload
// endpoint coming in iteration 2. machine_kb is upserted on each call so
// the row exists before the document references it.
//
// Server-only: uses the service-role Supabase client.

import { randomUUID } from "node:crypto";
import {
  extractPdfText,
  type PdfExtractionForce,
  type PdfExtractionSource,
} from "./pdfText";
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
// update mid-pipeline shouldn't tank the whole ingest.
async function writeProgress(
  documentId: string,
  pct: number,
  label: string,
): Promise<void> {
  try {
    const supabase = getSupabaseServerClient();
    await supabase
      .from("kb_documents")
      .update({ progress: pct, progress_label: label })
      .eq("id", documentId);
  } catch (err) {
    console.warn("writeProgress failed:", err);
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

export async function ingestPdf(input: IngestPdfInput): Promise<IngestPdfResult> {
  const supabase = getSupabaseServerClient();

  await ensureMachineKb(input.machineId, input.accountId, input.machineName);

  const documentId = randomUUID();
  const storagePath = `${input.machineId}/${documentId}.pdf`;
  const byteSize = input.fileBuffer.byteLength;
  const title = input.fileName.replace(/\.pdf$/i, "");

  const { error: uploadError } = await supabase.storage
    .from("kb-documents")
    .upload(storagePath, input.fileBuffer, {
      contentType: "application/pdf",
      upsert: false,
    });
  if (uploadError) throw new Error(`storage upload failed: ${uploadError.message}`);

  const folderPath =
    typeof input.folderPath === "string" && input.folderPath.trim()
      ? input.folderPath.trim()
      : null;
  if (folderPath) {
    await ensureFolderPath(input.machineId, folderPath);
  }

  // Insert the row up-front with status='extracting' so it shows in the
  // admin queue panel from second one — without this the operator stares
  // at nothing for 30–60s while OCR runs on a heavy PDF. We patch the
  // extraction-source / page-count once we know them.
  const { error: docError } = await supabase.from("kb_documents").insert({
    id: documentId,
    machine_id: input.machineId,
    title,
    summary: input.summary ?? title,
    source_type: "pdf",
    storage_path: storagePath,
    byte_size: byteSize,
    status: "extracting",
    created_by: input.createdBy ?? "cli",
    folder_path: folderPath,
    progress: 5,
    progress_label: "Læser PDF",
  });
  if (docError) throw new Error(`kb_documents insert failed: ${docError.message}`);

  try {
    const extracted = await extractPdfText(input.fileBuffer, {
      onPhaseStart: async (phase) => {
        if (phase === "claude-ocr") {
          await writeProgress(documentId, 10, "Kører OCR (Claude vision)…");
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
      })
      .eq("id", documentId);

    const chunks = chunkText(extracted.text);
    await writeProgress(
      documentId,
      40,
      `Embedder (${chunks.length} chunks)`,
    );
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
      machine_id: input.machineId,
      ordinal: i,
      page_from: null,
      page_to: null,
      text: chunkTextValue,
      embedding: embeddings[i],
      embedding_model: VOYAGE_MODEL,
    }));

    await writeProgress(documentId, 95, "Indsætter chunks");
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
      })
      .eq("id", documentId);

    return {
      documentId,
      chunkCount: chunks.length,
      pageCount: extracted.pageCount,
      byteSize,
      storagePath,
      extractionSource: extracted.source,
    };
  } catch (err) {
    // Mark the row failed so the operator sees what happened instead
    // of a perpetual "extracting" badge. Storage object stays so they
    // can retry via the reprocess button.
    await supabase
      .from("kb_documents")
      .update({
        status: "failed",
        progress: null,
        progress_label:
          err instanceof Error ? err.message.slice(0, 200) : null,
      })
      .eq("id", documentId);
    throw err;
  }
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
      progress_label: "Læser PDF",
    })
    .eq("id", row.id);

  // Drop the old chunks before re-inserting. ON DELETE CASCADE on
  // kb_chunks handles document deletion, but for re-embed we delete
  // explicitly since the document row is being kept.
  const { error: delErr } = await supabase
    .from("kb_chunks")
    .delete()
    .eq("document_id", row.id);
  if (delErr) {
    throw new Error(`wipe old chunks failed: ${delErr.message}`);
  }

  try {
    const extracted = await extractPdfText(buf, {
      force: args.force,
      onPhaseStart: async (phase) => {
        if (phase === "claude-ocr") {
          await writeProgress(row.id, 10, "Kører OCR (Claude vision)…");
        }
      },
    });

    await supabase
      .from("kb_documents")
      .update({
        status: "embedding",
        progress: 30,
        progress_label: `Chunker (${extracted.pageCount} sider)`,
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
    await writeProgress(row.id, 95, "Indsætter chunks");
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
        page_count: extracted.pageCount,
        extraction_source: extracted.source,
        progress: null,
        progress_label: null,
      })
      .eq("id", row.id);

    return {
      documentId: row.id,
      chunkCount: chunks.length,
      pageCount: extracted.pageCount,
      extractionSource: extracted.source,
    };
  } catch (err) {
    await supabase
      .from("kb_documents")
      .update({
        status: "failed",
        progress: null,
        progress_label:
          err instanceof Error ? err.message.slice(0, 200) : null,
      })
      .eq("id", row.id);
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
    .select("id, storage_path")
    .eq("machine_id", machineId);

  if (!oldDocs || oldDocs.length === 0) return 0;

  const paths = oldDocs
    .map((d) => d.storage_path)
    .filter((p): p is string => !!p);
  if (paths.length > 0) {
    await supabase.storage.from("kb-documents").remove(paths);
  }
  const { error } = await supabase
    .from("kb_documents")
    .delete()
    .eq("machine_id", machineId);
  if (error) throw new Error(`reset failed: ${error.message}`);

  return oldDocs.length;
}
