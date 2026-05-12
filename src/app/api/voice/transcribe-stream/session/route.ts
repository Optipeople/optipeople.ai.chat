import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { AuthError, resolveCurrentUser } from "@/lib/auth";
import {
  defaultLocale,
  isLocale,
  LOCALE_COOKIE,
  type Locale,
} from "@/i18n/config";
import { readQrTokenFromRequest, resolveQrToken } from "@/lib/qrAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRANSCRIBE_MODEL =
  process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe";

async function resolveLocale(): Promise<Locale> {
  const store = await cookies();
  const raw = store.get(LOCALE_COOKIE)?.value;
  return isLocale(raw) ? raw : defaultLocale;
}

export async function POST(req: Request) {
  const t = await getTranslations("server");

  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 },
    );
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
      return Response.json({ error: t("unauthorized") }, { status: 401 });
    }
  }

  const locale = await resolveLocale();

  const sessionRes = await fetch(
    "https://api.openai.com/v1/realtime/transcription_sessions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "realtime=v1",
      },
      body: JSON.stringify({
        input_audio_transcription: {
          model: TRANSCRIBE_MODEL,
          language: locale,
        },
        turn_detection: { type: "server_vad" },
      }),
    },
  );

  if (!sessionRes.ok) {
    const text = await sessionRes.text();
    console.error(
      "Realtime transcription session mint failed:",
      sessionRes.status,
      text,
    );
    return Response.json(
      { error: `Transcription session failed (${sessionRes.status})` },
      { status: 502 },
    );
  }

  const sessionData = (await sessionRes.json()) as {
    id: string;
    client_secret: { value: string; expires_at: number };
  };

  return Response.json({
    sessionId: sessionData.id,
    clientSecret: sessionData.client_secret.value,
    expiresAt: sessionData.client_secret.expires_at,
  });
}
