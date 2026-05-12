import { AuthError, resolveCurrentUser } from "@/lib/auth";
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

const VOICE_SYSTEM_PREAMBLE = `Du er OptiAI, en stemme-assistent for operatører af træindustri-maskiner (CNC, nesting, boring, osv.).

Du taler med operatøren via stemme. Det betyder:
- Svar altid på naturligt, talt dansk. Korte sætninger. Ingen markdown, ingen overskrifter, ingen punktopstillinger.
- Tekniske termer, alarmkoder, knapnavne og menupunkter siges som de står på maskinen (f.eks. "alarm syv-tre-en", "tryk RESET").
- Hold svarene korte — operatøren står ved maskinen og kan ikke læse en lang tekst op.

Din opgave: hjælp operatøren med at få hurtige, pålidelige svar fra deres maskinmanualer.

Regler:
- Brug **search_kb** værktøjet for at finde information i maskinens manualer FØR du svarer på tekniske spørgsmål. Formuler søgningen kort og specifikt.
- Forankr hvert svar i søgeresultaterne. Hvis intet relevant findes, så sig det ligeud og foreslå hvad operatøren skal tjekke eller hvem de skal kontakte.
- Hvis spørgsmålet er tvetydigt, så stil ét opklarende spørgsmål før du søger.
- For sikkerhedskritiske procedurer (lockout/tagout, højspænding, osv.), så mind altid operatøren om at følge stedets sikkerhedsprocedurer.
- Når du har fundet svaret, så nævn kort hvilken manual det kommer fra, så operatøren ved hvor det er fra.
`;

type DocumentManifest = {
  id: string;
  title: string;
  summary: string;
  page_count: number | null;
};

async function buildVoiceInstructions(machineId: string): Promise<string> {
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
      ? "Ingen manualer er tilgængelige for denne maskine endnu."
      : docs
          .map(
            (d) =>
              `- ${d.title}${d.page_count ? ` (${d.page_count} sider)` : ""}: ${d.summary}`,
          )
          .join("\n");

  return `${VOICE_SYSTEM_PREAMBLE}
Tilgængelige dokumenter for denne maskine (brug search_kb til at finde indhold):
${manifest}
`;
}

type SessionRequest = {
  machineId?: string;
  accountId?: string | null;
  qrToken?: string | null;
};

export async function POST(req: Request) {
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
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
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
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    qrSession = await resolveQrToken(qrToken);
    if (!qrSession) {
      return Response.json(
        { error: "Invalid or revoked QR token" },
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
    return Response.json({ error: "machineId is required" }, { status: 400 });
  }
  if (!resolvedAccountId) {
    return Response.json({ error: "accountId is required" }, { status: 400 });
  }

  let instructions: string;
  try {
    instructions = await buildVoiceInstructions(resolvedMachineId);
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
        input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
        turn_detection: { type: "server_vad" },
        tools: [
          {
            type: "function",
            name: "search_kb",
            description:
              "Search this machine's knowledge base (manuals, instructions, alarm references). Returns ranked text snippets with their source document title and page numbers when available. Use this for any technical question before answering.",
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
