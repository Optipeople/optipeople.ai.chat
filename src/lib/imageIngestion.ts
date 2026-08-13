// Per-machine image ingestion. Two entry points:
//
//   ingestImage(...)    — standalone image upload from the admin UI.
//                         One image → one kb_documents (source_type='image')
//                         → one kb_assets → one kb_chunks row carrying the
//                         Claude-generated caption + its Voyage embedding.
//
//   attachPdfFigures()  — called from ingestPdf after text extraction.
//                         Adds figure assets pointing back at the parent
//                         PDF's storage object (page_from=N) plus their
//                         caption chunks. Skipped silently on failure —
//                         text retrieval must keep working even if the
//                         figure pass blows up.

import { randomUUID } from "node:crypto";
import {
  captionImage,
  extensionForMime,
  extractPdfFigures,
  isSupportedImageMime,
  type ImageMime,
  type PdfFigure,
} from "./imageCaption";
import { ensureFolderPath, ensureMachineKb } from "./ingestion";
import { regenerateSuggestedQuestionsSafe } from "./suggestions";
import { getSupabaseServerClient } from "./supabase";
import { embedDocuments, VOYAGE_MODEL } from "./voyage";

export type IngestImageInput = {
  machineId: string;
  accountId: string;
  machineName?: string | null;
  fileName: string;
  fileBuffer: Buffer;
  mimeType: string;
  summary?: string | null;
  folderPath?: string | null;
  createdBy?: string;
};

export type IngestImageResult = {
  documentId: string;
  assetId: string;
  caption: string;
  altText: string;
  byteSize: number;
  storagePath: string;
};

