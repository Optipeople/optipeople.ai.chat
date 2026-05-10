// Per-machine PDF ingestion pipeline.
//
// One PDF in → one Storage object + one kb_documents row + N kb_chunks rows.
// Used by both the ingest CLI (scripts/ingest.ts) and the admin upload
// endpoint coming in iteration 2. machine_kb is upserted on each call so
// the row exists before the document references it.
//
// Server-only: uses the service-role Supabase client.

import { randomUUID } from "node:crypto";
import { extractPdfText, type PdfExtractionSource } from "./pdfText";
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

  const extracted = await extractPdfText(input.fileBuffer);

  const { error: docError } = await supabase.from("kb_documents").insert({
    id: documentId,
    machine_id: input.machineId,
    title,
    summary: input.summary ?? title,
    source_type: "pdf",
    storage_path: storagePath,
    byte_size: byteSize,
    page_count: extracted.pageCount,
    status: "embedding",
    created_by: input.createdBy ?? "cli",
  });
  if (docError) throw new Error(`kb_documents insert failed: ${docError.message}`);

  const chunks = chunkText(extracted.text);
  const embeddings = await embedDocuments(chunks);
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

  // Insert in batches to keep payloads sane.
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { error } = await supabase.from("kb_chunks").insert(slice);
    if (error) {
      throw new Error(`kb_chunks insert failed at offset ${i}: ${error.message}`);
    }
  }

  await supabase
    .from("kb_documents")
    .update({ status: "ready" })
    .eq("id", documentId);

  return {
    documentId,
    chunkCount: chunks.length,
    pageCount: extracted.pageCount,
    byteSize,
    storagePath,
    extractionSource: extracted.source,
  };
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
