import Anthropic from "@anthropic-ai/sdk";
import { getTranslations } from "next-intl/server";
import type {
  BetaContentBlockParam as ContentBlockParam,
  BetaImageBlockParam as ImageBlockParam,
  BetaMessage as Message,
  BetaMessageParam as MessageParam,
  BetaTool as Tool,
  BetaToolResultBlockParam as ToolResultBlockParam,
  BetaToolUseBlock as ToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages";
import {
  listEnabledAccountAiRules,
  renderRulesSection,
} from "@/lib/aiRules";
import { AuthError, resolveCurrentUser } from "@/lib/auth";
import {
  appendAssistantTurn,
  appendToolMessage,
  appendUserMessage,
  createConversation,
  validateConversation,
} from "@/lib/conversations";
import { getMcpAccessForAccount, type McpAccess } from "@/lib/mcpConfig";
import {
  readQrTokenFromRequest,
  resolveQrToken,
  type QrSession,
} from "@/lib/qrAuth";
import { getSupabaseServerClient } from "@/lib/supabase";
import { embedQuery, VOYAGE_MODEL } from "@/lib/voyage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-4-6";

// Hard cap on the agentic loop. The model usually finishes in 1–2 tool
// calls; this is a safety net against pathological loops.
const MAX_TOOL_ITERATIONS = 6;

// Transient upstream failures we retry inside the agent loop. The
// SDK's built-in retries don't always cover overloaded_error mid-stream,
// so we wrap each stream call with our own short backoff.
const MAX_STREAM_RETRIES = 2;

function isTransientAnthropicError(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    if (status === 408 || status === 429 || status === 529) return true;
    if (status >= 500 && status < 600) return true;
    const type = (err as { error?: { error?: { type?: string } } }).error
      ?.error?.type;
    if (type === "overloaded_error") return true;
  }
  return false;
}

// Map Anthropic SDK errors to translation keys for the user-facing
// message. Anything we don't recognize falls through to a generic
// "aiError" so we never leak raw JSON payloads to operators.
// "outage" / "overloaded" mean Anthropic itself is unhealthy — we link
// to their status page so operators can see if it's a known incident.
// "rate_limit" is our key's quota, not a global outage, so no link.
type ErrorKind = "outage" | "overloaded" | "rate_limit" | "error";
type ErrorI18nKey =
  | "aiUnavailable"
  | "aiOverloaded"
  | "aiRateLimited"
  | "aiError";

const ANTHROPIC_STATUS_URL = "https://status.anthropic.com";

function classifyAnthropicError(err: unknown): {
  kind: ErrorKind;
  i18nKey: ErrorI18nKey;
  statusUrl?: string;
} {
  if (err instanceof Anthropic.APIConnectionError) {
    return { kind: "outage", i18nKey: "aiUnavailable", statusUrl: ANTHROPIC_STATUS_URL };
  }
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    const type = (err as { error?: { error?: { type?: string } } }).error
      ?.error?.type;
    if (type === "overloaded_error" || status === 529) {
      return { kind: "overloaded", i18nKey: "aiOverloaded", statusUrl: ANTHROPIC_STATUS_URL };
    }
    if (status === 429) return { kind: "rate_limit", i18nKey: "aiRateLimited" };
    if (status >= 500 && status < 600) {
      return { kind: "outage", i18nKey: "aiUnavailable", statusUrl: ANTHROPIC_STATUS_URL };
    }
  }
  return { kind: "error", i18nKey: "aiError" };
}

