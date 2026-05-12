import OpenAI from "openai";
import { AuthError, resolveCurrentUser } from "@/lib/auth";
import { readQrTokenFromRequest, resolveQrToken } from "@/lib/qrAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CHARS = 4000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });
  }

  let body: { text?: unknown; qrToken?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
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
    const qrToken = readQrTokenFromRequest(req, body);
    if (!qrToken || !(await resolveQrToken(qrToken))) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return Response.json({ error: "Missing 'text'" }, { status: 400 });
  }
  if (text.length > MAX_CHARS) {
    return Response.json(
      { error: `Text too long (max ${MAX_CHARS} chars)` },
      { status: 413 },
    );
  }

  try {
    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "ash",
      input: text,
      response_format: "mp3",
    });

    return new Response(speech.body, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Speech synthesis failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
