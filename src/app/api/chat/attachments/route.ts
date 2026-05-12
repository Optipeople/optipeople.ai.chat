// POST /api/chat/attachments — multipart upload of an operator-supplied
// image (HMI photo, alarm screenshot, damaged part, …) that will be
// attached to the next chat turn.
//
// Auth: bearer (Optipeople token) OR QR token. QR sessions are pinned
// to a single machine — the upload row inherits that machine_id, and
// the chat route validates machine match before including the image in
// the user message.
//
// We do NOT require a conversation_id here: operators add attachments
// before sending the first message, so the conversation row may not
// exist yet. The chat route links them in by id and updates
// conversation_id once the conversation exists.

import { randomUUID } from "node:crypto";
import { AuthError, resolveCurrentUser } from "@/lib/auth";
import { readQrTokenFromRequest, resolveQrToken } from "@/lib/qrAuth";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const MAX_BYTES = 10 * 1024 * 1024;

function extFor(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "bin";
}

export async function POST(req: Request) {
  const hasBearer = !!req.headers.get("authorization");
  const qrToken = readQrTokenFromRequest(req, null);

  let uploaderUserId: string;
  let qrMachineId: string | null = null;

  if (hasBearer) {
    try {
      const u = await resolveCurrentUser(req);
      uploaderUserId = u.userId;
    } catch (err) {
      if (err instanceof AuthError) return err.toResponse();
      throw err;
    }
  } else if (qrToken) {
    const session = await resolveQrToken(qrToken);
    if (!session) {
      return Response.json(
        { error: "Invalid or revoked QR token" },
        { status: 401 },
      );
    }
    uploaderUserId = session.userId;
    qrMachineId = session.machineId;
  } else {
    return Response.json(
      { error: "Missing or malformed Authorization header" },
      { status: 401 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json(
      { error: "Expected multipart/form-data" },
      { status: 400 },
    );
  }

  const machineIdRaw = form.get("machineId");
  const file = form.get("file");

  let machineId: string;
  if (qrMachineId) {
    // QR-authenticated uploads are pinned to the QR's machine — ignore
    // whatever the client sent.
    machineId = qrMachineId;
  } else if (typeof machineIdRaw === "string" && machineIdRaw) {
    machineId = machineIdRaw;
  } else {
    return Response.json({ error: "machineId is required" }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return Response.json(
      { error: "file is required (multipart File)" },
      { status: 400 },
    );
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return Response.json(
      {
        error: `Unsupported image type: ${file.type || "(unknown)"} — accept PNG, JPEG, or WebP`,
      },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: `Image too large: ${file.size} bytes (max ${MAX_BYTES})` },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServerClient();
  const attachmentId = randomUUID();
  const storagePath = `${machineId}/${attachmentId}.${extFor(file.type)}`;

  const buf = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await supabase.storage
    .from("chat-attachments")
    .upload(storagePath, buf, {
      contentType: file.type,
      upsert: false,
    });
  if (upErr) {
    console.error("chat attachment upload failed:", upErr);
    return Response.json(
      { error: `Upload failed: ${upErr.message}` },
      { status: 500 },
    );
  }

  const { error: insErr } = await supabase
    .from("conversation_attachments")
    .insert({
      id: attachmentId,
      machine_id: machineId,
      uploader_user_id: uploaderUserId,
      storage_path: storagePath,
      mime_type: file.type,
      byte_size: file.size,
    });
  if (insErr) {
    // Best-effort cleanup so we don't leak orphan objects.
    await supabase.storage.from("chat-attachments").remove([storagePath]);
    console.error("chat attachment row insert failed:", insErr);
    return Response.json(
      { error: `Database error: ${insErr.message}` },
      { status: 500 },
    );
  }

  return Response.json({
    id: attachmentId,
    mimeType: file.type,
    byteSize: file.size,
  });
}