const SYSTEM_PREAMBLE = `You are Opti Assist, an assistant for operators of industrial machines.

Your job: help operators get fast, reliable answers from their machine manuals so they don't have to dig through hundreds of pages or wait hours for support. Use plain, everyday language — operators stand on the factory floor, not in an office. Keep technical terms, alarm codes, button names and menu items in the language they appear on the machine itself (e.g. **RESET**, **M06**, **Alarm 731**).

Tool & formatting rules:
- Use the **search_kb** tool to find information in the machine's manuals BEFORE answering technical questions. Make the search short and specific — e.g. "alarm 731 reset" or "tool change procedure".
- Ground every answer in the search_kb results. If nothing relevant is found, say so plainly and suggest what the operator should check or who they should contact.
- Use the **list_documents** tool when the operator asks what manuals are available, asks for a link / the PDF / the file itself, asks "where do I find the manual", or wants to browse the knowledge base. The tool returns every operator-visible document for this machine; each one is then rendered automatically as a clickable chip under your reply that opens the original PDF in a new tab. NEVER tell the operator you cannot share links — you can, by calling this tool.
- Be brief and to the point. Operators are at the machine — they want the solution, not a lecture.
- When you cite a source, refer to the document title as it appears in the search result.
- Document hits from **search_kb** and **list_documents** appear automatically as clickable chips below your reply — the operator can tap them to open the PDF at the right page. The chips below are always there as a catalog; on top of that, you can **embed an inline clickable link** directly in your prose when it specifically helps the reader, using this exact form:
  - \`[Operatørmanual](opti:doc/<document_id>)\` — opens the PDF in a new tab.
  - \`[Operatørmanual, side 12](opti:doc/<document_id>?page=12)\` — opens at a specific page.
  The \`<document_id>\` is the \`document_id\` value returned by **search_kb** or **list_documents**. NEVER invent IDs and NEVER paste raw https URLs — the platform's signed URLs expire after a few minutes; only the \`opti:doc/<id>\` form is stable.
- When a **search_kb** result has \`is_image: true\` AND an \`asset_id\`, you can **embed the figure inline** in your reply using this exact form: \`![short alt text](opti:asset/<asset_id>)\`. Place it on its own line, ideally right where you reference the figure in the prose. The operator-side renderer fetches the actual image. Same rules as for documents: only use \`asset_id\` values from tool results, never invent them, never paste raw URLs. If you embed a figure inline you can skip mentioning it again — the chip rail below still renders the same thumbnail for navigation.
- There is also a knowledge drawer (book icon on the right edge of the screen) where the operator can browse every manual for this machine on their own. You may mention it if they ask how to access the documents in general.
- If the question is ambiguous, ask one clarifying question before searching or guessing.
- For safety-critical procedures (lockout/tagout, high voltage, etc.), always remind the operator to follow site safety procedures.

Formatting (answers render as Markdown):
- Start with a one-sentence direct answer. No preambles like "Great question" and no restating of the question.
- Use numbered lists for step-by-step procedures, bullet lists for options or checks.
- Bold important values, part numbers, alarm codes, and button/menu names (e.g. **Alarm 731**, **RESET**, **M06**).
- Use short headings (### Heading) only when the answer has 2+ distinct parts (e.g. "Cause", "Fix", "If it persists"). Skip headings for short answers.
- Use inline \`code\` for parameter names, file paths, and exact values.
- Keep paragraphs to 1–3 lines. Prefer lists over prose for any multi-step content.
- Do NOT write a *Source:* line yourself — source links are appended automatically below your answer when you have used search_kb. You may refer to a manual's title in prose if it helps, but no footer citation.
- Never wrap the entire answer in a code block.
- When a search result has \`is_image: true\`, it is a figure/diagram. Mention briefly in prose what the figure shows ("see the diagram of the tool-change sequence below"). The operator sees the thumbnail automatically below your reply — do NOT try to embed the image yourself.
- The operator may attach photos to their message (HMI panel, alarm screen, damaged part, …). Read them carefully — they are first-hand evidence of what is happening at the machine. Use them to disambiguate (e.g. read the alarm code off the screen) and search the manual based on what you see. If a photo is unclear, ask the operator for a specific detail instead of guessing.

LANGUAGE: Always respond in the same language the user is writing in. Detect the language from the user's latest message and mirror it.
`;

const SEARCH_KB_TOOL: Tool = {
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
};

