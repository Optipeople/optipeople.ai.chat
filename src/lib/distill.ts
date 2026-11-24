// Conversation → knowledge distillation.
//
// Operators leave the chat open on the shop floor, walk away, and never
// answer the "was this solved?" card. Feedback promotion (feedback.ts)
// only captures the few chats where they did, so most of what operators
// tell the assistant about their machine was being lost. Once a
// conversation goes quiet, the distill sweep reads its transcript and
// extracts what is worth keeping: the problem, the cause, what worked,
// facts the operator stated about the machine, and the questions the
// assistant could not answer.
//
// Hybrid publishing, chosen deliberately:
//   - resolution = 'resolved' (the operator confirmed it worked) on a
//     machine conversation is published straight into the KB.
//   - Everything else lands in kb_insights as 'pending' for an admin to
//     approve, edit or reject. The assistant's own answers are not ground
//     truth: the 2026-08-19 wrong-DIP-switch answer would have been
//     "learned" verbatim if unconfirmed chats were auto-published.
//
// Fleet conversations are skipped for now: they span a whole account and
// the KB is per machine, so there is no safe place to file the result.
//
// Operator photos are part of the transcript: each one sits at the
// message it was sent with as its caption ("Photo N"), and the most
// recent ones are also shown to the model as images. The photos the
// learning relies on are kept on the insight (attachment_ids) and, when
// published, become image assets on the KB document, so search_kb can
// surface the photo itself.

import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { ImageBlockParam, TextBlockParam } from "@anthropic-ai/sdk/resources/messages";
import {
  attachmentAsText,
  captionChatAttachments,
  CHAT_ATTACHMENT_BUCKET,
  getAttachmentsByIds,
  groupByMessage,
  listConversationAttachments,
  signAttachments,
  type StoredChatAttachment,
} from "./chatAttachments";
import { publishExperienceDoc } from "./feedback";
import { getSupabaseServerClient } from "./supabase";
import { fromAnthropicUsage, recordUsage, type UsageAttribution } from "./usage";
import { embedDocuments, VOYAGE_MODEL } from "./voyage";

const MODEL = "claude-sonnet-5-5";
const EFFORT = "low" as const;
const MAX_TOKENS = 6000;

// A follow-up after this long is a new problem: the chat route rolls it
// into a fresh conversation, and the sweep treats the old one as over.
export const CONVERSATION_STALE_MS = 4 * 60 * 60 * 1000;
// A conversation the operator ended (feedback answered, or the screen
// reset after 30 idle minutes) still gets this grace period before the
// sweep reads it, in case they carry on typing.
const ENDED_GRACE_MS = 30 * 60 * 1000;
// Keeps one runaway transcript from blowing the prompt. Recent turns
// matter most, so the head is what gets cut.
const MAX_TRANSCRIPT_CHARS = 60_000;
// Failed passes before the sweep gives up on a conversation until its
// next message (the trigger resets the count).
const MAX_ATTEMPTS = 3;

const TITLE_MAX = 80;
const SUMMARY_MAX = 200;

// Photos shown to the model as images: the most recent ones. Older ones
// are still in the transcript as their caption.
const MAX_DISTILL_IMAGES = 8;
// The model fetches the image itself; it only needs the URL for the call.
const DISTILL_IMAGE_URL_TTL = 600;
// Photo caption chunks sort after the document's text chunks
// (kb_chunks is unique on document_id + ordinal), as PDF figures do.
const PHOTO_CHUNK_ORDINAL_OFFSET = 1_000_000;

export type InsightStatus = "pending" | "published" | "rejected" | "nothing";

export type Distillation = {
  worthKeeping: boolean;
  title: string;
  problem: string;
  cause: string;
  solution: string;
  facts: string[];
  openQuestions: string[];
  // "Photo N" numbers the learning relies on, as the model returned
  // them. null when the output held no usable list.
  photoNumbers: number[] | null;
};

type ConversationRow = {
  id: string;
  scope: string;
  machine_id: string | null;
  account_id: string | null;
  resolution: string | null;
  ended_at: string | null;
  last_message_at: string | null;
  distill_attempts: number;
};

