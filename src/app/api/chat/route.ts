import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  Tool,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { AuthError, resolveCurrentUser } from "@/lib/auth";
import {
  appendAssistantTurn,
  appendToolMessage,
  appendUserMessage,
  createConversation,
  validateConversation,
} from "@/lib/conversations";
import {
  readQrTokenFromRequest,
  resolveQrToken,
  type QrSession,
} from "@/lib/qrAuth";
import { getSupabaseServerClient } from "@/lib/supabase";
import { embedQuery, VOYAGE_MODEL } from "@/lib/voyage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-haiku-4-5-20251001";

// Hard cap on the agentic loop. The model usually finishes in 1–2 tool
// calls; this is a safety net against pathological loops.
const MAX_TOOL_ITERATIONS = 6;

const SYSTEM_PREAMBLE = `Du er OptiAI, en assistent for operatører af træindustri-maskiner (CNC, nesting, boring, osv.).

SPROG: Svar altid på dansk, uanset hvilket sprog manualen eller spørgsmålet er på. Hold tekniske termer, alarmkoder, knapnavne og menupunkter på originalsproget hvis det er sådan de står på maskinen (f.eks. **RESET**, **M06**, **Alarm 731**). Brug naturligt, hverdagsligt dansk — operatørerne står på fabriksgulvet, ikke i et kontor.

Din opgave: Hjælp operatører med at få hurtige, pålidelige svar fra deres maskinmanualer, så de ikke skal lede gennem hundredvis af sider eller vente i timevis på support.

Regler:
- Brug **search_kb** værktøjet for at finde information i maskinens manualer FØR du svarer på tekniske spørgsmål. Formuler søgningen kort og specifikt — f.eks. "alarm 731 reset" eller "værktøjsskift procedure".
- Forankr hvert svar i resultaterne fra search_kb. Hvis intet relevant findes, så sig det ligeud og foreslå hvad operatøren skal tjekke eller hvem de skal kontakte.
- Svar kort og præcist. Operatører står ved maskinen — de vil have løsningen, ikke et foredrag.
- Når du citerer, så nævn dokumentets titel som det fremgår i søgeresultatet.
- Hvis spørgsmålet er tvetydigt, så stil ét opklarende spørgsmål før du søger eller gætter.
- For sikkerhedskritiske procedurer (lockout/tagout, højspænding, osv.), så mind altid operatøren om at følge stedets sikkerhedsprocedurer.

Formatering (svar vises som Markdown):
- Start med ét sætnings direkte svar. Ingen indledning som "Godt spørgsmål" eller gentagelse af spørgsmålet.
- Brug nummererede lister til trinvise procedurer, punktopstillinger til muligheder eller tjek.
- Fremhæv (bold) vigtige værdier, varenumre, alarmkoder og knap-/menunavne (f.eks. **Alarm 731**, **RESET**, **M06**).
- Brug korte overskrifter (### Overskrift) kun når svaret har 2+ adskilte dele (f.eks. "Årsag", "Løsning", "Hvis det fortsætter"). Spring overskrifter over ved korte svar.
- Brug inline \`code\` til parameternavne, filstier og eksakte værdier.
- Hold afsnit på 1–3 linjer. Foretræk lister frem for prosa ved alt flertrins-indhold.
- Skriv IKKE en *Kilde:* linje selv — kildelinks tilføjes automatisk under svaret når du har brugt search_kb. Du kan referere til manualens titel i prosa hvis det hjælper, men ingen footer-citat.
- Pak aldrig hele svaret ind i en code block.
`;

const TOOLS: Tool[] = [
  {
    name: "search_kb",
    description:
      "Search this machine's knowledge base (manuals, instructions, alarm references). Returns ranked snippets with their source document title and page numbers when available. Use this for any technical question before answering.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Short, specific search query. Phrase it the way it would appear in a manual (e.g. 'alarm 731 reset', 'tool change procedure'). May be in any language; the index handles cross-lingual matching.",
        },
        top_k: {
          type: "integer",
          description: "How many results to return. Default 6, max 12.",
          default: 6,
        },
      },
      required: ["query"],
    },
  },
];

type ChatMessage = MessageParam;