const LIST_DOCUMENTS_TOOL: Tool = {
  name: "list_documents",
  description:
    "List every operator-visible manual / document for this machine. Use when the operator asks what manuals are available, asks for links to the documents, or wants to browse the knowledge base. Each returned document is automatically rendered as a clickable chip under the assistant reply that opens the original PDF in a new tab — you do not need to paste URLs yourself.",
  input_schema: {
    type: "object",
    properties: {},
  },
};

// Our custom tools live here. Portal data is no longer a custom tool;
// it now comes from the Optipeople MCP server, which Anthropic calls
// directly via the `mcp_servers` connector when the chat's account
// has authorized credentials. See docs/optipeople-data-access.md.
const TOOLS: Tool[] = [SEARCH_KB_TOOL, LIST_DOCUMENTS_TOOL];

// Client wire shape. User messages can include attachmentIds pointing at
// rows in conversation_attachments — we re-sign each one per request so
// the URLs stay valid across the agentic loop.
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  attachmentIds?: string[];
};

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

// Hard cap matching the client-side limit. Attachments beyond this are
// silently dropped to keep the prompt sane.
const MAX_ATTACHMENTS_PER_MESSAGE = 4;
const ATTACHMENT_SIGNED_URL_TTL = 600;

// Resolve attachmentIds → signed-URL image blocks for the user turns
// that have them. Bad/missing/cross-machine refs are skipped silently
// so a stale id in the client doesn't blow up the whole turn.
async function buildConversation(
  messages: ChatMessage[],
  machineId: string,
): Promise<MessageParam[]> {
  const supabase = getSupabaseServerClient();
  const out: MessageParam[] = [];

  // One-shot lookup of every referenced attachment so we don't do a
  // round trip per image. Same machine_id scope as the linking step.
  const ids = Array.from(
    new Set(
      messages
        .filter((m) => m.role === "user" && Array.isArray(m.attachmentIds))
        .flatMap((m) => m.attachmentIds!.slice(0, MAX_ATTACHMENTS_PER_MESSAGE)),
    ),
  );
  type AttRow = {
    id: string;
    storage_path: string;
    mime_type: string;
    machine_id: string;
  };
  const rowsById = new Map<string, AttRow>();
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from("conversation_attachments")
      .select("id, storage_path, mime_type, machine_id")
      .in("id", ids);
    if (error) {
      console.error("attachment lookup failed:", error);
    } else {
      for (const r of (data ?? []) as AttRow[]) {
        if (r.machine_id === machineId) rowsById.set(r.id, r);
      }
    }
  }

  for (const m of messages) {
    if (m.role !== "user") {
      out.push({ role: "assistant", content: m.content });
      continue;
    }
    const refs = (m.attachmentIds ?? []).slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
    if (refs.length === 0) {
      out.push({ role: "user", content: m.content });
      continue;
    }
    const blocks: ContentBlockParam[] = [];
    if (m.content.trim()) {
      blocks.push({ type: "text", text: m.content });
    }
    for (const id of refs) {
      const row = rowsById.get(id);
      if (!row) continue;
      const { data: signed, error: signErr } = await supabase.storage
        .from("chat-attachments")
        .createSignedUrl(row.storage_path, ATTACHMENT_SIGNED_URL_TTL);
      if (signErr || !signed) {
        console.error("attachment signed url failed:", signErr);
        continue;
      }
      const block: ImageBlockParam = {
        type: "image",
        source: { type: "url", url: signed.signedUrl },
      };
      blocks.push(block);
    }
    // If we somehow ended up with zero blocks (e.g. all sign URLs
    // failed and no text), fall back to a placeholder so the API call
    // doesn't reject the message.
    if (blocks.length === 0) {
      out.push({ role: "user", content: m.content || "(no content)" });
    } else {
      out.push({ role: "user", content: blocks });
    }
  }
  return out;
}

type DocumentManifest = {
  id: string;
  title: string;
  summary: string;
  page_count: number | null;
};