type MessageRow = {
  id: string;
  role: string;
  content: string;
  tool_name: string | null;
};

const SYSTEM_PROMPT = `You read a finished support chat between a machine operator and an AI assistant for an industrial machine, and extract knowledge worth keeping for the next operator with the same problem.

What counts as valuable, in order:
1. What the operator says actually happened or worked ("it was the proximity sensor", "resetting the drive fixed it").
2. Facts the operator states about this specific machine, its setup, or its history.
3. A solution the assistant proposed AND the operator confirmed worked.

Rules:
- Never present an assistant suggestion as fact unless the operator confirmed it. If the operator did not confirm, leave "solution" empty or describe it as "suggested, not confirmed".
- Do not copy generic manual content the assistant quoted. The manual is already in the knowledge base.
- "open_questions": questions the assistant could not answer, or answered only from general knowledge because the manual had nothing. These are documentation gaps.
- Set "worth_keeping" to false when the chat holds nothing beyond what the manual already says (a simple lookup, a greeting, a test message, an abandoned first question). Open questions alone still make a chat worth keeping.
- Write in the language the operator used. Keep alarm codes, part names and button labels exactly as written.
- "title": the problem in at most 10 words, as the next operator would phrase it.
- Photos the operator attached appear in the transcript as "[Photo N attached by the operator: description]", and the most recent ones are shown to you as images labelled "Photo N". Treat what they show as something the operator reported. "photo_numbers": the N of every photo that shows something the learning relies on (the fault, the alarm screen, the part, the setting). Leave out photos that add nothing (blurry, accidental, unrelated). Empty when there are no photos.
- Be concise. Each field a few sentences at most.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    worth_keeping: { type: "boolean" },
    title: { type: "string" },
    problem: { type: "string" },
    cause: { type: "string" },
    solution: { type: "string" },
    facts: { type: "array", items: { type: "string" } },
    open_questions: { type: "array", items: { type: "string" } },
    photo_numbers: { type: "array", items: { type: "integer" } },
  },
  required: [
    "worth_keeping",
    "title",
    "problem",
    "cause",
    "solution",
    "facts",
    "open_questions",
    "photo_numbers",
  ],
  additionalProperties: false,
} as const;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

// Photos ride on the user message they were sent with, as their caption,
// so a photo-only turn still shows up. `photoIndex` maps attachment id to
// its 0-based position in the whole conversation ("Photo N" = index + 1).
function buildTranscript(
  rows: MessageRow[],
  photosByMessage: Map<string, StoredChatAttachment[]> = new Map(),
  photoIndex: Map<string, number> = new Map(),
): string {
  const photoText = (list: StoredChatAttachment[] | undefined) =>
    (list ?? []).map((a) => attachmentAsText(a, photoIndex.get(a.id)));
  const lines: string[] = [];
  for (const m of rows) {
    if (m.role === "user") {
      const parts = [...photoText(photosByMessage.get(m.id))];
      if (m.content.trim()) parts.push(m.content.trim());
      if (parts.length > 0) lines.push(`OPERATOR: ${parts.join("\n")}`);
    } else if (m.role === "assistant") {
      if (m.content.trim()) lines.push(`ASSISTANT: ${m.content.trim()}`);
    } else if (m.role === "tool" && m.tool_name) {
      // Only the fact that a lookup ran, not its payload: it tells the
      // model whether an answer came from the manual.
      lines.push(`[assistant searched the knowledge base: ${m.tool_name}]`);
    }
  }
  // Legacy photos the backfill could not tie to a message: no user
  // message followed the upload, so they came last.
  const unplaced = photoText(photosByMessage.get(""));
  if (unplaced.length > 0) lines.push(`OPERATOR: ${unplaced.join("\n")}`);
  const text = lines.join("\n\n");
  return text.length > MAX_TRANSCRIPT_CHARS
    ? `…[earlier turns cut]\n\n${text.slice(text.length - MAX_TRANSCRIPT_CHARS)}`
    : text;
}

function strings(v: unknown): string[] {
  return Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === "string" && !!x.trim())
        .map((x) => x.trim())
    : [];
}

function parseDistillation(text: string): Distillation | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const p = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    return {
      worthKeeping: p.worth_keeping === true,
      title: str(p.title),
      problem: str(p.problem),
      cause: str(p.cause),
      solution: str(p.solution),
      facts: strings(p.facts),
      openQuestions: strings(p.open_questions),
      photoNumbers: Array.isArray(p.photo_numbers)
        ? p.photo_numbers.filter(
            (n): n is number => typeof n === "number" && Number.isInteger(n),
          )
        : null,
    };
  } catch {
    return null;
  }
}

// The KB chunk text. Problem first, because the next operator's query
// resembles the problem, not the answer (same reasoning as feedback.ts).
// Open questions stay out: they are gaps, not knowledge. Photo captions
// go in too, so the learning's text carries what the photos showed even
// where the image itself is not looked at.
export function insightChunkContent(d: {
  problem: string;
  cause: string;
  solution: string;
  facts: string[];
  photoCaptions?: string[];
}): string {
  const parts: string[] = [];
  if (d.problem) parts.push(`Problem:\n${d.problem}`);
  if (d.cause) parts.push(`Årsag:\n${d.cause}`);
  if (d.solution) parts.push(`Løsning:\n${d.solution}`);
  if (d.facts.length > 0) {
    parts.push(`Fakta om maskinen:\n${d.facts.map((f) => `- ${f}`).join("\n")}`);
  }
  const captions = (d.photoCaptions ?? []).filter((c) => c.trim());
  if (captions.length > 0) {
    parts.push(
      `Billeder fra operatøren:\n${captions.map((c) => `- ${c.trim()}`).join("\n")}`,
    );
  }
  return parts.join("\n\n");
}

// The insight's photos, captioned. Captions are normally written when the
// message is saved or by the distiller; an approve can still meet one
// that failed then, so missing ones get another try here. Photos from
// another machine are dropped: the KB document is per machine.
async function loadInsightPhotos(
  attachmentIds: string[],
  machineId: string,
  usage: UsageAttribution,
): Promise<StoredChatAttachment[]> {
  if (attachmentIds.length === 0) return [];
  let photos = await getAttachmentsByIds(attachmentIds);
  if (photos.some((a) => !a.caption)) {
    await captionChatAttachments(
      photos.filter((a) => !a.caption).map((a) => a.id),
      usage,
    );
    photos = await getAttachmentsByIds(attachmentIds);
  }
  return photos.filter((a) => a.machineId === machineId);
}

// One kb_assets row + one caption kb_chunks row per photo on the
// published document, the same shape image ingestion writes, so
// search_kb returns them as image hits. The asset points at the original
// chat-attachments object; nothing is copied, and deleting the document
// (cascade) leaves the conversation's photo alone. Best effort: a failure
// removes what it wrote and leaves the text document in place.
async function attachInsightPhotos(
  documentId: string,
  machineId: string,
  photos: StoredChatAttachment[],
): Promise<void> {
  const captioned = photos.filter(
    (a): a is StoredChatAttachment & { caption: string } => !!a.caption?.trim(),
  );
  if (captioned.length === 0) return;
  const supabase = getSupabaseServerClient();
  const assetRows = captioned.map((a, i) => ({
    id: randomUUID(),
    document_id: documentId,
    machine_id: machineId,
    storage_path: a.storagePath,
    storage_bucket: CHAT_ATTACHMENT_BUCKET,
    mime_type: a.mimeType,
    byte_size: a.byteSize,
    page_from: null,
    ordinal: i,
    caption: a.caption,
    alt_text: a.altText,
  }));
  try {
    const { error: assetErr } = await supabase.from("kb_assets").insert(assetRows);
    if (assetErr) throw new Error(`kb_assets insert failed: ${assetErr.message}`);

    const embeddings = await embedDocuments(
      captioned.map((a) => a.caption),
      { usage: { machineId } },
    );
    if (embeddings.length !== captioned.length) {
      throw new Error(
        `embedding count mismatch (${embeddings.length} vs ${captioned.length})`,
      );
    }
    const { error: chunkErr } = await supabase.from("kb_chunks").insert(
      captioned.map((a, i) => ({
        document_id: documentId,
        machine_id: machineId,
        asset_id: assetRows[i].id,
        ordinal: PHOTO_CHUNK_ORDINAL_OFFSET + i,
        page_from: null,
        page_to: null,
        text: a.caption,
        embedding: embeddings[i],
        embedding_model: VOYAGE_MODEL,
      })),
    );
    if (chunkErr) throw new Error(`kb_chunks insert failed: ${chunkErr.message}`);
  } catch (err) {
    console.warn(
      `publishInsight: photo assets failed for ${documentId}:`,
      err instanceof Error ? err.message : err,
    );
    // Caption chunks go with their assets (cascade).
    await supabase
      .from("kb_assets")
      .delete()
      .eq("document_id", documentId)
      .eq("storage_bucket", CHAT_ATTACHMENT_BUCKET);
  }
}

// Publish an insight's content as an Experience document and link it.
// Replaces whatever the insight (and the conversation's feedback row)
// pointed at before, so the KB holds one document per conversation.
// The insight's photos (kb_insights.attachment_ids) are attached to the
// new document; the old document's photo assets go with it.
export async function publishInsight(args: {
  insightId: string;
  conversationId: string;
  machineId: string;
  title: string;
  problem: string;
  cause: string;
  solution: string;
  facts: string[];
  createdBy: string;
}): Promise<string> {
  const supabase = getSupabaseServerClient();

  const { data: prior } = await supabase
    .from("kb_insights")
    .select("promoted_doc_id, attachment_ids, account_id")
    .eq("id", args.insightId)
    .maybeSingle<{
      promoted_doc_id: string | null;
      attachment_ids: string[] | null;
      account_id: string | null;
    }>();

  let photos: StoredChatAttachment[] = [];
  try {
    photos = await loadInsightPhotos(prior?.attachment_ids ?? [], args.machineId, {
      accountId: prior?.account_id ?? null,
      machineId: args.machineId,
      conversationId: args.conversationId,
    });
  } catch (err) {
    // The learning's text is still worth publishing without its photos.
    console.warn(
      `publishInsight: photo lookup failed for ${args.insightId}:`,
      err instanceof Error ? err.message : err,
    );
  }

  const content = insightChunkContent({
    ...args,
    photoCaptions: photos.map((a) => a.caption ?? ""),
  });
  const documentId = await publishExperienceDoc({
    machineId: args.machineId,
    title: `Operatørerfaring: ${truncate(args.title.replace(/\s+/g, " "), TITLE_MAX)}`,
    summary: truncate(
      (args.solution || args.problem).replace(/\s+/g, " "),
      SUMMARY_MAX,
    ),
    content,
    createdBy: args.createdBy,
  });
  await attachInsightPhotos(documentId, args.machineId, photos);

  const { data: fb } = await supabase
    .from("feedback")
    .select("id, promoted_doc_id")
    .eq("conversation_id", args.conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; promoted_doc_id: string | null }>();

  // The distilled document supersedes the bare solution text that
  // feedback promotion wrote: it carries the same operator words plus the
  // problem and cause around them.
  const superseded = new Set(
    [prior?.promoted_doc_id, fb?.promoted_doc_id].filter(
      (id): id is string => !!id && id !== documentId,
    ),
  );
  if (superseded.size > 0) {
    const { error } = await supabase
      .from("kb_documents")
      .delete()
      .in("id", [...superseded]);
    if (error) console.warn("publishInsight: superseded doc cleanup failed:", error);
  }
  if (fb) {
    await supabase
      .from("feedback")
      .update({ promoted_doc_id: documentId })
      .eq("id", fb.id);
  }

  const { error: linkErr } = await supabase
    .from("kb_insights")
    .update({ promoted_doc_id: documentId, status: "published" })
    .eq("id", args.insightId);
  if (linkErr) console.warn("publishInsight: insight link failed:", linkErr);

  return documentId;
}

// The conversation's photos, oldest first, each with a caption where one
// can be had. The chat route captions on save, best effort; whatever it
// missed is captioned here, since the sweep can wait for it.
async function loadConversationPhotos(
  conversationId: string,
  usage: UsageAttribution,
): Promise<StoredChatAttachment[]> {
  const photos = await listConversationAttachments(conversationId);
  const uncaptioned = photos.filter((a) => !a.caption).map((a) => a.id);
  if (uncaptioned.length === 0) return photos;
  await captionChatAttachments(uncaptioned, usage);
  return listConversationAttachments(conversationId);
}

// The most recent photos as image blocks, each preceded by its "Photo N"
// label so the model can tie it to the transcript. Signed-URL source, as
// in captionChatAttachments: full-size phone photos exceed the base64
// limit. A photo that fails to sign is left to its caption.
async function distillImageBlocks(
  photos: StoredChatAttachment[],
): Promise<Array<TextBlockParam | ImageBlockParam>> {
  const shown = photos
    .map((a, i) => ({ a, n: i + 1 }))
    .slice(-MAX_DISTILL_IMAGES);
  if (shown.length === 0) return [];
  const urls = await signAttachments(
    shown.map((s) => s.a),
    DISTILL_IMAGE_URL_TTL,
  );
  const blocks: Array<TextBlockParam | ImageBlockParam> = [];
  for (const { a, n } of shown) {
    const url = urls.get(a.id);
    if (!url) continue;
    blocks.push({ type: "text", text: `Photo ${n}:` });
    blocks.push({ type: "image", source: { type: "url", url } });
  }
  return blocks;
}

// Attachment ids for the photos the model said the learning relies on.
// An explicit empty list is respected (the photos added nothing); a
// missing list, or one with no valid number, falls back to every photo,
// since losing a relevant photo costs more than keeping an extra one.
function relevantPhotoIds(
  photos: StoredChatAttachment[],
  photoNumbers: number[] | null,
): string[] {
  if (photos.length === 0) return [];
  if (photoNumbers === null) return photos.map((a) => a.id);
  if (photoNumbers.length === 0) return [];
  const picked = [...new Set(photoNumbers)]
    .filter((n) => n >= 1 && n <= photos.length)
    .sort((a, b) => a - b)
    .map((n) => photos[n - 1].id);
  return picked.length > 0 ? picked : photos.map((a) => a.id);
}

// Only stamps when no message arrived since the sweep read the row: the
// trigger nulls distilled_at for a new message, and stamping over that
// would drop the message from distillation.
async function markDistilled(conv: ConversationRow): Promise<void> {
  const supabase = getSupabaseServerClient();
  let q = supabase
    .from("conversations")
    .update({ distilled_at: new Date().toISOString() })
    .eq("id", conv.id);
  if (conv.last_message_at) q = q.lte("last_message_at", conv.last_message_at);
  await q;
}

// Distill one conversation. Never throws for a model or parse failure:
// those leave distilled_at null so the next sweep retries.
export async function distillConversation(
  conv: ConversationRow,
): Promise<InsightStatus | "skipped" | "failed"> {
  const supabase = getSupabaseServerClient();

  if (conv.scope !== "machine" || !conv.machine_id) {
    await markDistilled(conv);
    return "skipped";
  }
  const machineId = conv.machine_id;

  // An admin's verdict outranks a re-distillation: a conversation picked
  // up again after review keeps what the admin decided.
  const { data: existing } = await supabase
    .from("kb_insights")
    .select("id, status, reviewed_at, promoted_doc_id")
    .eq("conversation_id", conv.id)
    .maybeSingle<{
      id: string;
      status: InsightStatus;
      reviewed_at: string | null;
      promoted_doc_id: string | null;
    }>();
  if (existing?.reviewed_at) {
    await markDistilled(conv);
    return "skipped";
  }

  const [{ data: msgs, error: msgErr }, { data: fb }] = await Promise.all([
    supabase
      .from("messages")
      .select("id, role, content, tool_name")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("feedback")
      .select("resolved, solution_text")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ resolved: boolean; solution_text: string | null }>(),
  ]);
  if (msgErr) {
    console.warn(`distill: messages lookup failed for ${conv.id}:`, msgErr);
    return "failed";
  }
  const rows = (msgs ?? []) as MessageRow[];

  // Photos are an enrichment, not a prerequisite: a failed lookup must not
  // burn one of the conversation's MAX_ATTEMPTS, so we log it and distill
  // from the text alone.
  let photos: StoredChatAttachment[] = [];
  let photoLookupFailed = false;
  try {
    photos = await loadConversationPhotos(conv.id, {
      accountId: conv.account_id,
      machineId,
      conversationId: conv.id,
    });
  } catch (err) {
    photoLookupFailed = true;
    console.warn(
      `distill: photo lookup failed for ${conv.id}, distilling text-only:`,
      err instanceof Error ? err.message : err,
    );
  }

  // A photo with no text is still the operator saying something.
  const hasUserText = rows.some((m) => m.role === "user" && m.content.trim());
  const hasUser = photos.length > 0 || hasUserText;
  const hasAnswer = rows.some((m) => m.role === "assistant" && m.content.trim());
  // If the operator only sent photos and we couldn't load them, "nothing to
  // distill" is not a safe conclusion — marking it distilled would lose the
  // conversation for good. Retry instead.
  if (photoLookupFailed && !hasUserText && hasAnswer) return "failed";
  if (!hasUser || !hasAnswer) {
    await markDistilled(conv);
    return "skipped";
  }

  let verdict = "The operator did not say whether the problem was solved.";
  if (fb?.resolved === true) {
    verdict = "The operator marked the problem as SOLVED.";
  } else if (fb?.resolved === false) {
    verdict = "The operator marked the problem as NOT solved.";
  } else if (conv.resolution === "escalated") {
    verdict = "The operator escalated to a human technician.";
  }
  const operatorNote = fb?.solution_text?.trim()
    ? `\n\nThe operator wrote this about what worked (treat as confirmed):\n${fb.solution_text.trim()}`
    : "";

  const photoIndex = new Map(photos.map((a, i) => [a.id, i]));
  const transcript = buildTranscript(rows, groupByMessage(photos), photoIndex);
  const imageBlocks = await distillImageBlocks(photos);

  const anthropic = new Anthropic();
  const prompt = `${verdict}${operatorNote}\n\nTranscript:\n\n${transcript}`;
  const callModel = async (
    images: Array<TextBlockParam | ImageBlockParam>,
  ): Promise<Distillation | null> => {
    const final = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      output_config: {
        effort: EFFORT,
        format: { type: "json_schema", schema: OUTPUT_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [
        { role: "user", content: [...images, { type: "text", text: prompt }] },
      ],
    });
    await recordUsage({
      accountId: conv.account_id,
      machineId,
      conversationId: conv.id,
      provider: "anthropic",
      model: MODEL,
      operation: "conversation_distill",
      ...fromAnthropicUsage(final.usage),
    });
    return parseDistillation(
      final.content.map((b) => (b.type === "text" ? b.text : "")).join(""),
    );
  };

  let distillation: Distillation | null = null;
  try {
    try {
      distillation = await callModel(imageBlocks);
    } catch (err) {
      // An image the API cannot fetch fails the whole call. The captions
      // are in the transcript, so a text-only pass still sees the photos.
      if (imageBlocks.length === 0) throw err;
      console.warn(
        `distill: call with images failed for ${conv.id}, retrying without:`,
        err instanceof Error ? err.message : err,
      );
      distillation = await callModel([]);
    }
  } catch (err) {
    console.warn(
      `distill: model call failed for ${conv.id}:`,
      err instanceof Error ? err.message : err,
    );
    return "failed";
  }
  if (!distillation) {
    console.warn(`distill: unparseable model output for ${conv.id}`);
    return "failed";
  }

  const resolution =
    fb?.resolved === true
      ? "resolved"
      : fb?.resolved === false
        ? "unresolved"
        : (conv.resolution ?? "unknown");
  const autoPublish =
    distillation.worthKeeping &&
    resolution === "resolved" &&
    !!(distillation.solution || distillation.problem);
  const status: InsightStatus = !distillation.worthKeeping
    ? "nothing"
    : autoPublish
      ? "published"
      : "pending";

  // A re-distillation that no longer publishes must take the earlier
  // auto-published document out of the KB, or it stays searchable behind
  // a 'pending' or 'nothing' row.
  if (!autoPublish && existing?.promoted_doc_id) {
    const { error } = await supabase
      .from("kb_documents")
      .delete()
      .eq("id", existing.promoted_doc_id);
    if (error) console.warn(`distill: stale doc cleanup failed for ${conv.id}:`, error);
  }

  const { data: saved, error: saveErr } = await supabase
    .from("kb_insights")
    .upsert(
      {
        conversation_id: conv.id,
        machine_id: machineId,
        account_id: conv.account_id,
        // Published is set by publishInsight once the document exists, so
        // a failed publish leaves the insight reviewable instead of lying.
        status: autoPublish ? "pending" : status,
        resolution,
        title: distillation.title,
        problem: distillation.problem,
        cause: distillation.cause,
        solution: distillation.solution,
        facts: distillation.facts,
        open_questions: distillation.openQuestions,
        attachment_ids: distillation.worthKeeping
          ? relevantPhotoIds(photos, distillation.photoNumbers)
          : [],
        model: MODEL,
        ...(autoPublish ? {} : { promoted_doc_id: null }),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "conversation_id" },
    )
    .select("id")
    .single<{ id: string }>();
  if (saveErr || !saved) {
    console.warn(`distill: insight save failed for ${conv.id}:`, saveErr);
    return "failed";
  }

  if (autoPublish) {
    try {
      await publishInsight({
        insightId: saved.id,
        conversationId: conv.id,
        machineId,
        title: distillation.title,
        problem: distillation.problem,
        cause: distillation.cause,
        solution: distillation.solution,
        facts: distillation.facts,
        createdBy: "distiller",
      });
    } catch (err) {
      console.warn(
        `distill: auto-publish failed for ${conv.id}, left pending:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  await markDistilled(conv);
  return status;
}