export async function ingestImage(
  input: IngestImageInput,
): Promise<IngestImageResult> {
  if (!isSupportedImageMime(input.mimeType)) {
    throw new Error(
      `Unsupported image mime: ${input.mimeType} (allowed: image/png, image/jpeg, image/webp)`,
    );
  }

  const supabase = getSupabaseServerClient();
  await ensureMachineKb(input.machineId, input.accountId, input.machineName);

  const documentId = randomUUID();
  const ext = extensionForMime(input.mimeType);
  const storagePath = `${input.machineId}/${documentId}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from("kb-images")
    .upload(storagePath, input.fileBuffer, {
      contentType: input.mimeType,
      upsert: false,
    });
  if (uploadErr) throw new Error(`storage upload failed: ${uploadErr.message}`);

  return runImagePipeline({
    documentId,
    machineId: input.machineId,
    storagePath,
    mimeType: input.mimeType,
    fileBuffer: input.fileBuffer,
    fileName: input.fileName,
    summary: input.summary,
    folderPath: input.folderPath,
    createdBy: input.createdBy,
  });
}

export type IngestImageFromStorageInput = {
  machineId: string;
  accountId: string;
  // documentId + storagePath were minted by the /sign endpoint; the
  // client uploaded the image straight to Storage under that path,
  // bypassing the ~4.5 MB Vercel function body limit.
  documentId: string;
  storagePath: string;
  mimeType: string;
  fileName: string;
  summary?: string | null;
  folderPath?: string | null;
  createdBy?: string;
};

// Storage-based entry point. The admin UI uploads the image directly to
// Storage via a signed URL, then calls this to caption + embed it. We
// download the bytes once (Claude vision needs them) rather than
// receiving them through the function request body.
export async function ingestImageFromStorage(
  input: IngestImageFromStorageInput,
): Promise<IngestImageResult> {
  if (!isSupportedImageMime(input.mimeType)) {
    throw new Error(
      `Unsupported image mime: ${input.mimeType} (allowed: image/png, image/jpeg, image/webp)`,
    );
  }

  const supabase = getSupabaseServerClient();
  await ensureMachineKb(input.machineId, input.accountId);

  const { data: blob, error: dlErr } = await supabase.storage
    .from("kb-images")
    .download(input.storagePath);
  if (dlErr || !blob) {
    throw new Error(
      `download from Storage failed: ${dlErr?.message ?? "object missing"}`,
    );
  }
  const fileBuffer = Buffer.from(await blob.arrayBuffer());

  return runImagePipeline({
    documentId: input.documentId,
    machineId: input.machineId,
    storagePath: input.storagePath,
    mimeType: input.mimeType,
    fileBuffer,
    fileName: input.fileName,
    summary: input.summary,
    folderPath: input.folderPath,
    createdBy: input.createdBy,
  });
}

// Shared after-upload pipeline: insert the doc row, caption with Claude
// vision, embed the caption, write the asset + chunk. Assumes the image
// is already in the kb-images bucket at storagePath.
async function runImagePipeline(args: {
  documentId: string;
  machineId: string;
  storagePath: string;
  mimeType: ImageMime;
  fileBuffer: Buffer;
  fileName: string;
  summary?: string | null;
  folderPath?: string | null;
  createdBy?: string;
}): Promise<IngestImageResult> {
  const supabase = getSupabaseServerClient();
  const { documentId, machineId, storagePath, mimeType, fileBuffer } = args;
  const assetId = randomUUID();
  const byteSize = fileBuffer.byteLength;
  const title = args.fileName.replace(/\.[^.]+$/, "") || "Image";

  const folderPath =
    typeof args.folderPath === "string" && args.folderPath.trim()
      ? args.folderPath.trim()
      : null;
  if (folderPath) {
    await ensureFolderPath(machineId, folderPath);
  }

  // Insert the doc row early so the admin queue panel shows progress
  // while the captioning + embedding pass runs (caption can take a
  // couple of seconds on a busy Anthropic endpoint).
  const { error: docErr } = await supabase.from("kb_documents").insert({
    id: documentId,
    machine_id: machineId,
    title,
    summary: args.summary?.trim() || title,
    source_type: "image",
    storage_path: storagePath,
    byte_size: byteSize,
    status: "embedding",
    created_by: args.createdBy ?? "admin",
    folder_path: folderPath,
    progress: 20,
    progress_label: "Beskriver billede (Claude vision)…",
  });
  if (docErr) throw new Error(`kb_documents insert failed: ${docErr.message}`);

  try {
    const { caption, altText } = await captionImage(fileBuffer, mimeType, {
      machineId,
    });

    await supabase
      .from("kb_documents")
      .update({
        progress: 70,
        progress_label: "Embedder beskrivelse",
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    const { error: assetErr } = await supabase.from("kb_assets").insert({
      id: assetId,
      document_id: documentId,
      machine_id: machineId,
      storage_path: storagePath,
      storage_bucket: "kb-images",
      mime_type: mimeType,
      byte_size: byteSize,
      page_from: null,
      ordinal: 0,
      caption,
      alt_text: altText,
    });
    if (assetErr) throw new Error(`kb_assets insert failed: ${assetErr.message}`);

    const [embedding] = await embedDocuments([caption], {
      usage: { machineId },
    });
    if (!embedding) throw new Error("embedding for caption was empty");

    const { error: chunkErr } = await supabase.from("kb_chunks").insert({
      document_id: documentId,
      machine_id: machineId,
      asset_id: assetId,
      ordinal: 0,
      page_from: null,
      page_to: null,
      text: caption,
      embedding,
      embedding_model: VOYAGE_MODEL,
    });
    if (chunkErr) throw new Error(`kb_chunks insert failed: ${chunkErr.message}`);

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
      assetId,
      caption,
      altText,
      byteSize,
      storagePath,
    };
  } catch (err) {
    // Mark the row failed so the queue panel surfaces it. Leave the
    // Storage object behind for forensics; reset-on-machine will sweep
    // it later. Clean up any partial kb_assets/kb_chunks we managed to
    // insert before the failure — otherwise the doc shows as failed but
    // queries against kb_chunks still hit orphaned rows pointing at an
    // asset whose caption never embedded.
    await supabase.from("kb_chunks").delete().eq("document_id", documentId);
    await supabase.from("kb_assets").delete().eq("document_id", documentId);
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

// Best-effort: extract figures from the freshly-ingested PDF and add
// them as kb_assets + caption chunks on the same kb_documents row. Any
// failure logs and returns 0 — text retrieval over the PDF is the
// load-bearing path and must not be blocked by a flaky figure pass.
export async function attachPdfFigures(args: {
  documentId: string;
  machineId: string;
  pdfBuffer: Buffer;
  pdfStoragePath: string;
}): Promise<number> {
  const supabase = getSupabaseServerClient();

  let figures: PdfFigure[];
  try {
    figures = await extractPdfFigures(args.pdfBuffer, {
      machineId: args.machineId,
    });
  } catch (err) {
    console.warn("attachPdfFigures: extractPdfFigures failed:", err);
    return 0;
  }
  if (figures.length === 0) return 0;

  const assetRows = figures.map((f, i) => ({
    id: randomUUID(),
    document_id: args.documentId,
    machine_id: args.machineId,
    storage_path: args.pdfStoragePath,
    storage_bucket: "kb-documents" as const,
    mime_type: "application/pdf",
    page_from: f.page,
    ordinal: i,
    caption: f.caption,
    alt_text: f.altText,
  }));

  const { error: assetErr } = await supabase.from("kb_assets").insert(assetRows);
  if (assetErr) {
    console.warn("attachPdfFigures: kb_assets insert failed:", assetErr);
    return 0;
  }

  let embeddings: number[][];
  try {
    embeddings = await embedDocuments(
      figures.map((f) => f.caption),
      { usage: { machineId: args.machineId } },
    );
  } catch (err) {
    console.warn("attachPdfFigures: embedDocuments failed:", err);
    return 0;
  }
  if (embeddings.length !== figures.length) {
    console.warn(
      `attachPdfFigures: embedding count mismatch (${embeddings.length} vs ${figures.length})`,
    );
    return 0;
  }

  // Figure chunks live after the text chunks in ordinal order. We don't
  // know the highest existing ordinal cheaply — picking a big offset
  // keeps them sorted-last in admin views without an extra query.
  const ORD_OFFSET = 1_000_000;
  const chunkRows = figures.map((f, i) => ({
    document_id: args.documentId,
    machine_id: args.machineId,
    asset_id: assetRows[i].id,
    ordinal: ORD_OFFSET + i,
    page_from: f.page,
    page_to: f.page,
    text: f.caption,
    embedding: embeddings[i],
    embedding_model: VOYAGE_MODEL,
  }));
  const { error: chunkErr } = await supabase.from("kb_chunks").insert(chunkRows);
  if (chunkErr) {
    console.warn("attachPdfFigures: kb_chunks insert failed:", chunkErr);
    return 0;
  }

  return figures.length;
}

// Wipes the figure assets + their caption chunks for a document. Called
// by reprocessPdf before re-running the figure pass so we don't leave
// stale entries behind. Text chunks (asset_id is null) are unaffected.
export async function wipePdfFigures(documentId: string): Promise<void> {
  const supabase = getSupabaseServerClient();
  // kb_chunks rows cascade away when their kb_assets row drops.
  const { error } = await supabase
    .from("kb_assets")
    .delete()
    .eq("document_id", documentId);
  if (error) {
    console.warn("wipePdfFigures failed:", error);
  }
}