async function buildSystemPrompt(
  machineId: string,
  accountId: string,
  hasMcp: boolean,
): Promise<string> {
  const supabase = getSupabaseServerClient();
  // Parallel: doc manifest (per-machine) + machine identity + account-
  // level AI rules. All three are needed before the system prompt can
  // be assembled.
  const [docsRes, machineRes, adminRules] = await Promise.all([
    supabase
      .from("kb_documents")
      .select("id, title, summary, page_count")
      .eq("machine_id", machineId)
      .eq("status", "ready")
      .order("title", { ascending: true }),
    supabase
      .from("machine_kb")
      .select("display_name")
      .eq("machine_id", machineId)
      .maybeSingle(),
    listEnabledAccountAiRules(accountId).catch((err) => {
      // Rules are a "soft" enhancement — if the lookup fails, the
      // locked rule still gets rendered below, so chat keeps working.
      console.error("buildSystemPrompt: listEnabledAccountAiRules failed:", err);
      return [] as Awaited<ReturnType<typeof listEnabledAccountAiRules>>;
    }),
  ]);
  if (docsRes.error) throw docsRes.error;
  const docs = (docsRes.data ?? []) as DocumentManifest[];
  const displayName =
    (machineRes.data as { display_name: string | null } | null)?.display_name ??
    null;

  const manifest =
    docs.length === 0
      ? "No manuals are available for this machine yet."
      : docs
          .map(
            (d) =>
              `- **${d.title}**${d.page_count ? ` (${d.page_count} pages)` : ""}: ${d.summary}`,
          )
          .join("\n");

  // Machine identity block. Tells the model "this whole conversation is
  // about ONE specific machine" so it doesn't fall back to account-wide
  // MCP tools when the operator asks a generic question like "what
  // errors happened today" — the answer is implicitly "on this machine".
  const machineIdentity = `Active machine for this conversation:
- machine_id: ${machineId}
- display_name: ${displayName ?? "(unnamed)"}

Every question the operator asks is about THIS machine unless they explicitly name a different one. Never list other machines or ask the operator which machine they mean — there is only one in scope.`;

  // Only emit MCP guidance when the account actually has MCP connected;
  // otherwise the model would be told about tools it can't see.
  const mcpGuidance = hasMcp
    ? `

Optipeople MCP rules (machine-scoped data — uptime, stops, KPIs, telemetry):
- ALWAYS pass machine_id="${machineId}" to any MCP tool that accepts it (e.g. get_machine_basic_info, get_stop_group_by_day_statistic, get_stops_concluesion_statistic, get_time_distribution_statistic, get_total_uptime_by_date, get_total_working_hours_by_date, get_part_counter_log, get_telemetry_data, get_kpi_report_by_date, etc.). Do NOT call the account-wide variants (e.g. get_machines_basic_info, get_factories_data) for operator questions — they return data for other machines the operator doesn't care about.
- If you genuinely need to resolve a name to an id, use the machine_id above directly; do NOT call get_machine_id or get_machines_basic_info just to find it.
- When the operator asks something open-ended like "what's been going on today" or "any errors", scope the query to machine_id="${machineId}" and today's date. Never ask the operator which machine they mean.`
    : "";

  // Inviolable rules go first so they take primacy over anything that
  // follows. The locked system rule is always rule #1; admin rules are
  // appended below it.
  const rulesSection = renderRulesSection(adminRules);

  return `${rulesSection}

${SYSTEM_PREAMBLE}
${machineIdentity}${mcpGuidance}

Available documents for this machine (use search_kb to find content):
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

// One per image-caption chunk that came back from search_kb. The client
// resolves these to thumbnails via /api/assets/<id>/url so the operator
// sees the diagram next to the answer.
type ImageHit = {
  assetId: string;
  documentId: string;
  documentTitle: string;
  altText: string;
  pageFrom: number | null;
  mimeType: string;
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
  // Image-caption hits — chunks whose asset_id points at a kb_assets
  // row. Surfaced separately so the client can render thumbnails
  // alongside the document chips.
  images: ImageHit[];
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
      images: [],
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
      images: [],
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

  // Look up document titles + each chunk's asset_id in parallel. The
  // RPC doesn't return asset_id (would require a SQL change), so we
  // join it back in here. Cheap — at most topK chunks.
  const docIds = [...new Set(rows.map((r) => r.document_id))];
  const chunkIds = rows.map((r) => r.chunk_id);
  const [docTitles, chunkAssets] = await Promise.all([
    docIds.length > 0
      ? supabase.from("kb_documents").select("id, title").in("id", docIds)
      : Promise.resolve({ data: [] }),
    chunkIds.length > 0
      ? supabase.from("kb_chunks").select("id, asset_id").in("id", chunkIds)
      : Promise.resolve({ data: [] }),
  ]);

  const titleByDoc = new Map<string, string>();
  for (const d of (docTitles.data ?? []) as { id: string; title: string }[]) {
    titleByDoc.set(d.id, d.title);
  }
  const assetByChunk = new Map<string, string>();
  for (const c of (chunkAssets.data ?? []) as {
    id: string;
    asset_id: string | null;
  }[]) {
    if (c.asset_id) assetByChunk.set(c.id, c.asset_id);
  }

  // Pull every involved asset (kb_assets row) so we can build the
  // image-hit list. Same one-shot batch fetch as titles above.
  const assetIds = [...new Set(assetByChunk.values())];
  const assetById = new Map<
    string,
    {
      id: string;
      document_id: string;
      mime_type: string;
      page_from: number | null;
      alt_text: string | null;
      caption: string;
    }
  >();
  if (assetIds.length > 0) {
    const { data: assets } = await supabase
      .from("kb_assets")
      .select("id, document_id, mime_type, page_from, alt_text, caption")
      .in("id", assetIds);
    for (const a of (assets ?? []) as {
      id: string;
      document_id: string;
      mime_type: string;
      page_from: number | null;
      alt_text: string | null;
      caption: string;
    }[]) {
      assetById.set(a.id, a);
    }
  }

  // Best chunk page per doc — keeps the source chip's deep-link
  // pointing at the most relevant page when there are multiple hits in
  // the same document.
  const hitsByDoc = new Map<string, DocHit>();
  const imageHits: ImageHit[] = [];
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
    const assetId = assetByChunk.get(r.chunk_id);
    if (assetId) {
      const asset = assetById.get(assetId);
      if (asset) {
        imageHits.push({
          assetId,
          documentId: r.document_id,
          documentTitle: titleByDoc.get(r.document_id) ?? "(unknown)",
          altText: asset.alt_text ?? asset.caption.slice(0, 80),
          pageFrom: asset.page_from,
          mimeType: asset.mime_type,
          score: r.rrf_score,
        });
      }
    }
  }

  return {
    modelPayload: {
      results: rows.map((r) => {
        const assetId = assetByChunk.get(r.chunk_id);
        const asset = assetId ? assetById.get(assetId) : undefined;
        return {
          document_id: r.document_id,
          title: titleByDoc.get(r.document_id) ?? "(unknown)",
          page_from: r.page_from,
          page_to: r.page_to,
          score: r.rrf_score,
          text: r.text,
          // The model uses these three fields to spot image hits and
          // optionally embed the figure inline in its reply via
          // ![alt](opti:asset/<asset_id>). When it doesn't embed inline,
          // the operator-side UI still renders the thumbnail below.
          is_image: !!asset,
          image_alt: asset?.alt_text ?? null,
          asset_id: assetId ?? null,
        };
      }),
    },
    chunkIds: rows.map((r) => r.chunk_id),
    documents: Array.from(hitsByDoc.values()),
    images: imageHits,
  };
}

// Returns every operator-visible, ready document for this machine, and
// folds each one into the docHits stream so the operator sees clickable
// source chips under the model's reply. Used when the operator asks
// "what manuals do you have" / "give me the link to the manual" — the
// model has no other way to surface a manual that wasn't matched by a
// content search.
async function executeListDocuments(
  machineId: string,
): Promise<ToolExecResult> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("kb_documents")
    .select("id, title, summary, folder_path, source_type, page_count")
    .eq("machine_id", machineId)
    .eq("operator_visible", true)
    .eq("status", "ready")
    .order("folder_path", { ascending: true, nullsFirst: true })
    .order("title", { ascending: true });

  if (error) {
    console.error("list_documents query failed:", error);
    return {
      modelPayload: { error: error.message },
      chunkIds: [],
      documents: [],
      images: [],
    };
  }

  const rows = (data ?? []) as Array<{
    id: string;
    title: string;
    summary: string;
    folder_path: string | null;
    source_type: string;
    page_count: number | null;
  }>;

  // Synthetic high score so list_documents hits sort above per-chunk
  // search_kb hits in the chip rail when both fire in the same turn.
  // (search_kb rrf_score is typically << 1.)
  const SYNTHETIC_SCORE = 1000;
  const documents: DocHit[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    pageFrom: null,
    score: SYNTHETIC_SCORE,
  }));

  return {
    modelPayload: {
      results: rows.map((r) => ({
        document_id: r.id,
        title: r.title,
        summary: r.summary,
        folder_path: r.folder_path,
        source_type: r.source_type,
        page_count: r.page_count,
      })),
      note:
        rows.length === 0
          ? "No operator-visible documents are available for this machine."
          : "Each result is rendered as a clickable chip below your reply that opens the original PDF in a new tab. Reference the titles in prose if helpful; do not paste URLs.",
    },
    chunkIds: [],
    documents,
    images: [],
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
  if (name === "list_documents") {
    return executeListDocuments(machineId);
  }
  return {
    modelPayload: { error: `Unknown tool: ${name}` },
    chunkIds: [],
    documents: [],
    images: [],
  };
}

export async function POST(req: Request) {
  const t = await getTranslations("server");

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
    return Response.json({ error: t("invalidJson") }, { status: 400 });
  }

  const userMessages = body.messages;
  const machineId = body.machineId;
  const accountId = body.accountId ?? null;

  if (!Array.isArray(userMessages) || userMessages.length === 0) {
    return Response.json(
      { error: t("missingField", { field: "messages" }) },
      { status: 400 },
    );
  }

  // Two auth paths. Optipeople bearer takes precedence if present; the
  // QR token (header X-QR-Token or body.qrToken) is the fallback for
  // shop-floor sticker access. Either path resolves to a uniform "who
  // is the operator" shape so the rest of the route doesn't branch.
  const hasBearer = /^Bearer\s/i.test(req.headers.get("authorization") ?? "");
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
        { error: t("invalidQrToken") },
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
      { error: t("missingAuthHeader") },
      { status: 401 },
    );
  }

  // Account ID is required for the conversations row. Operators always
  // have one; reject otherwise so we don't ingest orphan rows.
  if (!resolvedAccountId) {
    return Response.json(
      { error: t("missingField", { field: "accountId" }) },
      { status: 400 },
    );
  }
  if (!resolvedMachineId) {
    return Response.json(
      { error: t("missingField", { field: "machineId" }) },
      { status: 400 },
    );
  }

  console.log(
    `chat: account=${resolvedAccountId} machine=${resolvedMachineId} user=${user.email ?? user.userId} entry=${entryMode} turns=${userMessages.length}`,
  );

  const anthropic = new Anthropic();

  // Look up MCP access for the resolved account. If the account has
  // an authorized config and the token is fresh (or can be refreshed),
  // we'll add the MCP server to the request so Anthropic can call its
  // tools directly. Failures are logged but treated the same as "no
  // MCP available" so chat continues to work with just search_kb.
  let mcpAccess: McpAccess | null = null;
  try {
    mcpAccess = await getMcpAccessForAccount(resolvedAccountId);
  } catch (err) {
    console.error("chat: getMcpAccessForAccount failed:", err);
  }
  if (mcpAccess) {
    console.log(
      `chat: MCP enabled for account=${resolvedAccountId} server=${mcpAccess.serverUrl}`,
    );
  }

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
        const systemPrompt = await buildSystemPrompt(
          resolvedMachineId,
          resolvedAccountId,
          !!mcpAccess,
        );

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
          const text = latestUser.content ?? "";
          if (text.trim() || (latestUser.attachmentIds?.length ?? 0) > 0) {
            await safe("appendUserMessage", () =>
              appendUserMessage(conversationId!, text),
            );
          }
        }

        // Link any attachments referenced by user turns to this
        // conversation. Idempotent — already-linked rows are filtered out
        // by the conversation_id IS NULL clause. Cross-machine refs are
        // rejected to keep QR sessions strictly scoped.
        const allAttachmentIds = Array.from(
          new Set(
            userMessages
              .filter((m) => m.role === "user" && Array.isArray(m.attachmentIds))
              .flatMap((m) => m.attachmentIds!.slice(0, MAX_ATTACHMENTS_PER_MESSAGE)),
          ),
        );
        if (allAttachmentIds.length > 0) {
          await safe("linkAttachments", async () => {
            const supabase = getSupabaseServerClient();
            await supabase
              .from("conversation_attachments")
              .update({ conversation_id: conversationId })
              .in("id", allAttachmentIds)
              .is("conversation_id", null)
              .eq("machine_id", resolvedMachineId);
          });
        }

        // Convert each ChatMessage into a MessageParam the SDK expects.
        // For user messages with attachments we build a content-block
        // array: one text block followed by one image block per
        // attachment. Each image source is a freshly-signed URL — they
        // expire after a few minutes, which is fine for the synchronous
        // request lifetime but means we have to re-sign on every turn
        // (handled here per request).
        let conversation: MessageParam[] = await buildConversation(
          userMessages,
          resolvedMachineId,
        );
        const totalUsage = { input_tokens: 0, output_tokens: 0 };
        let lastStopReason: string | null = null;
        // Accumulate the best hit per document across all search_kb
        // calls in this turn's agentic loop. Streamed back as `sources`
        // so the UI can render clickable chips under the assistant reply.
        const docHits = new Map<string, DocHit>();
        // Same idea but for image-caption chunks — one entry per asset
        // so we don't show the same diagram twice if multiple searches
        // retrieved it.
        const imageHits = new Map<string, ImageHit>();

        for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
          // Retry the stream on overloaded/5xx/connection errors. We
          // only retry if no tokens have streamed yet — once the client
          // has started rendering text we can't cleanly restart.
          let final: Message | null = null;
          for (let attempt = 0; ; attempt++) {
            // When the account has an authorized MCP config, route
            // through the beta endpoint with `mcp_servers`. Anthropic
            // discovers and calls the MCP tools itself; we never see
            // them in `toolUses` below. When no MCP is available we
            // stay on the GA endpoint — same behavior as before.
            // Always go through beta.messages — the API is a superset
            // of GA (so non-MCP requests still behave identically) and
            // it gives us one code path to maintain. mcp_servers is
            // conditionally included only when the account has an
            // authorized config.
            const s = anthropic.beta.messages.stream({
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
              ...(mcpAccess
                ? {
                    // The MCP connector is gated behind a beta opt-in
                    // header; without it the API rejects mcp_servers.
                    // See https://docs.claude.com/en/docs/agents-and-tools/mcp-connector
                    betas: ["mcp-client-2025-04-04"],
                    mcp_servers: [
                      {
                        name: "optipeople",
                        type: "url" as const,
                        url: mcpAccess.serverUrl,
                        authorization_token: mcpAccess.accessToken,
                      },
                    ],
                  }
                : {}),
            });

            let streamed = false;
            s.on("text", (delta) => {
              streamed = true;
              send("delta", { text: delta });
            });
            // Emit tool_use the moment the content block opens — before
            // input JSON streams in and (crucially) before MCP execution
            // completes. The client uses this to start an elapsed timer,
            // so the operator sees motion immediately instead of staring
            // at a frozen label for tens of seconds. `id` lets the client
            // pair the eventual mcp_tool_result with the right step.
            s.on("streamEvent", (event) => {
              if (event.type !== "content_block_start") return;
              const block = event.content_block;
              if (block.type === "tool_use") {
                send("tool_use", { id: block.id, name: block.name });
              } else if (block.type === "mcp_tool_use") {
                send("tool_use", {
                  id: block.id,
                  name: block.name,
                  serverName: block.server_name,
                  source: "mcp" as const,
                });
              }
            });
            // MCP results arrive as their own finalized block. We mirror
            // them as tool_result events so the UI can mark the matching
            // step complete and surface an error icon if Anthropic
            // reported one.
            s.on("contentBlock", (block) => {
              if (block.type === "mcp_tool_result") {
                send("tool_result", {
                  toolUseId: block.tool_use_id,
                  isError: block.is_error ?? false,
                });
              }
            });

            try {
              final = await s.finalMessage();
              break;
            } catch (err) {
              if (
                !streamed &&
                attempt < MAX_STREAM_RETRIES &&
                isTransientAnthropicError(err)
              ) {
                const delay = 600 * 2 ** attempt + Math.floor(Math.random() * 250);
                console.warn(
                  `chat: transient Anthropic error (attempt ${attempt + 1}), retrying in ${delay}ms:`,
                  err instanceof Error ? err.message : err,
                );
                await new Promise((r) => setTimeout(r, delay));
                continue;
              }
              throw err;
            }
          }
          if (!final) throw new Error("stream produced no final message");
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
            // Model is done — no more tools requested. (tool_use SSE
            // events were already emitted via the contentBlock listener
            // above, so the UI already knows what fired this turn.)
            break;
          }

          const toolResults: ToolResultBlockParam[] = await Promise.all(
            toolUses.map(async (tu) => {
              try {
                const exec = await executeTool(
                  tu.name,
                  tu.input,
                  resolvedMachineId,
                );
                for (const d of exec.documents) {
                  const cur = docHits.get(d.id);
                  if (!cur || d.score > cur.score) docHits.set(d.id, d);
                }
                for (const im of exec.images) {
                  const cur = imageHits.get(im.assetId);
                  if (!cur || im.score > cur.score) imageHits.set(im.assetId, im);
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

        if (docHits.size > 0 || imageHits.size > 0) {
          send("sources", {
            sources: Array.from(docHits.values())
              .sort((a, b) => b.score - a.score)
              .map((d) => ({
                id: d.id,
                title: d.title,
                pageFrom: d.pageFrom,
              })),
            // Up to 4 figures — more than that overwhelms the chat
            // layout and the model rarely uses information from beyond
            // the top few hits anyway.
            images: Array.from(imageHits.values())
              .sort((a, b) => b.score - a.score)
              .slice(0, 4)
              .map((im) => ({
                assetId: im.assetId,
                documentId: im.documentId,
                documentTitle: im.documentTitle,
                altText: im.altText,
                pageFrom: im.pageFrom,
                mimeType: im.mimeType,
              })),
          });
        }
        send("done", { stop_reason: lastStopReason, usage: totalUsage });
        controller.close();
      } catch (err) {
        console.error("Chat error:", err);
        // For Anthropic API errors, surface a clean translated message
        // (and a status-page link when it points at an upstream outage)
        // rather than leaking the raw JSON payload to the operator.
        const isAnthropic =
          err instanceof Anthropic.APIError ||
          err instanceof Anthropic.APIConnectionError;
        if (isAnthropic) {
          const c = classifyAnthropicError(err);
          send("error", {
            kind: c.kind,
            title: t(`${c.i18nKey}Title` as never),
            message: t(c.i18nKey as never),
            statusUrl: c.statusUrl,
          });
        } else {
          send("error", {
            kind: "error" as const,
            title: t("aiErrorTitle" as never),
            message: err instanceof Error ? err.message : "Unknown error",
          });
        }
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
