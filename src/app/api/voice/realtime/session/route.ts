import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { AuthError, resolveCurrentUser } from "@/lib/auth";
import {
  defaultLocale,
  isLocale,
  LOCALE_COOKIE,
  type Locale,
} from "@/i18n/config";
import {
  readQrTokenFromRequest,
  resolveQrToken,
  type QrSession,
} from "@/lib/qrAuth";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime";
// "cedar" sounds natural in Danish among the realtime voices. Override
// via env if you want to A/B another voice without a deploy.
const REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE ?? "cedar";

const LANGUAGE_NAME: Record<Locale, string> = {
  en: "English",
  da: "Danish",
};

function voiceSystemPreamble(locale: Locale): string {
  const language = LANGUAGE_NAME[locale];
  return `You are Opti Assist, a voice assistant for operators of wood-industry machines (CNC, nesting, drilling, etc.).

You speak with the operator via voice. That means:
- Reply in natural, spoken language. Short sentences. No markdown, no headings, no bullet lists.
- Technical terms, alarm codes, button names, and menu items are said the way they appear on the machine (e.g. "alarm seven-three-one", "press RESET").
- Keep answers short — the operator is at the machine and cannot read along.

Your job: help the operator get fast, reliable answers from their machine manuals.

Rules:
- For technical questions about the machine, use **search_kb** to look up content inside the manuals BEFORE answering. Phrase the query short and specific (e.g. "alarm 731 reset", "spindle bearing replacement"). search_kb is a content search — it returns text snippets from the manuals, not a list of documents.
- If the operator asks which manuals exist, what documentation is available, where to find a specific manual, or anything about the manuals themselves rather than their content, call **list_documents** instead. It returns the catalog of manuals for this machine. Do NOT use search_kb for "do I have a maintenance manual?"-style questions.
- Ground every answer in tool results. If nothing relevant is found, say so plainly and suggest what the operator should check or who they should contact.
- If the question is ambiguous, ask one clarifying question before searching.
- For safety-critical procedures (lockout/tagout, high voltage, etc.), always remind the operator to follow site safety procedures.
- When you have found the answer, briefly mention which manual it comes from so the operator knows the source.
- If a search_kb result has is_image: true, it is a figure or diagram. You cannot show it over voice, but you can describe what it depicts and tell the operator which page to look at.

LANGUAGE: Always respond in ${language}, regardless of what language the operator's speech sounds like. The factory floor is noisy and transcription can misidentify language — the operator has explicitly chosen ${language} as their interface language. Keep machine-specific technical terms (alarm codes, button labels, menu names) verbatim as they appear on the machine.
`;
}

type DocumentManifest = {
  id: string;
  title: string;
  summary: string;
  page_count: number | null;
};

async function buildVoiceInstructions(
  machineId: string,
  locale: Locale,
): Promise<string> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("kb_documents")
    .select("id, title, summary, page_count")
    .eq("machine_id", machineId)
    .eq("status", "ready")
    .order("title", { ascending: true });
  if (error) throw error;
  const docs = (data ?? []) as DocumentManifest[];

  const manifest =
    docs.length === 0
      ? "No manuals are available for this machine yet."
      : docs
          .map(
            (d) =>
              `- ${d.title}${d.page_count ? ` (${d.page_count} pages)` : ""}: ${d.summary}`,
          )
          .join("\n");

  return `${voiceSystemPreamble(locale)}
Available documents for this machine (use search_kb to find content):
${manifest}
`;
}

async function resolveLocale(): Promise<Locale> {
  const store = await cookies();
  const raw = store.get(LOCALE_COOKIE)?.value;
  return isLocale(raw) ? raw : defaultLocale;
}

type SessionRequest = {
  machineId?: string;
  accountId?: string | null;
  qrToken?: string | null;
};