// Stamp a conversation as over. Only fills what is still empty, so an
// earlier verdict (resolved, escalated) is never overwritten.
export async function closeConversation(conversationId: string): Promise<void> {
  const supabase = getSupabaseServerClient();
  const now = new Date().toISOString();
  await Promise.all([
    supabase
      .from("conversations")
      .update({ ended_at: now })
      .eq("id", conversationId)
      .is("ended_at", null),
    supabase
      .from("conversations")
      .update({ resolution: "unknown" })
      .eq("id", conversationId)
      .is("resolution", null),
  ]);
}

// Scheduled pass (src/app/api/cron/distill-sweep). Picks conversations
// that went quiet: idle past CONVERSATION_STALE_MS, or ended and idle past
// ENDED_GRACE_MS. Oldest first, one at a time, inside the caller's budget.
export async function sweepConversationsForDistillation(opts: {
  deadlineAt: number;
  limit: number;
}): Promise<{ processed: number; results: Record<string, number> }> {
  const supabase = getSupabaseServerClient();
  const now = Date.now();
  const staleBefore = new Date(now - CONVERSATION_STALE_MS).toISOString();
  const graceBefore = new Date(now - ENDED_GRACE_MS).toISOString();

  const { data, error } = await supabase
    .from("conversations")
    .select(
      "id, scope, machine_id, account_id, resolution, ended_at, last_message_at, distill_attempts",
    )
    .is("distilled_at", null)
    .lt("distill_attempts", MAX_ATTEMPTS)
    .lt("last_message_at", graceBefore)
    .or(`ended_at.not.is.null,last_message_at.lt.${staleBefore}`)
    .order("last_message_at", { ascending: true })
    .limit(opts.limit);
  if (error) throw new Error(`distill sweep: lookup failed: ${error.message}`);

  const results: Record<string, number> = {};
  let processed = 0;
  for (const conv of (data ?? []) as ConversationRow[]) {
    if (Date.now() > opts.deadlineAt) break;
    if (!conv.ended_at) await closeConversation(conv.id);
    const outcome = await distillConversation(conv);
    // A failure is retried on the next sweep, up to MAX_ATTEMPTS: one
    // that keeps failing would otherwise bill a model call every run and
    // keep newer conversations out of the batch.
    if (outcome === "failed") {
      await supabase
        .from("conversations")
        .update({ distill_attempts: conv.distill_attempts + 1 })
        .eq("id", conv.id);
    }
    results[outcome] = (results[outcome] ?? 0) + 1;
    processed++;
  }
  return { processed, results };
}
