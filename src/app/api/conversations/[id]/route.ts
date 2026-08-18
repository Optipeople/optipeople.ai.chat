// GET /api/conversations/[id] — full transcript of one of the caller's
// own conversations, shaped for the chat client so a historical thread
// can be reopened and continued in place.
//
// Only the caller's own rows are readable (user_id must match, and a QR
// session must also match the machine). The admin drilldown at
// /api/admin/conversations/[id] is the cross-user view and stays
// separate — it exposes token counts, tool inputs and raw chunk text
// that operators have no business seeing.
//
// Storage differs from what the chat renders: the audit tables keep one
// row per agentic-loop step (assistant text, tool calls, tool results),
// while the chat shows one bubble per turn. We merge consecutive
// assistant rows, drop tool plumbing, and fold each turn's retrieved
// chunks back into the source chips that hung under the reply live.

import { AuthError } from "@/lib/auth";
import { resolveOperator } from "@/lib/operatorAuth";
import { getSupabaseServerClient } from "@/lib/supabase";
import type { SourceRef } from "@/components/SourceChips";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type OperatorTranscriptImage = {
  assetId: string;
  documentId: string;
  documentTitle: string;
  altText: string;
  pageFrom: number | null;
  mimeType: string;
};

export type OperatorTranscriptMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  // Photo-only user turn: the operator sent an image with no text. The
  // attachment itself isn't replayed (attachments are stored per
  // conversation, not per message), so the client substitutes a
  // localized placeholder for both display and the resumed prompt.
  photoOnly?: boolean;
  sources?: SourceRef[];
  images?: OperatorTranscriptImage[];
};

export type OperatorConversationResponse = {
  id: string;
  scope: "machine" | "fleet";
  machineId: string | null;
  startedAt: string;
  resolution: string | null;
  messages: OperatorTranscriptMessage[];
};

// Matches the live path, which caps figures at 4 per reply.
const MAX_IMAGES_PER_TURN = 4;

type MessageRow = {
  role: "user" | "assistant" | "tool";
  content: string;
  tool_chunks: string[] | null;
  created_at: string;
};