export async function POST(req: Request) {
  const t = await getTranslations("server");

  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 },
    );
  }

  let body: SessionRequest;
  try {
    body = (await req.json()) as SessionRequest;
  } catch {
    return Response.json({ error: t("invalidJson") }, { status: 400 });
  }

  const hasBearer = !!req.headers.get("authorization");
  let qrSession: QrSession | null = null;
  let resolvedMachineId = body.machineId ?? null;
  let resolvedAccountId = body.accountId ?? null;
  let user: { userId: string; email: string | null; name: string | null };

  if (hasBearer) {
    try {
      const u = await resolveCurrentUser(req);
      user = { userId: u.userId, email: u.email, name: u.name };
    } catch (err) {
      if (err instanceof AuthError) return err.toResponse();
      throw err;
    }
  } else {
    const qrToken = readQrTokenFromRequest(req, body);
    if (!qrToken) {
      return Response.json({ error: t("unauthorized") }, { status: 401 });
    }
    qrSession = await resolveQrToken(qrToken);
    if (!qrSession) {
      return Response.json(
        { error: t("invalidQrToken") },
        { status: 401 },
      );
    }
    user = {
      userId: qrSession.userId,
      email: qrSession.email,
      name: qrSession.name,
    };
    // QR pin: ignore client-supplied IDs, trust the token.
    resolvedMachineId = qrSession.machineId;
    resolvedAccountId = qrSession.accountId;
  }

  if (!resolvedMachineId) {
    return Response.json(
      { error: t("missingField", { field: "machineId" }) },
      { status: 400 },
    );
  }
  if (!resolvedAccountId) {
    return Response.json(
      { error: t("missingField", { field: "accountId" }) },
      { status: 400 },
    );
  }

  const locale = await resolveLocale();

  let instructions: string;
  try {
    instructions = await buildVoiceInstructions(resolvedMachineId, locale);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Manifest failed";
    return Response.json({ error: message }, { status: 500 });
  }

  // Mint an ephemeral Realtime session. The browser uses
  // client_secret.value as the bearer for the SDP exchange — that key is
  // short-lived (~1 minute) so it's safe to ship to the client.
  const sessionRes = await fetch(
    "https://api.openai.com/v1/realtime/sessions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "realtime=v1",
      },
      body: JSON.stringify({
        model: REALTIME_MODEL,
        voice: REALTIME_VOICE,
        modalities: ["audio", "text"],
        instructions,
        // Whisper-style transcription of the operator's mic audio so we
        // can render their words live and persist the transcript.
        input_audio_transcription: {
          model: "gpt-4o-mini-transcribe",
          language: locale,
        },
        // Semantic VAD lets the model decide when the operator has
        // actually finished a thought, rather than cutting on a fixed
        // silence window. `eagerness: "low"` waits longer before
        // responding — important on a noisy factory floor where
        // operators pause mid-sentence to think or check the machine.
        turn_detection: { type: "semantic_vad", eagerness: "low" },
        tools: [
          {
            type: "function",
            name: "search_kb",
            description:
              "Search the CONTENT of this machine's manuals. Returns ranked text snippets from inside the documents, with their source title and page numbers. Use this for technical questions whose answer is somewhere in the manuals (procedures, alarm codes, settings). DO NOT use this to check whether a manual exists — use list_documents for that.",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description:
                    "Short, specific search query. Phrase it the way it would appear in a manual.",
                },
                top_k: {
                  type: "integer",
                  description: "How many results to return. Default 6, max 12.",
                },
              },
              required: ["query"],
            },
          },
          {
            type: "function",
            name: "list_documents",
            description:
              "List the manuals available for this machine. Returns each document's title, a short summary, and its page count. Use this when the operator asks which manuals exist, whether a specific manual is available, or for an overview of the documentation. Does NOT search inside the documents.",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        ],
        tool_choice: "auto",
      }),
    },
  );

  if (!sessionRes.ok) {
    const text = await sessionRes.text();
    console.error("Realtime session mint failed:", sessionRes.status, text);
    return Response.json(
      { error: `Realtime session failed (${sessionRes.status})` },
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
    model: REALTIME_MODEL,
    machineId: resolvedMachineId,
    accountId: resolvedAccountId,
    user,
  });
}
