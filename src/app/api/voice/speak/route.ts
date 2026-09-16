import OpenAI from "openai";
import { AuthError, resolveCurrentUser } from "@/lib/auth";
import { readQrTokenFromRequest, resolveQrToken } from "@/lib/qrAuth";
import { recordUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CHARS = 4000;

const TTS_MODEL = "gpt-4o-mini-tts";

// The speech endpoint streams audio back and reports no usage object, so
// unlike every other metered call in the app these two figures are
// estimated rather than measured. Both are derived from the length of
// the text, and both are documented here because an estimate nobody can
// re-derive is worse than no estimate.
//
//   Input is the text itself, at the usual ~4 characters per token.
//
//   Output is audio. gpt-4o-mini-tts lists at roughly $0.015 per minute
//   of speech against a $12/MTok audio output rate, which puts a minute
//   at ~1,250 tokens. Synthesised speech runs near 14 characters per
//   second, so a minute is ~840 characters, giving ~1.5 audio tokens per
//   character of input text.
//
// The result is small next to a realtime session but not nothing, and
// leaving it at zero was hiding the whole "read it aloud" feature from
// the cost views.
const TTS_CHARS_PER_INPUT_TOKEN = 4;
const TTS_AUDIO_TOKENS_PER_CHAR = 1.5;

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

  // Who to bill. The button that calls this sends only the text, so the
  // attribution comes from the caller's own credentials: a QR sticker
  // names both the machine and its account, a logged-in user names their
  // account. Neither is taken from the body.
  let accountId: string | null = null;
  let machineId: string | null = null;

  const hasBearer = !!req.headers.get("authorization");
  if (hasBearer) {
    try {
      accountId = (await resolveCurrentUser(req)).accountId;
    } catch (err) {
      if (err instanceof AuthError) return err.toResponse();
      throw err;
    }
  } else {
    const qrToken = readQrTokenFromRequest(req, body);
    const session = qrToken ? await resolveQrToken(qrToken) : null;
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    accountId = session.accountId;
    machineId = session.machineId;
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
      model: TTS_MODEL,
      voice: "ash",
      input: text,
      response_format: "mp3",
    });

    // Not awaited: the operator is waiting on audio, and metering is
    // best-effort everywhere else in the app too. Recorded on the way
    // out rather than up front so a failed synthesis bills nothing.
    void recordUsage({
      accountId,
      machineId,
      provider: "openai",
      model: TTS_MODEL,
      operation: "tts",
      inputTokens: Math.ceil(text.length / TTS_CHARS_PER_INPUT_TOKEN),
      outputTokens: Math.ceil(text.length * TTS_AUDIO_TOKENS_PER_CHAR),
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
