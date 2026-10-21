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

import Anthropic from "@anthropic-ai/sdk";
import { publishExperienceDoc } from "./feedback";
import { getSupabaseServerClient } from "./supabase";
import { fromAnthropicUsage, recordUsage } from "./usage";

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

export type InsightStatus = "pending" | "published" | "rejected" | "nothing";

export type Distillation = {
  worthKeeping: boolean;
  title: string;
  problem: string;
  cause: string;
  solution: string;
  facts: string[];
  openQuestions: string[];
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
  },
  required: [
    "worth_keeping",
    "title",
    "problem",
    "cause",
    "solution",
    "facts",
    "open_questions",
  ],
  additionalProperties: false,
} as const;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

function buildTranscript(rows: MessageRow[]): string {
  const lines: string[] = [];
  for (const m of rows) {
    if (m.role === "user") {
      if (m.content.trim()) lines.push(`OPERATOR: ${m.content.trim()}`);
    } else if (m.role === "assistant") {
      if (m.content.trim()) lines.push(`ASSISTANT: ${m.content.trim()}`);
    } else if (m.role === "tool" && m.tool_name) {
      // Only the fact that a lookup ran, not its payload: it tells the
      // model whether an answer came from the manual.
      lines.push(`[assistant searched the knowledge base: ${m.tool_name}]`);
    }
  }
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
    };
  } catch {
    return null;
  }
}

// The KB chunk text. Problem first, because the next operator's query
// resembles the problem, not the answer (same reasoning as feedback.ts).
// Open questions stay out: they are gaps, not knowledge.
export function insightChunkContent(d: {
  problem: string;
  cause: string;
  solution: string;
  facts: string[];
}): string {
  const parts: string[] = [];
  if (d.problem) parts.push(`Problem:\n${d.problem}`);
  if (d.cause) parts.push(`Årsag:\n${d.cause}`);
  if (d.solution) parts.push(`Løsning:\n${d.solution}`);
  if (d.facts.length > 0) {
    parts.push(`Fakta om maskinen:\n${d.facts.map((f) => `- ${f}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

// Publish an insight's content as an Experience document and link it.
// Replaces whatever the insight (and the conversation's feedback row)
// pointed at before, so the KB holds one document per conversation.
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
  const content = insightChunkContent(args);
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

  const [{ data: prior }, { data: fb }] = await Promise.all([
    supabase
      .from("kb_insights")
      .select("promoted_doc_id")
      .eq("id", args.insightId)
      .maybeSingle<{ promoted_doc_id: string | null }>(),
    supabase
      .from("feedback")
      .select("id, promoted_doc_id")
      .eq("conversation_id", args.conversationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; promoted_doc_id: string | null }>(),
  ]);

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
      .select("role, content, tool_name")
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
  const hasUser = rows.some((m) => m.role === "user" && m.content.trim());
  const hasAnswer = rows.some((m) => m.role === "assistant" && m.content.trim());
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

  let distillation: Distillation | null = null;
  try {
    const anthropic = new Anthropic();
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
        {
          role: "user",
          content: `${verdict}${operatorNote}\n\nTranscript:\n\n${buildTranscript(rows)}`,
        },
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
    distillation = parseDistillation(
      final.content.map((b) => (b.type === "text" ? b.text : "")).join(""),
    );
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
