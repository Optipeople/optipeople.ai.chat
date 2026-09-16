// POST /api/voice/usage — meters the browser-side voice sessions.
//
// The Realtime API runs over WebRTC directly between the operator's
// browser and OpenAI. The server mints the ephemeral key and then drops
// out of the loop, so it never sees a token count: those arrive in the
// browser, on the data channel, as the `usage` object on `response.done`
// and on `conversation.item.input_audio_transcription.completed`. This
// endpoint is how they get back into usage_events.
//
// Until it existed, voice was absent from every usage and cost view.
// That mattered: voice is by far the most expensive path in the app. A
// five-minute spoken session costs a multiple of a typed conversation,
// and none of it was showing up.
//
// TRUST MODEL. The token counts are client-reported, so the account is
// never taken from the request body. It is resolved from the QR token or
// the bearer user, and a caller reporting against a machine outside its
// own account is rejected. The worst a hostile client can do is inflate
// its own bill. TOKEN_CAP_PER_REPORT then stops a bug or a hand-rolled
// request from writing an absurd number into what is now an invoicing
// basis. The model name is chosen here, never accepted from the client,
// so nothing can steer a row onto a cheaper price entry.

import { AuthError, resolveCurrentUser } from "@/lib/auth";
import { readQrTokenFromRequest, resolveQrToken } from "@/lib/qrAuth";
import {
  accountIdForMachine,
  recordUsage,
  splitRealtimeUsage,
  type RealtimeUsageLike,
  type UsageOperation,
} from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-side model names per report kind. The realtime one mirrors the
// session route so an env override stays in one conceptual place.
const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime";
const TRANSCRIBE_MODEL =
  process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe";

const KINDS = {
  realtime: { model: () => REALTIME_MODEL, operation: "voice" as const },
  transcription: {
    model: () => TRANSCRIBE_MODEL,
    operation: "transcription" as const,
  },
} satisfies Record<string, { model: () => string; operation: UsageOperation }>;

type ReportKind = keyof typeof KINDS;

// A realtime turn replays the whole conversation, so a single response
// legitimately reports six figures of cached input late in a long
// session. Seven is not reachable inside one session and means something
// is wrong, so it is clamped rather than invoiced.
const TOKEN_CAP_PER_REPORT = 1_000_000;

// A session's worth of turns, generously. Bounds the work one request
// can ask for.
const MAX_REPORTS_PER_REQUEST = 100;

type Report = {
  kind?: unknown;
  usage?: unknown;
  conversationId?: unknown;
};

type Body = {
  machineId?: unknown;
  reports?: unknown;
  qrToken?: unknown;
};

function clamp(n: number): number {
  return Math.min(Math.max(0, Math.round(n)), TOKEN_CAP_PER_REPORT);
}

function isKind(v: unknown): v is ReportKind {
  return typeof v === "string" && v in KINDS;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Resolve who is billed. A QR token pins both ids and the client's
  // machineId is ignored; a bearer session supplies a machine, which is
  // then checked against the machine's real owner.
  let accountId: string | null = null;
  let machineId: string | null = null;

  const qrToken = readQrTokenFromRequest(req, body);
  if (qrToken) {
    const session = await resolveQrToken(qrToken);
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    accountId = session.accountId;
    machineId = session.machineId;
  } else {
    let userAccountId: string | null;
    try {
      userAccountId = (await resolveCurrentUser(req)).accountId;
    } catch (err) {
      if (err instanceof AuthError) return err.toResponse();
      throw err;
    }

    machineId = typeof body.machineId === "string" ? body.machineId : null;
    const machineAccountId = machineId
      ? await accountIdForMachine(machineId)
      : null;

    if (machineId && !machineAccountId) {
      return Response.json({ error: "Unknown machine" }, { status: 404 });
    }
    // Cross-account reporting is the one thing a logged-in user could
    // otherwise do here, so it is refused outright. A super admin has no
    // accountId of their own and is billed to the machine they used.
    if (machineAccountId && userAccountId && machineAccountId !== userAccountId) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    accountId = machineAccountId ?? userAccountId;
  }

  if (!accountId) {
    // Nothing to bill to. Dropping is correct: an unattributable row
    // would land on somebody else's invoice.
    return Response.json({ ok: true, recorded: 0 });
  }

  const reportsRaw = Array.isArray(body.reports) ? body.reports : [];
  if (reportsRaw.length === 0) {
    return Response.json({ ok: true, recorded: 0 });
  }
  if (reportsRaw.length > MAX_REPORTS_PER_REQUEST) {
    return Response.json({ error: "Too many reports" }, { status: 413 });
  }

  let recorded = 0;
  for (const raw of reportsRaw as Report[]) {
    if (!raw || typeof raw !== "object") continue;
    if (!isKind(raw.kind)) continue;
    if (!raw.usage || typeof raw.usage !== "object") continue;

    const { model, operation } = KINDS[raw.kind];
    const slices = splitRealtimeUsage(raw.usage as RealtimeUsageLike);

    for (const slice of slices) {
      // Best-effort, like every other recordUsage call site: metering
      // must never be the reason a voice session reports a failure.
      await recordUsage({
        accountId,
        machineId,
        conversationId:
          typeof raw.conversationId === "string" ? raw.conversationId : null,
        provider: "openai",
        model: `${model()}:${slice.modality}`,
        operation,
        inputTokens: clamp(slice.inputTokens),
        outputTokens: clamp(slice.outputTokens),
        cacheReadTokens: clamp(slice.cacheReadTokens),
      });
      recorded++;
    }
  }

  return Response.json({ ok: true, recorded });
}
