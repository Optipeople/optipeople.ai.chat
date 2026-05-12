import { AuthError, resolveCurrentUser } from "@/lib/auth";
import {
  appendAssistantTurn,
  appendToolMessage,
  appendUserMessage,
  createConversation,
} from "@/lib/conversations";
import { readQrTokenFromRequest, resolveQrToken } from "@/lib/qrAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Turn =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      toolCalls?: { name: string; input: unknown }[];
    }
  | {
      role: "tool";
      toolName: string;
      toolInput: unknown;
      toolChunks?: string[];
      contentSummary: string;
    };

type PersistRequest = {
  machineId?: string;
  accountId?: string | null;
  qrToken?: string | null;
  turns?: Turn[];
};

export async function POST(req: Request) {
  let body: PersistRequest;
  try {
    body = (await req.json()) as PersistRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const hasBearer = !!req.headers.get("authorization");
  let user: { userId: string; email: string | null; name: string | null };
  let resolvedMachineId = body.machineId ?? null;
  let resolvedAccountId = body.accountId ?? null;

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
    const session = await resolveQrToken(qrToken);
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    user = {
      userId: session.userId,
      email: session.email,
      name: session.name,
    };
    resolvedMachineId = session.machineId;
    resolvedAccountId = session.accountId;
  }

  if (!resolvedMachineId || !resolvedAccountId) {
    return Response.json(
      { error: "machineId and accountId required" },
      { status: 400 },
    );
  }

  const turns = Array.isArray(body.turns) ? body.turns : [];
  if (turns.length === 0) {
    return Response.json({ ok: true, conversationId: null });
  }

  const conversationId = await createConversation({
    machineId: resolvedMachineId,
    accountId: resolvedAccountId,
    userId: user.userId,
    userEmail: user.email,
    userName: user.name,
    entryMode: "voice",
  });

  // Replay the transcript into the messages table in order. We don't
  // have token usage from the realtime session yet (the API does report
  // it, but plumbing it through the client adds complexity for v1).
  for (const t of turns) {
    try {
      if (t.role === "user") {
        await appendUserMessage(conversationId, t.content);
      } else if (t.role === "assistant") {
        await appendAssistantTurn({
          conversationId,
          content: t.content,
          toolCalls: t.toolCalls ?? [],
        });
      } else if (t.role === "tool") {
        await appendToolMessage({
          conversationId,
          toolName: t.toolName,
          toolInput: t.toolInput,
          toolChunks: t.toolChunks ?? [],
          contentSummary: t.contentSummary,
        });
      }
    } catch (err) {
      console.error("voice persist: turn write failed:", err);
    }
  }

  return Response.json({ ok: true, conversationId });
}
