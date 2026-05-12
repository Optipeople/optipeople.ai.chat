import OpenAI from "openai";
import { AuthError, resolveCurrentUser } from "@/lib/auth";
import { readQrTokenFromRequest, resolveQrToken } from "@/lib/qrAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });
  }

  const hasBearer = !!req.headers.get("authorization");
  if (hasBearer) {
    try {
      await resolveCurrentUser(req);
    } catch (err) {
      if (err instanceof AuthError) return err.toResponse();
      throw err;
    }
  } else {
    const qrToken = readQrTokenFromRequest(req, null);
    if (!qrToken || !(await resolveQrToken(qrToken))) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const audio = form.get("audio");
  if (!(audio instanceof Blob)) {
    return Response.json({ error: "Missing 'audio' file" }, { status: 400 });
  }
  if (audio.size === 0) {
    return Response.json({ error: "Empty audio" }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) {
    return Response.json({ error: "Audio too large (max 25 MB)" }, { status: 413 });
  }

  // MediaRecorder defaults to audio/webm; Whisper accepts it. Force a
  // filename so the SDK keeps the extension hint in the multipart upload.
  const filename = (audio as File).name || "speech.webm";
  const file = new File([audio], filename, { type: audio.type || "audio/webm" });

  try {
    // gpt-4o-mini-transcribe is much less prone to the "you" / "thank you"
    // hallucination Whisper produces on silent or low-energy audio.
    const result = await openai.audio.transcriptions.create({
      file,
      model: "gpt-4o-mini-transcribe",
      temperature: 0,
    });
    return Response.json({ text: result.text ?? "" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