// A bubble under construction. chunkIds are the chunks retrieved during
// the turn this bubble closes.
type Bubble = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  photoOnly?: boolean;
  chunkIds: string[];
  sources?: SourceRef[];
  images?: OperatorTranscriptImage[];
};

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let operator;
  try {
    operator = await resolveOperator(req);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  const supabase = getSupabaseServerClient();
  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select("id, scope, machine_id, user_id, started_at, resolution")
    .eq("id", id)
    .maybeSingle();
  if (convErr) {
    console.error("operator conversation lookup failed:", convErr);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  const conversation = conv as {
    id: string;
    scope: "machine" | "fleet";
    machine_id: string | null;
    user_id: string;
    started_at: string;
    resolution: string | null;
  } | null;
  // Wrong owner reads as "gone", not "forbidden" — a 403 would confirm
  // the id exists to anyone guessing UUIDs.
  if (!conversation || conversation.user_id !== operator.userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (operator.qrMachineId && conversation.machine_id !== operator.qrMachineId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { data: msgs, error: msgErr } = await supabase
    .from("messages")
    .select("role, content, tool_chunks, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });
  if (msgErr) {
    console.error("operator conversation messages failed:", msgErr);
    return Response.json({ error: "Database error" }, { status: 500 });
  }

  const bubbles = toBubbles((msgs ?? []) as MessageRow[]);
  const isFleet = conversation.scope === "fleet";
  await attachSources(bubbles, isFleet);

  const body: OperatorConversationResponse = {
    id: conversation.id,
    scope: conversation.scope,
    machineId: conversation.machine_id,
    startedAt: conversation.started_at,
    resolution: conversation.resolution,
    messages: bubbles.map((b) => ({
      role: b.role,
      content: b.content,
      createdAt: b.createdAt,
      ...(b.photoOnly ? { photoOnly: true } : {}),
      ...(b.sources && b.sources.length > 0 ? { sources: b.sources } : {}),
      ...(b.images && b.images.length > 0 ? { images: b.images } : {}),
    })),
  };
  return Response.json(body);
}

// Collapse audit rows into chat bubbles. Chunks retrieved by the tool
// rows of a turn are parked until the turn closes, then hung on that
// turn's last assistant bubble — where the live UI drew them.
function toBubbles(rows: MessageRow[]): Bubble[] {
  const out: Bubble[] = [];
  let turnChunks: string[] = [];
  // Where the current turn's assistant bubbles start. Bounds the
  // search below so a turn that retrieved chunks but never produced a
  // reply can't hang its chips on the previous turn's answer.
  let turnStart = 0;

  const closeTurn = () => {
    if (turnChunks.length === 0) return;
    for (let i = out.length - 1; i >= turnStart; i--) {
      if (out[i].role === "assistant") {
        out[i].chunkIds = Array.from(new Set(turnChunks));
        break;
      }
    }
    turnChunks = [];
  };

  for (const m of rows) {
    if (m.role === "tool") {
      if (m.tool_chunks) turnChunks.push(...m.tool_chunks);
      continue;
    }
    if (m.role === "user") {
      closeTurn();
      const text = m.content.trim();
      out.push({
        role: "user",
        content: text,
        createdAt: m.created_at,
        ...(text ? {} : { photoOnly: true }),
        chunkIds: [],
      });
      turnStart = out.length;
      continue;
    }
    const text = m.content.trim();
    // Assistant rows with no text are pure tool-call steps — their
    // chunks already went into turnChunks via the tool rows.
    if (!text) continue;
    const prev = out[out.length - 1];
    if (prev?.role === "assistant") {
      prev.content = `${prev.content}\n\n${text}`;
      continue;
    }
    out.push({
      role: "assistant",
      content: text,
      createdAt: m.created_at,
      chunkIds: [],
    });
  }
  closeTurn();
  return out;
}

// Resolve every bubble's chunk ids into the document chips and figure
// refs the chat renders. One bulk pass across the whole transcript.
async function attachSources(
  bubbles: Bubble[],
  isFleet: boolean,
): Promise<void> {
  const allChunkIds = Array.from(new Set(bubbles.flatMap((b) => b.chunkIds)));
  if (allChunkIds.length === 0) return;

  const supabase = getSupabaseServerClient();
  const { data: chunkRows, error: chunkErr } = await supabase
    .from("kb_chunks")
    .select("id, document_id, page_from, asset_id")
    .in("id", allChunkIds);
  if (chunkErr) {
    // Chips are garnish — a transcript without them still reads fine.
    console.error("operator conversation chunks failed:", chunkErr);
    return;
  }
  const chunks = new Map(
    (
      (chunkRows ?? []) as {
        id: string;
        document_id: string;
        page_from: number | null;
        asset_id: string | null;
      }[]
    ).map((c) => [c.id, c]),
  );
  if (chunks.size === 0) return;

  const docIds = Array.from(
    new Set(Array.from(chunks.values()).map((c) => c.document_id)),
  );
  const assetIds = Array.from(
    new Set(
      Array.from(chunks.values())
        .map((c) => c.asset_id)
        .filter((a): a is string => !!a),
    ),
  );

  const [docResult, assetResult] = await Promise.all([
    supabase.from("kb_documents").select("id, title, machine_id").in("id", docIds),
    assetIds.length > 0
      ? supabase
          .from("kb_assets")
          .select("id, alt_text, caption, page_from, mime_type")
          .in("id", assetIds)
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ]);

  const docs = new Map(
    (
      (docResult.data ?? []) as {
        id: string;
        title: string;
        machine_id: string;
      }[]
    ).map((d) => [d.id, d]),
  );
  const assets = new Map(
    (
      (assetResult.data ?? []) as {
        id: string;
        alt_text: string | null;
        caption: string;
        page_from: number | null;
        mime_type: string;
      }[]
    ).map((a) => [a.id, a]),
  );

  // Fleet chips name the owning machine, exactly as they do live.
  const machineNames = new Map<string, string | null>();
  if (isFleet && docs.size > 0) {
    const machineIds = Array.from(
      new Set(Array.from(docs.values()).map((d) => d.machine_id)),
    );
    const { data: machineRows } = await supabase
      .from("machine_kb")
      .select("machine_id, display_name")
      .in("machine_id", machineIds);
    for (const m of (machineRows ?? []) as {
      machine_id: string;
      display_name: string | null;
    }[]) {
      machineNames.set(m.machine_id, m.display_name);
    }
  }

  for (const bubble of bubbles) {
    if (bubble.chunkIds.length === 0) continue;
    // One chip per document, keeping retrieval order — the live path
    // ranks by RRF score, which isn't recorded per message.
    const sources = new Map<string, SourceRef>();
    const images = new Map<string, OperatorTranscriptImage>();
    for (const chunkId of bubble.chunkIds) {
      const chunk = chunks.get(chunkId);
      if (!chunk) continue;
      const doc = docs.get(chunk.document_id);
      if (!doc) continue;
      if (!sources.has(doc.id)) {
        const machineName = machineNames.get(doc.machine_id);
        sources.set(doc.id, {
          id: doc.id,
          title: doc.title,
          pageFrom: chunk.page_from,
          ...(isFleet && machineName ? { machineName } : {}),
        });
      }
      const asset = chunk.asset_id ? assets.get(chunk.asset_id) : null;
      if (asset && !images.has(asset.id)) {
        images.set(asset.id, {
          assetId: asset.id,
          documentId: doc.id,
          documentTitle: doc.title,
          altText: asset.alt_text ?? asset.caption.slice(0, 80),
          pageFrom: asset.page_from,
          mimeType: asset.mime_type,
        });
      }
    }
    bubble.sources = Array.from(sources.values());
    bubble.images = Array.from(images.values()).slice(0, MAX_IMAGES_PER_TURN);
  }
}
