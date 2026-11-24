// Operator photos attached to chat messages (conversation_attachments).
//
// Since migration 20261124120000_message_attachments every attachment is
// tied to the user message it was sent with (message_id), and carries a
// one-off Claude-vision caption. Everything that replays a conversation
// (history reload, the model's later turns, admin views, the distiller
// that writes learnings) goes through here so photos are never dropped.
//
// Storage objects live in the private `chat-attachments` bucket. Never
// persist a signed URL — store the path, sign on demand.

import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseServerClient } from "./supabase";
import { fromAnthropicUsage, recordUsage, type UsageAttribution } from "./usage";

export const CHAT_ATTACHMENT_BUCKET = "chat-attachments";

export type StoredChatAttachment = {
  id: string;
  messageId: string | null;
  conversationId: string | null;
  machineId: string;
  storagePath: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  byteSize: number | null;
  caption: string | null;
  altText: string | null;
  createdAt: string;
};

type Row = {
  id: string;
  message_id: string | null;
  conversation_id: string | null;
  machine_id: string;
  storage_path: string;
  mime_type: StoredChatAttachment["mimeType"];
  byte_size: number | null;
  caption: string | null;
  alt_text: string | null;
  created_at: string;
};

const COLUMNS =
  "id, message_id, conversation_id, machine_id, storage_path, mime_type, byte_size, caption, alt_text, created_at";

function toAttachment(r: Row): StoredChatAttachment {
  return {
    id: r.id,
    messageId: r.message_id,
    conversationId: r.conversation_id,
    machineId: r.machine_id,
    storagePath: r.storage_path,
    mimeType: r.mime_type,
    byteSize: r.byte_size,
    caption: r.caption,
    altText: r.alt_text,
    createdAt: r.created_at,
  };
}

