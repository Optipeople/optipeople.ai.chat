// POST /api/admin/ingest/sign — mint a signed Storage upload URL so the
// admin client can PUT a file directly to Supabase, bypassing Vercel's
// ~4.5 MB function request-body limit (which returns 413 before the
// request ever reaches us). The client uploads to uploadUrl, then calls
// the matching finalize endpoint (/api/admin/ingest, /ingest/image, or
// /ingest/file) with the returned documentId to run the
// extract/caption/embed pipeline against the already-stored object.

import { randomUUID } from "node:crypto";
import {
  assertMachineAccess,
  AuthError,
  requireAdmin,
} from "@/lib/auth";
import { extensionForMime, isSupportedImageMime } from "@/lib/imageCaption";
import { extensionForFile } from "@/lib/storagePaths";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type SignUploadResponse = {
  documentId: string;
  storagePath: string;
  bucket: string;
  // Absolute Supabase Storage URL the client PUTs the file to. The
  // upload token is embedded in the query string; it's scoped to this
  // single object and expires in 2 hours.
  uploadUrl: string;
  token: string;
};

export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  let body: {
    machineId?: unknown;
    kind?: unknown;
    contentType?: unknown;
    fileName?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const machineId = typeof body.machineId === "string" ? body.machineId : "";
  const kind = body.kind;
  const contentType =
    typeof body.contentType === "string" ? body.contentType : "";
  const fileName = typeof body.fileName === "string" ? body.fileName : "";

  if (!machineId) {
    return Response.json({ error: "machineId is required" }, { status: 400 });
  }
  if (kind !== "pdf" && kind !== "image" && kind !== "file") {
    return Response.json(
      { error: "kind must be 'pdf', 'image', or 'file'" },
      { status: 400 },
    );
  }

  try {
    await assertMachineAccess(admin, machineId);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  const documentId = randomUUID();
  let bucket: string;
  let storagePath: string;

  if (kind === "pdf") {
    if (contentType && contentType !== "application/pdf") {
      return Response.json(
        { error: "Only application/pdf files are accepted" },
        { status: 400 },
      );
    }
    bucket = "kb-documents";
    storagePath = `${machineId}/${documentId}.pdf`;
  } else if (kind === "file") {
    // Any content type is allowed here — the bucket's allow-list was
    // dropped so proprietary formats can be stored. The extension comes
    // from the filename via extensionForFile, whose regex only matches
    // trailing [A-Za-z0-9]+, so nothing traversable reaches the path.
    // The finalize endpoint recomputes it the same way rather than
    // trusting the path we return.
    bucket = "kb-documents";
    storagePath = `${machineId}/${documentId}.${extensionForFile(fileName)}`;
  } else {
    if (!isSupportedImageMime(contentType)) {
      return Response.json(
        {
          error: `Unsupported image type: ${contentType || "(unknown)"} — accept PNG, JPEG, or WebP`,
        },
        { status: 400 },
      );
    }
    bucket = "kb-images";
    storagePath = `${machineId}/${documentId}.${extensionForMime(contentType)}`;
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(storagePath);
  if (error || !data) {
    return Response.json(
      { error: `Could not create upload URL: ${error?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  const payload: SignUploadResponse = {
    documentId,
    storagePath,
    bucket,
    uploadUrl: data.signedUrl,
    token: data.token,
  };
  return Response.json(payload);
}