type ChatRequest = {
  messages?: ChatMessage[];
  accountId?: string | null;
  machineId?: string | null;
  conversationId?: string | null;
  // Optional QR token. When present and no Optipeople bearer is sent,
  // the request authenticates against the machine_kb.qr_token of the
  // requested machine. Mutually exclusive with the bearer flow at the
  // operator's level — if a bearer is present we ignore the QR token.
  qrToken?: string | null;
};

// Helper: extract plain text from a user MessageParam. The client
// always sends user content as a string, but defensively unpack a
// content-block array too.
function userMessageText(msg: MessageParam): string {
  if (typeof msg.content === "string") return msg.content;
  return msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .filter(Boolean)
    .join("\n");
}

type DocumentManifest = {
  id: string;
  title: string;
  summary: string;
  page_count: number | null;
};

async function buildSystemPrompt(machineId: string): Promise<string> {
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
              `- **${d.title}**${d.page_count ? ` (${d.page_count} sider)` : ""}: ${d.summary}`,
          )
          .join("\n");

  return `${SYSTEM_PREAMBLE}
Tilgængelige dokumenter for denne maskine (brug search_kb til at finde indhold):
${manifest}
`;
}

type DocHit = {
  id: string;
  title: string;
  // Page of the highest-scoring chunk for this doc — used to deep-link
  // the operator-facing source chip via PDF "#page=N".
  pageFrom: number | null;
  score: number;
};

type ToolExecResult = {
  // What goes back to the model as the tool_result content.
  modelPayload: unknown;
  // chunk_ids retrieved (search_kb only) — persisted alongside the
  // tool message so audit views can show which snippets the AI saw.
  chunkIds: string[];
  // Per-document best hit (search_kb only). Accumulated across the
  // agentic loop and streamed to the client as `sources` so the UI can
  // render clickable links to the original PDFs.
  documents: DocHit[];
};

async function executeSearchKb(
  machineId: string,
  input: { query?: unknown; top_k?: unknown },
): Promise<ToolExecResult> {
  if (typeof input.query !== "string" || input.query.trim().length === 0) {
    return {
      modelPayload: { error: "query must be a non-empty string" },
      chunkIds: [],
      documents: [],
    };
  }
  const topK = Math.min(
    Math.max(typeof input.top_k === "number" ? input.top_k : 6, 1),
    12,
  );
  const query = input.query.trim();

  const supabase = getSupabaseServerClient();
  const queryEmbedding = await embedQuery(query);
  const { data, error } = await supabase.rpc("search_kb", {
    p_machine_id: machineId,
    p_query_embedding: queryEmbedding,
    p_query_text: query,
    p_embedding_model: VOYAGE_MODEL,
    p_match_count: topK,
  });
  if (error) {
    console.error("search_kb rpc error:", error);
    return {
      modelPayload: { error: error.message },
      chunkIds: [],
      documents: [],
    };
  }

  const rows = (data ?? []) as Array<{
    chunk_id: string;
    document_id: string;
    ordinal: number;
    page_from: number | null;
    page_to: number | null;
    text: string;
    rrf_score: number;
  }>;

  // Look up document titles so the model can cite them by name.
  const docIds = [...new Set(rows.map((r) => r.document_id))];
  const titleByDoc = new Map<string, string>();
  if (docIds.length > 0) {
    const { data: docs } = await supabase
      .from("kb_documents")
      .select("id, title")
      .in("id", docIds);
    for (const d of (docs ?? []) as { id: string; title: string }[]) {
      titleByDoc.set(d.id, d.title);
    }
  }

  // Best chunk page per doc — keeps the source chip's deep-link
  // pointing at the most relevant page when there are multiple hits in
  // the same document.
  const hitsByDoc = new Map<string, DocHit>();
  for (const r of rows) {
    const cur = hitsByDoc.get(r.document_id);
    if (!cur || r.rrf_score > cur.score) {
      hitsByDoc.set(r.document_id, {
        id: r.document_id,
        title: titleByDoc.get(r.document_id) ?? "(unknown)",
        pageFrom: r.page_from,
        score: r.rrf_score,
      });
    }
  }

  return {
    modelPayload: {
      results: rows.map((r) => ({
        document_id: r.document_id,
        title: titleByDoc.get(r.document_id) ?? "(unknown)",
        page_from: r.page_from,
        page_to: r.page_to,
        score: r.rrf_score,
        text: r.text,
      })),
    },
    chunkIds: rows.map((r) => r.chunk_id),
    documents: Array.from(hitsByDoc.values()),
  };
}