// All attachments of a conversation, oldest first.
export async function listConversationAttachments(
  conversationId: string,
): Promise<StoredChatAttachment[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("conversation_attachments")
    .select(COLUMNS)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listConversationAttachments: ${error.message}`);
  return ((data ?? []) as Row[]).map(toAttachment);
}

// Attachments by id (any order in, oldest first out).
export async function getAttachmentsByIds(
  ids: string[],
): Promise<StoredChatAttachment[]> {
  if (ids.length === 0) return [];
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("conversation_attachments")
    .select(COLUMNS)
    .in("id", ids)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`getAttachmentsByIds: ${error.message}`);
  return ((data ?? []) as Row[]).map(toAttachment);
}

// Groups attachments by the message they rode on. Attachments without a
// message_id (legacy rows the backfill could not place) are returned
// under the key "" so callers can still show them somewhere.
export function groupByMessage(
  attachments: StoredChatAttachment[],
): Map<string, StoredChatAttachment[]> {
  const out = new Map<string, StoredChatAttachment[]>();
  for (const a of attachments) {
    const key = a.messageId ?? "";
    const list = out.get(key) ?? [];
    list.push(a);
    out.set(key, list);
  }
  return out;
}

// Ties freshly sent attachments to their conversation + message. Only
// rows that are still unlinked to a message and belong to an allowed
// machine are touched, so a replayed or forged id can't be re-homed.
export async function linkAttachmentsToMessage(args: {
  attachmentIds: string[];
  conversationId: string;
  messageId: string;
  allowedMachineIds: string[];
}): Promise<string[]> {
  if (args.attachmentIds.length === 0) return [];
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("conversation_attachments")
    .update({ conversation_id: args.conversationId, message_id: args.messageId })
    .in("id", args.attachmentIds)
    .is("message_id", null)
    .or(`conversation_id.is.null,conversation_id.eq.${args.conversationId}`)
    .in("machine_id", args.allowedMachineIds)
    .select("id");
  if (error) throw new Error(`linkAttachmentsToMessage: ${error.message}`);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

// Signed URLs for display or for an image block in the latest turn.
// Returns a map id → url; ids that fail to sign are left out.
export async function signAttachments(
  attachments: Pick<StoredChatAttachment, "id" | "storagePath">[],
  ttlSeconds: number,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (attachments.length === 0) return out;
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.storage
    .from(CHAT_ATTACHMENT_BUCKET)
    .createSignedUrls(
      attachments.map((a) => a.storagePath),
      ttlSeconds,
    );
  if (error || !data) return out;
  data.forEach((d, i) => {
    if (d.signedUrl && !d.error) out.set(attachments[i].id, d.signedUrl);
  });
  return out;
}

// Text stand-in for a photo in transcripts and older model turns.
export function attachmentAsText(a: StoredChatAttachment, index?: number): string {
  const label = index != null ? `Photo ${index + 1}` : "Photo";
  return a.caption
    ? `[${label} attached by the operator: ${a.caption}]`
    : `[${label} attached by the operator — no description available]`;
}

const CAPTION_MODEL = "claude-sonnet-5-5";
const CAPTION_MAX_TOKENS = 2000;
const CAPTION_URL_TTL = 600;

// Describes each attachment that has no caption yet and stores it.
// Best effort: a failure leaves caption null and is logged, never thrown.
// Uses a signed-URL image source, so the 5 MB base64 limit doesn't bite
// on full-size phone photos.
export async function captionChatAttachments(
  ids: string[],
  usage?: UsageAttribution,
): Promise<void> {
  if (ids.length === 0) return;
  let rows: StoredChatAttachment[];
  try {
    rows = (await getAttachmentsByIds(ids)).filter((a) => !a.caption);
  } catch (err) {
    console.error("captionChatAttachments: lookup failed", err);
    return;
  }
  if (rows.length === 0) return;
  const urls = await signAttachments(rows, CAPTION_URL_TTL);
  const anthropic = new Anthropic();
  const supabase = getSupabaseServerClient();

  await Promise.all(
    rows.map(async (a) => {
      const url = urls.get(a.id);
      if (!url) return;
      try {
        const res = await anthropic.messages.create({
          model: CAPTION_MODEL,
          max_tokens: CAPTION_MAX_TOKENS,
          thinking: { type: "adaptive" },
          output_config: { effort: "low" },
          messages: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "url", url } },
                {
                  type: "text",
                  text:
                    "An operator on a factory floor attached this photo to a support chat about their machine. " +
                    "Describe it so someone who cannot see the image has the same information. " +
                    "Return ONLY a JSON object with two fields: " +
                    '  "caption": what is shown (machine part, HMI screen, alarm, damage, etc.), its state, and ALL visible text, numbers, alarm codes and values verbatim. Up to ~5 sentences. ' +
                    '  "alt_text": a single short phrase (<= 12 words) suitable as an <img alt>. ' +
                    "No prose outside the JSON object. No code fences.",
                },
              ],
            },
          ],
        });
        if (usage) {
          await recordUsage({
            ...usage,
            provider: "anthropic",
            model: CAPTION_MODEL,
            operation: "image_caption",
            ...fromAnthropicUsage(res.usage),
          });
        }
        if (res.stop_reason === "max_tokens") throw new Error("caption truncated");
        const text = res.content
          .map((b) => (b.type === "text" ? b.text : ""))
          .join("")
          .trim()
          .replace(/^```(?:json)?/i, "")
          .replace(/```$/i, "")
          .trim();
        let caption = text;
        let altText = text.slice(0, 80);
        try {
          const obj = JSON.parse(text) as { caption?: unknown; alt_text?: unknown };
          if (typeof obj.caption === "string" && obj.caption.trim()) {
            caption = obj.caption.trim();
            altText =
              typeof obj.alt_text === "string" && obj.alt_text.trim()
                ? obj.alt_text.trim()
                : caption.slice(0, 80);
          }
        } catch {
          // keep the raw text as caption
        }
        if (!caption) return;
        await supabase
          .from("conversation_attachments")
          .update({ caption, alt_text: altText })
          .eq("id", a.id);
      } catch (err) {
        console.error(`captionChatAttachments: ${a.id} failed`, err);
      }
    }),
  );
}
