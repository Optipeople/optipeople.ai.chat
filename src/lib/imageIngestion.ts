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
//
//   attachArchiveImages() — called from the generic file pipeline for
//                         Office documents. Each embedded picture is
//                         stored in kb-images and captioned, with an
//                         asset + caption chunk on the parent document.

import { randomUUID } from "node:crypto";
import {
  captionImage,
  extensionForMime,
  extractPdfFigures,
  isSupportedImageMime,
  type ImageMime,
  type PdfFigure,
} from "./imageCaption";
import type { ArchiveImage } from "./fileText";
import {
  ensureFolderPath,
  ensureMachineKb,
  markFailedOnError,
  normalizeFolderPath,
  phaseLabel,
  withIngestBudget,
} from "./ingestion";
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
  // ms epoch when the HTTP request arrived; the time budget counts from
  // here. Defaults to now.
  requestStartedAt?: number;
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

  // Same hard budget + failure marking as the PDF pipeline, so a caption
  // call that hangs flips the row to failed instead of leaving it in
  // 'embedding' until the watchdog notices.
  return markFailedOnError(
    input.documentId,
    withIngestBudget(
      input.documentId,
      runImagePipeline({
        documentId: input.documentId,
        machineId: input.machineId,
        storagePath: input.storagePath,
        mimeType: input.mimeType,
        fileBuffer,
        fileName: input.fileName,
        summary: input.summary,
        folderPath: input.folderPath,
        createdBy: input.createdBy,
      }),
      { startedAt: input.requestStartedAt },
    ),
  );
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
  const title = args.fileName.replace(/\.[^.]+$/, "").trim() || "Image";

  const folderPath = normalizeFolderPath(args.folderPath);
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
    progress_label: phaseLabel("describing_image"),
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
        progress_label: phaseLabel("embedding_caption"),
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
          err instanceof Error ? err.message.slice(0, 200) : "Failed",
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
  // Checked before each write. The ingest pipeline passes one so a figure
  // pass it has abandoned (out of time) or lost ownership of cannot
  // insert rows after the document moved on. Omitted: always write.
  canWrite?: () => Promise<boolean>;
}): Promise<number> {
  const supabase = getSupabaseServerClient();
  const canWrite = args.canWrite ?? (async () => true);

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
  if (!(await canWrite())) return 0;

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
  if (!(await canWrite())) {
    // The asset rows went in while the pass still owned the document.
    // Without caption chunks they are invisible to retrieval, and the
    // next figure pass (or reprocess) wipes them.
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

// ---------------------------------------------------------------------------
// Pictures embedded in Office documents (.docx / .pptx / .xlsx)
// ---------------------------------------------------------------------------

// How many captions run at once. Each is one Sonnet vision call.
const ARCHIVE_CAPTION_CONCURRENCY = 4;

// Storage path of the n-th embedded picture of a generic file document.
// Kept flat under <machineId>/ so deleting a machine (which lists that
// folder non-recursively) also sweeps them.
function archiveImagePath(
  machineId: string,
  documentId: string,
  index: number,
  mime: ImageMime,
): string {
  return `${machineId}/${documentId}-media-${index}.${extensionForMime(mime)}`;
}

// Best-effort, like attachPdfFigures: uploads each embedded picture to
// kb-images, captions it with Claude vision and adds a kb_assets row plus
// a caption chunk on the parent document. A picture that fails is
// skipped; the text of the document never depends on this pass. Stops
// starting new captions once `deadlineAt` (ms epoch) has passed so the
// pipeline stays inside its time budget.
export async function attachArchiveImages(args: {
  documentId: string;
  machineId: string;
  accountId?: string;
  documentTitle: string;
  images: ArchiveImage[];
  deadlineAt?: number;
}): Promise<number> {
  if (args.images.length === 0) return 0;
  const supabase = getSupabaseServerClient();
  const usage = { accountId: args.accountId || undefined, machineId: args.machineId };

  type Done = {
    index: number;
    storagePath: string;
    mime: ImageMime;
    byteSize: number;
    caption: string;
    altText: string;
  };
  const done: (Done | null)[] = new Array(args.images.length).fill(null);

  let next = 0;
  const worker = async () => {
    while (next < args.images.length) {
      if (args.deadlineAt && Date.now() >= args.deadlineAt) return;
      const index = next++;
      const img = args.images[index];
      try {
        const storagePath = archiveImagePath(
          args.machineId,
          args.documentId,
          index,
          img.mime,
        );
        const { error: upErr } = await supabase.storage
          .from("kb-images")
          .upload(storagePath, img.data, { contentType: img.mime, upsert: true });
        if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);
        const { caption, altText } = await captionImage(img.data, img.mime, usage);
        done[index] = {
          index,
          storagePath,
          mime: img.mime,
          byteSize: img.data.byteLength,
          // The document title helps retrieval tie a screenshot to the
          // manual it came from.
          caption: `${args.documentTitle}: ${caption}`,
          altText,
        };
      } catch (err) {
        console.warn(
          `attachArchiveImages: ${img.name} of ${args.documentId} skipped:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(ARCHIVE_CAPTION_CONCURRENCY, args.images.length) },
      worker,
    ),
  );

  const captioned = done.filter((d): d is Done => d !== null);
  if (captioned.length === 0) return 0;

  let embeddings: number[][];
  try {
    embeddings = await embedDocuments(
      captioned.map((d) => d.caption),
      { usage },
    );
  } catch (err) {
    console.warn("attachArchiveImages: embedDocuments failed:", err);
    return 0;
  }
  if (embeddings.length !== captioned.length) {
    console.warn(
      `attachArchiveImages: embedding count mismatch (${embeddings.length} vs ${captioned.length})`,
    );
    return 0;
  }

  const assetRows = captioned.map((d) => ({
    id: randomUUID(),
    document_id: args.documentId,
    machine_id: args.machineId,
    storage_path: d.storagePath,
    storage_bucket: "kb-images" as const,
    mime_type: d.mime,
    byte_size: d.byteSize,
    page_from: null,
    ordinal: d.index,
    caption: d.caption,
    alt_text: d.altText,
  }));
  const { error: assetErr } = await supabase.from("kb_assets").insert(assetRows);
  if (assetErr) {
    console.warn("attachArchiveImages: kb_assets insert failed:", assetErr);
    return 0;
  }

  // After the text chunks in ordinal order, as with PDF figures.
  const ORD_OFFSET = 1_000_000;
  const chunkRows = captioned.map((d, i) => ({
    document_id: args.documentId,
    machine_id: args.machineId,
    asset_id: assetRows[i].id,
    ordinal: ORD_OFFSET + d.index,
    page_from: null,
    page_to: null,
    text: d.caption,
    embedding: embeddings[i],
    embedding_model: VOYAGE_MODEL,
  }));
  const { error: chunkErr } = await supabase.from("kb_chunks").insert(chunkRows);
  if (chunkErr) {
    console.warn("attachArchiveImages: kb_chunks insert failed:", chunkErr);
    // Assets without caption chunks are invisible to retrieval; drop them.
    await supabase
      .from("kb_assets")
      .delete()
      .in("id", assetRows.map((a) => a.id));
    return 0;
  }
  return captioned.length;
}

// Storage paths of the kb-images objects that belong to a document's
// assets but are not the document's own original (that one is removed
// with the document). Today these are the embedded pictures of Office
// files.
export async function listExtraImageObjects(
  documentIds: string[],
): Promise<string[]> {
  if (documentIds.length === 0) return [];
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("kb_assets")
    .select("storage_path")
    .eq("storage_bucket", "kb-images")
    .in("document_id", documentIds)
    .like("storage_path", "%-media-%");
  if (error) {
    console.warn("listExtraImageObjects failed:", error);
    return [];
  }
  return ((data ?? []) as { storage_path: string }[]).map((r) => r.storage_path);
}

// Removes a file document's embedded-picture assets, their caption chunks
// (cascade) and their Storage objects. Used before a retry re-runs the
// pipeline and when the document is deleted.
export async function wipeArchiveImages(documentId: string): Promise<void> {
  const supabase = getSupabaseServerClient();
  const paths = await listExtraImageObjects([documentId]);
  if (paths.length > 0) {
    const { error } = await supabase.storage.from("kb-images").remove(paths);
    if (error) console.warn("wipeArchiveImages storage remove failed:", error);
  }
  const { error } = await supabase
    .from("kb_assets")
    .delete()
    .eq("document_id", documentId)
    .eq("storage_bucket", "kb-images");
  if (error) console.warn("wipeArchiveImages failed:", error);
}