async function executeTool(
  name: string,
  input: unknown,
  machineId: string,
): Promise<ToolExecResult> {
  if (name === "search_kb") {
    return executeSearchKb(machineId, input as Record<string, unknown>);
  }
  return {
    modelPayload: { error: `Unknown tool: ${name}` },
    chunkIds: [],
    documents: [],
  };
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "Server misconfigured: ANTHROPIC_API_KEY missing" },
      { status: 500 },
    );
  }

  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const userMessages = body.messages;
  const machineId = body.machineId;
  const accountId = body.accountId ?? null;

  if (!Array.isArray(userMessages) || userMessages.length === 0) {
    return Response.json(
      { error: "messages must be a non-empty array" },
      { status: 400 },
    );
  }

  // Two auth paths. Optipeople bearer takes precedence if present; the
  // QR token (header X-QR-Token or body.qrToken) is the fallback for
  // shop-floor sticker access. Either path resolves to a uniform "who
  // is the operator" shape so the rest of the route doesn't branch.
  const hasBearer = !!req.headers.get("authorization");
  const qrToken = readQrTokenFromRequest(req, body);

  let user: { userId: string; email: string | null; name: string | null };
  let qrSession: QrSession | null = null;
  let resolvedAccountId = accountId;
  let resolvedMachineId = machineId;
  let entryMode: "qr" | "manual" = "manual";

  if (hasBearer) {
    try {
      const u = await resolveCurrentUser(req);
      user = { userId: u.userId, email: u.email, name: u.name };
    } catch (err) {
      if (err instanceof AuthError) return err.toResponse();
      throw err;
    }
  } else if (qrToken) {
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
    // QR sessions are pinned to a single machine — ignore whatever the
    // client sent and use the machine the token resolves to. Same for
    // accountId; never trust client-supplied IDs over the token.
    resolvedMachineId = qrSession.machineId;
    resolvedAccountId = qrSession.accountId;
    entryMode = "qr";
  } else {
    return Response.json(
      { error: "Missing or malformed Authorization header" },
      { status: 401 },
    );
  }

  // Account ID is required for the conversations row. Operators always
  // have one; reject otherwise so we don't ingest orphan rows.
  if (!resolvedAccountId) {
    return Response.json(
      { error: "accountId is required" },
      { status: 400 },
    );
  }
  if (!resolvedMachineId) {
    return Response.json(
      { error: "machineId is required" },
      { status: 400 },
    );
  }

  console.log(
    `chat: account=${resolvedAccountId} machine=${resolvedMachineId} user=${user.email ?? user.userId} entry=${entryMode} turns=${userMessages.length}`,
  );

  const anthropic = new Anthropic();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      // Audit persistence is best-effort: any failure logs but doesn't
      // break the live chat for the operator.
      async function safe<T>(label: string, fn: () => Promise<T>): Promise<void> {
        try {
          await fn();
        } catch (err) {
          console.error(`audit: ${label} failed:`, err);
        }
      }

      try {
        const systemPrompt = await buildSystemPrompt(resolvedMachineId);

        // Conversation lifecycle: client sends conversationId on
        // follow-ups; we validate it. Otherwise we create a fresh row
        // and stream the id back so the client can include it next time.
        let conversationId: string | null = null;
        if (body.conversationId) {
          const ok = await validateConversation(
            body.conversationId,
            resolvedMachineId,
            user.userId,
          );
          if (ok) conversationId = body.conversationId;
        }
        if (!conversationId) {
          conversationId = await createConversation({
            machineId: resolvedMachineId,
            accountId: resolvedAccountId,
            userId: user.userId,
            userEmail: user.email,
            userName: user.name,
            entryMode,
          });
          send("conversation", { id: conversationId });
        }

        // Persist the latest user turn (the rest of `userMessages` is
        // history we already wrote on previous requests).
        const latestUser = userMessages[userMessages.length - 1];
        if (latestUser?.role === "user") {
          const text = userMessageText(latestUser);
          if (text.trim()) {
            await safe("appendUserMessage", () =>
              appendUserMessage(conversationId!, text),
            );
          }
        }

        let conversation: MessageParam[] = userMessages;
        const totalUsage = { input_tokens: 0, output_tokens: 0 };
        let lastStopReason: string | null = null;
        // Accumulate the best hit per document across all search_kb
        // calls in this turn's agentic loop. Streamed back as `sources`
        // so the UI can render clickable chips under the assistant reply.
        const docHits = new Map<string, DocHit>();

        for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
          const s = anthropic.messages.stream({
            model: MODEL,
            max_tokens: 2048,
            system: [
              {
                type: "text",
                text: systemPrompt,
                cache_control: { type: "ephemeral", ttl: "1h" },
              },
            ],
            tools: TOOLS,
            messages: conversation,
          });

          s.on("text", (delta) => send("delta", { text: delta }));

          const final = await s.finalMessage();
          const usageIn = final.usage.input_tokens ?? 0;
          const usageOut = final.usage.output_tokens ?? 0;
          const cacheHit =
            (final.usage.cache_read_input_tokens ?? 0) > 0;
          totalUsage.input_tokens += usageIn;
          totalUsage.output_tokens += usageOut;
          lastStopReason = final.stop_reason;

          const toolUses = final.content.filter(
            (c): c is ToolUseBlock => c.type === "tool_use",
          );

          // Concatenate assistant text blocks for the audit row.
          const assistantText = final.content
            .map((b) => (b.type === "text" ? b.text : ""))
            .filter(Boolean)
            .join("\n");

          await safe("appendAssistantTurn", () =>
            appendAssistantTurn({
              conversationId: conversationId!,
              content: assistantText,
              toolCalls: toolUses.map((t) => ({
                name: t.name,
                input: t.input,
              })),
              tokensIn: usageIn,
              tokensOut: usageOut,
              cacheHit,
            }),
          );

          if (toolUses.length === 0) {
            // Model is done — no more tools requested.
            break;
          }

          // Show the operator-facing client which tools are firing —
          // useful for "Searching the manuals…" indicators later.
          for (const tu of toolUses) {
            send("tool_use", { name: tu.name, input: tu.input });
          }

          const toolResults: ToolResultBlockParam[] = await Promise.all(
            toolUses.map(async (tu) => {
              try {
                const exec = await executeTool(tu.name, tu.input, resolvedMachineId);
                for (const d of exec.documents) {
                  const cur = docHits.get(d.id);
                  if (!cur || d.score > cur.score) docHits.set(d.id, d);
                }
                const payloadStr = JSON.stringify(exec.modelPayload);
                await safe("appendToolMessage", () =>
                  appendToolMessage({
                    conversationId: conversationId!,
                    toolName: tu.name,
                    toolInput: tu.input,
                    toolChunks: exec.chunkIds,
                    // Truncate the audit copy — full chunk text is
                    // already in kb_chunks via tool_chunks references.
                    contentSummary:
                      payloadStr.length > 4000
                        ? payloadStr.slice(0, 4000) + "…[truncated]"
                        : payloadStr,
                  }),
                );
                return {
                  type: "tool_result" as const,
                  tool_use_id: tu.id,
                  content: payloadStr,
                };
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                await safe("appendToolMessage(error)", () =>
                  appendToolMessage({
                    conversationId: conversationId!,
                    toolName: tu.name,
                    toolInput: tu.input,
                    toolChunks: [],
                    contentSummary: JSON.stringify({ error: msg }),
                  }),
                );
                return {
                  type: "tool_result" as const,
                  tool_use_id: tu.id,
                  is_error: true,
                  content: JSON.stringify({ error: msg }),
                };
              }
            }),
          );

          conversation = [
            ...conversation,
            { role: "assistant", content: final.content },
            { role: "user", content: toolResults },
          ];
        }

        if (docHits.size > 0) {
          send("sources", {
            sources: Array.from(docHits.values())
              .sort((a, b) => b.score - a.score)
              .map((d) => ({
                id: d.id,
                title: d.title,
                pageFrom: d.pageFrom,
              })),
          });
        }
        send("done", { stop_reason: lastStopReason, usage: totalUsage });
        controller.close();
      } catch (err) {
        console.error("Chat error:", err);
        send("error", {
          message: err instanceof Error ? err.message : "Unknown error",
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
